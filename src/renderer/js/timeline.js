/* Frameline — timeline: ruler, tracks, clips, playhead and all mouse editing
   (move, trim, razor, snapping, drag-in from the Project panel). */
'use strict';

(() => {
  const HEAD_W = 168;
  const scroll = document.getElementById('timeline-scroll');
  const timeline = document.getElementById('timeline');
  const tracksEl = document.getElementById('tracks');
  const ruler = document.getElementById('ruler');
  const rctx = ruler.getContext('2d');
  const playhead = document.getElementById('playhead');
  const snapLine = document.getElementById('snap-line');
  const zoomInput = document.getElementById('zoom');

  FL.HEAD_W = HEAD_W;
  const MIN_PX = 2;
  const MAX_PX = 600;
  const pxFromSlider = (v) => MIN_PX * Math.pow(MAX_PX / MIN_PX, v / 1000);
  const sliderFromPx = (px) => (Math.log(px / MIN_PX) / Math.log(MAX_PX / MIN_PX)) * 1000;

  const timeToX = (t) => t * FL.pxPerSec;
  const xToTime = (x) => x / FL.pxPerSec;
  const laneX = (clientX) => clientX - timeline.getBoundingClientRect().left - HEAD_W;

  FL.select = (id) => {
    if (FL.selectedId === id) return;
    FL.selectedId = id;
    tracksEl.querySelectorAll('.clip.selected').forEach((n) => n.classList.remove('selected'));
    if (id) { const n = tracksEl.querySelector(`.clip[data-id="${id}"]`); if (n) n.classList.add('selected'); }
    FL.emit('select', id);
  };

  // ---------- zoom ----------
  FL.setZoom = (px, anchorTime) => {
    px = FL.clamp(px, MIN_PX, MAX_PX);
    const anchor = anchorTime ?? FL.time;
    const anchorScreen = timeToX(anchor) - scroll.scrollLeft;
    FL.pxPerSec = px;
    zoomInput.value = sliderFromPx(px);
    render();
    scroll.scrollLeft = Math.max(0, timeToX(anchor) - anchorScreen);
    drawRuler();
  };
  FL.zoomBy = (f) => FL.setZoom(FL.pxPerSec * f);
  FL.zoomFit = () => {
    const dur = FL.duration() || 30;
    const w = scroll.clientWidth - HEAD_W - 40;
    FL.setZoom(w / dur, 0);
    scroll.scrollLeft = 0;
  };
  zoomInput.addEventListener('input', () => FL.setZoom(pxFromSlider(+zoomInput.value)));
  document.getElementById('zoom-in').onclick = () => FL.zoomBy(1.5);
  document.getElementById('zoom-out').onclick = () => FL.zoomBy(1 / 1.5);
  document.getElementById('zoom-fit').onclick = () => FL.zoomFit();
  scroll.addEventListener('wheel', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) {
      e.preventDefault();
      const t = xToTime(laneX(e.clientX));
      FL.setZoom(FL.pxPerSec * Math.exp(-e.deltaY * 0.01), Math.max(0, t));
    }
  }, { passive: false });

  // ---------- rendering ----------
  function contentWidth() {
    return Math.max(timeToX(FL.duration() + 60), scroll.clientWidth - HEAD_W);
  }

  function icon(name) { return `<i class="ic ic-${name}"></i>`; }

  function trackHead(tr) {
    const isV = tr.kind === 'video';
    return `<div class="track-head ${tr.kind}">
      <span class="track-name">${FL.esc(tr.name)}</span>
      <span class="track-btns">
        ${isV
          ? `<button class="hbtn ${tr.hidden ? 'off' : ''}" data-act="hide" title="Toggle track output">${icon(tr.hidden ? 'eye-off' : 'eye')}</button>`
          : `<button class="hbtn ${tr.muted ? 'on warn' : ''}" data-act="mute" title="Mute track">M</button>`}
        <button class="hbtn ${tr.locked ? 'on' : ''}" data-act="lock" title="Lock track">${icon(tr.locked ? 'lock' : 'unlock')}</button>
      </span>
    </div>`;
  }

  function clipHTML(c) {
    const m = FL.media(c.mediaId);
    const w = Math.max(2, timeToX(c.duration));
    const style = [`left:${timeToX(c.start)}px`, `width:${w}px`];
    const layers = [];
    if (c.type === 'video' || c.type === 'image') {
      if (m && m.thumb) layers.push(`<div class="clip-thumbs" style="background-image:url('${window.api.fileUrl(m.thumb)}')"></div>`);
    }
    if ((c.type === 'audio' || (c.type === 'video' && m && m.hasAudio)) && m && m.wave && m.duration) {
      const full = timeToX(m.duration / (c.speed || 1));
      const off = timeToX((c.in || 0) / (c.speed || 1));
      layers.push(`<div class="clip-wave ${c.type === 'video' ? 'mini' : ''} ${c.muted ? 'muted' : ''}" style="background-image:url('${window.api.fileUrl(m.wave)}');background-size:${full}px 100%;background-position:${-off}px 0"></div>`);
    }
    if (c.fadeIn > 0) layers.push(`<div class="fade in" style="width:${Math.min(w, timeToX(c.fadeIn))}px"></div>`);
    if (c.fadeOut > 0) layers.push(`<div class="fade out" style="width:${Math.min(w, timeToX(c.fadeOut))}px"></div>`);
    const badges = [];
    if ((c.speed || 1) !== 1) badges.push(`${Math.round(c.speed * 100)}%`);
    if (c.type === 'video' && m && m.hasAudio && c.muted) badges.push('muted');
    if (!m && c.type !== 'text') badges.push('offline');
    return `<div class="clip ${c.type} ${c.id === FL.selectedId ? 'selected' : ''} ${!m && c.type !== 'text' ? 'offline' : ''}" data-id="${c.id}" style="${style.join(';')}">
      ${layers.join('')}
      <div class="clip-label">${c.type === 'text' ? icon('text') : ''}<span>${FL.esc(FL.clipName(c))}</span>${badges.map((b) => `<em>${b}</em>`).join('')}</div>
      <div class="trim l"></div><div class="trim r"></div>
    </div>`;
  }

  function render() {
    const cw = contentWidth();
    timeline.style.width = HEAD_W + cw + 'px';
    document.getElementById('ruler-row').style.width = HEAD_W + cw + 'px';
    tracksEl.innerHTML = FL.project.tracks.map((tr) => {
      const clips = FL.project.clips.filter((c) => c.trackId === tr.id).map(clipHTML).join('');
      return `<div class="track-row ${tr.kind} ${tr.locked ? 'locked' : ''} ${tr.hidden ? 'hidden-track' : ''} ${tr.muted ? 'muted-track' : ''}" data-track="${tr.id}">
        ${trackHead(tr)}
        <div class="lane" data-track="${tr.id}" style="width:${cw}px">${clips}</div>
      </div>`;
    }).join('');
    // divider between video and audio sections
    const firstAudio = tracksEl.querySelector('.track-row.audio');
    if (firstAudio) firstAudio.classList.add('first-audio');
    updatePlayhead();
    drawRuler();
  }
  FL.renderTimeline = render;

  // ---------- ruler ----------
  function drawRuler() {
    const dpr = window.devicePixelRatio || 1;
    const w = scroll.clientWidth - HEAD_W;
    const h = 28;
    if (ruler.width !== Math.round(w * dpr)) { ruler.width = Math.round(w * dpr); ruler.style.width = w + 'px'; }
    if (ruler.height !== h * dpr) { ruler.height = h * dpr; ruler.style.height = h + 'px'; }
    rctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    rctx.clearRect(0, 0, w, h);
    const css = getComputedStyle(document.documentElement);
    rctx.fillStyle = css.getPropertyValue('--ruler-bg').trim() || '#1c1c20';
    rctx.fillRect(0, 0, w, h);

    const px = FL.pxPerSec;
    const fps = FL.fps();
    const steps = [1 / fps, 2 / fps, 5 / fps, 10 / fps, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1200];
    const major = steps.find((s) => s * px >= 90) || 1800;
    const minor = steps.slice().reverse().find((s) => s < major && s * px >= 8 && Math.abs(major / s - Math.round(major / s)) < 1e-6) || major / 2;
    const left = scroll.scrollLeft;
    const t0 = Math.floor(xToTime(left) / minor) * minor;
    const t1 = xToTime(left + w);
    rctx.strokeStyle = css.getPropertyValue('--ruler-tick').trim() || '#555';
    rctx.fillStyle = css.getPropertyValue('--text-dim').trim() || '#999';
    rctx.font = '10px "SF Mono", Menlo, monospace';
    rctx.lineWidth = 1;
    rctx.beginPath();
    for (let t = t0; t <= t1 + minor; t += minor) {
      const x = Math.round(timeToX(t) - left) + 0.5;
      const isMajor = Math.abs(t / major - Math.round(t / major)) < 1e-6;
      rctx.moveTo(x, h);
      rctx.lineTo(x, isMajor ? h - 12 : h - 5);
      if (isMajor) rctx.fillText(FL.timecode(t), x + 4, 12);
    }
    rctx.stroke();
    // sequence end marker
    const endX = timeToX(FL.duration()) - left;
    if (endX > 0 && endX < w) {
      rctx.fillStyle = 'rgba(255,255,255,0.08)';
      rctx.fillRect(endX, 0, w - endX, h);
    }
  }
  scroll.addEventListener('scroll', drawRuler);
  new ResizeObserver(() => { render(); }).observe(scroll);

  // ---------- playhead ----------
  function updatePlayhead() {
    playhead.style.transform = `translateX(${HEAD_W + timeToX(FL.time)}px)`;
  }
  FL.on('time', () => {
    updatePlayhead();
    if (FL.playing) {
      const x = timeToX(FL.time);
      const view = scroll.clientWidth - HEAD_W;
      if (x > scroll.scrollLeft + view - 40 || x < scroll.scrollLeft) scroll.scrollLeft = Math.max(0, x - 60);
    }
  });

  function ensureVisible(t) {
    const x = timeToX(t);
    const view = scroll.clientWidth - HEAD_W;
    if (x < scroll.scrollLeft + 20 || x > scroll.scrollLeft + view - 20) scroll.scrollLeft = Math.max(0, x - view / 2);
  }
  FL.ensureVisible = ensureVisible;

  // scrub on ruler
  document.getElementById('ruler-row').addEventListener('pointerdown', (e) => {
    if (e.target.classList.contains('corner')) return;
    const row = e.currentTarget;
    row.setPointerCapture(e.pointerId);
    const wasPlaying = FL.playing;
    if (wasPlaying) FL.pause();
    const go = (ev) => {
      let t = Math.max(0, xToTime(laneX(ev.clientX)));
      if (FL.snap && !ev.shiftKey) {
        const th = 6 / FL.pxPerSec;
        const near = FL.editPoints().find((p) => Math.abs(p - t) < th);
        if (near !== undefined) t = near;
      }
      FL.seek(t);
    };
    go(e);
    const up = () => { row.removeEventListener('pointermove', go); row.removeEventListener('pointerup', up); };
    row.addEventListener('pointermove', go);
    row.addEventListener('pointerup', up);
  });

  // ---------- snapping ----------
  function snapPoints(excludeId) {
    const pts = FL.editPoints(excludeId);
    pts.push(FL.time);
    return pts;
  }
  function nearest(t, pts) {
    let best = null;
    for (const p of pts) if (best === null || Math.abs(p - t) < Math.abs(best - t)) best = p;
    return best;
  }
  function showSnap(t) {
    if (t === null || t === undefined) { snapLine.style.display = 'none'; return; }
    snapLine.style.display = 'block';
    snapLine.style.transform = `translateX(${HEAD_W + timeToX(t)}px)`;
  }

  // ---------- clip interactions ----------
  function laneAt(clientX, clientY) {
    const el = document.elementFromPoint(clientX, clientY);
    const lane = el && el.closest('.lane');
    return lane ? FL.track(lane.dataset.track) : null;
  }

  tracksEl.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const head = e.target.closest('.track-head');
    if (head) return;
    const clipEl = e.target.closest('.clip');
    const lane = e.target.closest('.lane');
    if (!clipEl) {
      if (lane) { FL.select(null); if (FL.playing) FL.pause(); FL.seek(xToTime(laneX(e.clientX))); }
      return;
    }
    const clip = FL.clip(clipEl.dataset.id);
    if (!clip) return;
    FL.select(clip.id);

    if (FL.tool === 'razor') {
      if (FL.isLocked(clip)) return FL.toast('Track is locked');
      let t = FL.snapToFrame(xToTime(laneX(e.clientX)));
      if (FL.snap && !e.shiftKey && Math.abs(t - FL.time) < 6 / FL.pxPerSec) t = FL.time;
      FL.pushUndo();
      const right = FL.splitClip(clip, t);
      if (!right) { FL.undoStack.pop(); return; }
      FL.changed();
      return;
    }
    if (FL.isLocked(clip)) return;

    const mode = e.target.classList.contains('trim') ? (e.target.classList.contains('l') ? 'trimL' : 'trimR') : 'move';
    const x0 = e.clientX;
    const orig = { start: clip.start, duration: clip.duration, in: clip.in || 0, trackId: clip.trackId };
    const pts = FL.snap ? snapPoints(clip.id) : [];
    const th = 8 / FL.pxPerSec;
    let moved = false;
    document.body.classList.add(mode === 'move' ? 'dragging' : 'trimming');

    // neighbours on the same track bound trims
    const siblings = FL.clipsOn(clip.trackId).filter((c) => c.id !== clip.id);
    const prevEnd = Math.max(0, ...siblings.filter((c) => c.start + c.duration <= orig.start + 1e-6).map((c) => c.start + c.duration));
    const nextStart = Math.min(Infinity, ...siblings.filter((c) => c.start >= orig.start + orig.duration - 1e-6).map((c) => c.start));
    const speed = clip.speed || 1;

    const onMove = (ev) => {
      const dx = ev.clientX - x0;
      if (!moved && Math.abs(dx) < 3 && mode === 'move' && !laneChanged(ev)) return;
      if (!moved) { FL.pushUndo(); moved = true; }
      const dt = xToTime(dx);
      let snapAt = null;
      if (mode === 'move') {
        let s = Math.max(0, orig.start + dt);
        if (FL.snap && !ev.shiftKey) {
          const a = nearest(s, pts);
          const b = nearest(s + clip.duration, pts);
          const da = a === null ? Infinity : Math.abs(a - s);
          const db = b === null ? Infinity : Math.abs(b - (s + clip.duration));
          if (da < th && da <= db) { s = a; snapAt = a; } else if (db < th) { s = b - clip.duration; snapAt = b; }
        }
        clip.start = Math.max(0, FL.snapToFrame(s));
        const tr = laneAt(ev.clientX, ev.clientY);
        if (tr && tr.kind === FL.kindFor(clip.type) && !tr.locked && tr.id !== clip.trackId) {
          clip.trackId = tr.id;
          const lane = tracksEl.querySelector(`.lane[data-track="${tr.id}"]`);
          lane.appendChild(clipEl);
        }
        clipEl.style.left = timeToX(clip.start) + 'px';
      } else if (mode === 'trimL') {
        const end = orig.start + orig.duration;
        let s = orig.start + dt;
        const minStart = Math.max(prevEnd, clip.type === 'video' || clip.type === 'audio' ? orig.start - orig.in / speed : 0, 0);
        if (FL.snap && !ev.shiftKey) { const a = nearest(s, pts); if (a !== null && Math.abs(a - s) < th) { s = a; snapAt = a; } }
        s = FL.clamp(FL.snapToFrame(s), minStart, end - FL.MIN_CLIP);
        clip.start = s;
        clip.duration = end - s;
        clip.in = Math.max(0, orig.in + (s - orig.start) * speed);
        clipEl.style.left = timeToX(clip.start) + 'px';
        clipEl.style.width = timeToX(clip.duration) + 'px';
      } else {
        let e2 = orig.start + orig.duration + dt;
        if (FL.snap && !ev.shiftKey) { const a = nearest(e2, pts); if (a !== null && Math.abs(a - e2) < th) { e2 = a; snapAt = a; } }
        const maxEnd = Math.min(nextStart, orig.start + FL.mediaLimit(clip));
        e2 = FL.clamp(FL.snapToFrame(e2), orig.start + FL.MIN_CLIP, maxEnd);
        clip.duration = e2 - orig.start;
        clipEl.style.width = timeToX(clip.duration) + 'px';
      }
      showSnap(snapAt);
      FL.emit('inspector-refresh');
      FL.requestDraw();
    };
    function laneChanged(ev) {
      const tr = laneAt(ev.clientX, ev.clientY);
      return tr && tr.id !== orig.trackId;
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      document.body.classList.remove('dragging', 'trimming');
      showSnap(null);
      if (!moved) return;
      if (mode === 'move') FL.overwrite(clip.trackId, clip.start, clip.start + clip.duration, clip.id);
      FL.changed();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  });

  // hover cursor for razor
  tracksEl.addEventListener('pointermove', (e) => {
    if (FL.tool !== 'razor') return;
    const clipEl = e.target.closest('.clip');
    if (clipEl) showSnap(FL.snapToFrame(xToTime(laneX(e.clientX))));
  });
  tracksEl.addEventListener('pointerleave', () => { if (FL.tool === 'razor') showSnap(null); });

  // track header buttons
  tracksEl.addEventListener('click', (e) => {
    const btn = e.target.closest('.hbtn');
    if (!btn) return;
    const tr = FL.track(btn.closest('.track-row').dataset.track);
    FL.pushUndo();
    if (btn.dataset.act === 'hide') tr.hidden = !tr.hidden;
    if (btn.dataset.act === 'mute') tr.muted = !tr.muted;
    if (btn.dataset.act === 'lock') tr.locked = !tr.locked;
    FL.changed();
  });

  // context menus
  tracksEl.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const clipEl = e.target.closest('.clip');
    const row = e.target.closest('.track-row');
    if (clipEl) {
      const clip = FL.clip(clipEl.dataset.id);
      FL.select(clip.id);
      const m = FL.media(clip.mediaId);
      FL.showMenu(e.clientX, e.clientY, [
        { label: 'Split at Playhead', key: '⌘K', act: () => FL.cmd('split'), disabled: !(FL.time > clip.start && FL.time < clip.start + clip.duration) },
        { label: 'Duplicate', key: '⌘D', act: () => FL.cmd('duplicate') },
        { label: 'Copy', key: '⌘C', act: () => FL.cmd('copy') },
        { sep: true },
        { label: clip.type === 'video' && m && m.hasAudio && !clip.muted ? 'Detach Audio' : null, key: '⌘L', act: () => FL.cmd('detachAudio') },
        { label: 'Fade In / Out (0.5s)', act: () => FL.cmd('quickFade') },
        { label: 'Reset Motion', act: () => FL.cmd('resetMotion'), disabled: clip.type === 'audio' },
        { sep: true },
        { label: 'Delete', key: '⌫', act: () => FL.cmd('delete') },
        { label: 'Ripple Delete', key: '⇧⌫', act: () => FL.cmd('rippleDelete') },
      ].filter((i) => i.sep || i.label));
    } else if (row) {
      const tr = FL.track(row.dataset.track);
      const isEmpty = !FL.project.clips.some((c) => c.trackId === tr.id);
      const sameKind = FL.project.tracks.filter((t) => t.kind === tr.kind).length;
      FL.showMenu(e.clientX, e.clientY, [
        { label: 'Paste at Playhead', key: '⌘V', act: () => FL.cmd('paste', tr.id), disabled: !FL.clipboard || FL.kindFor(FL.clipboard.type) !== tr.kind },
        { label: `Add ${tr.kind === 'video' ? 'Video' : 'Audio'} Track`, act: () => FL.cmd(tr.kind === 'video' ? 'addVideoTrack' : 'addAudioTrack') },
        { label: 'Delete Track', disabled: !isEmpty || sameKind <= 1, act: () => { FL.pushUndo(); FL.project.tracks = FL.project.tracks.filter((t) => t.id !== tr.id); FL.changed(); } },
      ]);
    }
  });

  // ---------- drop from Project panel / Finder ----------
  const ghost = document.createElement('div');
  ghost.className = 'drop-ghost';
  ghost.hidden = true;

  function dropTarget(e) {
    const tr = laneAt(e.clientX, e.clientY);
    if (!tr) return null;
    let t = Math.max(0, xToTime(laneX(e.clientX)));
    if (FL.snap) { const a = nearest(t, snapPoints(null)); if (a !== null && Math.abs(a - t) < 10 / FL.pxPerSec) t = a; }
    return { track: tr, time: FL.snapToFrame(t) };
  }
  tracksEl.addEventListener('dragover', (e) => {
    const isMedia = e.dataTransfer.types.includes('application/x-fl-media');
    const isFiles = e.dataTransfer.types.includes('Files');
    if (!isMedia && !isFiles) return;
    const tgt = dropTarget(e);
    if (!tgt || tgt.track.locked) { ghost.hidden = true; return; }
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
    const media = FL.dragMedia ? FL.media(FL.dragMedia) : null;
    let dur = 5;
    if (media) dur = media.type === 'image' ? 5 : media.duration;
    const lane = tracksEl.querySelector(`.lane[data-track="${tgt.track.id}"]`);
    if (ghost.parentNode !== lane) lane.appendChild(ghost);
    ghost.hidden = false;
    ghost.style.left = timeToX(tgt.time) + 'px';
    ghost.style.width = Math.max(4, timeToX(dur)) + 'px';
  });
  tracksEl.addEventListener('dragleave', (e) => { if (!tracksEl.contains(e.relatedTarget)) ghost.hidden = true; });
  tracksEl.addEventListener('drop', async (e) => {
    ghost.hidden = true;
    const tgt = dropTarget(e);
    if (!tgt || tgt.track.locked) return;
    e.preventDefault();
    e.stopPropagation();
    const id = e.dataTransfer.getData('application/x-fl-media');
    if (id) { FL.insertMedia(FL.media(id), tgt.track, tgt.time); return; }
    if (e.dataTransfer.files.length) {
      const paths = [...e.dataTransfer.files].map((f) => window.api.pathForFile(f)).filter(Boolean);
      const items = await FL.importPaths(paths);
      let t = tgt.time;
      for (const m of items) { const c = FL.insertMedia(m, tgt.track, t); if (c) t = c.start + c.duration; }
    }
  });

  // Puts media on the timeline (picks a fitting track if the target is the wrong kind).
  FL.insertMedia = (media, track, time) => {
    if (!media) return null;
    let kind = track ? track.kind : (media.type === 'audio' ? 'audio' : 'video');
    if (media.type === 'audio') kind = 'audio';
    if (media.type === 'image') kind = 'video';
    if (kind === 'audio' && !media.hasAudio) kind = 'video';
    if (!track || track.kind !== kind) {
      track = FL.project.tracks.filter((t) => t.kind === kind && !t.locked).slice(kind === 'video' ? -1 : 0)[0];
      if (!track) track = FL.addTrack(kind);
    }
    FL.pushUndo();
    const clip = FL.clipFromMedia(media, kind);
    FL.placeClip(clip, track.id, time ?? FL.time);
    FL.selectedId = clip.id;
    FL.changed();
    FL.emit('select', clip.id);
    return clip;
  };

  FL.on('change', render);
  FL.on('select', () => {});
  window.addEventListener('resize', drawRuler);
  render();
})();
