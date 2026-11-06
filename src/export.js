// Freemiere Pro — turns a sequence into one FFmpeg command.
//
// Picture: every video track is composited bottom-up over the background.
//   • A clip without transitions is scaled, run through its effects, faded,
//     scaled/rotated (static or keyframed) and overlaid at its position.
//   • Clips joined by transitions form a "run": each clip is rendered onto a
//     transparent full frame (with transition handles) and the run is chained
//     with `xfade`, then overlaid.
//   • Adjustment layers apply their effects to everything below them.
// Sound: every clip is trimmed, processed (effects, volume/pan keyframes,
//   fades, audio transitions), delayed to its start and mixed with `amix`.

const fs = require('fs');
const path = require('path');
const D = require('./shared/defs');

const num = (n, d = 4) => {
  const s = Number(Number(n).toFixed(d)).toString();
  return s === '-0' ? '0' : s;
};
const even = (n) => { n = Math.max(2, Math.round(n)); return n % 2 ? n + 1 : n; };
const hex = (c) => '0x' + String(c || '#000000').replace('#', '').slice(0, 6);
const atempo = (speed) => {
  const parts = [];
  let r = speed;
  while (r > 2) { parts.push(2); r /= 2; }
  while (r < 0.5) { parts.push(0.5); r /= 0.5; }
  if (Math.abs(r - 1) > 1e-6) parts.push(r);
  return parts.map((p) => `atempo=${num(p, 5)}`);
};

function seqDuration(seq) {
  let end = 0;
  for (const c of seq.clips) end = Math.max(end, c.start + c.duration);
  return Math.max(end, 0.04);
}
function projectDuration(project, seqId) {
  const seq = project.sequences ? project.sequences.find((s) => s.id === seqId) || project.sequences[0] : project;
  return seqDuration(seq);
}

