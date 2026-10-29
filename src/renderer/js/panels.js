/* Frameline — Effects browser, Essential Graphics, Markers, the Source monitor
   (In/Out, video/audio choice, drag video only / audio only, Insert/Overwrite)
   and the Program monitor's drop zones. */
'use strict';

(() => {
  const D = window.FLDefs;
  const $ = (s) => document.querySelector(s);
  const api = window.api;

  FL.showTab = (_group, panel) => FL.dock && FL.dock.show(panel);

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
        c.effects.push(FL.makeEffect(item.id));
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
    if (!applied) {
      FL.undoStack.pop();
      FL.toast(item.kind === 'afx' || item.kind === 'apreset' || item.kind === 'atrans' ? 'That is an audio item — drop it on an audio clip' : 'That item doesn’t apply to this clip');
      return;
    }
    if (targets.length === 1 && !item.kind.endsWith('trans')) FL.select(targets[0].id, { keep: true });
    FL.changed();
  };

  // ---------------------------------------------------------------- Effects browser
  const tree = $('#fx-tree');
  const open = { presets: true, vfx: true, vtrans: true, afx: false, atrans: false };
  function fxItems() {
    return [
      { id: 'presets', name: 'Presets', items: [
        ...Object.keys(D.LOOKS).map((k) => ({ kind: 'look', id: k, name: k, tag: 'Lumetri' })),
        ...Object.keys(D.AUDIO_PRESETS).map((k) => ({ kind: 'apreset', id: k, name: k, tag: 'Audio' })),
      ] },
      { id: 'vfx', name: 'Video Effects', items: Object.entries(D.VIDEO_EFFECTS).map(([k, d]) => ({ kind: 'vfx', id: k, name: d.name, tag: d.cat })) },
      { id: 'vtrans', name: 'Video Transitions', items: Object.entries(D.VIDEO_TRANSITIONS).map(([k, d]) => ({ kind: 'vtrans', id: k, name: d.name, tag: d.cat })) },
      { id: 'afx', name: 'Audio Effects', items: Object.entries(D.AUDIO_EFFECTS).map(([k, d]) => ({ kind: 'afx', id: k, name: d.name, tag: d.cat })) },
      { id: 'atrans', name: 'Audio Transitions', items: Object.entries(D.AUDIO_TRANSITIONS).map(([k, d]) => ({ kind: 'atrans', id: k, name: d.name, tag: 'Crossfade' })) },
    ];
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
        <div class="fx-items">${items.map((i) => `<div class="fx-item" data-kind="${i.kind}" data-id="${FL.esc(i.id)}" data-name="${FL.esc(i.name)}" title="${FL.esc(i.tag || '')}"><i class="ic ic-${kindIcon[i.kind]}"></i><span>${FL.esc(i.name)}</span>${i.id === 'crossdissolve' ? '<em>default</em>' : ''}</div>`).join('')}</div>
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
  tree.addEventListener('pointerdown', (e) => {
    const it = e.target.closest('.fx-item');
    if (!it) return;
    FL.dnd.press(e, () => ({ kind: 'fx', item: { kind: it.dataset.kind, id: it.dataset.id } }), it.dataset.name);
  });
  renderFx();

  // ---------------------------------------------------------------- Essential Graphics
  const gfxList = $('#gfx-list');
  const GFX_EXTRA = [
    { id: 'title', name: 'Basic Title', desc: 'Free text you can style' },
    { id: 'adjust', name: 'Adjustment Layer', desc: 'Effects apply to all tracks below' },
    { id: 'matte', name: 'Color Matte', desc: 'Solid color background' },
  ];
  function renderGfx() {
    const items = [...Object.entries(D.GRAPHICS).map(([k, g]) => ({ id: k, name: g.name, desc: g.desc })), ...GFX_EXTRA];
    gfxList.innerHTML = '<div class="gfx-head">News & broadcast templates</div>' + items.map((i) => `<div class="gfx-card" data-gfx="${i.id}" data-name="${FL.esc(i.name)}">
        <div class="gfx-thumb" data-thumb="${i.id}"></div>
        <div class="gfx-meta"><b>${FL.esc(i.name)}</b><span>${FL.esc(i.desc)}</span></div>
      </div>`).join('');
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
  gfxList.addEventListener('pointerdown', (e) => {
    const card = e.target.closest('.gfx-card');
    if (card) FL.dnd.press(e, () => ({ kind: 'gfx', id: card.dataset.gfx }), card.dataset.name);
  });
  gfxList.addEventListener('dblclick', (e) => {
    const card = e.target.closest('.gfx-card');
    if (card) FL.insertGraphicItem(card.dataset.gfx, null, FL.time);
  });
  renderGfx();

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
    FL.select(clip.id);
    FL.changed();
    if (clip.type === 'adjust') FL.toast('Adjustment layer added — drop effects on it to affect everything below');
    return clip;
  };

  // ---------------------------------------------------------------- Markers panel
  const mlist = $('#markers-list');
  function renderMarkers() {
    const seq = FL.seq();
    if (!seq.markers.length) { mlist.innerHTML = '<p class="empty-note">No markers in this sequence yet.<br>Press <kbd>M</kbd> to add one at the playhead.</p>'; return; }
    mlist.innerHTML = seq.markers.map((m) => `<div class="mk-row" data-id="${m.id}">
      <span class="mk-dot" style="background:${FL.esc(m.color || '#3ddc84')}"></span>
      <span class="mk-tc">${FL.timecode(m.t)}</span>
      <span class="mk-name">${FL.esc(m.name || '(no name)')}</span>
      <button class="mk-del" title="Delete marker">✕</button></div>`).join('');
  }
  mlist.addEventListener('click', (e) => {
    const row = e.target.closest('.mk-row');
    if (!row) return;
    const seq = FL.seq();
    const m = seq.markers.find((x) => x.id === row.dataset.id);
    if (!m) return;
    if (e.target.closest('.mk-del')) { FL.pushUndo(); seq.markers = seq.markers.filter((x) => x !== m); FL.changed(); return; }
    FL.seek(m.t);
    FL.ensureVisible(m.t);
  });
  mlist.addEventListener('dblclick', (e) => {
    const n = e.target.closest('.mk-name');
    if (!n) return;
    const m = FL.seq().markers.find((x) => x.id === n.parentNode.dataset.id);
    const r = n.getBoundingClientRect();
    FL.promptInline(r.left, r.top - 3, Math.max(160, r.width), m.name || '', (v) => { FL.pushUndo(); m.name = v; FL.changed(); });
  });
  FL.on('change', renderMarkers);
  FL.on('seq', renderMarkers);
  renderMarkers();

  // ---------------------------------------------------------------- Source monitor
  const sv = $('#src-video');
  const wave = $('#src-wave');
  const waveHead = $('#src-wave-head');
  const srcMon = $('#src-monitor');
  const bar = $('#src-bar');
  FL.source = { media: null };
  const srcM = () => FL.source.media;
  const srcDur = () => { const m = srcM(); return m ? (m.type === 'image' ? 5 : m.duration || sv.duration || 0) : 0; };
  const srcIn = () => { const m = srcM(); return m && m.srcIn != null ? m.srcIn : null; };
  const srcOut = () => { const m = srcM(); return m && m.srcOut != null ? m.srcOut : null; };
  const range = () => { const m = srcM(); if (!m || m.type === 'image') return null; return { in: srcIn() ?? 0, out: srcOut() ?? srcDur() }; };
  FL.sourceRange = range;

  FL.openSource = (m, focus = true) => {
    if (!m) return;
    FL.source.media = m;
    sv.pause();
    sv.crossOrigin = 'anonymous';
    if (m.type === 'image') { sv.removeAttribute('src'); sv.load(); sv.poster = api.mediaUrl(m.proxy || m.path); }
    else { sv.poster = ''; sv.src = api.mediaUrl(m.proxy || m.path); }
    sv.hidden = m.type === 'audio';
    wave.hidden = m.type !== 'audio' || !m.wave;
    waveHead.hidden = wave.hidden;
    if (!wave.hidden) wave.src = api.fileUrl(m.wave);
    $('#src-empty').hidden = true;
    const startAt = srcIn() ?? 0;
    sv.addEventListener('loadedmetadata', () => { try { sv.currentTime = startAt; } catch (_) {} }, { once: true });
    if (focus) FL.dock.show('source');
    FL.emit('source');
    updateSrc();
  };

  function patchUI() {
    const p = FL.patch();
    $('#src-use-v').checked = !!p.vOn;
    $('#src-use-a').checked = !!p.aOn;
    const m = srcM();
    $('#src-use-v').disabled = !!m && m.type === 'audio';
    $('#src-use-a').disabled = !!m && (m.type === 'image' || !m.hasAudio);
    $('#src-drag-v').classList.toggle('off', !!m && m.type === 'audio');
    $('#src-drag-a').classList.toggle('off', !!m && (m.type === 'image' || !m.hasAudio));
  }

  function updateSrc() {
    const m = srcM();
    const d = srcDur();
    const t = sv.currentTime || 0;
    const a = srcIn();
    const b = srcOut();
    $('#src-tc').textContent = FL.timecode(t);
    const span = Math.max(0, (b ?? d) - (a ?? 0));
    $('#src-dur').textContent = FL.timecode(m && m.type !== 'image' ? span : 0);
    const w = bar.clientWidth || 1;
    $('#src-head').style.left = (d ? (t / d) * w : 0) + 'px';
    const r = $('#src-range');
    r.hidden = !m || m.type === 'image';
    r.style.left = (d ? ((a ?? 0) / d) * w : 0) + 'px';
    r.style.width = Math.max(2, d ? (span / d) * w : 0) + 'px';
    r.classList.toggle('full', a == null && b == null);
    if (!wave.hidden) waveHead.style.left = `calc(16px + (100% - 32px) * ${d ? t / d : 0})`;
    $('#s-play').innerHTML = `<i class="ic ic-${sv.paused ? 'play' : 'pause'}"></i>`;
    for (const [id, v] of [['#src-in-f', a ?? 0], ['#src-out-f', b ?? d], ['#src-dur-f', span]]) {
      const inp = $(id);
      if (document.activeElement !== inp) inp.value = m && m.type !== 'image' ? FL.timecode(v) : '';
      inp.disabled = !m || m.type === 'image';
    }
    patchUI();
  }
  FL.updateSource = updateSrc;
  sv.addEventListener('timeupdate', updateSrc);
  sv.addEventListener('loadedmetadata', updateSrc);
  sv.addEventListener('play', updateSrc);
  sv.addEventListener('pause', updateSrc);
  sv.addEventListener('seeked', updateSrc);
  // keep the playhead smooth while playing
  (function loop() { if (!sv.paused) updateSrc(); requestAnimationFrame(loop); })();

  const setIn = (t) => { const m = srcM(); if (!m || m.type === 'image') return; m.srcIn = FL.clamp(t, 0, srcDur()); if (m.srcOut != null && m.srcOut <= m.srcIn) m.srcOut = null; FL.setDirty(true); updateSrc(); };
  const setOut = (t) => { const m = srcM(); if (!m || m.type === 'image') return; m.srcOut = FL.clamp(t, 0, srcDur()); if (m.srcIn != null && m.srcIn >= m.srcOut) m.srcIn = null; FL.setDirty(true); updateSrc(); };
  const seekSrc = (t) => { sv.currentTime = FL.clamp(t, 0, srcDur()); updateSrc(); };

  FL.sourceToggle = () => {
    const m = srcM();
    if (!m || m.type === 'image') return;
    if (sv.paused) {
      if (srcOut() != null && sv.currentTime >= srcOut() - 0.02) sv.currentTime = srcIn() ?? 0;
      sv.playbackRate = 1;
      sv.play().catch(() => {});
    } else sv.pause();
  };
  FL.sourceShuttle = (k) => {
    if (!srcM()) return;
    if (k === 'k') { sv.pause(); return; }
    if (k === 'l') { sv.playbackRate = sv.paused ? 1 : Math.min(4, sv.playbackRate * 2); sv.play().catch(() => {}); return; }
    if (k === 'j') { sv.pause(); seekSrc(sv.currentTime - 1); }
  };
  FL.sourceStep = (n) => { sv.pause(); seekSrc(sv.currentTime + n * FL.frame()); };
  FL.sourceMark = (which) => { if (!srcM()) return; if (which === 'in') setIn(sv.currentTime || 0); else setOut(sv.currentTime || 0); };
  FL.sourceClear = () => { const m = srcM(); if (!m) return; m.srcIn = null; m.srcOut = null; FL.setDirty(true); updateSrc(); };
  FL.sourceGo = (which) => { const v = which === 'in' ? srcIn() ?? 0 : srcOut() ?? srcDur(); sv.pause(); seekSrc(v); };

  // Insert / Overwrite from the Source monitor, using source patching
  FL.sourceEdit = (mode) => {
    const m = srcM();
    if (!m) { FL.toast('Open a clip in the Source monitor first (double-click it in Project)'); return null; }
    const p = FL.patch();
    const clips = FL.placeMedia(m, { time: FL.time, range: range(), mode, video: p.vOn, audio: p.aOn, vTrack: FL.track(p.v), aTrack: FL.track(p.a) });
    if (clips && clips.length) {
      FL.toast(`${mode === 'insert' ? 'Inserted' : 'Overwritten'} ${FL.timecode(clips[0].duration)} at ${FL.timecode(clips[0].start)}`);
      FL.seek(clips[0].start + clips[0].duration);
      FL.ensureVisible(FL.time);
    }
    return clips;
  };

  $('#s-play').onclick = FL.sourceToggle;
  $('#s-back').onclick = () => FL.sourceStep(-1);
  $('#s-fwd').onclick = () => FL.sourceStep(1);
  $('#s-in').onclick = () => FL.sourceMark('in');
  $('#s-out').onclick = () => FL.sourceMark('out');
  $('#s-clear').onclick = FL.sourceClear;
  $('#s-goin').onclick = () => FL.sourceGo('in');
  $('#s-goout').onclick = () => FL.sourceGo('out');
  $('#s-insert').onclick = () => FL.sourceEdit('insert');
  $('#s-overwrite').onclick = () => FL.sourceEdit('overwrite');
  $('#src-ins-btn').onclick = () => FL.sourceEdit('insert');
  $('#src-ow-btn').onclick = () => FL.sourceEdit('overwrite');
  $('#src-use-v').onchange = (e) => { FL.patch().vOn = e.target.checked; FL.changed({ source: 'patch' }); };
  $('#src-use-a').onchange = (e) => { FL.patch().aOn = e.target.checked; FL.changed({ source: 'patch' }); };

  // typed In / Out / Duration
  const tcField = (id, apply) => {
    const inp = $(id);
    inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') inp.blur(); if (e.key === 'Escape') { inp.value = ''; inp.blur(); } });
    inp.addEventListener('change', () => {
      const v = FL.parseTimecode(inp.value);
      if (v == null || !srcM()) { updateSrc(); return; }
      apply(v);
      updateSrc();
    });
    inp.addEventListener('blur', updateSrc);
  };
  tcField('#src-in-f', (v) => { setIn(v); seekSrc(v); });
  tcField('#src-out-f', (v) => { setOut(v); seekSrc(v); });
  tcField('#src-dur-f', (v) => { const a = srcIn() ?? 0; setOut(Math.min(srcDur(), a + Math.max(FL.frame(), v))); });

  // ruler: scrub, or drag the In/Out handles / the whole range
  bar.addEventListener('pointerdown', (e) => {
    const m = srcM();
    if (!m || e.button !== 0) return;
    bar.setPointerCapture(e.pointerId);
    const r = bar.getBoundingClientRect();
    const tAt = (ev) => FL.clamp((ev.clientX - r.left) / r.width, 0, 1) * srcDur();
    const h = e.target.closest('.mr-h');
    let fn;
    if (h && h.dataset.h === 'in') fn = (ev) => { setIn(Math.min(tAt(ev), (srcOut() ?? srcDur()) - FL.frame())); seekSrc(srcIn()); };
    else if (h && h.dataset.h === 'out') fn = (ev) => { setOut(Math.max(tAt(ev), (srcIn() ?? 0) + FL.frame())); seekSrc(srcOut()); };
    else if (e.target.closest('#src-range') && e.altKey) {
      const a0 = srcIn() ?? 0; const b0 = srcOut() ?? srcDur(); const t0 = tAt(e);
      fn = (ev) => { const d = FL.clamp(tAt(ev) - t0, -a0, srcDur() - b0); m.srcIn = a0 + d; m.srcOut = b0 + d; updateSrc(); };
    } else { sv.pause(); fn = (ev) => seekSrc(tAt(ev)); fn(e); }
    const up = () => { bar.removeEventListener('pointermove', fn); bar.removeEventListener('pointerup', up); };
    bar.addEventListener('pointermove', fn);
    bar.addEventListener('pointerup', up);
  });
  new ResizeObserver(updateSrc).observe(bar);

  // dragging out of the Source monitor (picture = per the Video/Audio boxes; handles = one side only)
  const srcPayload = (part) => () => {
    const m = srcM();
    if (!m) return null;
    const p = FL.patch();
    let want = part;
    if (want === 'both') want = p.vOn && p.aOn ? 'both' : p.vOn ? 'video' : p.aOn ? 'audio' : 'both';
    if (want === 'video' && m.type === 'audio') { FL.toast('This clip has no picture'); return null; }
    if (want === 'audio' && (m.type === 'image' || !m.hasAudio)) { FL.toast('This clip has no sound'); return null; }
    return { kind: 'media', mediaId: m.id, range: range(), part: want };
  };
  const srcLabel = (part) => () => {
    const m = srcM();
    const r = range();
    return `${m ? m.name : ''}${r ? ' · ' + FL.timecode(r.out - r.in) : ''}${part === 'video' ? ' (video only)' : part === 'audio' ? ' (audio only)' : ''}`;
  };
  srcMon.addEventListener('pointerdown', (e) => { if (srcM()) FL.dnd.press(e, srcPayload('both'), srcLabel('both')); });
  $('#src-drag-v').addEventListener('pointerdown', (e) => FL.dnd.press(e, srcPayload('video'), srcLabel('video')));
  $('#src-drag-a').addEventListener('pointerdown', (e) => FL.dnd.press(e, srcPayload('audio'), srcLabel('audio')));
  srcMon.addEventListener('dblclick', FL.sourceToggle);

  // the Source monitor accepts media from the Project panel
  FL.dnd.target({
    match: (el, p) => p.kind === 'media' && !p.fromSource && !!el.closest('.pc[data-panel="source"]'),
    over: () => { srcMon.classList.add('drop-hot'); FL.dnd.hint('Open in Source'); return true; },
    drop: (p) => FL.openSource(FL.media(p.mediaId)),
    leave: () => srcMon.classList.remove('drop-hot'),
  });

  FL.on('change', patchUI);
  FL.on('seq', patchUI);
  updateSrc();

  // ---------------------------------------------------------------- Program monitor: mini ruler + drop zones
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

  const pdrop = $('#prog-drop');
  let hotZone = null;
  FL.dnd.target({
    match: (el, p) => (p.kind === 'media' || p.kind === 'gfx' || p.kind === 'fx') && !!el.closest('.pc[data-panel="program"]'),
    over: (p, e, el) => {
      if (p.kind === 'fx') {
        const n = FL.selectedClips().length;
        FL.dnd.hint(n ? `Apply to ${n} selected clip${n > 1 ? 's' : ''}` : 'Select a clip first');
        return n ? { zone: 'fx' } : null;
      }
      pdrop.hidden = false;
      const z = el.closest('[data-zone]');
      const zone = z ? z.dataset.zone : 'overwrite';
      if (hotZone !== zone) {
        pdrop.querySelectorAll('.pd-zone').forEach((n) => n.classList.toggle('hot', n.dataset.zone === zone));
        hotZone = zone;
      }
      return { zone };
    },
    drop: (p, e, st) => {
      if (p.kind === 'fx') { FL.applyFxItem(p.item, FL.selectedClips()); return; }
      const t = st.zone === 'append' ? FL.duration() : FL.time;
      if (p.kind === 'gfx') { FL.insertGraphicItem(p.id, null, t); return; }
      const m = FL.media(p.mediaId);
      if (!m) return;
      const pt = FL.patch();
      const r = p.range || null;
      const dur = r ? r.out - r.in : m.type === 'image' ? 5 : m.duration;
      let vTrack = FL.track(pt.v);
      let aTrack = FL.track(pt.a);
      if (st.zone === 'overlay') {
        vTrack = FL.freeVideoTrack(t, t + dur);
        aTrack = FL.aTracks().find((tr) => !tr.locked && !FL.seq().clips.some((o) => o.trackId === tr.id && o.start < t + dur && o.start + o.duration > t)) || null;
      }
      const clips = FL.placeMedia(m, { time: t, range: r, mode: st.zone === 'insert' ? 'insert' : 'overwrite', part: p.part, vTrack, aTrack, newAudioTrack: st.zone === 'overlay' && !aTrack });
      if (clips && clips.length) { FL.seek(clips[0].start + clips[0].duration); FL.ensureVisible(FL.time); }
    },
    leave: () => { pdrop.hidden = true; hotZone = null; },
  });

  // ---------------------------------------------------------------- editable timecodes
  function editableTc(sel, get, set) {
    const el = $(sel);
    el.addEventListener('click', () => {
      const r = el.getBoundingClientRect();
      FL.promptInline(r.left - 4, r.top - 3, Math.max(110, r.width + 10), FL.timecode(get()), (v) => {
        const t = FL.parseTimecode(v);
        if (t != null) set(t);
      }, 'tc');
    });
  }
  editableTc('#tc-current', () => FL.time, (t) => { FL.seek(t); FL.ensureVisible(FL.time); });
  editableTc('#tl-tc', () => FL.time, (t) => { FL.seek(t); FL.ensureVisible(FL.time); });
  editableTc('#src-tc', () => sv.currentTime || 0, (t) => { sv.pause(); seekSrc(t); });

  // ---------------------------------------------------------------- inline prompt
  FL.promptInline = (x, y, w, value, cb, cls = '') => {
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.className = 'inline-prompt ' + cls;
    inp.value = value || '';
    inp.spellcheck = false;
    Object.assign(inp.style, { left: Math.max(4, Math.min(x, innerWidth - w - 8)) + 'px', top: Math.max(4, y) + 'px', width: w + 'px' });
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
