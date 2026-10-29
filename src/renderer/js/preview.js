/* Freemiere Pro — Program monitor: playback clock, media element sync (picture
   and sound, including transition handles) and the compositor. */
'use strict';

(() => {
  const canvas = document.getElementById('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: false });
  const stage = document.getElementById('stage');
  const monitor = document.getElementById('monitor');
  const D = window.FLDefs;

  const pool = new Map();   // clipId -> { el, src, used }
  FL._pool = pool;
  const images = new Map(); // mediaId -> HTMLImageElement
  let quality = 1;
  let needsDraw = true;
  let playStartPerf = 0;
  let playStartTime = 0;

  FL.requestDraw = () => { needsDraw = true; };
  FL.previewQuality = () => quality;

  // ---------------------------------------------------------------- sizing
  function layout() {
    const { width: W, height: H } = FL.S();
    const cw = Math.round(W * quality);
    const ch = Math.round(H * quality);
    if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
    const box = monitor.getBoundingClientRect();
    const pad = 16;
    const s = Math.min((box.width - pad * 2) / W, (box.height - pad * 2) / H);
    stage.style.width = Math.max(10, Math.floor(W * s)) + 'px';
    stage.style.height = Math.max(10, Math.floor(H * s)) + 'px';
    needsDraw = true;
  }
  new ResizeObserver(layout).observe(monitor);
  FL.on('change', layout);
  FL.on('seq', layout);
  FL.layoutPreview = layout;
  FL.setPreviewQuality = (q) => { quality = q; layout(); };

  // ---------------------------------------------------------------- media sources
  const srcFor = (m) => window.api.mediaUrl(m.proxy || m.path);
  FL.imageFor = (m) => {
    const src = srcFor(m);
    let img = images.get(m.id);
    if (!img || img.dataset.src !== src) {
      img = new Image();
      img.crossOrigin = 'anonymous';
      img.dataset.src = src;
      img.onload = () => { needsDraw = true; };
      img.src = src;
      images.set(m.id, img);
    }
    return img;
  };

  function elementFor(clip, m) {
    const src = srcFor(m);
    let entry = pool.get(clip.id);
    if (entry && entry.src !== src) { release(clip.id); entry = null; }
    if (!entry) {
      const el = clip.type === 'audio' ? new Audio() : document.createElement('video');
      el.crossOrigin = 'anonymous';
      el.preload = 'auto';
      el.playsInline = true;
      el.preservesPitch = true;
      el.src = src;
      el.addEventListener('seeked', () => { needsDraw = true; });
      el.addEventListener('loadeddata', () => { needsDraw = true; });
      entry = { el, src, used: performance.now() };
      pool.set(clip.id, entry);
      trimPool();
    }
    entry.used = performance.now();
    return entry.el;
  }
  function release(id) {
    const e = pool.get(id);
    if (!e) return;
    e.el.pause();
    FL.audio.detach(e.el);
    e.el.removeAttribute('src');
    e.el.load();
    pool.delete(id);
  }
  function trimPool() {
    if (pool.size <= 16) return;
    const sorted = [...pool.entries()].sort((a, b) => a[1].used - b[1].used);
    for (const [id] of sorted.slice(0, pool.size - 16)) release(id);
  }

  // ---------------------------------------------------------------- transport
  FL.play = () => {
    const end = FL.duration();
    if (!end) return;
    FL.audio.resume();
    FL.audio.updateBuses();
    if (FL.time >= end - FL.frame()) FL.time = 0;
    FL.playing = true;
    playStartPerf = performance.now();
    playStartTime = FL.time;
    FL.emit('playstate', true);
  };
  FL.pause = () => {
    FL.playing = false;
    for (const { el } of pool.values()) el.pause();
    FL.time = FL.snapToFrame(FL.time);
    needsDraw = true;
    FL.emit('playstate', false);
    FL.emit('time', FL.time);
  };
  FL.togglePlay = () => (FL.playing ? FL.pause() : FL.play());
  FL.seek = (t, { snap = true } = {}) => {
    t = Math.max(0, t);
    FL.time = snap ? FL.snapToFrame(t) : t;
    if (FL.playing) { playStartPerf = performance.now(); playStartTime = FL.time; }
    needsDraw = true;
    FL.emit('time', FL.time);
  };

  // ---------------------------------------------------------------- audio transition weights
  const curve = (type, p) => {
    p = FL.clamp(p, 0, 1);
    const c = (D.AUDIO_TRANSITIONS[type] || D.AUDIO_TRANSITIONS.constantpower).curve;
    if (c === 'qsin') return Math.sin((p * Math.PI) / 2);
    if (c === 'exp') return Math.exp(-11.512925 * (1 - p));
    return p;
  };
  FL.audioWeight = (c, t) => {
    let w = 1;
    const end = c.start + c.duration;
    const prev = FL.prevAdj(c);
    const next = FL.nextAdj(c);
    if (c.atransIn) {
      const d = c.atransIn.duration;
      const s = prev ? c.start - d / 2 : c.start;
      if (t < s + d) w *= curve(c.atransIn.type, (t - s) / d);
    }
    if (next && next.atransIn) {
      const d = next.atransIn.duration;
      const s = end - d / 2;
      if (t > s) w *= curve(next.atransIn.type, 1 - (t - s) / d);
    } else if (c.atransOut) {
      const d = c.atransOut.duration;
      if (t > end - d) w *= curve(c.atransOut.type, (end - t) / d);
    }
    return w;
  };

  // ---------------------------------------------------------------- sync media elements
  function sync(t) {
    const active = new Set();
    const fps = FL.fps();
    const seq = FL.seq();
    for (const clip of seq.clips) {
      if (clip.type !== 'video' && clip.type !== 'audio') continue;
      const m = FL.media(clip.mediaId);
      if (!m || m.missing) continue;
      const ve = FL.vExt(clip);
      const ae = FL.aExt(clip);
      const head = Math.max(ve.head, ae.head);
      const tail = Math.max(ve.tail, ae.tail);
      const local = t - clip.start;
      if (local < -head - 0.75 || local >= clip.duration + tail) continue;
      const el = elementFor(clip, m);
      active.add(clip.id);
      const speed = clip.speed || 1;
      const maxT = Math.max(0, (m.duration || 0) - 0.04);
      const expected = FL.clamp((clip.in || 0) + local * speed, 0, maxT);
      const inside = local >= -head && local < clip.duration + tail;

      const withSound = FL.hasAudio(clip);
      if (withSound) {
        FL.audio.attach(el, clip);
        const audible = FL.playing && local >= -ae.head && local < clip.duration + ae.tail && !clip.muted;
        const u = FL.clamp(local, 0, clip.duration);
        const lvl = audible ? (FL.kfValue(clip, 'volume', u) ?? 1) * FL.fadeFactor(clip, t) * FL.audioWeight(clip, t) : 0;
        FL.audio.set(el, lvl, FL.kfValue(clip, 'pan', u) || 0);
      }
      el.muted = !withSound;
      if (el.playbackRate !== speed) { try { el.playbackRate = speed; } catch (_) {} }

      const atEnd = expected >= maxT - 0.001 && local > 0;
      if (FL.playing && inside && !atEnd) {
        if (el.paused) {
          if (Math.abs(el.currentTime - expected) > 0.05) el.currentTime = expected;
          el.play().catch(() => {});
        } else if (Math.abs(el.currentTime - expected) > 0.3) {
          el.currentTime = expected;
        }
      } else {
        if (!el.paused) el.pause();
        if (!el.seeking && Math.abs(el.currentTime - expected) > 0.5 / fps) el.currentTime = expected;
      }
    }
    for (const [id, entry] of pool) {
      if (active.has(id)) continue;
      if (!entry.el.paused) entry.el.pause();
      if (!FL.clip(id)) release(id);
    }
  }

  // ---------------------------------------------------------------- compositor
  function sourceFor(c) {
    if (c.type === 'video') { const e = pool.get(c.id); return e ? e.el : null; }
    if (c.type === 'image') { const m = FL.media(c.mediaId); return m && !m.missing ? FL.imageFor(m) : null; }
    return null;
  }
  const drawSide = (c, t, q) => (x) => R.drawClip(x, c, t - c.start, sourceFor(c), q);

  // What a video track shows at time t: a clip, a transition, or nothing.
  FL.trackStateAt = (track, t) => {
    const clips = FL.clipsOn(track.id);
    for (const b of clips) {
      if (!b.transIn) continue;
      const a = FL.prevAdj(b);
      const d = b.transIn.duration;
      if (a && t >= b.start - d / 2 && t < b.start + d / 2) {
        return { kind: 'trans', a, b, type: b.transIn.type, p: 1 - (t - (b.start - d / 2)) / d };
      }
    }
    const c = clips.find((x) => t >= x.start && t < x.start + x.duration);
    if (!c) return null;
    if (c.type !== 'adjust') {
      if (c.transIn && !FL.prevAdj(c) && t < c.start + c.transIn.duration) {
        return { kind: 'trans', a: null, b: c, type: c.transIn.type, p: 1 - (t - c.start) / c.transIn.duration };
      }
      const next = FL.nextAdj(c);
      if (c.transOut && !(next && next.transIn) && t > c.start + c.duration - c.transOut.duration) {
        const d = c.transOut.duration;
        return { kind: 'trans', a: c, b: null, type: c.transOut.type, p: 1 - (t - (c.start + c.duration - d)) / d };
      }
    }
    return { kind: 'clip', c };
  };

  const R = FL.R;
  FL.compose = (targetCanvas, tctx, t, q) => {
    const { width: W, height: H, bg } = FL.S();
    tctx.setTransform(1, 0, 0, 1, 0, 0);
    tctx.globalAlpha = 1;
    tctx.filter = 'none';
    tctx.globalCompositeOperation = 'source-over';
    tctx.fillStyle = bg || '#000';
    tctx.fillRect(0, 0, targetCanvas.width, targetCanvas.height);
    tctx.setTransform(q, 0, 0, q, 0, 0);
    const tracks = FL.seq().tracks.filter((tr) => tr.kind === 'video').reverse();
    for (const tr of tracks) {
      if (tr.hidden) continue;
      const st = FL.trackStateAt(tr, t);
      if (!st) continue;
      if (st.kind === 'clip') {
        if (st.c.type === 'adjust') R.drawAdjust(targetCanvas, tctx, st.c, t - st.c.start, q);
        else drawSide(st.c, t, q)(tctx);
      } else {
        R.transition(tctx, st.type, FL.clamp(st.p, 0, 1),
          st.a ? drawSide(st.a, t, q) : null,
          st.b ? drawSide(st.b, t, q) : null, q);
      }
    }
    tctx.setTransform(1, 0, 0, 1, 0, 0);
  };

  // the clip whose picture is being edited (for a linked pair, the video half)
  const visualSel = () => { const p = FL.selected(); return p && FL.isVisual(p) ? p : FL.selectedClips().find(FL.isVisual) || p; };
  function drawOverlay(t) {
    const sel = visualSel();
    if (FL.playing || !sel || !FL.isVisual(sel) || sel.type === 'adjust') return;
    if (t < sel.start || t >= sel.start + sel.duration) return;
    const tr = FL.track(sel.trackId);
    if (!tr || tr.hidden) return;
    const { width: W } = FL.S();
    const k = stage.clientWidth / W;
    const u = t - sel.start;
    const mo = R.motion(sel, u);
    const { bw, bh } = R.baseSize(sel);
    ctx.save();
    ctx.setTransform(quality, 0, 0, quality, 0, 0);
    ctx.translate(FL.S().width / 2 + mo.x, FL.S().height / 2 + mo.y);
    ctx.rotate((mo.r * Math.PI) / 180);
    ctx.scale(mo.s, mo.s);
    ctx.lineWidth = 1.5 / k / mo.s;
    ctx.strokeStyle = '#4c8dff';
    ctx.setLineDash([8 / k / mo.s, 5 / k / mo.s]);
    ctx.strokeRect(-bw / 2, -bh / 2, bw, bh);
    ctx.setLineDash([]);
    const hs = 9 / k / mo.s;
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#2b5fd9';
    ctx.lineWidth = 1.2 / k / mo.s;
    for (const [hx, hy] of HANDLES) {
      ctx.fillRect((hx * bw) / 2 - hs / 2, (hy * bh) / 2 - hs / 2, hs, hs);
      ctx.strokeRect((hx * bw) / 2 - hs / 2, (hy * bh) / 2 - hs / 2, hs, hs);
    }
    // centre point
    ctx.beginPath();
    ctx.arc(0, 0, 4 / k / mo.s, 0, Math.PI * 2);
    ctx.stroke();
    // mask outline
    const me = FL.maskEdit && FL.maskEdit.clipId === sel.id && (sel.effects || []).find((e) => e.id === FL.maskEdit.fxId);
    if (me && me.mask) {
      const mk = me.mask;
      ctx.strokeStyle = '#ffd34d';
      ctx.lineWidth = 2 / k / mo.s;
      ctx.beginPath();
      const cx = (mk.cx - 0.5) * bw;
      const cy = (mk.cy - 0.5) * bh;
      if (mk.shape === 'ellipse') ctx.ellipse(cx, cy, (mk.w * bw) / 2, (mk.h * bh) / 2, 0, 0, Math.PI * 2);
      else ctx.rect(cx - (mk.w * bw) / 2, cy - (mk.h * bh) / 2, mk.w * bw, mk.h * bh);
      ctx.stroke();
    }
    ctx.restore();
  }

  // Full-quality still of the current frame (Export Frame).
  FL.renderFrame = (t) => {
    const { width: W, height: H } = FL.S();
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    FL.compose(c, c.getContext('2d'), t, 1);
    return c;
  };

  // ---------------------------------------------------------------- loop
  let lastEmit = 0;
  function tick(now) {
    if (FL.playing) {
      const end = FL.duration();
      let t = playStartTime + (now - playStartPerf) / 1000;
      if (t >= end) { t = end; FL.time = t; FL.pause(); }
      else FL.time = t;
      sync(FL.time);
      FL.compose(canvas, ctx, FL.time, quality);
      if (now - lastEmit > 30) { FL.emit('time', FL.time); lastEmit = now; }
    } else if (needsDraw) {
      needsDraw = false;
      sync(FL.time);
      FL.compose(canvas, ctx, FL.time, quality);
      drawOverlay(FL.time);
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  // ---------------------------------------------------------------- direct manipulation
  function toSeq(e) {
    const r = canvas.getBoundingClientRect();
    const { width: W, height: H } = FL.S();
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H, k: W / r.width };
  }
  function hit(c, p) {
    const u = FL.time - c.start;
    const mo = R.motion(c, u);
    const { bw, bh } = R.baseSize(c);
    const { width: W, height: H } = FL.S();
    const dx = p.x - (W / 2 + mo.x);
    const dy = p.y - (H / 2 + mo.y);
    const rot = (-mo.r * Math.PI) / 180;
    const lx = dx * Math.cos(rot) - dy * Math.sin(rot);
    const ly = dx * Math.sin(rot) + dy * Math.cos(rot);
    return Math.abs(lx) <= (bw * mo.s) / 2 && Math.abs(ly) <= (bh * mo.s) / 2;
  }
  function visibleAt(t) {
    const out = [];
    for (const tr of FL.seq().tracks.filter((x) => x.kind === 'video')) {
      if (tr.hidden) continue;
      const c = FL.clipAt(tr.id, t);
      if (c && c.type !== 'adjust') out.push(c);
    }
    return out; // topmost first
  }

  // ---------------------------------------------------------------- scale & rotate handles
  const HANDLES = [[-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]];
  function geometry(c) {
    const u = FL.localTime(c);
    const mo = R.motion(c, u);
    const { bw, bh } = R.baseSize(c);
    const { width: W, height: H } = FL.S();
    const cx = W / 2 + mo.x;
    const cy = H / 2 + mo.y;
    const a = (mo.r * Math.PI) / 180;
    const pt = (lx, ly) => ({ x: cx + (lx * Math.cos(a) - ly * Math.sin(a)) * mo.s, y: cy + (lx * Math.sin(a) + ly * Math.cos(a)) * mo.s });
    return { u, mo, cx, cy, handles: HANDLES.map(([hx, hy]) => ({ hx, hy, p: pt((hx * bw) / 2, (hy * bh) / 2) })) };
  }
  // What the pointer is over on the selected clip: a scale handle, the rotate zone, or nothing.
  function handleAt(c, p) {
    if (!c || !FL.isVisual(c) || c.type === 'adjust' || FL.isLocked(c)) return null;
    if (FL.time < c.start || FL.time >= c.start + c.duration) return null;
    const tr = FL.track(c.trackId);
    if (!tr || tr.hidden) return null;
    const g = geometry(c);
    const d = (h) => Math.hypot(h.p.x - p.x, h.p.y - p.y);
    for (const h of g.handles) if (d(h) <= 9 * p.k) return { kind: 'scale', h, g };
    if (!hit(c, p)) for (const h of g.handles) if (h.hx && h.hy && d(h) <= 30 * p.k) return { kind: 'rotate', h, g };
    return null;
  }
  const ROTATE_CURSOR = `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'><path d='M19 12a7 7 0 1 1-2.05-4.95' fill='none' stroke='white' stroke-width='4' stroke-linecap='round'/><path d='M19 12a7 7 0 1 1-2.05-4.95' fill='none' stroke='black' stroke-width='2' stroke-linecap='round'/><path d='M20 3v5h-5' fill='none' stroke='white' stroke-width='4' stroke-linecap='round' stroke-linejoin='round'/><path d='M20 3v5h-5' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/></svg>") 12 12, crosshair`;
  function cursorFor(hd) {
    if (!hd) return '';
    if (hd.kind === 'rotate') return ROTATE_CURSOR;
    // pick the resize arrow that best matches the handle direction on screen
    const ang = ((Math.atan2(hd.h.p.y - hd.g.cy, hd.h.p.x - hd.g.cx) * 180) / Math.PI + 180) % 180;
    if (ang < 22.5 || ang >= 157.5) return 'ew-resize';
    if (ang < 67.5) return 'nwse-resize';
    if (ang < 112.5) return 'ns-resize';
    return 'nesw-resize';
  }
  canvas.addEventListener('pointermove', (e) => {
    if (e.buttons) return;
    const p = toSeq(e);
    const sel = visualSel();
    const hd = handleAt(sel, p);
    canvas.style.cursor = hd ? cursorFor(hd) : sel && FL.isVisual(sel) && visibleAt(FL.time).includes(sel) && hit(sel, p) ? 'move' : '';
  });

  function transformDrag(e, c, hd) {
    const p0 = toSeq(e);
    const { g } = hd;
    const u = g.u;
    const s0 = g.mo.s;
    const r0 = g.mo.r;
    const d0 = Math.max(1, Math.hypot(p0.x - g.cx, p0.y - g.cy));
    const a0 = Math.atan2(p0.y - g.cy, p0.x - g.cx);
    let moved = false;
    canvas.setPointerCapture(e.pointerId);
    const move = (ev) => {
      const q = toSeq(ev);
      if (!moved) { FL.pushUndo(); moved = true; }
      if (hd.kind === 'scale') {
        let sc = (s0 * Math.hypot(q.x - g.cx, q.y - g.cy)) / d0;
        sc = ev.shiftKey ? Math.round(sc * 20) / 20 : Math.round(sc * 1000) / 1000;
        FL.setProp(c, 'scale', FL.clamp(sc, 0.01, 10), u);
        FL.toast(`Scale ${Math.round(FL.kfValue(c, 'scale', u) * 100)}%`, 700);
      } else {
        let r = r0 + ((Math.atan2(q.y - g.cy, q.x - g.cx) - a0) * 180) / Math.PI;
        r = ev.shiftKey ? Math.round(r / 15) * 15 : Math.round(r * 10) / 10;
        FL.setProp(c, 'rotation', r, u);
        FL.toast(`Rotation ${FL.kfValue(c, 'rotation', u)}°`, 700);
      }
      needsDraw = true;
      FL.emit('inspector-refresh');
    };
    const up = () => {
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      if (moved) FL.changed({ source: 'monitor' });
    };
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const p = toSeq(e);
    if (!FL.maskEdit) {
      const sel = visualSel();
      const hd = handleAt(sel, p);
      if (hd) { transformDrag(e, sel, hd); return; }
    }
    let target = visualSel();
    const vis = visibleAt(FL.time);
    if (!(target && vis.includes(target) && hit(target, p))) target = vis.find((c) => hit(c, p));
    if (!target) { if (!FL.maskEdit) FL.select(null); return; }
    if (!FL.sel.has(target.id)) FL.select(target.id);
    if (FL.isLocked(target)) return;
    const u = FL.localTime(target);
    const fx = FL.maskEdit && FL.maskEdit.clipId === target.id && (target.effects || []).find((x) => x.id === FL.maskEdit.fxId && x.mask);
    const startPos = fx ? { x: fx.mask.cx, y: fx.mask.cy } : { x: FL.kfValue(target, 'x', u) || 0, y: FL.kfValue(target, 'y', u) || 0 };
    let moved = false;
    canvas.setPointerCapture(e.pointerId);
    const move = (ev) => {
      const q = toSeq(ev);
      if (!moved) { FL.pushUndo(); moved = true; }
      let dx = q.x - p.x;
      let dy = q.y - p.y;
      if (fx) {
        const mo = R.motion(target, u);
        const { bw, bh } = R.baseSize(target);
        const rot = (-mo.r * Math.PI) / 180;
        const lx = (dx * Math.cos(rot) - dy * Math.sin(rot)) / mo.s;
        const ly = (dx * Math.sin(rot) + dy * Math.cos(rot)) / mo.s;
        fx.mask.cx = FL.clamp(startPos.x + lx / bw, -0.5, 1.5);
        fx.mask.cy = FL.clamp(startPos.y + ly / bh, -0.5, 1.5);
      } else {
        let nx = startPos.x + dx;
        let ny = startPos.y + dy;
        if (!ev.shiftKey) {
          const th = 10 * q.k;
          if (Math.abs(nx) < th) nx = 0;
          if (Math.abs(ny) < th) ny = 0;
        }
        FL.setProp(target, 'x', Math.round(nx), u);
        FL.setProp(target, 'y', Math.round(ny), u);
      }
      needsDraw = true;
      FL.emit('inspector-refresh');
    };
    const up = () => {
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      if (moved) FL.changed({ source: 'monitor' });
    };
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
  });

  // Sets a property, writing a keyframe when that property is animated.
  FL.setProp = (c, prop, v, u = FL.localTime(c)) => {
    if (FL.hasKf(c, prop)) FL.setKf(c, prop, u, v);
    else c[prop] = v;
  };

  FL.on('change', () => { needsDraw = true; });
  FL.on('select', () => { needsDraw = true; });
  FL.on('seq', () => { for (const id of [...pool.keys()]) release(id); needsDraw = true; });
})();
