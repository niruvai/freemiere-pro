/* Freemiere Pro — timeline: sequence tabs, ruler (markers, in/out), tracks,
   clips, transitions, keyframe ticks, playhead and every editing tool
   (selection, track-select-forward, ripple, rolling, rate stretch, razor, slip). */
'use strict';

(() => {
  const D = window.FLDefs;
  const HEAD_W = 176;
  const scroll = document.getElementById('timeline-scroll');
  const timeline = document.getElementById('timeline');
  const tracksEl = document.getElementById('tracks');
  const ruler = document.getElementById('ruler');
  const rulerRow = document.getElementById('ruler-row');
  const rctx = ruler.getContext('2d');
  const playhead = document.getElementById('playhead');
  const snapLine = document.getElementById('snap-line');
  const marquee = document.getElementById('marquee');
  const zoomInput = document.getElementById('zoom');
  const seqTabs = document.getElementById('seq-tabs');

  FL.HEAD_W = HEAD_W;
  const MIN_PX = 1;
  const MAX_PX = 600;
  const pxFromSlider = (v) => MIN_PX * Math.pow(MAX_PX / MIN_PX, v / 1000);
  const sliderFromPx = (px) => (Math.log(px / MIN_PX) / Math.log(MAX_PX / MIN_PX)) * 1000;
  const timeToX = (t) => t * FL.pxPerSec;
  const xToTime = (x) => x / FL.pxPerSec;
  const laneX = (clientX) => clientX - timeline.getBoundingClientRect().left - HEAD_W;
  const icon = (n) => `<i class="ic ic-${n}"></i>`;

  // ---------------------------------------------------------------- sequence tabs
  function renderSeqTabs() {
    const act = FL.project.activeSeq;
    seqTabs.innerHTML = FL.project.sequences.map((s) => `<button class="seq-tab ${s.id === act ? 'active' : ''}" data-seq="${s.id}" title="Double-click to rename">
      <span class="seq-dot"></span><span class="seq-name">${FL.esc(s.name)}</span>${FL.project.sequences.length > 1 ? `<span class="seq-x" data-close-seq="${s.id}">×</span>` : ''}</button>`).join('') +
      `<button class="seq-add" title="New sequence (⌘N)">+</button>`;
  }
  seqTabs.addEventListener('click', (e) => {
    const x = e.target.closest('[data-close-seq]');
    if (x) { e.stopPropagation(); FL.cmd('deleteSequence', x.dataset.closeSeq); return; }
    if (e.target.closest('.seq-add')) { FL.cmd('newSequence'); return; }
    const t = e.target.closest('.seq-tab');
    if (t) FL.openSequence(t.dataset.seq);
  });
  seqTabs.addEventListener('dblclick', (e) => {
    const t = e.target.closest('.seq-tab');
    if (!t) return;
    const s = FL.project.sequences.find((q) => q.id === t.dataset.seq);
    const r = t.getBoundingClientRect();
    FL.promptInline(r.left, r.top, r.width + 40, s.name, (v) => { if (v) { FL.pushUndo(); s.name = v; FL.changed(); } });
  });
  seqTabs.addEventListener('contextmenu', (e) => {
    const t = e.target.closest('.seq-tab');
    if (!t) return;
    e.preventDefault();
    const id = t.dataset.seq;
    FL.showMenu(e.clientX, e.clientY, [
      { label: 'Open', act: () => FL.openSequence(id) },
      { label: 'Duplicate Sequence', act: () => FL.cmd('duplicateSequence', id) },
      { label: 'Sequence Settings…', act: () => { FL.openSequence(id); FL.cmd('settings'); } },
      { sep: true },
      { label: 'Delete Sequence', disabled: FL.project.sequences.length < 2, act: () => FL.cmd('deleteSequence', id) },
    ]);
  });
  FL.openSequence = (id) => {
    if (FL.project.activeSeq === id) return;
    if (FL.playing) FL.pause();
    FL.project.activeSeq = id;
    FL.sel.clear();
    FL.selectedId = null;
    FL.selTrans = null;
    FL.time = Math.min(FL.time, FL.duration());
    FL.emit('seq');
    FL.emit('change', { source: 'seq' });
    FL.emit('select', null);
    FL.emit('time', FL.time);
  };

  // ---------------------------------------------------------------- zoom
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
      FL.setZoom(FL.pxPerSec * Math.exp(-e.deltaY * 0.01), Math.max(0, xToTime(laneX(e.clientX))));
    }
  }, { passive: false });

  // ---------------------------------------------------------------- rendering
  const contentWidth = () => Math.max(timeToX(FL.duration() + 60), scroll.clientWidth - HEAD_W);

  function trackHead(tr) {
    const isV = tr.kind === 'video';
    const p = FL.patch();
    const patched = isV ? p.v === tr.id : p.a === tr.id;
    const on = patched && (isV ? p.vOn : p.aOn);
    const src = FL.source && FL.source.media;
    const relevant = !src || (isV ? src.type !== 'audio' : src.type !== 'image' && src.hasAudio);
    return `<div class="track-head ${tr.kind}">
      <button class="patch ${patched ? 'set' : ''} ${on ? 'on' : ''} ${relevant ? '' : 'na'}" data-act="patch"
        title="${patched ? (on ? 'Source patch: Insert/Overwrite send the ' + (isV ? 'picture' : 'sound') + ' here — click to turn off' : 'Source patch is off — click to turn on') : 'Click to send Source ' + (isV ? 'video' : 'audio') + ' to this track'}">${patched ? (isV ? 'V1' : 'A1') : ''}</button>
      <span class="track-btns">
        <button class="hbtn ${tr.locked ? 'on' : ''}" data-act="lock" title="Toggle track lock">${icon(tr.locked ? 'lock' : 'unlock')}</button>
        ${isV ? `<button class="hbtn ${tr.hidden ? 'off' : ''}" data-act="hide" title="Toggle track output">${icon(tr.hidden ? 'eye-off' : 'eye')}</button>` : ''}
      </span>
      <span class="track-name" title="Double-click to rename">${FL.esc(tr.name)}</span>
      ${isV ? '' : `<span class="track-btns">
        <button class="hbtn ${tr.muted ? 'on warn' : ''}" data-act="mute" title="Mute track">M</button>
        <button class="hbtn ${tr.solo ? 'on solo' : ''}" data-act="solo" title="Solo track">S</button></span>`}
    </div>`;
  }

  function transBlock(c, kind) {
    const out = [];
    const prev = FL.prevAdj(c);
    const next = FL.nextAdj(c);
    const key = kind === 'audio' ? 'atrans' : 'trans';
    const defs = kind === 'audio' ? D.AUDIO_TRANSITIONS : D.VIDEO_TRANSITIONS;
    const inT = c[key + 'In'];
    const outT = c[key + 'Out'];
    const sel = (side) => FL.selTrans && FL.selTrans.clipId === c.id && FL.selTrans.side === side && FL.selTrans.audio === (kind === 'audio');
    if (inT) {
      const s = prev ? c.start - inT.duration / 2 : c.start;
      out.push(`<div class="trans ${kind} ${prev ? 'pair' : ''} ${sel('in') ? 'selected' : ''}" data-clip="${c.id}" data-side="in" data-audio="${kind === 'audio' ? 1 : 0}"
        style="left:${timeToX(s)}px;width:${Math.max(6, timeToX(inT.duration))}px" title="${FL.esc((defs[inT.type] || {}).name || '')}"><span>${FL.esc((defs[inT.type] || {}).name || '')}</span></div>`);
    }
    if (outT && !(next && next[key + 'In'])) {
      const s = c.start + c.duration - outT.duration;
      out.push(`<div class="trans ${kind} ${sel('out') ? 'selected' : ''}" data-clip="${c.id}" data-side="out" data-audio="${kind === 'audio' ? 1 : 0}"
        style="left:${timeToX(s)}px;width:${Math.max(6, timeToX(outT.duration))}px" title="${FL.esc((defs[outT.type] || {}).name || '')}"><span>${FL.esc((defs[outT.type] || {}).name || '')}</span></div>`);
    }
    return out.join('');
  }

  function clipHTML(c) {
    const m = FL.media(c.mediaId);
    const w = Math.max(2, timeToX(c.duration));
    const layers = [];
    if ((c.type === 'video' || c.type === 'image') && m && m.thumb) {
      layers.push(`<div class="clip-thumbs" style="background-image:url('${window.api.fileUrl(m.thumb)}')"></div>`);
    }
    if (FL.hasAudio(c) && m && m.wave && m.duration) {
      const full = timeToX(m.duration / (c.speed || 1));
      const off = timeToX((c.in || 0) / (c.speed || 1));
      layers.push(`<div class="clip-wave ${c.type === 'video' ? 'mini' : ''} ${c.muted ? 'muted' : ''}" style="background-image:url('${window.api.fileUrl(m.wave)}');background-size:${full}px 100%;background-position:${-off}px 0"></div>`);
    }
    if (c.type === 'solid') layers.push(`<div class="clip-swatch" style="background:${FL.esc(c.color)}"></div>`);
    if (c.fadeIn > 0) layers.push(`<div class="fade in" style="width:${Math.min(w, timeToX(c.fadeIn))}px"></div>`);
    if (c.fadeOut > 0) layers.push(`<div class="fade out" style="width:${Math.min(w, timeToX(c.fadeOut))}px"></div>`);
    const kfs = FL.kfTimes(c);
    if (kfs.length && w > 20) layers.push(`<div class="kf-row">${kfs.map((t) => `<span class="kf" style="left:${timeToX(t)}px"></span>`).join('')}</div>`);
    const badges = [];
    const partners = FL.partners(c);
    for (const p of partners) {
      const off = FL.syncOffset(c, p);
      if (off) { badges.push(`<em class="sync" title="Out of sync with its linked ${p.type === 'audio' ? 'audio' : 'video'} by ${Math.abs(off)} frames">${off > 0 ? '+' : ''}${off}</em>`); break; }
    }
    const fxCount = (c.effects || []).filter((e) => e.enabled).length;
    if (fxCount) badges.push('<em class="fx">fx</em>');
    if ((c.speed || 1) !== 1) badges.push(`<em>${Math.round(c.speed * 100)}%</em>`);
    if (c.type === 'video' && m && m.hasAudio && c.muted) badges.push('<em>muted</em>');
    if (!m && (c.type === 'video' || c.type === 'image' || c.type === 'audio')) badges.push('<em>offline</em>');
    const tIcon = { text: 'text', graphic: 'graphics', adjust: 'adjust', solid: 'matte' }[c.type];
    return `<div class="clip ${c.type} ${FL.sel.has(c.id) ? 'selected' : ''} ${!m && ['video', 'image', 'audio'].includes(c.type) ? 'offline' : ''}" data-id="${c.id}" style="left:${timeToX(c.start)}px;width:${w}px">
      ${layers.join('')}
      <div class="clip-label">${tIcon ? icon(tIcon) : ''}${badges.filter((b) => b.includes('fx')).join('')}<span class="${partners.length ? 'linked' : ''}">${FL.esc(FL.clipName(c))}${partners.length ? (c.type === 'audio' ? ' [A]' : ' [V]') : ''}</span>${badges.filter((b) => !b.includes('fx')).join('')}</div>
      <div class="trim l"></div><div class="trim r"></div>
    </div>`;
  }

  function render() {
    const seq = FL.seq();
    const cw = contentWidth();
    timeline.style.width = HEAD_W + cw + 'px';
    rulerRow.style.width = HEAD_W + cw + 'px';
    tracksEl.innerHTML = seq.tracks.map((tr) => {
      const clips = seq.clips.filter((c) => c.trackId === tr.id);
      const html = clips.map(clipHTML).join('') + clips.map((c) => (tr.kind === 'video' ? transBlock(c, 'video') : '') + (FL.hasAudio(c) ? transBlock(c, 'audio') : '')).join('');
      return `<div class="track-row ${tr.kind} ${tr.locked ? 'locked' : ''} ${tr.hidden ? 'hidden-track' : ''} ${tr.muted ? 'muted-track' : ''}" data-track="${tr.id}">
        ${trackHead(tr)}
        <div class="lane" data-track="${tr.id}" style="width:${cw}px">${html}</div>
      </div>`;
    }).join('');
    const firstAudio = tracksEl.querySelector('.track-row.audio');
    if (firstAudio) firstAudio.classList.add('first-audio');
    renderSeqTabs();
    updatePlayhead();
    drawRuler();
  }
  FL.renderTimeline = render;

  // ---------------------------------------------------------------- ruler
  function drawRuler() {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(10, scroll.clientWidth - HEAD_W);
    const h = 30;
    if (ruler.width !== Math.round(w * dpr)) { ruler.width = Math.round(w * dpr); ruler.style.width = w + 'px'; }
    if (ruler.height !== h * dpr) { ruler.height = h * dpr; ruler.style.height = h + 'px'; }
    rctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const css = getComputedStyle(document.documentElement);
    rctx.fillStyle = css.getPropertyValue('--ruler-bg').trim() || '#1c1c20';
    rctx.fillRect(0, 0, w, h);
    const seq = FL.seq();
    const left = scroll.scrollLeft;

    // in/out range
    if (seq.inPoint != null || seq.outPoint != null) {
      const a = timeToX(seq.inPoint ?? 0) - left;
      const b = timeToX(seq.outPoint ?? FL.duration()) - left;
      rctx.fillStyle = 'rgba(76,141,255,0.28)';
      rctx.fillRect(a, h - 9, Math.max(1, b - a), 9);
      rctx.fillStyle = '#4c8dff';
      if (seq.inPoint != null) rctx.fillRect(a, h - 12, 2, 12);
      if (seq.outPoint != null) rctx.fillRect(b - 2, h - 12, 2, 12);
    }

    const px = FL.pxPerSec;
    const fps = FL.fps();
    const steps = [1 / fps, 2 / fps, 5 / fps, 10 / fps, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1200, 1800, 3600];
    const major = steps.find((s) => s * px >= 90) || 7200;
    const minor = steps.slice().reverse().find((s) => s < major && s * px >= 8 && Math.abs(major / s - Math.round(major / s)) < 1e-6) || major / 2;
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
      rctx.moveTo(x, h - 10);
      rctx.lineTo(x, isMajor ? h - 22 : h - 15);
      if (isMajor) rctx.fillText(FL.timecode(t), x + 4, 11);
    }
    rctx.stroke();
    const endX = timeToX(FL.duration()) - left;
    if (endX < w) { rctx.fillStyle = 'rgba(255,255,255,0.06)'; rctx.fillRect(Math.max(0, endX), 0, w - Math.max(0, endX), h); }

    // markers
    for (const mk of seq.markers) {
      const x = timeToX(mk.t) - left;
      if (x < -10 || x > w + 10) continue;
      rctx.fillStyle = mk.color || '#3ddc84';
      rctx.beginPath();
      rctx.moveTo(x - 5, 13); rctx.lineTo(x + 5, 13); rctx.lineTo(x + 5, 20); rctx.lineTo(x, 25); rctx.lineTo(x - 5, 20);
      rctx.closePath();
      rctx.fill();
      if (mk.name && px * 1 > 20) { rctx.fillStyle = '#cfcfd6'; rctx.fillText(mk.name, x + 8, 22); }
    }
  }
  scroll.addEventListener('scroll', drawRuler);
  new ResizeObserver(render).observe(scroll);

  function markerAt(clientX) {
    const t = xToTime(laneX(clientX));
    const th = 6 / FL.pxPerSec;
    return FL.seq().markers.find((m) => Math.abs(m.t - t) < th);
  }

  rulerRow.addEventListener('pointerdown', (e) => {
    if (e.target.classList.contains('corner') || e.button !== 0) return;
    const mk = markerAt(e.clientX);
    rulerRow.setPointerCapture(e.pointerId);
    if (FL.playing) FL.pause();
    if (mk) {
      let moved = false;
      const move = (ev) => {
        if (!moved) { FL.pushUndo(); moved = true; }
        mk.t = Math.max(0, FL.snapToFrame(xToTime(laneX(ev.clientX))));
        drawRuler();
      };
      const up = () => {
        rulerRow.removeEventListener('pointermove', move);
        rulerRow.removeEventListener('pointerup', up);
        if (moved) FL.changed(); else FL.seek(mk.t);
      };
      rulerRow.addEventListener('pointermove', move);
      rulerRow.addEventListener('pointerup', up);
      return;
    }
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
    const up = () => { rulerRow.removeEventListener('pointermove', go); rulerRow.removeEventListener('pointerup', up); };
    rulerRow.addEventListener('pointermove', go);
    rulerRow.addEventListener('pointerup', up);
  });
  rulerRow.addEventListener('dblclick', (e) => {
    const mk = markerAt(e.clientX);
    if (!mk) return;
    FL.promptInline(e.clientX, e.clientY - 10, 200, mk.name || '', (v) => { FL.pushUndo(); mk.name = v; FL.changed(); });
  });
  rulerRow.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const mk = markerAt(e.clientX);
    const seq = FL.seq();
    const items = [];
    if (mk) {
      items.push({ label: 'Rename Marker…', act: () => FL.promptInline(e.clientX, e.clientY, 200, mk.name || '', (v) => { FL.pushUndo(); mk.name = v; FL.changed(); }) });
      for (const [name, col] of [['Green', '#3ddc84'], ['Red', '#ff5d5d'], ['Blue', '#4c8dff'], ['Yellow', '#ffd34d'], ['Purple', '#b07cff']]) {
        items.push({ label: `Color: ${name}`, act: () => { FL.pushUndo(); mk.color = col; FL.changed(); } });
      }
      items.push({ sep: true }, { label: 'Delete Marker', act: () => { FL.pushUndo(); seq.markers = seq.markers.filter((x) => x !== mk); FL.changed(); } });
    }
    items.push({ label: 'Add Marker', act: () => { FL.seek(xToTime(laneX(e.clientX))); FL.cmd('addMarker'); } });
    items.push({ label: 'Clear All Markers', disabled: !seq.markers.length, act: () => { FL.pushUndo(); seq.markers = []; FL.changed(); } });
    items.push({ label: 'Clear In and Out', disabled: seq.inPoint == null && seq.outPoint == null, act: () => FL.cmd('clearInOut') });
    FL.showMenu(e.clientX, e.clientY, items);
  });

  // ---------------------------------------------------------------- playhead
  function updatePlayhead() { playhead.style.transform = `translateX(${HEAD_W + timeToX(FL.time)}px)`; }
  FL.on('time', () => {
    updatePlayhead();
    if (FL.playing) {
      const x = timeToX(FL.time);
      const view = scroll.clientWidth - HEAD_W;
      if (x > scroll.scrollLeft + view - 40 || x < scroll.scrollLeft) scroll.scrollLeft = Math.max(0, x - 60);
    }
  });
  FL.ensureVisible = (t) => {
    const x = timeToX(t);
    const view = scroll.clientWidth - HEAD_W;
    if (x < scroll.scrollLeft + 20 || x > scroll.scrollLeft + view - 20) scroll.scrollLeft = Math.max(0, x - view / 2);
  };

  // ---------------------------------------------------------------- snapping
  const nearest = (t, pts) => {
    let best = null;
    for (const p of pts) if (best === null || Math.abs(p - t) < Math.abs(best - t)) best = p;
    return best;
  };
  function showSnap(t) {
    if (t === null || t === undefined) { snapLine.style.display = 'none'; return; }
    snapLine.style.display = 'block';
    snapLine.style.transform = `translateX(${HEAD_W + timeToX(t)}px)`;
  }
  const snapPts = (exclude) => { const p = FL.editPoints(exclude); p.push(FL.time); return p; };

  // ---------------------------------------------------------------- clip interactions
  function laneAt(clientX, clientY) {
    const el = document.elementFromPoint(clientX, clientY);
    const lane = el && el.closest('.lane');
    return lane ? FL.track(lane.dataset.track) : null;
  }
  const clone = (o) => JSON.parse(JSON.stringify(o));
  function startDrag(onMove, onUp, cursorClass) {
    document.body.classList.add(cursorClass);
    const up = (ev) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', up);
      document.body.classList.remove(cursorClass);
      showSnap(null);
      onUp(ev);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', up);
  }
  function shiftKfFrom(c, orig, by) {
    // keyframes are clip-local: moving the head by `by` shifts them by -by
    c.kf = {};
    for (const [prop, list] of Object.entries(orig.kf || {})) c.kf[prop] = list.map((k) => ({ t: +(k.t - by).toFixed(4), v: k.v }));
  }

  // Linked partners that move with a clip (Option-click / Linked Selection off = just the clip).
  const EPS = () => 0.5 / FL.fps();
  const linkedGroup = (clip, solo) => (FL.linkSel && !solo ? [clip, ...FL.partners(clip)] : [clip]).filter((c) => c === clip || !FL.isLocked(c));
  const neighbours = (c) => {
    const sibs = FL.clipsOn(c.trackId).filter((o) => o.id !== c.id);
    return {
      later: sibs.filter((o) => o.start >= c.start + c.duration - 1e-6).map((o) => ({ c: o, start: o.start })),
      prevEnd: Math.max(0, ...sibs.filter((o) => o.start + o.duration <= c.start + 1e-6).map((o) => o.start + o.duration)),
      nextStart: Math.min(Infinity, ...sibs.filter((o) => o.start >= c.start + c.duration - 1e-6).map((o) => o.start)),
    };
  };

  tracksEl.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    if (e.target.closest('.track-head')) return;
    const tEl = e.target.closest('.trans');
    if (tEl) { FL.selectTransition(tEl.dataset.clip, tEl.dataset.side, tEl.dataset.audio === '1'); render(); return; }
    const clipEl = e.target.closest('.clip');
    const lane = e.target.closest('.lane');
    if (!clipEl) { if (lane) startMarquee(e); return; }
    const clip = FL.clip(clipEl.dataset.id);
    if (!clip) return;
    const tool = FL.tool;
    const solo = e.altKey;
    const tClick = xToTime(laneX(e.clientX));

    if (tool === 'razor') {
      if (FL.isLocked(clip)) return FL.toast('Track is locked');
      let t = FL.snapToFrame(tClick);
      if (FL.snap && Math.abs(t - FL.time) < 6 / FL.pxPerSec) t = FL.time;
      const targets = e.shiftKey ? FL.seq().clips.filter((c) => t > c.start && t < c.start + c.duration && !FL.isLocked(c)) : linkedGroup(clip, solo);
      FL.pushUndo();
      if (!FL.splitClips(targets, t).length) { FL.undoStack.pop(); return; }
      FL.changed();
      return;
    }
    if (tool === 'trackfwd') {
      const ids = FL.seq().clips.filter((c) => c.start + c.duration > tClick && (!e.shiftKey || c.trackId === clip.trackId)).map((c) => c.id);
      FL.selectMany(ids, true);
      render();
      return moveDrag(e, clip, false);
    }

    const edge = e.target.classList.contains('trim') ? (e.target.classList.contains('l') ? 'L' : 'R') : null;
    if (e.shiftKey && !edge) { FL.select(clip.id, { toggle: true, solo }); render(); return; }
    FL.select(clip.id, { keep: !solo, solo });
    render();
    if (FL.isLocked(clip)) return;

    if (edge) {
      if (tool === 'rolling') return rollingDrag(e, clip, edge, solo);
      if (tool === 'rate') return rateDrag(e, clip, edge, solo);
      return trimDrag(e, clip, edge, tool === 'ripple' || e.metaKey || e.ctrlKey, solo);
    }
    if (tool === 'slip') return slipDrag(e, clip, solo);
    moveDrag(e, clip, solo);
  });

  // move the selection (Option = duplicate); dragging up/down changes track
  function moveDrag(e, primary, duplicate) {
    const x0 = e.clientX;
    let moving = FL.selectedClips().filter((c) => !FL.isLocked(c));
    if (!moving.includes(primary)) moving = [primary];
    let origs = moving.map(clone);
    let moved = false;
    const th = 8 / FL.pxPerSec;
    let pts = [];
    const kindP = FL.kindFor(primary.type);
    const listOf = (kind) => (kind === 'video' ? FL.vTracks() : FL.aTracks());
    const startIdx = FL.trackIndex(FL.track(primary.trackId));
    const onMove = (ev) => {
      const dx = ev.clientX - x0;
      const tr = laneAt(ev.clientX, ev.clientY);
      const vert = tr && tr.kind === kindP && FL.trackIndex(tr) !== startIdx;
      if (!moved && Math.abs(dx) < 3 && !vert) return;
      if (!moved) {
        FL.pushUndo();
        moved = true;
        if (duplicate) {
          const pi = moving.indexOf(primary);
          const copies = FL.relink(moving.map((c) => Object.assign(clone(c), { id: FL.uid('clip') })));
          FL.seq().clips.push(...copies);
          moving = copies;
          origs = copies.map(clone);
          primary = copies[pi];
          FL.selectMany(copies.map((c) => c.id), true);
        }
        pts = FL.snap ? snapPts(moving.map((c) => c.id)) : [];
      }
      let dt = xToTime(dx);
      dt = Math.max(-Math.min(...origs.map((o) => o.start)), dt);
      let snapAt = null;
      if (FL.snap && !ev.shiftKey) {
        let best = null;
        for (const o of origs) {
          for (const edgeT of [o.start + dt, o.start + o.duration + dt]) {
            const n = nearest(edgeT, pts);
            if (n !== null && Math.abs(n - edgeT) < th && (!best || Math.abs(n - edgeT) < Math.abs(best.d))) best = { d: n - edgeT, at: n };
          }
        }
        if (best) { dt += best.d; snapAt = best.at; }
      }
      moving.forEach((c, i) => { c.start = Math.max(0, FL.snapToFrame(origs[i].start + dt)); });
      // vertical: shift every moving clip of the dragged kind by the same number of tracks
      const list = listOf(kindP);
      const d = tr && tr.kind === kindP ? FL.trackIndex(tr) - startIdx : 0;
      const dest = origs.map((o) => (FL.kindFor(o.type) === kindP ? list[FL.trackIndex(FL.track(o.trackId)) + d] : FL.track(o.trackId)));
      if (dest.every((t) => t && !t.locked)) moving.forEach((c, i) => { c.trackId = dest[i].id; });
      render();
      showSnap(snapAt);
      FL.requestDraw();
    };
    startDrag(onMove, () => {
      if (!moved) return;
      const ids = moving.map((c) => c.id);
      moving.forEach((c) => FL.overwrite(c.trackId, c.start, c.start + c.duration, ids));
      FL.changed();
    }, duplicate ? 'copying' : 'dragging');
  }

  // trim an edge (ripple = later clips follow); linked partners on the same edge trim too
  function trimDrag(e, clip, edge, ripple, solo) {
    const x0 = e.clientX;
    const at = (c) => (edge === 'L' ? c.start : c.start + c.duration);
    const group = linkedGroup(clip, solo).filter((c) => Math.abs(at(c) - at(clip)) < EPS());
    const info = group.map((c) => Object.assign({ c, o: clone(c), speed: c.speed || 1, media: c.type === 'video' || c.type === 'audio' }, neighbours(c)));
    const po = info[0].o;
    const pts = FL.snap ? snapPts(group.map((c) => c.id)) : [];
    const th = 8 / FL.pxPerSec;
    let moved = false;
    const onMove = (ev) => {
      const dx = ev.clientX - x0;
      if (!moved && Math.abs(dx) < 2) return;
      if (!moved) { FL.pushUndo(); moved = true; }
      const dt = xToTime(dx);
      let snapAt = null;
      if (edge === 'L') {
        let s = po.start + dt;
        if (FL.snap && !ev.shiftKey) { const a = nearest(s, pts); if (a !== null && Math.abs(a - s) < th) { s = a; snapAt = a; } }
        const lo = Math.max(0, ...info.map((i) => Math.max(ripple ? 0 : i.prevEnd, i.media ? i.o.start - (i.o.in || 0) / i.speed : 0)));
        const hi = Math.min(...info.map((i) => i.o.start + i.o.duration - FL.MIN_CLIP));
        s = FL.clamp(FL.snapToFrame(s), lo, hi);
        const delta = s - po.start;
        for (const i of info) {
          i.c.in = Math.max(0, (i.o.in || 0) + delta * i.speed);
          shiftKfFrom(i.c, i.o, delta);
          i.c.duration = i.o.duration - delta;
          if (ripple) { i.c.start = i.o.start; i.later.forEach((l) => { l.c.start = Math.max(0, l.start - delta); }); }
          else i.c.start = i.o.start + delta;
        }
      } else {
        let e2 = po.start + po.duration + dt;
        if (FL.snap && !ev.shiftKey) { const a = nearest(e2, pts); if (a !== null && Math.abs(a - e2) < th) { e2 = a; snapAt = a; } }
        const hi = Math.min(...info.map((i) => Math.min(ripple ? Infinity : i.nextStart, i.o.start + FL.mediaLimit(i.o))));
        const lo = Math.max(...info.map((i) => i.o.start + FL.MIN_CLIP));
        e2 = FL.clamp(FL.snapToFrame(e2), lo, hi);
        for (const i of info) {
          i.c.duration = e2 - i.o.start;
          if (ripple) i.later.forEach((l) => { l.c.start = Math.max(0, l.start + (i.c.duration - i.o.duration)); });
        }
      }
      render();
      showSnap(snapAt);
      FL.emit('inspector-refresh');
      FL.requestDraw();
    };
    startDrag(onMove, () => { if (moved) FL.changed(); }, 'trimming');
  }

  // rolling edit: moves the cut between two adjacent clips (on every linked track at that cut)
  function rollingDrag(e, clip, edge, solo) {
    const cut = edge === 'R' ? clip.start + clip.duration : clip.start;
    const pairs = [];
    for (const m of linkedGroup(clip, solo)) {
      let a = null; let b = null;
      if (Math.abs(m.start + m.duration - cut) < EPS()) { a = m; b = FL.nextAdj(m); }
      else if (Math.abs(m.start - cut) < EPS()) { b = m; a = FL.prevAdj(m); }
      if (a && b && !FL.isLocked(a) && !FL.isLocked(b)) pairs.push({ a, b, oa: clone(a), ob: clone(b) });
    }
    if (!pairs.length) return trimDrag(e, clip, edge, false, solo);
    const x0 = e.clientX;
    let moved = false;
    const onMove = (ev) => {
      const dx = ev.clientX - x0;
      if (!moved && Math.abs(dx) < 2) return;
      if (!moved) { FL.pushUndo(); moved = true; }
      let dt = FL.snapToFrame(xToTime(dx));
      let lo = -Infinity; let hi = Infinity;
      for (const { oa, ob } of pairs) {
        lo = Math.max(lo, -(oa.duration - FL.MIN_CLIP));
        if (ob.type === 'video' || ob.type === 'audio') lo = Math.max(lo, -(ob.in || 0) / (ob.speed || 1));
        hi = Math.min(hi, FL.mediaLimit(oa) - oa.duration, ob.duration - FL.MIN_CLIP);
      }
      dt = FL.clamp(dt, lo, hi);
      for (const { a, b, oa, ob } of pairs) {
        a.duration = oa.duration + dt;
        b.start = ob.start + dt;
        b.duration = ob.duration - dt;
        b.in = Math.max(0, (ob.in || 0) + dt * (ob.speed || 1));
        shiftKfFrom(b, ob, dt);
      }
      render();
      showSnap(cut + dt);
      FL.requestDraw();
    };
    startDrag(onMove, () => { if (moved) FL.changed(); }, 'trimming');
  }

  // rate stretch: drag an edge to change speed instead of content
  function rateDrag(e, clip, edge, solo) {
    if (clip.type !== 'video' && clip.type !== 'audio') return trimDrag(e, clip, edge, false, solo);
    const group = linkedGroup(clip, solo).filter((c) => (c.type === 'video' || c.type === 'audio') &&
      Math.abs(c.start - clip.start) < EPS() && Math.abs(c.duration - clip.duration) < EPS());
    const info = group.map((c) => Object.assign({ c, o: clone(c), span: c.duration * (c.speed || 1) }, neighbours(c)));
    const po = info[0].o;
    const x0 = e.clientX;
    let moved = false;
    const onMove = (ev) => {
      const dx = ev.clientX - x0;
      if (!moved && Math.abs(dx) < 2) return;
      if (!moved) { FL.pushUndo(); moved = true; }
      const dt = FL.snapToFrame(xToTime(dx));
      let dur = edge === 'R' ? po.duration + dt : po.duration - dt;
      for (const i of info) {
        dur = FL.clamp(dur, i.span / 10, i.span / 0.1);
        dur = Math.min(dur, edge === 'R' ? i.nextStart - i.o.start : i.o.start + i.o.duration - i.prevEnd);
      }
      for (const i of info) {
        i.c.duration = dur;
        i.c.speed = i.span / dur;
        if (edge === 'L') i.c.start = i.o.start + i.o.duration - dur;
        const k = i.o.duration / dur;
        i.c.kf = {};
        for (const [p, list] of Object.entries(i.o.kf || {})) i.c.kf[p] = list.map((kk) => ({ t: +(kk.t / k).toFixed(4), v: kk.v }));
      }
      render();
      FL.emit('inspector-refresh');
      FL.requestDraw();
    };
    startDrag(onMove, () => { if (moved) FL.changed(); }, 'trimming');
  }

  // slip: change which part of the source shows, without moving the clip
  function slipDrag(e, clip, solo) {
    if (clip.type !== 'video' && clip.type !== 'audio') return moveDrag(e, clip, false);
    const info = linkedGroup(clip, solo).filter((c) => (c.type === 'video' || c.type === 'audio') && FL.media(c.mediaId)).map((c) => {
      const m = FL.media(c.mediaId);
      const speed = c.speed || 1;
      return { c, o: clone(c), speed, maxIn: Math.max(0, m.duration - c.duration * speed) };
    });
    if (!info.length) return;
    let lo = -Infinity; let hi = Infinity; // allowed shift in timeline seconds
    for (const i of info) { lo = Math.max(lo, ((i.o.in || 0) - i.maxIn) / i.speed); hi = Math.min(hi, (i.o.in || 0) / i.speed); }
    const x0 = e.clientX;
    let moved = false;
    const onMove = (ev) => {
      const dx = ev.clientX - x0;
      if (!moved && Math.abs(dx) < 2) return;
      if (!moved) { FL.pushUndo(); moved = true; }
      const d = FL.clamp(xToTime(dx), lo, hi);
      for (const i of info) i.c.in = (i.o.in || 0) - d * i.speed;
      render();
      FL.requestDraw();
      const p = info[0];
      FL.toast(`In ${FL.timecode(p.c.in)}  ·  Out ${FL.timecode(p.c.in + p.c.duration * p.speed)}`, 900);
    };
    startDrag(onMove, () => { if (moved) FL.changed(); }, 'dragging');
  }

  // marquee selection on empty lane space
  function startMarquee(e) {
    const tl = timeline.getBoundingClientRect();
    const x0 = e.clientX - tl.left;
    const y0 = e.clientY - tl.top;
    let moved = false;
    const base = e.shiftKey ? [...FL.sel] : [];
    const onMove = (ev) => {
      const x1 = ev.clientX - tl.left;
      const y1 = ev.clientY - tl.top;
      if (!moved && Math.hypot(x1 - x0, y1 - y0) < 4) return;
      moved = true;
      marquee.hidden = false;
      const l = Math.min(x0, x1); const t = Math.min(y0, y1);
      const w = Math.abs(x1 - x0); const h = Math.abs(y1 - y0);
      Object.assign(marquee.style, { left: l + 'px', top: t + 'px', width: w + 'px', height: h + 'px' });
      const box = { l: ev.clientX < e.clientX ? ev.clientX : e.clientX, r: Math.max(ev.clientX, e.clientX), t: Math.min(ev.clientY, e.clientY), b: Math.max(ev.clientY, e.clientY) };
      const ids = [...tracksEl.querySelectorAll('.clip')].filter((n) => {
        const r = n.getBoundingClientRect();
        return r.right > box.l && r.left < box.r && r.bottom > box.t && r.top < box.b;
      }).map((n) => n.dataset.id);
      FL.sel = new Set([...base, ...ids]);
      tracksEl.querySelectorAll('.clip').forEach((n) => n.classList.toggle('selected', FL.sel.has(n.dataset.id)));
    };
    startDrag(onMove, () => {
      marquee.hidden = true;
      if (!moved) { FL.select(null); render(); return; }
      FL.selectMany([...FL.sel]);
      render();
    }, 'marquee');
  }

  // razor hover line
  tracksEl.addEventListener('pointermove', (e) => {
    if (FL.tool !== 'razor') return;
    if (e.target.closest('.clip')) showSnap(FL.snapToFrame(xToTime(laneX(e.clientX))));
    else showSnap(null);
  });
  tracksEl.addEventListener('pointerleave', () => { if (FL.tool === 'razor') showSnap(null); });

  // track header buttons
  tracksEl.addEventListener('click', (e) => {
    const pb = e.target.closest('.patch');
    if (pb) {
      const tr = FL.track(pb.closest('.track-row').dataset.track);
      const p = FL.patch();
      const k = tr.kind === 'video' ? 'v' : 'a';
      if (p[k] === tr.id) p[k + 'On'] = !p[k + 'On'];
      else { p[k] = tr.id; p[k + 'On'] = true; }
      FL.changed({ source: 'patch' });
      return;
    }
    const btn = e.target.closest('.hbtn');
    if (!btn) return;
    const tr = FL.track(btn.closest('.track-row').dataset.track);
    FL.pushUndo();
    const act = btn.dataset.act;
    if (act === 'hide') tr.hidden = !tr.hidden;
    if (act === 'mute') tr.muted = !tr.muted;
    if (act === 'solo') tr.solo = !tr.solo;
    if (act === 'lock') tr.locked = !tr.locked;
    FL.changed();
  });
  tracksEl.addEventListener('dblclick', (e) => {
    const nameEl = e.target.closest('.track-name');
    if (nameEl) {
      const tr = FL.track(nameEl.closest('.track-row').dataset.track);
      const r = nameEl.getBoundingClientRect();
      FL.promptInline(r.left, r.top, 110, tr.name, (v) => { if (v) { FL.pushUndo(); tr.name = v; FL.changed(); } });
      return;
    }
    const clipEl = e.target.closest('.clip');
    if (clipEl) { FL.cmd('panel:effectcontrols'); }
  });

  // context menus
  tracksEl.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const tEl = e.target.closest('.trans');
    if (tEl) {
      FL.selectTransition(tEl.dataset.clip, tEl.dataset.side, tEl.dataset.audio === '1');
      render();
      FL.showMenu(e.clientX, e.clientY, [
        { label: 'Set Transition Duration…', act: () => FL.cmd('panel:effectcontrols') },
        { label: 'Clear', key: '⌫', act: () => FL.cmd('delete') },
      ]);
      return;
    }
    const clipEl = e.target.closest('.clip');
    const row = e.target.closest('.track-row');
    if (clipEl) {
      const clip = FL.clip(clipEl.dataset.id);
      if (!FL.sel.has(clip.id)) { FL.select(clip.id); render(); }
      const m = FL.media(clip.mediaId);
      const inside = FL.time > clip.start && FL.time < clip.start + clip.duration;
      FL.showMenu(e.clientX, e.clientY, [
        { label: 'Cut', key: '⌘X', act: () => FL.cmd('cut') },
        { label: 'Copy', key: '⌘C', act: () => FL.cmd('copy') },
        { label: 'Paste Attributes', key: '⌥⌘V', act: () => FL.cmd('pasteAttributes'), disabled: !FL.clipboard },
        { label: 'Duplicate', key: '⌥⌘D', act: () => FL.cmd('duplicate') },
        { sep: true },
        { label: 'Add Edit', key: '⌘K', act: () => FL.cmd('split'), disabled: !inside },
        { label: 'Apply Video Transition', key: '⌘D', act: () => FL.cmd('applyVideoTransition'), disabled: !FL.isVisual(clip) },
        { label: 'Apply Audio Transition', key: '⇧⌘D', act: () => FL.cmd('applyAudioTransition'), disabled: !FL.hasAudio(clip) },
        { label: FL.selectedClips().some((x) => x.link) ? 'Unlink' : FL.selectedClips().length > 1 ? 'Link' : (FL.hasAudio(clip) && clip.type === 'video' ? 'Unlink Audio' : null), key: '⌘L', act: () => FL.cmd('toggleLink') },
        { label: 'Scale to Frame Size', act: () => FL.cmd('fill'), disabled: !(clip.type === 'video' || clip.type === 'image') },
        { label: (clip.effects || []).some((x) => x.enabled) ? 'Disable Effects' : 'Enable Effects', act: () => FL.cmd('toggleFx'), disabled: !(clip.effects || []).length },
        { label: 'Reveal in Project', act: () => FL.cmd('revealMedia', clip.mediaId), disabled: !m },
        { sep: true },
        { label: 'Clear', key: '⌫', act: () => FL.cmd('delete') },
        { label: 'Ripple Delete', key: '⇧⌫', act: () => FL.cmd('rippleDelete') },
      ].filter((i) => i.sep || i.label));
    } else if (row) {
      const tr = FL.track(row.dataset.track);
      const isEmpty = !FL.seq().clips.some((c) => c.trackId === tr.id);
      const sameKind = FL.seq().tracks.filter((t) => t.kind === tr.kind).length;
      FL.showMenu(e.clientX, e.clientY, [
        { label: 'Paste at Playhead', key: '⌘V', act: () => FL.cmd('paste', tr.id), disabled: !FL.clipboard },
        { label: `Add ${tr.kind === 'video' ? 'Video' : 'Audio'} Track`, act: () => FL.cmd(tr.kind === 'video' ? 'addVideoTrack' : 'addAudioTrack') },
        { label: 'Rename Track…', act: () => { const r = row.querySelector('.track-name').getBoundingClientRect(); FL.promptInline(r.left, r.top, 110, tr.name, (v) => { if (v) { FL.pushUndo(); tr.name = v; FL.changed(); } }); } },
        { label: 'Delete Track', disabled: !isEmpty || sameKind <= 1, act: () => { FL.pushUndo(); FL.seq().tracks = FL.seq().tracks.filter((t) => t.id !== tr.id); FL.changed(); } },
      ]);
    }
  });

  // ---------------------------------------------------------------- dropping onto the timeline
  const ghosts = [];
  let fxHover = null;
  const clearGhosts = () => { ghosts.splice(0).forEach((g) => g.remove()); };
  function addGhost(track, start, dur, cls = '') {
    const lane = track && tracksEl.querySelector(`.lane[data-track="${track.id}"]`);
    if (!lane) return;
    const g = document.createElement('div');
    g.className = 'drop-ghost ' + cls;
    g.style.left = timeToX(start) + 'px';
    g.style.width = Math.max(4, timeToX(dur)) + 'px';
    lane.appendChild(g);
    ghosts.push(g);
  }
  function setFxHover(el) {
    if (fxHover && fxHover !== el) fxHover.classList.remove('fx-target');
    fxHover = el;
    if (el) el.classList.add('fx-target');
  }
  function dropTime(clientX) {
    let t = Math.max(0, xToTime(laneX(clientX)));
    if (FL.snap) { const a = nearest(t, snapPts(null)); if (a !== null && Math.abs(a - t) < 10 / FL.pxPerSec) t = a; }
    return FL.snapToFrame(t);
  }
  const sides = (m, part) => ({
    v: m.type !== 'audio' && part !== 'audio',
    a: m.type !== 'image' && !!m.hasAudio && part !== 'video',
  });

  FL.dnd.target({
    match: (el) => !!el.closest('#tracks'),
    over: (p, e, el) => {
      clearGhosts();
      setFxHover(null);
      const row = el.closest('.track-row');
      if (!row) return null;
      const track = FL.track(row.dataset.track);
      if (p.kind === 'fx') {
        const clipEl = el.closest('.clip');
        if (!clipEl) { FL.dnd.hint('Drop on a clip'); return null; }
        setFxHover(clipEl);
        const r = clipEl.getBoundingClientRect();
        const side = e.clientX - r.left < r.width / 2 ? 'in' : 'out';
        FL.dnd.hint(p.item.kind.endsWith('trans') ? (side === 'in' ? 'Clip start' : 'Clip end') : '');
        return { clipId: clipEl.dataset.id, side };
      }
      if (track.locked) { FL.dnd.hint('Track is locked'); return null; }
      const t = dropTime(e.clientX);
      if (p.kind === 'gfx') {
        if (track.kind !== 'video') { FL.dnd.hint('Drop on a video track'); return null; }
        addGhost(track, t, D.DEFAULT_GRAPHIC_DURATION);
        return { track, t };
      }
      const m = FL.media(p.mediaId);
      if (!m) return null;
      const want = sides(m, p.part || 'both');
      const dur = p.range && m.type !== 'image' ? p.range.out - p.range.in : m.type === 'image' ? 5 : m.duration;
      const insert = e.metaKey || e.ctrlKey;
      const vT = want.v ? (track.kind === 'video' ? track : FL.pairTrack(track, false)) : null;
      const aT = want.a ? (track.kind === 'audio' ? track : FL.pairTrack(track, false)) : null;
      addGhost(vT, t, dur, insert ? 'insert' : '');
      addGhost(aT, t, dur, insert ? 'insert' : '');
      FL.dnd.hint(`${insert ? 'Insert' : 'Overwrite'} at ${FL.timecode(t)}${insert ? '' : ' · hold ⌘ to insert'}`);
      return { track, t, insert };
    },
    drop: (p, e, st) => {
      if (p.kind === 'fx') {
        const clip = FL.clip(st.clipId);
        if (!clip) return;
        const targets = FL.sel.has(clip.id) && !p.item.kind.endsWith('trans') ? FL.selectedClips() : [clip];
        FL.applyFxItem(p.item, targets, st.side);
        return;
      }
      if (p.kind === 'gfx') { FL.insertGraphicItem(p.id, st.track, st.t); return; }
      FL.placeMedia(FL.media(p.mediaId), { time: st.t, range: p.range, part: p.part, mode: st.insert ? 'insert' : 'overwrite', dropTrack: st.track });
    },
    leave: () => { clearGhosts(); setFxHover(null); },
  });

  // files dragged in from Finder
  const isFiles = (e) => [...e.dataTransfer.types].includes('Files');
  tracksEl.addEventListener('dragover', (e) => {
    if (!isFiles(e)) return;
    const row = e.target.closest('.track-row');
    if (!row) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
    clearGhosts();
    addGhost(FL.track(row.dataset.track), dropTime(e.clientX), 5);
  });
  tracksEl.addEventListener('dragleave', (e) => { if (!tracksEl.contains(e.relatedTarget)) clearGhosts(); });
  tracksEl.addEventListener('drop', async (e) => {
    clearGhosts();
    if (!isFiles(e) || !e.dataTransfer.files.length) return;
    const row = e.target.closest('.track-row');
    if (!row) return;
    e.preventDefault();
    e.stopPropagation();
    const track = FL.track(row.dataset.track);
    let t = dropTime(e.clientX);
    const paths = [...e.dataTransfer.files].map((f) => window.api.pathForFile(f)).filter(Boolean);
    for (const m of await FL.importPaths(paths)) {
      const clips = FL.placeMedia(m, { time: t, dropTrack: track });
      if (clips.length) t = clips[0].start + clips[0].duration;
    }
  });

  // Places media on the timeline as Premiere does: picture on a V track, sound on an A track, linked.
  // o: { time, range, mode: 'overwrite'|'insert', part: 'both'|'video'|'audio', video/audio (patch on/off),
  //      vTrack/aTrack (explicit targets) or dropTrack (V2 drop → A2), newAudioTrack }
  FL.placeMedia = (media, o = {}) => {
    if (!media) return [];
    let part = o.part || 'both';
    if (o.video === false && o.audio === false) { FL.toast('Both Video and Audio are turned off in the Source monitor'); return []; }
    if (o.video === false) part = part === 'video' ? 'none' : 'audio';
    if (o.audio === false) part = part === 'audio' ? 'none' : 'video';
    const clips = part === 'none' ? [] : FL.clipsFromMedia(media, part, o.range);
    if (!clips.length) { FL.toast(`This clip has no ${part === 'audio' ? 'sound' : 'picture'} to place`); return []; }
    FL.pushUndo();
    const resolve = (kind) => {
      let t = kind === 'video' ? o.vTrack : o.aTrack;
      if (o.dropTrack) t = o.dropTrack.kind === kind ? o.dropTrack : FL.pairTrack(o.dropTrack, true);
      if (!t && kind === 'audio' && o.newAudioTrack) t = FL.addTrack('audio');
      if (!t || t.locked || t.kind !== kind) t = (kind === 'video' ? FL.vTracks() : FL.aTracks()).find((x) => !x.locked) || FL.addTrack(kind);
      return t;
    };
    const at = Math.max(0, FL.snapToFrame(o.time ?? FL.time));
    const dur = clips[0].duration;
    if (o.mode === 'insert') {
      const cut = FL.seq().clips.filter((c) => !FL.isLocked(c) && at > c.start + 1e-6 && at < c.start + c.duration - 1e-6);
      FL.splitClips(cut, at);
      for (const c of FL.seq().clips) if (!FL.isLocked(c) && c.start >= at - 1e-6) c.start += dur;
    }
    for (const c of clips) FL.placeClip(c, resolve(FL.kindFor(c.type)).id, at);
    FL.selectMany(clips.map((c) => c.id), true);
    FL.changed();
    return clips;
  };
  FL.insertMedia = (media, track, time, range, mode = 'overwrite') => {
    const p = FL.patch();
    const clips = FL.placeMedia(media, { time, range, mode, dropTrack: track || null, vTrack: FL.track(p.v), aTrack: FL.track(p.a) });
    return clips[0] || null;
  };

  FL.on('change', render);
  FL.on('select', () => {
    tracksEl.querySelectorAll('.clip').forEach((n) => n.classList.toggle('selected', FL.sel.has(n.dataset.id)));
  });
  window.addEventListener('resize', drawRuler);
  render();
})();
