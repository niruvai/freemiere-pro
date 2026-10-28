/* Frameline — Program monitor: playback clock, media element sync and the
   canvas compositor (tracks bottom-up, with opacity, fades, transforms and colour). */
'use strict';

(() => {
  const canvas = document.getElementById('canvas');
  const ctx = canvas.getContext('2d');
  const stage = document.getElementById('stage');
  const monitor = document.getElementById('monitor');

  const pool = new Map();   // clipId -> { el, src, used }
  const images = new Map(); // mediaId -> HTMLImageElement
  let quality = 1;
  let needsDraw = true;
  let playStartPerf = 0;
  let playStartTime = 0;

  FL.requestDraw = () => { needsDraw = true; };

  // ---------- sizing ----------
  function layout() {
    const { width: W, height: H } = FL.project.settings;
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
  FL.on('change', () => { layout(); });
  FL.layoutPreview = layout;
  FL.setPreviewQuality = (q) => { quality = q; layout(); };

  // ---------- media sources ----------
  function srcFor(m) { return window.api.fileUrl(m.proxy || m.path); }

  function imageFor(m) {
    const src = srcFor(m);
    let img = images.get(m.id);
    if (!img || img.dataset.src !== src) {
      img = new Image();
      img.dataset.src = src;
      img.onload = () => { needsDraw = true; };
      img.src = src;
      images.set(m.id, img);
    }
    return img;
  }

  function elementFor(clip, m) {
    const src = srcFor(m);
    let entry = pool.get(clip.id);
    if (entry && entry.src !== src) { release(clip.id); entry = null; }
    if (!entry) {
      const el = clip.type === 'audio' ? new Audio() : document.createElement('video');
      el.preload = 'auto';
      el.playsInline = true;
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
    e.el.removeAttribute('src');
    e.el.load();
    pool.delete(id);
  }
  function trimPool() {
    if (pool.size <= 14) return;
    const sorted = [...pool.entries()].sort((a, b) => a[1].used - b[1].used);
    for (const [id] of sorted.slice(0, pool.size - 14)) release(id);
  }

  // ---------- transport ----------
  FL.play = () => {
    const dur = FL.duration();
    if (!dur) return;
    if (FL.time >= dur - FL.frame()) FL.time = 0;
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

  // ---------- sync media elements to the playhead ----------
  function sync(t) {
    const active = new Set();
    const fps = FL.fps();
    for (const clip of FL.project.clips) {
      if (clip.type !== 'video' && clip.type !== 'audio') continue;
      const local = t - clip.start;
      if (local < -0.75 || local >= clip.duration) continue;
      const m = FL.media(clip.mediaId);
      if (!m) continue;
      const track = FL.track(clip.trackId);
      const el = elementFor(clip, m);
      active.add(clip.id);
      const speed = clip.speed || 1;
      const expected = (clip.in || 0) + Math.max(0, local) * speed;
      const inside = local >= 0;

      const silent = clip.muted || !m.hasAudio || (track && track.kind === 'audio' && track.muted) || !inside;
      el.muted = !!silent;
      if (!silent) el.volume = FL.clamp((clip.volume ?? 1) * FL.fadeFactor(clip, t), 0, 1);
      if (el.playbackRate !== speed) { try { el.playbackRate = speed; } catch (_) {} }

      if (FL.playing && inside) {
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

  // ---------- compositor ----------
  function drawMedia(src, m, clip, alpha) {
    const { width: W, height: H } = FL.project.settings;
    const fit = Math.min(W / m.width, H / m.height) * (clip.scale ?? 1);
    const w = m.width * fit;
    const h = m.height * fit;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(W / 2 + (clip.x || 0), H / 2 + (clip.y || 0));
    if (clip.rotation) ctx.rotate((clip.rotation * Math.PI) / 180);
    const b = clip.brightness || 0;
    const c = clip.contrast || 0;
    const s = clip.saturation ?? 100;
    if (b || c || s !== 100) ctx.filter = `brightness(${1 + b / 100 * 0.5}) contrast(${1 + c / 100}) saturate(${s / 100})`;
    ctx.drawImage(src, -w / 2, -h / 2, w, h);
    ctx.restore();
  }

  FL.clipBounds = (clip) => {
    // Box in sequence pixels (centre, size, rotation) for the selection outline & hit tests.
    const { width: W, height: H } = FL.project.settings;
    let w;
    let h;
    if (clip.type === 'text') {
      const L = FL.textLayout(ctx, clip);
      w = L.bw; h = L.bh;
    } else {
      const m = FL.media(clip.mediaId);
      if (!m || !m.width) return null;
      const fit = Math.min(W / m.width, H / m.height) * (clip.scale ?? 1);
      w = m.width * fit; h = m.height * fit;
    }
    return { cx: W / 2 + (clip.x || 0), cy: H / 2 + (clip.y || 0), w, h, rot: ((clip.rotation || 0) * Math.PI) / 180 };
  };

  function visibleClipsAt(t) {
    const out = [];
    const tracks = FL.project.tracks.filter((tr) => tr.kind === 'video').reverse();
    for (const tr of tracks) {
      if (tr.hidden) continue;
      const c = FL.clipAt(tr.id, t);
      if (c) out.push(c);
    }
    return out; // bottom first
  }

  function draw(t) {
    const { width: W, height: H, bg } = FL.project.settings;
    ctx.setTransform(quality, 0, 0, quality, 0, 0);
    ctx.globalAlpha = 1;
    ctx.filter = 'none';
    ctx.fillStyle = bg || '#000';
    ctx.fillRect(0, 0, W, H);

    for (const clip of visibleClipsAt(t)) {
      const alpha = (clip.opacity ?? 1) * FL.fadeFactor(clip, t);
      if (alpha <= 0) continue;
      if (clip.type === 'text') { FL.drawText(ctx, clip, W, H, alpha); continue; }
      const m = FL.media(clip.mediaId);
      if (!m || !m.width) continue;
      if (clip.type === 'image') {
        const img = imageFor(m);
        if (img.complete && img.naturalWidth) drawMedia(img, m, clip, alpha);
      } else {
        const entry = pool.get(clip.id);
        if (entry && entry.el.readyState >= 2 && entry.el.videoWidth) drawMedia(entry.el, m, clip, alpha);
      }
    }

    // selection outline
    const sel = FL.selected();
    if (!FL.playing && sel && sel.type !== 'audio' && t >= sel.start && t < sel.start + sel.duration) {
      const tr = FL.track(sel.trackId);
      const b = tr && !tr.hidden && FL.clipBounds(sel);
      if (b) {
        ctx.save();
        ctx.translate(b.cx, b.cy);
        ctx.rotate(b.rot);
        ctx.lineWidth = 2 / quality / (stage.clientWidth / W);
        ctx.strokeStyle = '#4c8dff';
        ctx.setLineDash([8 / (stage.clientWidth / W), 5 / (stage.clientWidth / W)]);
        ctx.strokeRect(-b.w / 2, -b.h / 2, b.w, b.h);
        ctx.setLineDash([]);
        const hs = 7 / (stage.clientWidth / W);
        ctx.fillStyle = '#fff';
        for (const [hx, hy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) ctx.fillRect(hx * b.w / 2 - hs / 2, hy * b.h / 2 - hs / 2, hs, hs);
        ctx.restore();
      }
    }
  }

  // ---------- main loop ----------
  let lastEmit = 0;
  function tick(now) {
    if (FL.playing) {
      const dur = FL.duration();
      let t = playStartTime + (now - playStartPerf) / 1000;
      if (t >= dur) { t = dur; FL.time = t; FL.pause(); }
      else FL.time = t;
      sync(FL.time);
      draw(FL.time);
      if (now - lastEmit > 30) { FL.emit('time', FL.time); lastEmit = now; }
    } else if (needsDraw) {
      needsDraw = false;
      sync(FL.time);
      draw(FL.time);
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  // ---------- direct manipulation in the monitor ----------
  function toSeq(e) {
    const r = canvas.getBoundingClientRect();
    const { width: W, height: H } = FL.project.settings;
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H, k: W / r.width };
  }
  function hit(clip, p) {
    const b = FL.clipBounds(clip);
    if (!b) return false;
    const dx = p.x - b.cx;
    const dy = p.y - b.cy;
    const lx = dx * Math.cos(-b.rot) - dy * Math.sin(-b.rot);
    const ly = dx * Math.sin(-b.rot) + dy * Math.cos(-b.rot);
    return Math.abs(lx) <= b.w / 2 && Math.abs(ly) <= b.h / 2;
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const p = toSeq(e);
    const clips = visibleClipsAt(FL.time).reverse(); // topmost first
    let target = FL.selected();
    if (!(target && clips.includes(target) && hit(target, p))) target = clips.find((c) => hit(c, p));
    if (!target) { FL.select(null); return; }
    FL.select(target.id);
    if (FL.isLocked(target)) return;
    const start = { x: target.x || 0, y: target.y || 0 };
    let moved = false;
    canvas.setPointerCapture(e.pointerId);
    const move = (ev) => {
      const q = toSeq(ev);
      if (!moved) { FL.pushUndo(); moved = true; }
      let nx = start.x + (q.x - p.x);
      let ny = start.y + (q.y - p.y);
      if (!ev.shiftKey) { // snap to centre lines
        const th = 10 * q.k;
        if (Math.abs(nx) < th) nx = 0;
        if (Math.abs(ny) < th) ny = 0;
      }
      target.x = Math.round(nx);
      target.y = Math.round(ny);
      needsDraw = true;
      FL.emit('inspector-refresh');
    };
    const up = () => {
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      if (moved) FL.changed();
    };
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
  });

  FL.on('change', () => { needsDraw = true; });
  FL.on('select', () => { needsDraw = true; });
})();
