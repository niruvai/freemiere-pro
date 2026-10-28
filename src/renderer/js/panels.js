/* Frameline — panels: tab groups, Effects browser, Essential Graphics,
   Source monitor, and the helpers that apply effects/transitions/graphics. */
'use strict';

(() => {
  const D = window.FLDefs;
  const $ = (s) => document.querySelector(s);
  const api = window.api;

  // ---------------------------------------------------------------- tabs
  FL.showTab = (group, tab) => {
    const bar = document.querySelector(`.tabs[data-group="${group}"]`);
    if (!bar) return;
    bar.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === tab));
    bar.parentNode.querySelectorAll(':scope > .tab-page').forEach((p) => { p.hidden = p.dataset.page !== tab; });
    if (group === 'monitor') { FL.monitorTab = tab; if (tab === 'program') FL.layoutPreview(); else layoutSource(); }
  };
  document.querySelectorAll('.tabs[data-group]').forEach((bar) => {
    bar.addEventListener('click', (e) => {
      const t = e.target.closest('.tab');
      if (t) FL.showTab(bar.dataset.group, t.dataset.tab);
    });
  });
  FL.monitorTab = 'program';

  // ---------------------------------------------------------------- applying effects & transitions
  FL.applyFxItem = (item, targets, side = 'both') => {
    targets = targets.filter((c) => c && !FL.isLocked(c));
    if (!targets.length) return;
    FL.pushUndo();
    let applied = 0;
    const setTrans = (c, kind, which, type) => {
      const key = kind === 'audio' ? 'atrans' : 'trans';
      const d = Math.min(D.DEFAULT_TRANSITION_DURATION, c.duration);
      if (which === 'in') {
        const prev = FL.prevAdj(c);
        c[key + 'In'] = { type, duration: prev ? Math.min(d, prev.duration * 2, c.duration * 2) : d };
      } else {
        const next = FL.nextAdj(c);
        if (next) next[key + 'In'] = { type, duration: Math.min(d, next.duration * 2, c.duration * 2) };
        else c[key + 'Out'] = { type, duration: d };
      }
      applied++;
    };
    for (const c of targets) {
      if (item.kind === 'vfx' && FL.isVisual(c)) {
        const e = FL.makeEffect(item.id);
        c.effects.push(e);
        applied++;
        if (item.id === 'blur' || item.id === 'mosaic') FL.toast('Tip: add a mask in Effect Controls to blur only part of the picture');
      } else if (item.kind === 'afx' && FL.hasAudio(c)) { c.effects.push(FL.makeEffect(item.id)); applied++; }
      else if (item.kind === 'look' && FL.isVisual(c)) {
        let e = c.effects.find((x) => x.type === 'lumetri');
        if (!e) { e = FL.makeEffect('lumetri'); c.effects.push(e); }
        Object.assign(e.params, D.LOOKS[item.id]);
        applied++;
      } else if (item.kind === 'apreset' && FL.hasAudio(c)) {
        for (const x of D.AUDIO_PRESETS[item.id]) c.effects.push(FL.makeEffect(x.type, x.params));
        applied++;
      } else if (item.kind === 'vtrans' && FL.isVisual(c) && c.type !== 'adjust') {
        if (side === 'in' || side === 'both') setTrans(c, 'video', 'in', item.id);
        if (side === 'out' || side === 'both') setTrans(c, 'video', 'out', item.id);
      } else if (item.kind === 'atrans' && FL.hasAudio(c)) {
        if (side === 'in' || side === 'both') setTrans(c, 'audio', 'in', item.id);
        if (side === 'out' || side === 'both') setTrans(c, 'audio', 'out', item.id);
      }
    }
    if (!applied) { FL.undoStack.pop(); FL.toast('That item doesn’t apply to this clip'); return; }
    if (targets.length === 1 && !item.kind.endsWith('trans')) FL.select(targets[0].id);
    FL.changed();
  };

  // ---------------------------------------------------------------- Effects browser
  const tree = $('#fx-tree');
  const open = { presets: true, vfx: true, vtrans: true, afx: false, atrans: false };
  function fxItems() {
    const groups = [];
    groups.push({ id: 'presets', name: 'Presets', items: [
      ...Object.keys(D.LOOKS).map((k) => ({ kind: 'look', id: k, name: k, tag: 'Lumetri' })),
      ...Object.keys(D.AUDIO_PRESETS).map((k) => ({ kind: 'apreset', id: k, name: k, tag: 'Audio' })),
    ] });
    groups.push({ id: 'vfx', name: 'Video Effects', items: Object.entries(D.VIDEO_EFFECTS).map(([k, d]) => ({ kind: 'vfx', id: k, name: d.name, tag: d.cat })) });
    groups.push({ id: 'vtrans', name: 'Video Transitions', items: Object.entries(D.VIDEO_TRANSITIONS).map(([k, d]) => ({ kind: 'vtrans', id: k, name: d.name, tag: d.cat })) });
    groups.push({ id: 'afx', name: 'Audio Effects', items: Object.entries(D.AUDIO_EFFECTS).map(([k, d]) => ({ kind: 'afx', id: k, name: d.name, tag: d.cat })) });
    groups.push({ id: 'atrans', name: 'Audio Transitions', items: Object.entries(D.AUDIO_TRANSITIONS).map(([k, d]) => ({ kind: 'atrans', id: k, name: d.name, tag: 'Crossfade' })) });
    return groups;
  }
  const kindIcon = { look: 'lumetri', apreset: 'audio', vfx: 'fxv', vtrans: 'trans', afx: 'fxa', atrans: 'transa' };
  function renderFx() {
    const q = $('#fx-filter').value.trim().toLowerCase();
    tree.innerHTML = fxItems().map((g) => {
      const items = g.items.filter((i) => !q || i.name.toLowerCase().includes(q) || (i.tag || '').toLowerCase().includes(q));
      if (!items.length) return '';
      const isOpen = q || open[g.id];
      return `<div class="fx-group ${isOpen ? 'open' : ''}" data-g="${g.id}">
        <div class="fx-group-head"><i class="ic ic-chevron"></i><i class="ic ic-folder"></i>${g.name}<span class="count">${items.length}</span></div>
        <div class="fx-items">${items.map((i) => `<div class="fx-item" draggable="true" data-kind="${i.kind}" data-id="${FL.esc(i.id)}" title="${FL.esc(i.tag || '')}"><i class="ic ic-${kindIcon[i.kind]}"></i><span>${FL.esc(i.name)}</span>${i.id === 'crossdissolve' ? '<em>default</em>' : ''}</div>`).join('')}</div>
      </div>`;
    }).join('');
  }
  $('#fx-filter').addEventListener('input', renderFx);
  tree.addEventListener('click', (e) => {
    const h = e.target.closest('.fx-group-head');
    if (h) { const g = h.parentNode; open[g.dataset.g] = !g.classList.contains('open'); g.classList.toggle('open'); return; }
    const it = e.target.closest('.fx-item');
    tree.querySelectorAll('.fx-item.sel').forEach((n) => n.classList.remove('sel'));
    if (it) it.classList.add('sel');
  });
  tree.addEventListener('dblclick', (e) => {
    const it = e.target.closest('.fx-item');
    if (!it) return;
    const clips = FL.selectedClips();
    if (!clips.length) return FL.toast('Select a clip in the timeline first');
    FL.applyFxItem({ kind: it.dataset.kind, id: it.dataset.id }, clips);
  });
  tree.addEventListener('dragstart', (e) => {
    const it = e.target.closest('.fx-item');
    if (!it) return;
    e.dataTransfer.setData('application/x-fl-fx', JSON.stringify({ kind: it.dataset.kind, id: it.dataset.id }));
    e.dataTransfer.effectAllowed = 'copy';
  });
  renderFx();

  // ---------------------------------------------------------------- Essential Graphics
  const gfxList = $('#gfx-list');
  function renderGfx() {
    const items = [
      ...Object.entries(D.GRAPHICS).map(([k, g]) => ({ id: k, name: g.name, desc: g.desc })),
      { id: 'title', name: 'Basic Title', desc: 'Free text you can style' },
      { id: 'adjust', name: 'Adjustment Layer', desc: 'Effects apply to all tracks below' },
      { id: 'matte', name: 'Color Matte', desc: 'Solid color background' },
    ];
    gfxList.innerHTML = '<div class="gfx-head">News & broadcast templates</div>' + items.map((i) => `<div class="gfx-card" draggable="true" data-gfx="${i.id}">
        <div class="gfx-thumb" data-thumb="${i.id}"></div>
        <div class="gfx-meta"><b>${FL.esc(i.name)}</b><span>${FL.esc(i.desc)}</span></div>
      </div>`).join('');
    // thumbnails (fonts may still be loading, so draw after a beat)
    setTimeout(() => {
      gfxList.querySelectorAll('[data-thumb]').forEach((el) => {
        const id = el.dataset.thumb;
        let cv;
        if (D.GRAPHICS[id]) cv = FL.R.graphicThumb(id);
        else {
          cv = document.createElement('canvas');
          cv.width = 320; cv.height = 180;
          const x = cv.getContext('2d');
          const grd = x.createLinearGradient(0, 0, 320, 180);
          grd.addColorStop(0, '#3b4252'); grd.addColorStop(1, '#1d222b');
          x.fillStyle = id === 'matte' ? '#1a3a8f' : grd;
          x.fillRect(0, 0, 320, 180);
          x.fillStyle = '#fff';
          x.font = `700 30px ${FL.R.fontStack('Helvetica Neue')}`;
          x.textAlign = 'center';
          x.textBaseline = 'middle';
          if (id === 'title') x.fillText('Your Title', 160, 90);
          if (id === 'adjust') { x.globalAlpha = 0.5; x.fillStyle = '#b07cff'; x.fillRect(30, 40, 260, 100); x.globalAlpha = 1; x.fillStyle = '#fff'; x.font = `600 22px ${FL.R.fontStack('Helvetica Neue')}`; x.fillText('fx ▸ all tracks below', 160, 90); }
        }
        el.innerHTML = '';
        el.appendChild(cv);
      });
    }, 300);
  }
  gfxList.addEventListener('dragstart', (e) => {
    const card = e.target.closest('.gfx-card');
    if (!card) return;
    e.dataTransfer.setData('application/x-fl-gfx', card.dataset.gfx);
    e.dataTransfer.effectAllowed = 'copy';
  });
  gfxList.addEventListener('dblclick', (e) => {
    const card = e.target.closest('.gfx-card');
    if (card) FL.insertGraphicItem(card.dataset.gfx, null, FL.time);
  });
  renderGfx();

  // Adds a title / graphic / adjustment layer / matte at `time` (on `track` or the first free video track).
  FL.insertGraphicItem = (id, track, time) => {
    let clip;
    if (D.GRAPHICS[id]) clip = FL.makeGraphicClip(id);
    else if (id === 'title') clip = FL.makeTextClip({ font: 'Kohinoor Bangla' });
    else if (id === 'adjust') clip = FL.makeAdjustClip();
    else if (id === 'matte') clip = FL.makeSolidClip();
    if (!clip) return null;
    FL.pushUndo();
    if (!track || track.kind !== 'video' || track.locked) track = FL.freeVideoTrack(time, time + clip.duration);
    FL.placeClip(clip, track.id, time);
    FL.sel = new Set([clip.id]);
    FL.selectedId = clip.id;
    FL.changed();
    FL.emit('select', clip.id);
    if (clip.type === 'adjust') FL.toast('Adjustment layer added — drop effects on it to affect everything below');
    return clip;
  };

  // ---------------------------------------------------------------- Source monitor
  const sv = $('#src-video');
  const srcMon = $('#src-monitor');
  FL.source = { media: null, in: null, out: null };
  function layoutSource() {
    const m = FL.source.media;
    $('#src-empty').hidden = !!m;
    sv.hidden = !m || m.type === 'audio';
  }
  FL.openSource = (m) => {
    if (!m) return;
    FL.source = { media: m, in: null, out: null };
    $('#src-name').textContent = m.name;
    sv.crossOrigin = 'anonymous';
    if (m.type === 'image') { sv.removeAttribute('src'); sv.poster = api.mediaUrl(m.proxy || m.path); }
    else { sv.poster = ''; sv.src = api.mediaUrl(m.proxy || m.path); }
    FL.showTab('monitor', 'source');
    layoutSource();
    updateSrc();
  };
  function srcDur() { const m = FL.source.media; return m ? (m.type === 'image' ? 5 : m.duration || sv.duration || 0) : 0; }
  function updateSrc() {
    const d = srcDur();
    const t = sv.currentTime || 0;
    $('#src-tc').textContent = FL.timecode(t);
    const a = FL.source.in ?? 0;
    const b = FL.source.out ?? d;
    $('#src-dur').textContent = FL.timecode(Math.max(0, b - a));
    const bar = $('#src-bar');
    const w = bar.clientWidth || 1;
    $('#src-head').style.left = (d ? (t / d) * w : 0) + 'px';
    const r = $('#src-range');
    r.hidden = FL.source.in == null && FL.source.out == null;
    r.style.left = (d ? (a / d) * w : 0) + 'px';
    r.style.width = (d ? ((b - a) / d) * w : 0) + 'px';
    $('#s-play').innerHTML = `<i class="ic ic-${sv.paused ? 'play' : 'pause'}"></i>`;
  }
  sv.addEventListener('timeupdate', updateSrc);
  sv.addEventListener('loadedmetadata', updateSrc);
  sv.addEventListener('play', updateSrc);
  sv.addEventListener('pause', updateSrc);
  FL.sourceToggle = () => { if (!FL.source.media || FL.source.media.type === 'image') return; if (sv.paused) sv.play().catch(() => {}); else sv.pause(); };
  FL.sourceStep = (n) => { sv.pause(); sv.currentTime = FL.clamp(sv.currentTime + n * FL.frame(), 0, srcDur()); };
  FL.sourceMark = (which) => {
    if (!FL.source.media) return;
    const t = sv.currentTime || 0;
    if (which === 'in') { FL.source.in = t; if (FL.source.out != null && FL.source.out <= t) FL.source.out = null; }
    else { FL.source.out = t; if (FL.source.in != null && FL.source.in >= t) FL.source.in = null; }
    updateSrc();
  };
  FL.sourceEdit = (mode) => {
    const m = FL.source.media;
    if (!m) return FL.toast('Open a clip in the Source monitor first');
    const range = m.type === 'image' ? null : { in: FL.source.in ?? 0, out: FL.source.out ?? m.duration };
    FL.insertMedia(m, null, FL.time, range, mode);
    FL.toast(mode === 'insert' ? 'Inserted at playhead' : 'Overwritten at playhead');
  };
  $('#s-play').onclick = FL.sourceToggle;
  $('#s-back').onclick = () => FL.sourceStep(-1);
  $('#s-fwd').onclick = () => FL.sourceStep(1);
  $('#s-in').onclick = () => FL.sourceMark('in');
  $('#s-out').onclick = () => FL.sourceMark('out');
  $('#s-insert').onclick = () => FL.sourceEdit('insert');
  $('#s-overwrite').onclick = () => FL.sourceEdit('overwrite');
  $('#src-bar').addEventListener('pointerdown', (e) => {
    const bar = e.currentTarget;
    bar.setPointerCapture(e.pointerId);
    const go = (ev) => { const r = bar.getBoundingClientRect(); sv.currentTime = FL.clamp((ev.clientX - r.left) / r.width, 0, 1) * srcDur(); updateSrc(); };
    go(e);
    const up = () => { bar.removeEventListener('pointermove', go); bar.removeEventListener('pointerup', up); };
    bar.addEventListener('pointermove', go);
    bar.addEventListener('pointerup', up);
  });
  // drag the source picture into the timeline (uses its in/out)
  srcMon.draggable = true;
  srcMon.addEventListener('dragstart', (e) => {
    const m = FL.source.media;
    if (!m) { e.preventDefault(); return; }
    FL.dragMedia = m.id;
    FL.dragRange = m.type === 'image' ? null : { in: FL.source.in ?? 0, out: FL.source.out ?? m.duration };
    e.dataTransfer.setData('application/x-fl-media', m.id);
    e.dataTransfer.effectAllowed = 'copy';
  });
  srcMon.addEventListener('dragend', () => { FL.dragMedia = null; FL.dragRange = null; });
  new ResizeObserver(updateSrc).observe($('#src-bar'));

  // ---------------------------------------------------------------- Program mini-ruler
  const pbar = $('#prog-bar');
  function updateProg() {
    const d = Math.max(FL.duration(), 0.001);
    const w = pbar.clientWidth || 1;
    $('#prog-head').style.left = FL.clamp(FL.time / d, 0, 1) * w + 'px';
    const seq = FL.seq();
    const r = $('#prog-range');
    r.hidden = seq.inPoint == null && seq.outPoint == null;
    const a = seq.inPoint ?? 0;
    const b = seq.outPoint ?? d;
    r.style.left = (a / d) * w + 'px';
    r.style.width = Math.max(1, ((b - a) / d) * w) + 'px';
  }
  pbar.addEventListener('pointerdown', (e) => {
    pbar.setPointerCapture(e.pointerId);
    if (FL.playing) FL.pause();
    const go = (ev) => { const r = pbar.getBoundingClientRect(); FL.seek(FL.clamp((ev.clientX - r.left) / r.width, 0, 1) * FL.duration()); };
    go(e);
    const up = () => { pbar.removeEventListener('pointermove', go); pbar.removeEventListener('pointerup', up); };
    pbar.addEventListener('pointermove', go);
    pbar.addEventListener('pointerup', up);
  });
  FL.on('time', updateProg);
  FL.on('change', updateProg);
  new ResizeObserver(updateProg).observe(pbar);

  // ---------------------------------------------------------------- inline prompt
  FL.promptInline = (x, y, w, value, cb) => {
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.className = 'inline-prompt';
    inp.value = value || '';
    Object.assign(inp.style, { left: Math.min(x, innerWidth - w - 8) + 'px', top: Math.max(4, y) + 'px', width: w + 'px' });
    document.body.appendChild(inp);
    inp.focus();
    inp.select();
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      const v = inp.value.trim();
      inp.remove();
      if (ok) cb(v);
    };
    inp.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') finish(true);
      if (e.key === 'Escape') finish(false);
    });
    inp.addEventListener('blur', () => finish(true));
  };
})();