function buildExportArgs(project, options, assets, outPath, tmpDir) {
  const seq = project.sequences.find((s) => s.id === options.seqId) || project.sequences[0];
  const { width: W, height: H, bg } = seq.settings;
  const F = options.fps || seq.settings.fps;
  const OW = even(options.width || W);
  const OH = even(options.height || H);
  const full = seqDuration(seq);
  const range = options.range && options.range.end > options.range.start ? options.range : null;
  const media = Object.fromEntries(project.media.map((m) => [m.id, m]));
  const images = assets.images || {};
  const meta = assets.meta || {};
  const luts = assets.luts || {};
  const eps = 0.5 / seq.settings.fps;
  const clips = seq.clips.filter((c) => c.type !== 'nest');

  const inputs = [];
  const filters = [];
  let nInputs = 0;
  let uid = 0;
  const lbl = (p = 'x') => `${p}${uid++}`;
  const addInput = (args) => { inputs.push(...args); return nInputs++; };
  const loopImage = (file, L) => addInput(['-f', 'image2', '-pattern_type', 'none', '-loop', '1', '-framerate', String(F), '-t', num(L + 0.1), '-i', file]);

  const prevAdj = (c) => clips.find((o) => o.trackId === c.trackId && o.id !== c.id && Math.abs(o.start + o.duration - c.start) < eps) || null;
  const nextAdj = (c) => clips.find((o) => o.trackId === c.trackId && o.id !== c.id && Math.abs(c.start + c.duration - o.start) < eps) || null;
  const isVisual = (c) => ['video', 'image', 'text', 'graphic', 'solid', 'adjust'].includes(c.type);
  // a speed-ramped video keeps only its picture (as in Premiere); unlinked/linked audio clips play normally
  const hasAudio = (c) => c.type === 'audio' || (c.type === 'video' && !c.noAudio && !D.isRamped(c) && media[c.mediaId] && media[c.mediaId].hasAudio);
  const geom = (c) => meta[c.id] || { bw: W, bh: H };

  // ------------------------------------------------------------ animated parameters
  // Keyframed effect parameters and moving masks are driven by `sendcmd`: one command file
  // per clip stream lists, frame by frame, every value that changes. `cmd` collects them.
  let cmd = null;
  const cmdName = (filter) => `${filter}@k${uid++}`;
  function track(name, param, valueAt) {
    if (!cmd) return;
    cmd.tracks.push({ name, param, valueAt });
  }
  function flushCmd(inL) {
    const c0 = cmd;
    cmd = null;
    if (!c0 || !c0.tracks.length) return inL;
    const lines = [];
    const frames = Math.ceil(c0.L * F) + 1;
    const last = c0.tracks.map(() => null);
    for (let n = 0; n <= frames; n++) {
      const t = n / F;
      const u = FLclamp(t - c0.head, 0, c0.c.duration);
      const parts = [];
      c0.tracks.forEach((tk, i) => {
        const v = tk.valueAt(u);
        if (v !== last[i]) { parts.push(`${tk.name} ${tk.param} ${v}`); last[i] = v; }
      });
      if (parts.length) lines.push(`${num(t, 4)} ${parts.join(', ')};`);
    }
    const file = path.join(tmpDir, `cmd${uid++}.txt`);
    fs.writeFileSync(file, lines.join('\n') + '\n');
    const out = lbl('cm');
    filters.push(`[${inL}]sendcmd=f='${file.replace(/\\/g, '/').replace(/'/g, "\\'")}'[${out}]`);
    return out;
  }
  const at = (c, e, u) => D.effectAt(c, e, u);
  const lutExpr = (lin, i) => `val*${num(lin[i][0], 5)}${lin[i][1] >= 0 ? '+' : ''}${num(lin[i][1] * 255, 3)}`;

  // ------------------------------------------------------------ video effects
  function effectBody(e, inL, c, bw, bh, L) {
    const p = e.params || {};
    const out = lbl('fx');
    const f = [];
    const animated = cmd && D.effectAnimated(c, e);
    switch (e.type) {
      case 'lumetri': case 'bw': {
        const { lin, M } = D.colorOps(e);
        // lutrgb clips its results to 0–255 by itself
        const lut = ['r', 'g', 'b'].map((ch, i) => `${ch}='${lutExpr(lin, i)}'`).join(':');
        const mx = ['r', 'g', 'b'].map((o, r) => ['r', 'g', 'b'].map((i, cc) => `${o}${i}=${num(M[r][cc], 5)}`).join(':')).join(':');
        if (!animated) { filters.push(`[${inL}]lutrgb=${lut},colorchannelmixer=${mx}[${out}]`); return out; }
        const ln = cmdName('lutrgb');
        const mn = cmdName('colorchannelmixer');
        ['r', 'g', 'b'].forEach((ch, i) => track(ln, ch, (u) => lutExpr(D.colorOps(at(c, e, u)).lin, i)));
        ['r', 'g', 'b'].forEach((o, r) => ['r', 'g', 'b'].forEach((ii, cc) => track(mn, o + ii, (u) => num(D.colorOps(at(c, e, u)).M[r][cc], 5))));
        filters.push(`[${inL}]${ln}=${lut},${mn}=${mx}[${out}]`);
        return out;
      }
      case 'blur':
        if (animated) {
          const gn = cmdName('gblur');
          track(gn, 'sigma', (u) => num(Math.max(0, at(c, e, u).params.amount) * 0.5, 3));
          filters.push(`[${inL}]${gn}=sigma=${num(Math.max(0, p.amount) * 0.5, 3)}[${out}]`);
          return out;
        }
        if (!(p.amount > 0)) return inL;
        filters.push(`[${inL}]gblur=sigma=${num(p.amount * 0.5, 3)}[${out}]`);
        return out;
      case 'lut': {
        const file = luts[p.file];
        if (!file) return inL;
        const k = (p.intensity ?? 100) / 100;
        const esc = file.replace(/\\/g, '/').replace(/'/g, "\\'");
        if (!animated && k >= 0.999) { filters.push(`[${inL}]lut3d=file='${esc}':interp=tetrahedral[${out}]`); return out; }
        const a = lbl('la'); const b = lbl('lb'); const l = lbl('ll');
        const bn = cmdName('blend');
        if (animated) track(bn, 'all_opacity', (u) => num(FLclamp((at(c, e, u).params.intensity ?? 100) / 100, 0, 1), 4));
        filters.push(`[${inL}]split[${a}][${b}]`);
        filters.push(`[${a}]lut3d=file='${esc}':interp=tetrahedral[${l}]`);
        filters.push(`[${l}][${b}]${bn}=all_mode=normal:all_opacity=${num(FLclamp(k, 0, 1), 4)}[${out}]`);
        return out;
      }
      case 'sharpen': {
        const k = (p.amount / 100) * 1.5;
        const m = `0 ${num(-k)} 0 ${num(-k)} ${num(1 + 4 * k)} ${num(-k)} 0 ${num(-k)} 0`;
        filters.push(`[${inL}]format=gbrap,convolution=0m='${m}':1m='${m}':2m='${m}':3m='0 0 0 0 1 0 0 0 0':0rdiv=1:1rdiv=1:2rdiv=1:3rdiv=1,format=rgba[${out}]`);
        return out;
      }
      case 'mosaic': {
        const n = Math.max(1, Math.round(p.blocks));
        const m = Math.max(1, Math.round((p.blocks * bh) / bw));
        filters.push(`[${inL}]scale=${n}:${m}:flags=area,scale=${bw}:${bh}:flags=neighbor[${out}]`);
        return out;
      }
      case 'vignette': {
        const file = images[`vig:${c.id}:${e.id}`];
        if (!file) return inL;
        const idx = loopImage(file, L);
        filters.push(`[${idx}:v]format=rgba,scale=${bw}:${bh}[${out}v]`);
        filters.push(`[${inL}][${out}v]overlay=0:0:format=auto:shortest=1[${out}]`);
        return out;
      }
      case 'crop': {
        const l = Math.round((p.left / 100) * bw);
        const t = Math.round((p.top / 100) * bh);
        const cw = Math.round(bw - l - (p.right / 100) * bw);
        const ch = Math.round(bh - t - (p.bottom / 100) * bh);
        if (cw < 2 || ch < 2) f.push('colorchannelmixer=aa=0');
        else if (l || t || cw !== bw || ch !== bh) f.push(`crop=${cw}:${ch}:${l}:${t}`, `pad=${bw}:${bh}:${l}:${t}:color=black@0`);
        else return inL;
        break;
      }
      case 'hflip': f.push('hflip'); break;
      case 'vflip': f.push('vflip'); break;
      case 'chromakey':
        f.push('format=yuva444p', `chromakey=color=${hex(p.color)}:similarity=${num(Math.max(0.00001, (p.similarity / 100) * 0.4))}:blend=${num((p.blend / 100) * 0.4)}`, 'format=rgba');
        break;
      default: return inL;
    }
    filters.push(`[${inL}]${f.join(',')}[${out}]`);
    return out;
  }

  // head: where clip-local time 0 falls in this stream (transition handles come first)
  function applyEffects(inL, c, bw, bh, L, head = 0) {
    cmd = { c, L, head, tracks: [] };
    // the command file is attached at the head of the chain once all effects are known
    const startL = lbl('cs');
    let cur = startL;
    for (const e of c.effects || []) {
      if (!e.enabled || !D.VIDEO_EFFECTS[e.type]) continue;
      const hasMask = e.mask && !D.VIDEO_EFFECTS[e.type].noMask;
      const maskFile = hasMask ? images[`mask:${c.id}:${e.id}`] : null;
      const stampFile = hasMask ? images[`mstamp:${c.id}:${e.id}`] : null;
      if (maskFile || stampFile) {
        const o = lbl('mo'); const e1 = lbl('me');
        filters.push(`[${cur}]split[${o}][${e1}]`);
        const ef = effectBody(e, e1, c, bw, bh, L);
        const m = lbl('mk'); const em = lbl('em'); const out = lbl('mf');
        if (stampFile) {
          // moving mask: a black frame with the white shape overlaid at its keyframed position
          const st = (meta[c.id] || {})[`mstamp:${e.id}`] || { w: bw, h: bh };
          const idx = loopImage(stampFile, L);
          const on = cmdName('overlay');
          const pos = (u, axis) => {
            const mk = at(c, e, u).mask;
            return axis === 'x' ? Math.round(mk.cx * bw - st.w / 2) : Math.round(mk.cy * bh - st.h / 2);
          };
          track(on, 'x', (u) => pos(u, 'x'));
          track(on, 'y', (u) => pos(u, 'y'));
          const bg = lbl('mb'); const sp = lbl('sp');
          filters.push(`color=c=black:s=${bw}x${bh}:r=${F}:d=${num(L)},format=rgba[${bg}]`);
          filters.push(`[${idx}:v]format=rgba[${sp}]`);
          filters.push(`[${bg}][${sp}]${on}=x=${pos(0, 'x')}:y=${pos(0, 'y')}:format=auto:shortest=1,format=gray${e.mask.invert ? ',negate' : ''}[${m}]`);
        } else {
          const idx = loopImage(maskFile, L);
          filters.push(`[${idx}:v]format=gray,scale=${bw}:${bh}[${m}]`);
        }
        filters.push(`[${ef}][${m}]alphamerge[${em}]`);
        filters.push(`[${o}][${em}]overlay=0:0:format=auto[${out}]`);
        cur = out;
      } else cur = effectBody(e, cur, c, bw, bh, L);
    }
    if (cur === startL) { cmd = null; return inL; }
    // splice: [inL] → (sendcmd, if anything is animated) → startL
    filters.push(`[${flushCmd(inL)}]null[${startL}]`);
    return cur;
  }

  // opacity (static/keyframed) and legacy fades; local time origin at `head`
  function applyOpacity(inL, c, head, L) {
    const f = [];
    if (D.hasKf(c, 'opacity')) {
      const name = `colorchannelmixer@op${uid++}`;
      const lines = [];
      let last = null;
      const frames = Math.ceil(L * F) + 1;
      for (let n = 0; n <= frames; n++) {
        const t = n / F;
        const v = FLclamp(D.kfValue(c, 'opacity', FLclamp(t - head, 0, c.duration)), 0, 1);
        const s = num(v, 3);
        if (s !== last) { lines.push(`${num(t, 4)} ${name} aa ${s};`); last = s; }
      }
      const file = path.join(tmpDir, `op${uid++}.cmd`);
      fs.writeFileSync(file, lines.join('\n') + '\n');
      f.push(`sendcmd=f=${file.replace(/\\/g, '/')}`, `${name}=aa=${num(FLclamp(D.kfValue(c, 'opacity', 0), 0, 1), 3)}`);
    } else if ((c.opacity ?? 1) < 1) f.push(`colorchannelmixer=aa=${num(Math.max(0, c.opacity))}`);
    if (c.fadeIn > 0) f.push(`fade=t=in:st=${num(head)}:d=${num(Math.min(c.fadeIn, c.duration))}:alpha=1`);
    if (c.fadeOut > 0) f.push(`fade=t=out:st=${num(head + Math.max(0, c.duration - c.fadeOut))}:d=${num(Math.min(c.fadeOut, c.duration))}:alpha=1`);
    if (!f.length) return inL;
    const out = lbl('op');
    filters.push(`[${inL}]${f.join(',')}[${out}]`);
    return out;
  }

  // scale / rotation (static or keyframed); position is applied by the overlay
  function applyMotion(inL, c, bw, bh, head) {
    const U = `(t-${num(head)})`;
    const animated = D.hasKf(c, 'scale') || D.hasKf(c, 'rotation');
    const out = lbl('mo');
    if (!animated) {
      const f = [];
      const s = c.scale ?? 1;
      if (Math.abs(s - 1) > 1e-4) f.push(`scale=${even(bw * s)}:${even(bh * s)}:flags=bicubic`);
      if (c.rotation) {
        const a = num((c.rotation * Math.PI) / 180, 6);
        f.push(`rotate=${a}:c=none:ow=rotw(${a}):oh=roth(${a})`);
      }
      if (!f.length) return inL;
      filters.push(`[${inL}]${f.join(',')}[${out}]`);
      return out;
    }
    const svals = [c.scale ?? 1, ...((c.kf && c.kf.scale) || []).map((k) => k.v)];
    const maxS = Math.max(...svals.map((v) => Math.abs(v)), 0.01);
    const Dm = even(Math.ceil(Math.hypot(bw, bh) * maxS) + 4);
    const S = D.kfExpr(c, 'scale', U);
    const Rr = D.kfExpr(c, 'rotation', U);
    filters.push(`[${inL}]scale=w='max(2,trunc(${bw}*(${S})/2)*2)':h='max(2,trunc(${bh}*(${S})/2)*2)':eval=frame:flags=bicubic,` +
      `pad=w=${Dm}:h=${Dm}:x='(ow-iw)/2':y='(oh-ih)/2':color=black@0:eval=frame,` +
      `rotate=a='(${Rr})*PI/180':c=none:ow=${Dm}:oh=${Dm}[${out}]`);
    return out;
  }

  // one clip as an rgba stream with local timestamps 0..L (L = head + duration + tail)
  function clipStream(c, head, tail) {
    const L = head + c.duration + tail;
    const { bw, bh } = geom(c);
    let cur = lbl('src');
    if (c.type === 'video') {
      const m = media[c.mediaId];
      const inP = c.in || 0;
      let ss; let padHead; let srcLen; let pts;
      if (D.isRamped(c)) {
        // speed ramp: each source frame is placed at the clip time where the ramp reaches it
        ss = Math.max(0, inP + D.srcOffset(c, -head));
        padHead = Math.max(0, D.srcInverse(c, ss - inP) + head);
        srcLen = D.srcOffset(c, c.duration + tail) - (ss - inP) + 0.5;
        const inv = D.srcInverseExpr(c, `(PTS-STARTPTS)*TB+${num(ss - inP, 5)}`);
        pts = `setpts='(${inv}+${num(head - padHead, 5)})/TB'`;
      } else {
        const speed = c.speed || 1;
        const want = head * speed;
        ss = Math.max(0, inP - want);
        padHead = (want - (inP - ss)) / speed;
        srcLen = L * speed + 0.5;
        pts = speed !== 1 ? `setpts=(PTS-STARTPTS)/${num(speed, 5)}` : 'setpts=PTS-STARTPTS';
      }
      const idx = addInput(['-ss', num(ss), '-t', num(srcLen), '-i', m.path]);
      const f = [pts, `fps=${F}`, `scale=${bw}:${bh}:flags=bicubic`, 'setsar=1', 'format=rgba'];
      if (padHead > 0.001) f.push(`tpad=start_duration=${num(padHead)}:start_mode=clone`);
      f.push(`tpad=stop_mode=clone:stop_duration=${num(tail + 1)}`, `trim=duration=${num(L)}`, 'setpts=PTS-STARTPTS');
      filters.push(`[${idx}:v]${f.join(',')}[${cur}]`);
    } else if (c.type === 'image') {
      const idx = loopImage(media[c.mediaId].path, L);
      filters.push(`[${idx}:v]scale=${bw}:${bh}:flags=bicubic,setsar=1,format=rgba,trim=duration=${num(L)},setpts=PTS-STARTPTS[${cur}]`);
    } else if (c.type === 'text') {
      const idx = loopImage(images[`text:${c.id}`], L);
      filters.push(`[${idx}:v]format=rgba,trim=duration=${num(L)},setpts=PTS-STARTPTS[${cur}]`);
    } else if (c.type === 'solid') {
      filters.push(`color=c=${hex(c.color)}:s=${bw}x${bh}:r=${F}:d=${num(L)},format=rgba[${cur}]`);
    } else if (c.type === 'graphic') {
      const idx = loopImage(images[`gfx:${c.id}`], L);
      const st = lbl('gs');
      filters.push(`[${idx}:v]format=rgba,trim=duration=${num(L)},setpts=PTS-STARTPTS[${st}]`);
      const cr = meta[c.id] && meta[c.id].crawl;
      if (cr && images[`crawl:${c.id}`]) {
        const sIdx = loopImage(images[`crawl:${c.id}`], L);
        const reg = lbl('rg'); const crl = lbl('cr');
        const d = `(${num(cr.speed, 3)}*max(0,t-${num(head)}))`;
        const x = `if(lt(${d},${cr.rw}),${cr.rw}-${d},-mod(${d}-${cr.rw},${num(cr.period, 3)}))`;
        filters.push(`color=c=black@0:s=${cr.rw}x${cr.rh}:r=${F}:d=${num(L)},format=rgba[${reg}]`);
        filters.push(`[${reg}][${sIdx}:v]overlay=x='${x}':y=0:format=auto:shortest=1[${crl}]`);
        filters.push(`[${st}][${crl}]overlay=x=${cr.rx}:y=${cr.ry}:format=auto[${cur}]`);
      } else cur = st;
    }
    cur = applyEffects(cur, c, bw, bh, L, head);
    cur = applyOpacity(cur, c, head, L);
    cur = applyMotion(cur, c, bw, bh, head);
    return { label: cur, L };
  }

  const posExpr = (c, U, axis) => D.kfExpr(c, axis, U);

  // ------------------------------------------------------------ compositing
  // nested sequences render with a transparent background so lower tracks show through
  filters.push(`color=c=${options.transparent ? 'black@0' : hex(bg)}:s=${W}x${H}:r=${F}:d=${num(full)},format=rgba[L0]`);
  let cur = 'L0';

  function direct(c) {
    const { label } = clipStream(c, 0, 0);
    const s = lbl('sh'); const next = lbl('L');
    const U = `(t-${num(c.start)})`;
    filters.push(`[${label}]setpts=PTS-STARTPTS+${num(c.start)}/TB[${s}]`);
    filters.push(`[${cur}][${s}]overlay=x='(main_w-overlay_w)/2+${posExpr(c, U, 'x')}':y='(main_h-overlay_h)/2+${posExpr(c, U, 'y')}'` +
      `:enable='between(t,${num(c.start)},${num(c.start + c.duration)})':eof_action=pass:format=auto[${next}]`);
    cur = next;
  }

  function fullFrame(c, head, tail) {
    const { label, L } = clipStream(c, head, tail);
    const cv = lbl('cv'); const out = lbl('ff');
    const U = `(t-${num(head)})`;
    filters.push(`color=c=black@0:s=${W}x${H}:r=${F}:d=${num(L)},format=rgba[${cv}]`);
    filters.push(`[${cv}][${label}]overlay=x='(main_w-overlay_w)/2+${posExpr(c, U, 'x')}':y='(main_h-overlay_h)/2+${posExpr(c, U, 'y')}':format=auto:eof_action=pass,format=gbrap[${out}]`);
    return { label: out, L };
  }
  const transparent = (d) => {
    const t = lbl('tp');
    filters.push(`color=c=black@0:s=${W}x${H}:r=${F}:d=${num(d)},format=gbrap[${t}]`);
    return t;
  };
  const xf = (type) => (D.VIDEO_TRANSITIONS[type] || D.VIDEO_TRANSITIONS.crossdissolve).xfade;

  function run(list) {
    const parts = list.map((c, i) => fullFrame(c, i > 0 ? c.transIn.duration / 2 : 0, i < list.length - 1 ? list[i + 1].transIn.duration / 2 : 0));
    let acc = parts[0].label;
    let Lacc = parts[0].L;
    const c0 = list[0];
    const pv = prevAdj(c0);
    if (c0.transIn && !pv) {
      const d = Math.min(c0.transIn.duration, Lacc);
      const o = lbl('xf');
      filters.push(`[${transparent(d)}][${acc}]xfade=transition=${xf(c0.transIn.type)}:duration=${num(d)}:offset=0[${o}]`);
      acc = o;
    }
    for (let i = 1; i < list.length; i++) {
      const d = list[i].transIn.duration;
      const o = lbl('xf');
      filters.push(`[${acc}][${parts[i].label}]xfade=transition=${xf(list[i].transIn.type)}:duration=${num(d)}:offset=${num(Lacc - d)}[${o}]`);
      acc = o;
      Lacc = Lacc + parts[i].L - d;
    }
    const cn = list[list.length - 1];
    const nx = nextAdj(cn);
    if (cn.transOut && !(nx && nx.transIn)) {
      const d = Math.min(cn.transOut.duration, Lacc);
      const o = lbl('xf');
      filters.push(`[${acc}][${transparent(d)}]xfade=transition=${xf(cn.transOut.type)}:duration=${num(d)}:offset=${num(Lacc - d)}[${o}]`);
      acc = o;
    }
    const s = lbl('rs'); const next = lbl('L');
    const start = c0.start;
    const end = cn.start + cn.duration;
    filters.push(`[${acc}]format=rgba,setpts=PTS-STARTPTS+${num(start)}/TB[${s}]`);
    filters.push(`[${cur}][${s}]overlay=0:0:enable='between(t,${num(start)},${num(end)})':eof_action=pass:format=auto[${next}]`);
    cur = next;
  }

  function adjust(c) {
    const fx = (c.effects || []).filter((e) => e.enabled && D.VIDEO_EFFECTS[e.type]);
    if (!fx.length) return;
    const a = lbl('aa'); const b = lbl('ab'); const t = lbl('at');
    const s = c.start; const e = c.start + c.duration;
    filters.push(`[${cur}]split[${a}][${b}]`);
    filters.push(`[${b}]trim=start=${num(s)}:end=${num(e)},setpts=PTS-STARTPTS[${t}]`);
    let x = applyEffects(t, c, W, H, c.duration, 0);
    x = applyOpacity(x, c, 0, c.duration);
    const sh = lbl('as'); const next = lbl('L');
    filters.push(`[${x}]format=rgba,setpts=PTS-STARTPTS+${num(s)}/TB[${sh}]`);
    filters.push(`[${a}][${sh}]overlay=0:0:enable='between(t,${num(s)},${num(e)})':eof_action=pass:format=auto[${next}]`);
    cur = next;
  }

  let videoTracks = seq.tracks.filter((t) => t.kind === 'video').reverse();
  // a multi-camera angle renders only its own video track
  if (options.angle != null) videoTracks = videoTracks.filter((t, i) => i === options.angle);
  for (const track of videoTracks) {
    if (track.hidden && options.angle == null) continue;
    const list = clips.filter((c) => c.trackId === track.id && isVisual(c)).sort((a, b) => a.start - b.start);
    const done = new Set();
    for (const c of list) {
      if (done.has(c.id)) continue;
      done.add(c.id);
      if (c.type === 'adjust') { adjust(c); continue; }
      if (c.type === 'video' && !media[c.mediaId]) continue;
      if (c.type === 'image' && !media[c.mediaId]) continue;
      const chain = [c];
      for (;;) {
        const n = nextAdj(chain[chain.length - 1]);
        if (!n || !n.transIn || n.type === 'adjust' || done.has(n.id)) break;
        if ((n.type === 'video' || n.type === 'image') && !media[n.mediaId]) break;
        chain.push(n);
        done.add(n.id);
      }
      const oneIn = !!c.transIn;
      const last = chain[chain.length - 1];
      const nx = nextAdj(last);
      const oneOut = last.transOut && !(nx && nx.transIn);
      if (chain.length > 1 || oneIn || oneOut) run(chain);
      else direct(c);
    }
  }
  const enc = encoderArgs(options, OW, OH, F);
  const vFinal = [];
  if (range) vFinal.push(`trim=start=${num(range.start)}:end=${num(range.end)}`, 'setpts=PTS-STARTPTS');
  if (OW !== W || OH !== H) vFinal.push(`scale=${OW}:${OH}:flags=lanczos`);
  vFinal.push(`format=${enc.pixFmt}`);
  filters.push(`[${cur}]${vFinal.join(',')}[vout]`);

  // ------------------------------------------------------------ sound
  const anySolo = seq.tracks.some((t) => t.kind === 'audio' && t.solo);
  const trackById = Object.fromEntries(seq.tracks.map((t) => [t.id, t]));
  const curveOf = (tr) => (D.AUDIO_TRANSITIONS[tr && tr.type] || D.AUDIO_TRANSITIONS.constantpower).curve;
  const mix = [];
  for (const c of clips) {
    if (!hasAudio(c) || c.muted) continue;
    const tr = trackById[c.trackId];
    if (!tr) continue;
    if (tr.kind === 'audio' ? tr.muted || (anySolo && !tr.solo) : anySolo) continue;
    const m = media[c.mediaId];
    if (!m) continue;
    const speed = c.speed || 1;
    const pv = prevAdj(c);
    const nx = nextAdj(c);
    const pairIn = c.atransIn && pv;
    const pairOut = nx && nx.atransIn;
    let head = pairIn ? c.atransIn.duration / 2 : 0;
    let tail = pairOut ? nx.atransIn.duration / 2 : 0;
    head = Math.min(head, (c.in || 0) / speed);
    tail = Math.max(0, Math.min(tail, ((m.duration || 0) - (c.in || 0) - c.duration * speed) / speed));
    const L = head + c.duration + tail;
    const idx = addInput(['-ss', num((c.in || 0) - head * speed), '-t', num(L * speed + 0.1), '-i', m.path]);
    // mono sources go to both speakers at full level (FFmpeg's default upmix is 3 dB quieter than the preview)
    const f = [...(m.channels === 1 ? ['pan=stereo|c0=c0|c1=c0'] : []), 'aresample=48000', 'aformat=sample_fmts=fltp:channel_layouts=stereo', 'asetpts=PTS-STARTPTS', ...atempo(speed), `apad=whole_dur=${num(L)}`, `atrim=duration=${num(L)}`];
    for (const e of c.effects || []) {
      if (!e.enabled || !D.AUDIO_EFFECTS[e.type]) continue;
      const p = e.params;
      if (e.type === 'gain' && p.gain) f.push(`volume=${num(p.gain, 2)}dB`);
      if (e.type === 'eq') {
        if (p.bass) f.push(`bass=g=${num(p.bass, 2)}:f=120`);
        if (p.mid) f.push(`equalizer=f=1000:t=q:w=0.7:g=${num(p.mid, 2)}`);
        if (p.treble) f.push(`treble=g=${num(p.treble, 2)}:f=4000`);
      }
      if (e.type === 'highpass') f.push(`highpass=f=${num(p.freq, 1)}`);
      if (e.type === 'lowpass') f.push(`lowpass=f=${num(p.freq, 1)}`);
      if (e.type === 'denoise') f.push(`afftdn=nr=${num(p.amount, 1)}`);
      if (e.type === 'compressor') f.push(`acompressor=threshold=${num(p.threshold, 1)}dB:ratio=${num(p.ratio, 2)}:attack=20:release=250`);
    }
    const U = `(t-${num(head)})`;
    if (D.hasKf(c, 'volume')) f.push(`volume='max(0,${D.kfExpr(c, 'volume', U)})':eval=frame`);
    else if ((c.volume ?? 1) !== 1) f.push(`volume=${num(c.volume)}`);
    if (c.fadeIn > 0) f.push(`afade=t=in:st=${num(head)}:d=${num(Math.min(c.fadeIn, c.duration))}`);
    if (c.fadeOut > 0) f.push(`afade=t=out:st=${num(head + Math.max(0, c.duration - c.fadeOut))}:d=${num(Math.min(c.fadeOut, c.duration))}`);
    if (c.atransIn) {
      const d = pairIn ? head + c.atransIn.duration / 2 : c.atransIn.duration;
      f.push(`afade=t=in:st=0:d=${num(Math.max(0.01, d))}:curve=${curveOf(c.atransIn)}`);
    }
    if (pairOut) {
      const d = nx.atransIn.duration / 2 + tail;
      f.push(`afade=t=out:st=${num(L - d)}:d=${num(Math.max(0.01, d))}:curve=${curveOf(nx.atransIn)}`);
    } else if (c.atransOut) {
      const d = Math.min(c.atransOut.duration, c.duration);
      f.push(`afade=t=out:st=${num(head + c.duration - d)}:d=${num(d)}:curve=${curveOf(c.atransOut)}`);
    }
    const a = lbl('a');
    let chain = `[${idx}:a]${f.join(',')}`;
    if (D.hasKf(c, 'pan') || Math.abs(c.pan || 0) > 1e-4) {
      const P = D.kfExpr(c, 'pan', U);
      const s1 = lbl('pl'); const s2 = lbl('pr'); const l2 = lbl('ql'); const r2 = lbl('qr'); const j = lbl('pj');
      filters.push(`${chain},channelsplit=channel_layout=stereo[${s1}][${s2}]`);
      filters.push(`[${s1}]volume='min(1,1-(${P}))':eval=frame[${l2}]`);
      filters.push(`[${s2}]volume='min(1,1+(${P}))':eval=frame[${r2}]`);
      filters.push(`[${l2}][${r2}]join=inputs=2:channel_layout=stereo[${j}]`);
      chain = `[${j}]anull`;
    }
    const ms = Math.round((c.start - head) * 1000);
    filters.push(`${chain}${ms > 0 ? `,adelay=${ms}:all=1` : ''}[${a}]`);
    mix.push(`[${a}]`);
  }
  filters.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${num(full)}[asil]`);
  const aFinal = [`amix=inputs=${mix.length + 1}:duration=first:dropout_transition=0:normalize=0`, 'alimiter=limit=0.98'];
  if (range) aFinal.push(`atrim=start=${num(range.start)}:end=${num(range.end)}`, 'asetpts=PTS-STARTPTS');
  filters.push(`[asil]${mix.join('')}${aFinal.join(',')}[aout]`);

  const total = range ? range.end - range.start : full;
  const graph = filters.join(';\n');
  try { fs.writeFileSync(path.join(tmpDir, `graph${options.angle != null ? '-cam' + options.angle : ''}-${seq.id}.txt`), graph); } catch (_) { /* debug copy only */ }
  const args = [
    '-y', '-hide_banner', '-nostdin',
    ...inputs,
    '-filter_complex', graph,
    '-map', '[vout]', '-map', '[aout]',
    ...enc.video, '-r', String(F),
    ...enc.audio, '-ar', '48000',
    '-t', num(total),
    '-movflags', '+faststart',
    '-progress', 'pipe:1', '-nostats',
    outPath,
  ];
  return { args, total, encoder: enc.name };
}

// Video/audio encoder settings.
//   options.codec: 'h264' | 'hevc' | 'prores' | 'prores_hq' | 'intermediate' (internal: nested renders)
//   options.hw:    use Apple VideoToolbox (only when the encoder exists; see main.js)
//   options.quality: 'high' | 'standard' | 'draft'
const BITS_PER_PIXEL = { high: 0.12, standard: 0.075, draft: 0.04 };
function encoderArgs(options, w, h, fps) {
  const quality = options.quality || 'standard';
  const codec = options.codec || 'h264';
  const kbps = (k) => `${Math.max(500, Math.round((BITS_PER_PIXEL[quality] * w * h * fps * k) / 1000))}k`;
  const aac = ['-c:a', 'aac', '-b:a', '192k'];
  if (codec === 'intermediate') {
    // nested sequences: ProRes 4444 keeps the transparency, and is quick to write and read back
    return { name: 'ProRes 4444 (intermediate)', pixFmt: 'yuva444p10le', video: ['-c:v', 'prores_ks', '-profile:v', '4', '-alpha_bits', '16', '-pix_fmt', 'yuva444p10le', '-vendor', 'apl0'], audio: ['-c:a', 'pcm_s16le'] };
  }
  if (codec === 'prores' || codec === 'prores_hq') {
    return {
      name: 'ProRes 422' + (codec === 'prores_hq' ? ' HQ' : ''),
      pixFmt: 'yuv422p10le',
      video: ['-c:v', 'prores_ks', '-profile:v', codec === 'prores_hq' ? '3' : '2', '-vendor', 'apl0', '-pix_fmt', 'yuv422p10le'],
      audio: ['-c:a', 'pcm_s16le'],
    };
  }
  if (codec === 'hevc') {
    if (options.hw) return { name: 'HEVC (VideoToolbox)', pixFmt: 'yuv420p', video: ['-c:v', 'hevc_videotoolbox', '-b:v', kbps(0.7), '-maxrate', kbps(1.1), '-tag:v', 'hvc1', '-allow_sw', '1', '-pix_fmt', 'yuv420p'], audio: aac };
    const crf = { high: '20', standard: '24', draft: '28' }[quality];
    const preset = { high: 'medium', standard: 'fast', draft: 'veryfast' }[quality];
    return { name: 'HEVC (x265)', pixFmt: 'yuv420p', video: ['-c:v', 'libx265', '-preset', preset, '-crf', crf, '-tag:v', 'hvc1', '-x265-params', 'log-level=error', '-pix_fmt', 'yuv420p'], audio: aac };
  }
  if (options.hw) return { name: 'H.264 (VideoToolbox)', pixFmt: 'yuv420p', video: ['-c:v', 'h264_videotoolbox', '-b:v', kbps(1), '-maxrate', kbps(1.5), '-profile:v', 'high', '-allow_sw', '1', '-pix_fmt', 'yuv420p'], audio: aac };
  const q = { high: ['medium', '18'], standard: ['fast', '21'], draft: ['veryfast', '27'] }[quality];
  return { name: 'H.264 (x264)', pixFmt: 'yuv420p', video: ['-c:v', 'libx264', '-preset', q[0], '-crf', q[1], '-pix_fmt', 'yuv420p'], audio: aac };
}

function FLclamp(v, a, b) { return Math.min(b, Math.max(a, v)); }

module.exports = { buildExportArgs, projectDuration, seqDuration, encoderArgs };
