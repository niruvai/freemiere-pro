/* Freemiere Pro — editing features built on the core model: dialogs, speed ramps,
   Remove Silence, Nest, Auto Reframe, mask tracking, auto-save & crash recovery
   and relinking offline media. */
'use strict';

(() => {
  const api = window.api;
  const D = window.FLDefs;
  const $ = (s) => document.querySelector(s);
  const fmtDur = (s) => (s >= 60 ? `${Math.floor(s / 60)}m ${Math.round(s % 60)}s` : `${s.toFixed(1)}s`);

  // ======================================================================
  // Dialog + progress (one shared modal)
  // ======================================================================
  const modal = $('#gen-modal');
  let dlgResolve = null;
  let dlgCancelHook = null;
  function closeDlg(value) {
    modal.hidden = true;
    $('#gen-progress').hidden = true;
    $('#gen-body').hidden = false;
    const r = dlgResolve;
    dlgResolve = null;
    if (r) r(value);
  }
  // opts: { title, html, ok, cancel, wide, onOpen(body), collect(body) → value | null (stay open) }
  FL.dialog = (opts) => new Promise((resolve) => {
    if (dlgResolve) closeDlg(null);
    dlgResolve = resolve;
    dlgCancelHook = null;
    $('#gen-title').textContent = opts.title || '';
    $('#gen-body').innerHTML = opts.html || '';
    $('#gen-body').hidden = false;
    $('#gen-progress').hidden = true;
    $('#gen-foot').textContent = opts.foot || '';
    modal.querySelector('.modal').classList.toggle('wide', !!opts.wide);
    const ok = $('#gen-ok');
    ok.hidden = opts.ok === false;
    ok.textContent = opts.ok || 'OK';
    ok.disabled = false;
    $('#gen-cancel').textContent = opts.cancel || 'Cancel';
    $('#gen-cancel').hidden = opts.cancel === false;
    ok.onclick = () => {
      const v = opts.collect ? opts.collect($('#gen-body')) : true;
      if (v == null) return;
      closeDlg(v);
    };
    modal.hidden = false;
    if (opts.onOpen) opts.onOpen($('#gen-body'));
    const first = $('#gen-body').querySelector('input:not([type=checkbox]),select');
    if (first) setTimeout(() => first.focus(), 30);
  });
  const cancelDlg = () => { if (dlgCancelHook) dlgCancelHook(); else closeDlg(null); };
  $('#gen-cancel').onclick = cancelDlg;
  $('#gen-x').onclick = cancelDlg;
  modal.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA' && !$('#gen-ok').hidden && !$('#gen-ok').disabled) { e.preventDefault(); $('#gen-ok').click(); }
    if (e.key === 'Escape') cancelDlg();
  });

  // A progress view in the same modal; analysis in the main process reports through it.
  let progressId = null;
  FL.progress = (title, note = '') => {
    if (dlgResolve) closeDlg(null);
    const id = 'p' + Date.now();
    progressId = id;
    const state = { cancelled: false };
    $('#gen-title').textContent = title;
    $('#gen-body').hidden = true;
    $('#gen-progress').hidden = false;
    $('#gen-ok').hidden = true;
    $('#gen-cancel').hidden = false;
    $('#gen-cancel').textContent = 'Stop';
    $('#gen-foot').textContent = '';
    $('#gen-bar').style.width = '0%';
    $('#gen-bar').classList.remove('done', 'fail');
    $('#gen-pct').textContent = 'Starting…';
    $('#gen-note').textContent = note;
    modal.hidden = false;
    dlgCancelHook = () => { state.cancelled = true; api.cancelAnalysis(); };
    const p = {
      id,
      get cancelled() { return state.cancelled; },
      set(pct, text) {
        if (progressId !== id) return;
        $('#gen-bar').style.width = (FL.clamp(pct, 0, 1) * 100).toFixed(1) + '%';
        $('#gen-pct').textContent = `${Math.round(FL.clamp(pct, 0, 1) * 100)}%`;
        if (text != null) $('#gen-note').textContent = text;
      },
      close() { if (progressId === id) { progressId = null; dlgCancelHook = null; modal.hidden = true; $('#gen-progress').hidden = true; $('#gen-body').hidden = false; } },
    };
    return p;
  };
  const progressHandlers = new Map();
  api.onAnalysisProgress(({ id, pct }) => { const fn = progressHandlers.get(id); if (fn) fn(pct); });
  FL.progressHandlers = progressHandlers;

  const isCancel = (err) => /cancelled/i.test(String(err && err.message || err));

  // ======================================================================
  // Speed ramps
  // ======================================================================
  FL.addCmd('speedRamp', () => {
    const list = FL.selectedClips().filter((c) => c.type === 'video' && !FL.isLocked(c));
    if (!list.length) return FL.toast('Select a video clip first');
    FL.pushUndo();
    for (const c of list) {
      const v = c.speed || 1;
      const d = c.duration;
      // classic ramp: normal → slow motion in the middle → normal
      c.kf = c.kf || {};
      c.kf.speed = [
        { t: 0, v }, { t: +(d * 0.3).toFixed(4), v }, { t: +(d * 0.42).toFixed(4), v: D.clampSpeed(v * 0.3) },
        { t: +(d * 0.58).toFixed(4), v: D.clampSpeed(v * 0.3) }, { t: +(d * 0.7).toFixed(4), v },
      ];
      c.kfMode = c.kfMode || {};
      delete c.kfMode.speed;
      c.duration = Math.max(FL.MIN_CLIP, Math.min(c.duration, FL.mediaLimit(c)));
    }
    FL.changed();
    const linked = list.some((c) => FL.partners(c).length);
    FL.toast(linked ? 'Speed ramp added — the linked audio keeps normal speed (as in Premiere)' : 'Speed ramp added — adjust the Speed keyframes in Effect Controls', 3500);
  });
  FL.addCmd('clearRamp', () => {
    const list = FL.selectedClips().filter((c) => FL.isRamped(c) || (c.kf && c.kf.speed));
    if (!list.length) return;
    FL.pushUndo();
    for (const c of list) {
      c.speed = D.clampSpeed(c.kf.speed[0].v);
      delete c.kf.speed;
      c.duration = Math.max(FL.MIN_CLIP, Math.min(c.duration, FL.mediaLimit(c)));
    }
    FL.changed();
  });

  // ======================================================================
  // Remove Silence
  // ======================================================================
  // Keeps only the stretches where every target clip covering that time is silent.
  function commonSilence(targets, ranges) {
    const pts = new Set();
    targets.forEach((c) => { pts.add(c.start); pts.add(c.start + c.duration); });
    ranges.forEach((list) => list.forEach((r) => { pts.add(r.a); pts.add(r.b); }));
    const sorted = [...pts].sort((x, y) => x - y);
    const out = [];
    for (let i = 0; i < sorted.length - 1; i++) {
      const a = sorted[i]; const b = sorted[i + 1];
      if (b - a < 1e-6) continue;
      const mid = (a + b) / 2;
      const covering = targets.map((c, k) => (mid > c.start && mid < c.start + c.duration ? k : -1)).filter((k) => k >= 0);
      if (!covering.length) continue;
      if (covering.every((k) => ranges[k].some((r) => mid > r.a && mid < r.b))) {
        const last = out[out.length - 1];
        if (last && Math.abs(last.b - a) < 1e-6) last.b = b; else out.push({ a, b });
      }
    }
    return out;
  }

  FL.addCmd('removeSilence', async () => {
    let targets = FL.selectedClips().filter((c) => FL.hasAudio(c) && c.type !== 'nest' && !FL.isLocked(c));
    if (!targets.length) targets = FL.seq().clips.filter((c) => FL.hasAudio(c) && c.type !== 'nest' && !FL.isLocked(c) && !FL.track(c.trackId).muted);
    // a linked pair: analyse the sound side only
    targets = targets.filter((c) => !(c.type === 'video' && FL.partners(c).some((p) => targets.includes(p))));
    targets = targets.filter((c) => FL.media(c.mediaId) && !FL.media(c.mediaId).missing);
    if (!targets.length) return FL.toast('Select clips with sound (or a talking-head clip) first');
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem('fl-silence') || '{}'); } catch (_) {}
    const o = await FL.dialog({
      title: 'Remove Silence',
      ok: 'Analyze',
      html: `<p class="hint">Finds the pauses in ${targets.length === 1 ? `“${FL.esc(FL.clipName(targets[0]))}”` : `${targets.length} clips`} and cuts them out — quick jump cuts for talking videos.
        When several clips play at once, a pause is only cut when <b>all</b> of them are quiet.</p>
        <div class="row2">
          <label class="field"><span>Silence is quieter than</span><select id="si-db">${[-50, -45, -40, -35, -30, -25].map((v) => `<option value="${v}" ${v === (saved.db ?? -40) ? 'selected' : ''}>${v} dB${v === -40 ? ' (normal)' : v <= -45 ? ' (quiet room)' : v >= -30 ? ' (noisy room)' : ''}</option>`).join('')}</select></label>
          <label class="field"><span>Shortest pause to cut</span><select id="si-min">${[0.25, 0.35, 0.5, 0.75, 1, 1.5, 2].map((v) => `<option value="${v}" ${v === (saved.min ?? 0.5) ? 'selected' : ''}>${v} s</option>`).join('')}</select></label>
        </div>
        <div class="row2">
          <label class="field"><span>Keep around speech</span><select id="si-pad">${[0, 0.05, 0.1, 0.15, 0.25, 0.4].map((v) => `<option value="${v}" ${v === (saved.pad ?? 0.1) ? 'selected' : ''}>${Math.round(v * 1000)} ms</option>`).join('')}</select></label>
          <label class="field"><span>Then</span><select id="si-act">
            <option value="ripple-all">Cut and close gaps on all tracks (keeps everything in sync)</option>
            <option value="ripple-own">Cut and close gaps on these clips’ tracks only</option>
            <option value="lift">Cut, leave the gaps</option>
            <option value="markers">Only add markers at the pauses</option>
          </select></label>
        </div>`,
      onOpen: (b) => { if (saved.act) b.querySelector('#si-act').value = saved.act; },
      collect: (b) => ({ db: +b.querySelector('#si-db').value, min: +b.querySelector('#si-min').value, pad: +b.querySelector('#si-pad').value, act: b.querySelector('#si-act').value }),
    });
    if (!o) return;
    try { localStorage.setItem('fl-silence', JSON.stringify(o)); } catch (_) {}
    const prog = FL.progress('Remove Silence', 'Listening for pauses…');
    const ranges = [];
    try {
      for (let i = 0; i < targets.length; i++) {
        const c = targets[i];
        const m = FL.media(c.mediaId);
        prog.set(i / targets.length, `Analyzing ${FL.clipName(c)}…`);
        const srcStart = c.in || 0;
        const srcDur = FL.srcOffset(c, c.duration);
        const sil = await api.detectSilence(m.path, { start: srcStart, duration: srcDur, noiseDb: o.db, minSilence: o.min });
        if (prog.cancelled) throw new Error('cancelled');
        ranges.push(sil.map((s) => ({ a: c.start + D.srcInverse(c, s.s - srcStart), b: c.start + D.srcInverse(c, Math.min(s.e, srcStart + srcDur) - srcStart) })));
      }
    } catch (err) {
      prog.close();
      if (!isCancel(err)) FL.toast(`Couldn't analyze the audio: ${String(err.message || err).slice(0, 120)}`, 4000);
      return;
    }
    prog.close();
    const fps = FL.fps();
    const cuts = commonSilence(targets, ranges).map((r) => {
      const lo = Math.min(...targets.map((c) => c.start));
      const hi = Math.max(...targets.map((c) => c.start + c.duration));
      // pauses at the very start/end of the clips are cut fully; inner ones keep a little air
      const a = r.a <= lo + 1e-3 ? r.a : r.a + o.pad;
      const b = r.b >= hi - 1e-3 ? r.b : r.b - o.pad;
      return { a: Math.ceil(a * fps - 1e-6) / fps, b: Math.floor(b * fps + 1e-6) / fps };
    }).filter((r) => r.b - r.a >= 2 / fps);
    if (!cuts.length) { FL.toast('No pauses found with these settings — try a higher dB value or a shorter pause'); return; }
    const total = cuts.reduce((s, r) => s + (r.b - r.a), 0);
    const ok = await FL.dialog({
      title: 'Remove Silence',
      ok: o.act === 'markers' ? 'Add Markers' : 'Remove',
      html: `<div class="ex-summary"><span>Pauses found <b>${cuts.length}</b></span><span>Total <b>${fmtDur(total)}</b></span></div>
        <p class="hint">${o.act === 'markers' ? 'A marker will be added at each pause.' : o.act === 'lift' ? 'The pauses will be cut out and left as gaps.' : 'The pauses will be cut out and the rest pulled together.'} You can undo this with ⌘Z.</p>`,
    });
    if (!ok) return;
    FL.pushUndo();
    const seq = FL.seq();
    if (o.act === 'markers') {
      for (const r of cuts) seq.markers.push({ id: FL.uid('mk'), t: r.a, name: `Pause ${fmtDur(r.b - r.a)}`, color: '#ffd34d' });
      seq.markers.sort((x, y) => x.t - y.t);
    } else {
      let trackIds;
      if (o.act === 'ripple-all') trackIds = seq.tracks.filter((t) => !t.locked).map((t) => t.id);
      else {
        const s = new Set();
        targets.forEach((c) => { s.add(c.trackId); FL.partners(c).forEach((p) => s.add(p.trackId)); });
        trackIds = [...s];
      }
      for (const r of cuts.slice().reverse()) {
        if (o.act === 'lift') {
          for (const id of trackIds) FL.overwrite(id, r.a, r.b, []);
        } else FL.extractRange(trackIds, r.a, r.b);
      }
    }
    FL.changed();
    FL.toast(o.act === 'markers' ? `${cuts.length} markers added` : `${cuts.length} pauses removed (${fmtDur(total)})`, 3000);
  });

  // ======================================================================
  // Nest
  // ======================================================================
  FL.addCmd('nest', async () => {
    const list = FL.selectedClips().filter((c) => !FL.isLocked(c));
    if (!list.length) return FL.toast('Select the clips to nest first');
    if (!list.some(FL.isVisual)) return FL.toast('Include at least one video or graphic clip to nest');
    const n = FL.project.sequences.filter((s) => /^Nested Sequence \d+$/.test(s.name)).length + 1;
    const name = await FL.dialog({
      title: 'Nested Sequence Name',
      html: '<label class="field"><span>Name</span><input type="text" id="ns-name"></label><p class="hint">The selected clips move into a new sequence, which takes their place as one clip. Double-click it to edit inside.</p>',
      onOpen: (b) => { b.querySelector('#ns-name').value = `Nested Sequence ${n}`; },
      collect: (b) => b.querySelector('#ns-name').value.trim() || `Nested Sequence ${n}`,
    });
    if (!name) return;
    FL.pushUndo();
    const outer = FL.seq();
    const t0 = Math.min(...list.map((c) => c.start));
    const t1 = Math.max(...list.map((c) => c.start + c.duration));
    const inner = FL.newSequence(name, Object.assign({}, outer.settings));
    // same track layout, so clips keep their relative stacking
    inner.tracks = outer.tracks.map((t) => ({ id: FL.uid(t.kind === 'video' ? 'v' : 'a'), kind: t.kind, name: t.name }));
    const map = Object.fromEntries(outer.tracks.map((t, i) => [t.id, inner.tracks[i].id]));
    const ids = new Set(list.map((c) => c.id));
    for (const c of list) inner.clips.push(Object.assign(JSON.parse(JSON.stringify(c)), { start: c.start - t0, trackId: map[c.trackId] }));
    // links survive only inside the nest
    outer.clips = outer.clips.filter((c) => !ids.has(c.id));
    FL.project.sequences.push(inner);
    const vis = list.filter(FL.isVisual);
    const track = FL.vTracks().find((t) => vis.some((c) => c.trackId === t.id)) || FL.vTracks()[0];
    const clip = FL.makeNestClip(inner, { duration: t1 - t0 });
    FL.placeClip(clip, track.id, t0);
    FL.sel = new Set([clip.id]);
    FL.selectedId = clip.id;
    FL.changed();
    FL.emit('select', clip.id);
    FL.toast(`Nested into “${name}” — double-click it to edit`);
  });
  FL.addCmd('insertNest', (id) => {
    const inner = FL.seqById(id);
    if (!inner) return;
    if (FL.nestCycle(FL.project.activeSeq, id)) return FL.toast('A sequence can’t contain itself');
    if (!inner.clips.length) return FL.toast('That sequence is empty');
    FL.pushUndo();
    const clip = FL.makeNestClip(inner);
    const tr = FL.freeVideoTrack(FL.time, FL.time + clip.duration);
    FL.placeClip(clip, tr.id, FL.time);
    FL.sel = new Set([clip.id]);
    FL.selectedId = clip.id;
    FL.changed();
    FL.emit('select', clip.id);
  });

  // ======================================================================
  // Auto Reframe
  // ======================================================================
  const MOTION = {
    slow: { label: 'Slower motion (steady, for interviews)', win: 2.4, tol: 0.06 },
    default: { label: 'Default', win: 1.2, tol: 0.035 },
    fast: { label: 'Faster motion (sport, action)', win: 0.5, tol: 0.02 },
  };
  // moving average, then a "lazy camera" that only moves when the subject drifts away
  function smoothPath(samples, key, win, dead) {
    const out = samples.map((s, i) => {
      let sum = 0; let n = 0;
      for (const o of samples) if (Math.abs(o.t - s.t) <= win / 2) { sum += o[key]; n++; }
      return n ? sum / n : s[key];
    });
    let cam = out[0];
    return out.map((v) => { if (Math.abs(v - cam) > dead) cam += (v - cam) - Math.sign(v - cam) * dead; return cam; });
  }
  // Ramer–Douglas–Peucker: keeps the keyframes that matter
  function simplify(points, tol) {
    if (points.length < 3) return points;
    const keep = new Array(points.length).fill(false);
    keep[0] = keep[points.length - 1] = true;
    const stack = [[0, points.length - 1]];
    while (stack.length) {
      const [a, b] = stack.pop();
      let best = -1; let bi = -1;
      for (let i = a + 1; i < b; i++) {
        const p = (points[i].t - points[a].t) / Math.max(1e-6, points[b].t - points[a].t);
        const d = Math.abs(points[i].v - (points[a].v + (points[b].v - points[a].v) * p));
        if (d > best) { best = d; bi = i; }
      }
      if (best > tol) { keep[bi] = true; stack.push([a, bi], [bi, b]); }
    }
    return points.filter((_, i) => keep[i]);
  }
  // Pans (and scales to fill) one clip so the subject stays in frame.
  async function reframeClip(c, motion, prog, part) {
    const m = FL.media(c.mediaId);
    if (!m || m.missing || !m.width) return false;
    const { width: W, height: H } = FL.S();
    const { bw, bh } = FL.R.baseSize(c);
    const s = Math.max(W / bw, H / bh);
    const spanX = Math.max(0, (bw * s - W) / 2);
    const spanY = Math.max(0, (bh * s - H) / 2);
    c.scale = s;
    if (c.kf) { delete c.kf.scale; delete c.kf.x; delete c.kf.y; }
    c.x = 0; c.y = 0;
    if (spanX < 1 && spanY < 1) return true;
    let samples;
    if (c.type === 'image') samples = [];
    else {
      const id = 'rf' + Date.now();
      progressHandlers.set(id, (p) => prog.set(part[0] + p * (part[1] - part[0])));
      try {
        samples = await api.findSubject(m.path, { id, start: c.in || 0, duration: FL.srcOffset(c, c.duration), frameW: m.width, frameH: m.height, cropW: W / (bw * s), cropH: H / (bh * s), rate: 4 });
      } finally { progressHandlers.delete(id); }
    }
    if (!samples.length) return true;
    const cfg = MOTION[motion] || MOTION.default;
    const pts = samples.map((p) => ({ t: FL.clamp(D.srcInverse(c, p.t - (c.in || 0)), 0, c.duration), cx: p.cx, cy: p.cy }));
    const write = (axis, key, span, len) => {
      if (span < 1) return;
      const path = smoothPath(pts, key, cfg.win, cfg.tol);
      const vals = pts.map((p, i) => ({ t: +p.t.toFixed(4), v: Math.round(FL.clamp(-(path[i] - 0.5) * len * s, -span, span)) }));
      const keep = simplify(vals, Math.max(2, span * 0.04));
      if (keep.every((k) => k.v === keep[0].v) || keep.length < 2) { c[axis] = keep[0].v; return; }
      c.kf = c.kf || {};
      c.kf[axis] = keep;
      c.kfMode = c.kfMode || {};
      c.kfMode[axis] = 'ease';
    };
    write('x', 'cx', spanX, bw);
    write('y', 'cy', spanY, bh);
    return true;
  }
  const PRESETS = [['9:16', 1080, 1920, 'Vertical 9:16 (Reels, Shorts, TikTok)'], ['1:1', 1080, 1080, 'Square 1:1'], ['4:5', 1080, 1350, 'Portrait 4:5 (Instagram feed)'], ['16:9', 1920, 1080, 'Horizontal 16:9 (YouTube)']];
  const motionSelect = () => `<label class="field"><span>Motion tracking</span><select id="rf-motion">${Object.entries(MOTION).map(([k, m]) => `<option value="${k}" ${k === 'default' ? 'selected' : ''}>${m.label}</option>`).join('')}</select></label>`;

  FL.addCmd('reframeClip', async () => {
    const list = FL.selectedClips().filter((c) => (c.type === 'video' || c.type === 'image') && !FL.isLocked(c));
    if (!list.length) return FL.toast('Select video clips to reframe');
    const o = await FL.dialog({
      title: 'Auto Reframe',
      ok: 'Reframe',
      html: `<p class="hint">Scales ${list.length > 1 ? 'the clips' : 'the clip'} to fill the ${FL.S().width}×${FL.S().height} frame and pans to keep the subject (faces, people, movement) in view, with keyframes you can fine-tune.</p>${motionSelect()}`,
      collect: (b) => ({ motion: b.querySelector('#rf-motion').value }),
    });
    if (!o) return;
    FL.pushUndo();
    const prog = FL.progress('Auto Reframe', 'Finding the subject…');
    try {
      for (let i = 0; i < list.length; i++) {
        prog.set(i / list.length, `Analyzing ${FL.clipName(list[i])}…`);
        await reframeClip(list[i], o.motion, prog, [i / list.length, (i + 1) / list.length]);
        if (prog.cancelled) throw new Error('cancelled');
      }
    } catch (err) {
      prog.close();
      FL.undo();
      if (!isCancel(err)) FL.toast(`Auto Reframe failed: ${String(err.message || err).slice(0, 120)}`, 4000);
      return;
    }
    prog.close();
    FL.changed();
    FL.toast('Reframed — fine-tune Position keyframes in Effect Controls', 3000);
  });

  FL.addCmd('reframeSeq', async () => {
    const src = FL.seq();
    if (!src.clips.length) return FL.toast('This sequence is empty');
    const o = await FL.dialog({
      title: 'Auto Reframe Sequence',
      ok: 'Create',
      html: `<p class="hint">Makes a copy of “${FL.esc(src.name)}” in a new shape. Video clips are scaled to fill and panned to follow the subject; titles and graphics are kept inside the frame.</p>
        <div class="row2"><label class="field"><span>Aspect ratio</span><select id="rf-ar">${PRESETS.map((p, i) => `<option value="${i}" ${i === 0 ? 'selected' : ''}>${p[3]}</option>`).join('')}</select></label>${motionSelect()}</div>
        <label class="field"><span>New sequence name</span><input type="text" id="rf-name"></label>`,
      onOpen: (b) => {
        const upd = () => { b.querySelector('#rf-name').value = `${src.name} (${PRESETS[+b.querySelector('#rf-ar').value][0]})`; };
        b.querySelector('#rf-ar').onchange = upd;
        upd();
      },
      collect: (b) => ({ preset: PRESETS[+b.querySelector('#rf-ar').value], motion: b.querySelector('#rf-motion').value, name: b.querySelector('#rf-name').value.trim() }),
    });
    if (!o) return;
    FL.pushUndo();
    const copy = JSON.parse(JSON.stringify(src));
    copy.id = FL.uid('seq');
    copy.name = o.name || `${src.name} (${o.preset[0]})`;
    const k = Math.min(o.preset[1] / src.settings.width, o.preset[2] / src.settings.height);
    copy.settings = Object.assign({}, src.settings, { width: o.preset[1], height: o.preset[2] });
    copy.clips.forEach((c) => { c.id = FL.uid('clip'); FL.refreshEffectIds(c); });
    // linked pairs keep their links (fresh ids per pair)
    const lmap = {};
    copy.clips.forEach((c) => { if (c.link) c.link = lmap[c.link] = lmap[c.link] || FL.uid('lnk'); });
    FL.project.sequences.push(copy);
    FL.openSequence(copy.id);
    // titles: keep their relative position and size
    for (const c of copy.clips) {
      if (c.type === 'text') {
        c.size = Math.max(8, Math.round(c.size * Math.max(k, 0.5)));
        c.x = Math.round((c.x || 0) * (o.preset[1] / src.settings.width));
        c.y = Math.round((c.y || 0) * (o.preset[2] / src.settings.height));
        if (c.kf) { delete c.kf.x; delete c.kf.y; }
      }
    }
    const vids = copy.clips.filter((c) => c.type === 'video' || c.type === 'image');
    const prog = FL.progress('Auto Reframe Sequence', 'Finding the subject…');
    try {
      for (let i = 0; i < vids.length; i++) {
        prog.set(i / vids.length, `Clip ${i + 1} of ${vids.length}: ${FL.clipName(vids[i])}`);
        await reframeClip(vids[i], o.motion, prog, [i / vids.length, (i + 1) / vids.length]);
        if (prog.cancelled) throw new Error('cancelled');
      }
    } catch (err) {
      prog.close();
      if (!isCancel(err)) FL.toast(`Auto Reframe stopped: ${String(err.message || err).slice(0, 120)}`, 4000);
      FL.changed();
      return;
    }
    prog.close();
    FL.changed();
    FL.emit('seq');
    setTimeout(() => FL.zoomFit(), 50);
    FL.toast(`Created “${copy.name}”`, 3000);
  });

  // ======================================================================
  // Mask tracking
  // ======================================================================
  FL.trackMask = async (c, e, backward) => {
    const m = FL.media(c.mediaId);
    if (!m || m.missing || c.type !== 'video') return FL.toast('Tracking works on video clips');
    if (!e.mask) return;
    const u0 = FL.clamp(FL.time - c.start, 0, c.duration);
    if (FL.time < c.start || FL.time >= c.start + c.duration) return FL.toast('Put the playhead on this clip, over the frame to start from');
    const fx = D.effectAt(c, e, u0);
    const s0 = (c.in || 0) + FL.srcOffset(c, u0);
    const sEnd = (c.in || 0) + FL.srcOffset(c, c.duration);
    const duration = backward ? s0 - (c.in || 0) : sEnd - s0;
    if (duration < 0.1) return FL.toast(backward ? 'Already at the start of the clip' : 'Already at the end of the clip');
    if (FL.playing) FL.pause();
    const prog = FL.progress('Tracking mask', backward ? 'Tracking backward…' : 'Tracking forward…');
    const id = 'tr' + Date.now();
    progressHandlers.set(id, (p) => prog.set(p));
    let pts;
    try {
      pts = await api.trackBox(m.path, {
        id, start: backward ? c.in || 0 : s0, duration, fps: m.fps || FL.fps(), frameW: m.width, frameH: m.height, reverse: backward,
        box: { cx: FL.clamp(fx.mask.cx, 0, 1), cy: FL.clamp(fx.mask.cy, 0, 1), w: FL.clamp(fx.mask.w, 0.01, 1), h: FL.clamp(fx.mask.h, 0.01, 1) },
      });
    } catch (err) {
      prog.close();
      if (!isCancel(err)) FL.toast(`Tracking failed: ${String(err.message || err).slice(0, 120)}`, 4000);
      return;
    } finally { progressHandlers.delete(id); }
    prog.close();
    if (!pts || pts.length < 2) return FL.toast('Couldn’t follow that area — make the mask cover something with clear detail');
    const total = Math.round(duration * Math.min(30, Math.max(10, m.fps || 30)));
    FL.pushUndo();
    const kfFor = (key) => pts.map((p) => ({ t: +FL.clamp(D.srcInverse(c, p.t - (c.in || 0)), 0, c.duration).toFixed(4), v: +p[key].toFixed(5) }));
    for (const key of ['cx', 'cy']) {
      const prop = `mask:${e.id}:${key}`;
      const path = simplify(kfFor(key).sort((a, b) => a.t - b.t), 0.0012);
      const lo = path[0].t; const hi = path[path.length - 1].t;
      c.kf = c.kf || {};
      const keepOld = (c.kf[prop] || []).filter((k) => k.t < lo - 1e-4 || k.t > hi + 1e-4);
      c.kf[prop] = [...keepOld, ...path].sort((a, b) => a.t - b.t);
      if (c.kfMode) delete c.kfMode[prop];
    }
    FL.changed();
    const lost = pts.length < total * 0.95;
    FL.toast(lost ? `Tracked ${fmtDur(pts.length / Math.min(30, Math.max(10, m.fps || 30)))} — lost the area after that. Move the mask there and track again.` : 'Mask tracked', 4000);
  };

  // ======================================================================
  // Auto-save & crash recovery
  // ======================================================================
  const AUTOSAVE_EVERY = 90 * 1000;
  let lastAutosave = 0;
  setInterval(() => {
    if (!FL.dirty || Date.now() - lastAutosave < AUTOSAVE_EVERY - 1000) return;
    if (FL.home && FL.home.visible()) return;
    if (!FL.project.media.length && !FL.project.sequences.some((s) => s.clips.length)) return;
    lastAutosave = Date.now();
    const data = JSON.parse(JSON.stringify(FL.project));
    data.media.forEach((m) => { delete m.missing; });
    api.autosave(data, { projectPath: FL.filePath, name: FL.projectName() }).catch((err) => console.warn('autosave failed', err));
  }, 15 * 1000);

  // Opens an auto-saved copy: it is linked to its original project, so ⌘S saves over it.
  async function openAutosave(file, projectPath) {
    const data = await api.autosaveRead(file);
    delete data.autosave;
    FL.loadProject(data, projectPath || null);
    FL.setDirty(true);
    FL.toast(projectPath ? 'Recovered — press ⌘S to save it over the original project' : 'Recovered — press ⌘S to save it', 4500);
  }
  FL.offerRecovery = async () => {
    const r = await api.autosavePending();
    if (!r) return false;
    const when = new Date(r.time).toLocaleString();
    const ok = await FL.dialog({
      title: 'Recover unsaved work?',
      ok: 'Recover',
      cancel: 'Discard',
      html: `<p>Freemiere Pro didn’t close normally last time. An auto-saved copy of <b>${FL.esc(r.name || 'Untitled')}</b> from ${FL.esc(when)} has changes that were never saved.</p>
        <p class="hint">Auto-saved copies are kept for a while either way: <b>File → Open Auto-Saved Version…</b></p>`,
    });
    if (ok) { await openAutosave(r.autosave, r.projectPath); return true; }
    api.autosaveClean();
    return false;
  };
  FL.addCmd('autosaves', async () => {
    const list = await api.autosaveList();
    if (!list.length) return FL.toast('No auto-saved versions yet (they are made every 90 seconds while you edit)', 3500);
    let picked = null;
    const ok = await FL.dialog({
      title: 'Open Auto-Saved Version',
      ok: 'Open',
      wide: true,
      foot: 'Auto-saves are made every 90 s while there are unsaved changes; the newest 10 per project are kept.',
      html: `<div class="pick-list" id="as-list">${list.map((a, i) => `<button class="pick-row" data-i="${i}"><span>${FL.esc(a.name)}</span><em>${FL.esc(new Date(a.modified).toLocaleString())}</em></button>`).join('')}</div>
        <div class="prop-actions"><button class="btn small ghost" id="as-folder">Show Auto-Save Folder</button></div>`,
      onOpen: (b) => {
        b.querySelector('#as-folder').onclick = () => api.autosaveFolder();
        b.querySelector('#as-list').addEventListener('click', (e) => {
          const row = e.target.closest('.pick-row');
          if (!row) return;
          b.querySelectorAll('.pick-row').forEach((n) => n.classList.toggle('sel', n === row));
          picked = list[+row.dataset.i];
        });
        b.querySelector('#as-list').addEventListener('dblclick', () => { if (picked) $('#gen-ok').click(); });
      },
      collect: () => picked || null,
    });
    if (!ok) return;
    if (!(await api.confirmDiscard())) return;
    await openAutosave(picked.path, null);
  });

  // ======================================================================
  // Link Media (relink offline files)
  // ======================================================================
  const base = (p) => String(p).split(/[\\/]/).pop();
  async function relinkTo(m, file) {
    let info;
    try { info = await api.probe(file); } catch (err) { FL.toast(`${base(file)} can’t be opened`); return false; }
    if (info.type !== m.type && !(m.type === 'video' && info.type === 'video')) { FL.toast(`${base(file)} is a different kind of file`); return false; }
    if (m.duration && info.duration && Math.abs(info.duration - m.duration) > 1) FL.toast(`Note: ${base(file)} is ${fmtDur(info.duration)} long, the original was ${fmtDur(m.duration)}`, 4000);
    Object.assign(m, info, { path: file, name: base(file), thumb: null, wave: null, proxy: null, missing: false });
    await api.allowMedia([file]);
    FL.ensureAssets(m);
    return true;
  }
  FL.linkMedia = async (opts = {}) => {
    const missing = () => FL.project.media.filter((m) => m.missing);
    if (!missing().length) { if (!opts.auto) FL.toast('No offline media in this project'); return; }
    const render = (b) => {
      const list = missing();
      b.querySelector('#lm-list').innerHTML = list.length ? list.map((m) => `<div class="lm-row" data-id="${m.id}">
          <div><b>${FL.esc(m.name)}</b><span class="hint">${FL.esc(m.path)}</span></div>
          <button class="btn small" data-locate="${m.id}">Locate…</button></div>`).join('') : '<p class="ok">All media is linked.</p>';
      $('#gen-ok').textContent = list.length ? 'Leave Offline' : 'Done';
    };
    await FL.dialog({
      title: 'Link Media',
      ok: 'Leave Offline',
      cancel: false,
      wide: true,
      html: `<p class="hint">These files were moved, renamed or are on a drive that isn’t connected. Locate one and Freemiere Pro also looks for the others in the same folder.</p>
        <div class="lm-list" id="lm-list"></div>
        <div class="prop-actions"><button class="btn small" id="lm-search">Search a Folder…</button></div>`,
      onOpen: (b) => {
        render(b);
        const searchIn = async (folder) => {
          const list = missing();
          const found = await api.relinkSearch(folder, list.map((m) => m.name));
          let n = 0;
          for (const m of list) if (found[m.name] && (await relinkTo(m, found[m.name]))) n++;
          return n;
        };
        b.querySelector('#lm-list').addEventListener('click', async (e) => {
          const btn = e.target.closest('[data-locate]');
          if (!btn) return;
          const m = FL.media(btn.dataset.locate);
          const file = await api.relinkPick(m.name);
          if (!file || !(await relinkTo(m, file))) return;
          const more = await searchIn(file.replace(/[\\/][^\\/]*$/, ''));
          if (more) FL.toast(`Also found ${more} more file${more > 1 ? 's' : ''} in that folder`);
          FL.setDirty(true);
          render(b);
          FL.renderBin(); FL.renderTimeline(); FL.requestDraw();
        });
        b.querySelector('#lm-search').onclick = async () => {
          const folder = await api.relinkPickFolder();
          if (!folder) return;
          const n = await searchIn(folder);
          FL.toast(n ? `Linked ${n} file${n > 1 ? 's' : ''}` : 'None of the missing files were found there');
          if (n) FL.setDirty(true);
          render(b);
          FL.renderBin(); FL.renderTimeline(); FL.requestDraw();
        };
      },
    });
  };
  FL.addCmd('linkMedia', () => FL.linkMedia());
})();
