/* Freemiere Pro — app shell: Project panel, importing, commands, Premiere-style
   keyboard shortcuts, menus, splitters, save/open and Export. */
'use strict';

(() => {
  const api = window.api;
  const D = window.FLDefs;
  const $ = (s) => document.querySelector(s);
  const bin = $('#bin');
  const binEmpty = $('#bin-empty');
  const basename = (p) => p.split(/[\\/]/).pop();
  const isTyping = (el) => el && (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' ||
    (el.tagName === 'INPUT' && !['range', 'checkbox', 'button', 'color'].includes(el.type)) || el.isContentEditable);

  document.body.classList.toggle('mac', api.platform === 'darwin');

  // ======================================================================
  // Project panel
  // ======================================================================
  const status = {};
  function renderBin() {
    const q = $('#bin-filter').value.trim().toLowerCase();
    const items = FL.project.media.filter((m) => !q || m.name.toLowerCase().includes(q));
    const n = FL.project.media.length;
    $('#media-count').textContent = `${n} item${n === 1 ? '' : 's'} · ${FL.project.sequences.length} sequence${FL.project.sequences.length === 1 ? '' : 's'}`;
    binEmpty.hidden = n > 0;
    bin.querySelectorAll('.media').forEach((el) => el.remove());
    const used = new Set();
    for (const s of FL.project.sequences) for (const c of s.clips) if (c.mediaId) used.add(c.mediaId);
    for (const m of items) {
      const el = document.createElement('div');
      el.className = `media ${m.type}${m.missing ? ' missing' : ''}`;
      el.dataset.id = m.id;
      el.title = m.path;
      el.innerHTML = `
        <div class="media-thumb">${m.thumb ? `<img src="${api.fileUrl(m.thumb)}" draggable="false">` : `<i class="ic ic-${m.type === 'audio' ? 'audio' : m.type}"></i>`}
          ${m.type !== 'image' ? `<span class="media-dur">${FL.timecode(m.duration).slice(3)}</span>` : ''}
          ${status[m.id] === 'proxy' ? '<span class="media-status">Preparing preview…</span>' : ''}
          ${m.missing ? '<span class="media-status err">Media offline</span>' : ''}
          ${used.has(m.id) ? '<span class="media-used" title="Used in a sequence"></span>' : ''}
        </div>
        <div class="media-name"><i class="ic ic-${m.type === 'audio' ? 'audio' : m.type}"></i><span>${FL.esc(m.name)}</span></div>`;
      bin.appendChild(el);
    }
  }
  FL.renderBin = renderBin;
  $('#bin-filter').addEventListener('input', renderBin);

  bin.addEventListener('pointerdown', (e) => {
    const el = e.target.closest('.media');
    if (!el) return;
    const m = FL.media(el.dataset.id);
    FL.dnd.press(e, () => (m && !m.missing ? { kind: 'media', mediaId: m.id, range: null, part: 'both' } : null), m ? m.name : '');
  });
  bin.addEventListener('click', (e) => {
    const el = e.target.closest('.media');
    bin.querySelectorAll('.media.sel').forEach((n) => n.classList.remove('sel'));
    if (el) el.classList.add('sel');
  });
  bin.addEventListener('dblclick', (e) => {
    const el = e.target.closest('.media');
    if (el) FL.openSource(FL.media(el.dataset.id));
  });
  bin.addEventListener('contextmenu', (e) => {
    const el = e.target.closest('.media');
    if (!el) return;
    e.preventDefault();
    const m = FL.media(el.dataset.id);
    FL.showMenu(e.clientX, e.clientY, [
      { label: 'Open in Source Monitor', act: () => FL.openSource(m) },
      { label: 'Insert at Playhead', key: ',', act: () => FL.insertMedia(m, null, FL.time, null, 'insert') },
      { label: 'Overwrite at Playhead', key: '.', act: () => FL.insertMedia(m, null, FL.time) },
      { label: 'New Sequence From Clip', act: () => FL.cmd('newSequenceFrom', m.id) },
      { label: api.platform === 'darwin' ? 'Reveal in Finder' : 'Show in Folder', act: () => api.reveal(m.path) },
      { sep: true },
      { label: 'Remove from Project', act: () => {
        FL.pushUndo();
        for (const s of FL.project.sequences) s.clips = s.clips.filter((c) => c.mediaId !== m.id);
        FL.project.media = FL.project.media.filter((x) => x.id !== m.id);
        FL.changed();
      } },
    ]);
  });
  $('#btn-new-item').addEventListener('click', (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    FL.showMenu(r.left, r.bottom + 4, [
      { label: 'Sequence…', act: () => FL.cmd('newSequence') },
      { label: 'Adjustment Layer', act: () => FL.cmd('adjustLayer') },
      { label: 'Color Matte', act: () => FL.cmd('colorMatte') },
      { label: 'Title', act: () => FL.cmd('title') },
    ]);
  });

  // ======================================================================
  // Importing
  // ======================================================================
  function canPlay(m) {
    return new Promise((resolve) => {
      let el;
      const done = (ok) => { clearTimeout(t); el.removeAttribute('src'); try { el.load && el.load(); } catch (_) {} resolve(ok); };
      if (m.type === 'image') {
        el = new Image();
        el.onload = () => done(el.naturalWidth > 0);
        el.onerror = () => done(false);
      } else {
        el = document.createElement(m.type === 'audio' ? 'audio' : 'video');
        el.preload = 'metadata';
        el.onloadedmetadata = () => done(m.type === 'audio' || el.videoWidth > 0);
        el.onerror = () => done(false);
      }
      el.crossOrigin = 'anonymous';
      const t = setTimeout(() => done(true), 10000);
      el.src = api.mediaUrl(m.path);
    });
  }

  async function ensureAssets(m) {
    const exists = await api.exists(m.path);
    m.missing = !exists;
    if (!exists) { renderBin(); return; }
    await api.allowMedia([m.path]);
    const jobs = [];
    if (m.hasVideo && (!m.thumb || !(await api.exists(m.thumb)))) jobs.push(api.thumb(m.path, m.type, m.duration).then((p) => { m.thumb = p; }).catch(() => {}));
    if (m.hasAudio && (!m.wave || !(await api.exists(m.wave)))) jobs.push(api.wave(m.path).then((p) => { m.wave = p; }).catch(() => {}));
    if (m.proxy && !(await api.exists(m.proxy))) m.proxy = null;
    if (m.proxy) await api.allowMedia([m.proxy]);
    else {
      jobs.push(canPlay(m).then(async (ok) => {
        if (ok) return;
        status[m.id] = 'proxy';
        renderBin();
        try { m.proxy = await api.proxy(m.path, m.type); } catch (err) { FL.toast(`Couldn't prepare preview for ${m.name}`); }
        delete status[m.id];
      }));
    }
    await Promise.all(jobs);
    renderBin();
    FL.renderTimeline();
    FL.requestDraw();
  }

  FL.importPaths = async (paths) => {
    const out = [];
    let failed = 0;
    for (const p of paths) {
      let m = FL.project.media.find((x) => x.path === p);
      if (m) { out.push(m); continue; }
      try {
        const info = await api.probe(p);
        m = Object.assign({ id: FL.uid('media'), path: p, name: basename(p), thumb: null, wave: null, proxy: null }, info);
        if (m.type !== 'audio' && (!m.width || !m.height)) throw new Error('no picture');
        await api.allowMedia([p]);
        FL.project.media.push(m);
        out.push(m);
        renderBin();
        ensureAssets(m);
      } catch (err) {
        failed++;
        console.warn('import failed', p, err);
      }
    }
    if (failed) FL.toast(`${failed} file${failed > 1 ? 's' : ''} couldn't be imported`);
    if (out.length) FL.setDirty(true);
    return out;
  };
  async function importDialog() {
    const paths = await api.pickMedia();
    if (paths.length) FL.importPaths(paths);
  }

  const overlay = $('#drop-overlay');
  let dragDepth = 0;
  window.addEventListener('dragenter', (e) => { if (e.dataTransfer.types.includes('Files')) { dragDepth++; overlay.hidden = false; } });
  window.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) overlay.hidden = true; });
  window.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); });
  window.addEventListener('drop', (e) => {
    dragDepth = 0;
    overlay.hidden = true;
    if (!e.dataTransfer.files.length) return;
    e.preventDefault();
    FL.importPaths([...e.dataTransfer.files].map((f) => api.pathForFile(f)).filter(Boolean));
  });

  // ======================================================================
  // Commands
  // ======================================================================
  const seq = () => FL.seq();
  const targetsAtPlayhead = () => {
    const t = FL.time;
    const sel = FL.selectedClips().filter((c) => t > c.start && t < c.start + c.duration);
    return sel.length ? sel : seq().clips.filter((c) => t > c.start && t < c.start + c.duration && !FL.isLocked(c));
  };
  function rippleTrim(which) {
    const t = FL.time;
    const hits = seq().clips.filter((c) => !FL.isLocked(c) && t > c.start && t < c.start + c.duration);
    if (!hits.length) return FL.toast('No clip under the playhead');
    FL.pushUndo();
    for (const c of hits) {
      if (which === 'prev') {
        const cut = t - c.start;
        FL.trimHeadKf(c, cut);
        c.in = (c.in || 0) + cut * (c.speed || 1);
        c.duration -= cut;
        c.transIn = null;
        for (const o of seq().clips) if (o.trackId === c.trackId && o.id !== c.id && o.start >= c.start) o.start -= cut;
      } else {
        const cut = c.start + c.duration - t;
        const end = c.start + c.duration;
        c.duration -= cut;
        c.transOut = null;
        for (const o of seq().clips) if (o.trackId === c.trackId && o.id !== c.id && o.start >= end - 1e-6) o.start -= cut;
      }
    }
    if (which === 'prev') FL.seek(Math.min(...hits.map((c) => c.start)));
    FL.changed();
  }
  function liftExtract(ripple) {
    const s = seq();
    if (s.inPoint == null || s.outPoint == null) return FL.toast('Set In (I) and Out (O) points first');
    const a = s.inPoint;
    const b = s.outPoint;
    FL.pushUndo();
    for (const tr of s.tracks) {
      if (tr.locked) continue;
      FL.overwrite(tr.id, a, b, []);
      if (ripple) for (const c of s.clips) if (c.trackId === tr.id && c.start >= b - 1e-6) c.start -= b - a;
    }
    if (ripple) s.outPoint = null;
    FL.changed();
  }
  function applyDefaultTransition(kind) {
    let clips = FL.selectedClips();
    if (!clips.length) {
      const t = FL.time;
      const eps = 1.5 / FL.fps();
      clips = seq().clips.filter((c) => !FL.isLocked(c) && Math.abs(c.start - t) < eps);
      if (!clips.length) return FL.toast('Select clips or park the playhead on an edit');
      return FL.applyFxItem({ kind: kind === 'audio' ? 'atrans' : 'vtrans', id: kind === 'audio' ? 'constantpower' : 'crossdissolve' }, clips, 'in');
    }
    FL.applyFxItem({ kind: kind === 'audio' ? 'atrans' : 'vtrans', id: kind === 'audio' ? 'constantpower' : 'crossdissolve' }, clips, 'both');
  }
  function addClip(clip) {
    FL.pushUndo();
    const tr = FL.freeVideoTrack(FL.time, FL.time + clip.duration);
    FL.placeClip(clip, tr.id, FL.time);
    FL.sel = new Set([clip.id]);
    FL.selectedId = clip.id;
    FL.changed();
    FL.emit('select', clip.id);
    return clip;
  }

  const cmds = {
    new: async () => { if (await api.confirmDiscard()) loadProject(FL.newProject(), null); },
    open: async () => {
      if (!(await api.confirmDiscard())) return;
      const res = await api.openProject();
      if (res) loadProject(res.data, res.path);
    },
    save: () => saveProject(false),
    saveAs: () => saveProject(true),
    import: importDialog,
    export: openExport,
    exportFrame: async () => {
      if (FL.playing) FL.pause();
      try {
        const c = FL.renderFrame(FL.time);
        const p = await api.saveFrame(c.toDataURL('image/png'), `${seq().name} ${FL.timecode(FL.time).replace(/:/g, '.')}.png`);
        if (p) { await FL.importPaths([p]); FL.toast('Frame exported and added to the project'); }
      } catch (err) { FL.toast('Could not export this frame'); console.error(err); }
    },
    undo: () => (isTyping(document.activeElement) ? document.execCommand('undo') : FL.undo()),
    redo: () => (isTyping(document.activeElement) ? document.execCommand('redo') : FL.redo()),

    newSequence: () => {
      FL.pushUndo();
      const s = FL.newSequence(`Sequence ${String(FL.project.sequences.length + 1).padStart(2, '0')}`, seq().settings);
      FL.project.sequences.push(s);
      FL.changed();
      FL.openSequence(s.id);
    },
    newSequenceFrom: (mediaId) => {
      const m = FL.media(mediaId);
      if (!m) return;
      FL.pushUndo();
      const settings = Object.assign({}, seq().settings);
      if (m.width) { settings.width = Math.round(m.width / 2) * 2; settings.height = Math.round(m.height / 2) * 2; }
      if (m.fps) settings.fps = [23.976, 24, 25, 29.97, 30, 50, 59.94, 60].reduce((a, b) => (Math.abs(b - m.fps) < Math.abs(a - m.fps) ? b : a));
      const s = FL.newSequence(m.name.replace(/\.[^.]+$/, ''), settings);
      FL.project.sequences.push(s);
      FL.changed();
      FL.openSequence(s.id);
      FL.undoStack.pop();
      FL.insertMedia(m, null, 0);
    },
    duplicateSequence: (id) => {
      const src = FL.project.sequences.find((s) => s.id === (id || FL.project.activeSeq));
      FL.pushUndo();
      const copy = JSON.parse(JSON.stringify(src));
      copy.id = FL.uid('seq');
      copy.name = src.name + ' Copy';
      copy.clips.forEach((c) => { c.id = FL.uid('clip'); });
      FL.project.sequences.push(copy);
      FL.changed();
      FL.openSequence(copy.id);
    },
    deleteSequence: (id) => {
      if (FL.project.sequences.length < 2) return;
      const s = FL.project.sequences.find((x) => x.id === id);
      if (!s) return;
      FL.pushUndo();
      FL.project.sequences = FL.project.sequences.filter((x) => x.id !== id);
      if (FL.project.activeSeq === id) { FL.project.activeSeq = FL.project.sequences[0].id; FL.emit('seq'); }
      FL.sel.clear(); FL.selectedId = null;
      FL.changed();
      FL.emit('select', null);
    },
    settings: () => openSeqSettings(),

    split: () => {
      const t = FL.time;
      const list = targetsAtPlayhead();
      if (!list.length) return FL.toast('Nothing under the playhead to split');
      FL.pushUndo();
      list.forEach((c) => FL.splitClip(c, t));
      FL.changed();
    },
    splitAll: () => {
      const t = FL.time;
      const list = seq().clips.filter((c) => t > c.start && t < c.start + c.duration && !FL.isLocked(c));
      if (!list.length) return;
      FL.pushUndo();
      list.forEach((c) => FL.splitClip(c, t));
      FL.changed();
    },
    rippleTrimPrev: () => rippleTrim('prev'),
    rippleTrimNext: () => rippleTrim('next'),
    lift: () => liftExtract(false),
    extract: () => liftExtract(true),
    delete: () => {
      if (FL.selTrans) {
        const { clipId, side, audio } = FL.selTrans;
        const c = FL.clip(clipId);
        if (!c) return;
        FL.pushUndo();
        c[(audio ? 'atrans' : 'trans') + (side === 'in' ? 'In' : 'Out')] = null;
        FL.selTrans = null;
        FL.changed();
        FL.emit('select', null);
        return;
      }
      const list = FL.selectedClips().filter((c) => !FL.isLocked(c));
      if (!list.length) return;
      FL.pushUndo();
      list.forEach((c) => FL.deleteClip(c.id));
      FL.changed();
      FL.emit('select', null);
    },
    rippleDelete: () => {
      const list = FL.selectedClips().filter((c) => !FL.isLocked(c)).sort((a, b) => b.start - a.start);
      if (!list.length) return;
      FL.pushUndo();
      list.forEach((c) => FL.deleteClip(c.id, true));
      FL.changed();
      FL.emit('select', null);
    },
    // ⌘L — Premiere's Link / Unlink. Old-style clips that carry their own sound get it split onto an audio track.
    toggleLink: () => {
      const list = FL.selectedClips().filter((c) => !FL.isLocked(c));
      if (!list.length) return FL.toast('Select clips first');
      if (list.some((c) => c.link)) {
        FL.pushUndo();
        list.forEach((c) => { c.link = null; });
        FL.changed();
        FL.select(FL.selectedId, { solo: true });
        FL.toast('Unlinked — video and audio now move separately');
        return;
      }
      const embedded = list.length === 1 && list[0].type === 'video' && FL.hasAudio(list[0]) ? list[0] : null;
      if (embedded) {
        const c = embedded;
        FL.pushUndo();
        const end = c.start + c.duration;
        let track = FL.aTracks().find((t) => !t.locked && !seq().clips.some((o) => o.trackId === t.id && o.start < end && o.start + o.duration > c.start));
        if (!track) track = FL.addTrack('audio');
        const a = FL.makeClip({ type: 'audio', mediaId: c.mediaId, start: c.start, duration: c.duration, in: c.in, speed: c.speed,
          volume: c.volume, pan: c.pan, fadeIn: c.fadeIn, fadeOut: c.fadeOut, atransIn: c.atransIn, atransOut: c.atransOut, muted: c.muted,
          kf: Object.fromEntries(Object.entries(c.kf || {}).filter(([k]) => k === 'volume' || k === 'pan')),
          effects: (c.effects || []).filter((e) => FL.isAudioEffect(e.type)) });
        FL.placeClip(a, track.id, c.start);
        c.noAudio = true;
        c.muted = false;
        c.effects = (c.effects || []).filter((e) => !FL.isAudioEffect(e.type));
        FL.changed();
        FL.toast(`Audio moved to ${track.name}`);
        return;
      }
      if (list.length > 1 && list.some(FL.isVisual) && list.some((c) => c.type === 'audio')) {
        FL.pushUndo();
        const link = FL.uid('lnk');
        list.forEach((c) => { c.link = link; });
        FL.changed();
        FL.toast('Linked');
        return;
      }
      FL.toast('Select a video clip and an audio clip to link them');
    },
    detachAudio: () => cmds.toggleLink(),
    applyVideoTransition: () => applyDefaultTransition('video'),
    applyAudioTransition: () => applyDefaultTransition('audio'),
    toggleFx: () => {
      const list = FL.selectedClips().filter((c) => (c.effects || []).length);
      if (!list.length) return;
      FL.pushUndo();
      const anyOn = list.some((c) => c.effects.some((e) => e.enabled));
      list.forEach((c) => c.effects.forEach((e) => { e.enabled = !anyOn; }));
      FL.changed();
      FL.toast(anyOn ? 'Effects disabled' : 'Effects enabled');
    },
    fill: () => {
      const list = FL.selectedClips().filter((c) => c.type === 'video' || c.type === 'image');
      if (!list.length) return;
      FL.pushUndo();
      const { width: W, height: H } = FL.S();
      for (const c of list) {
        const m = FL.media(c.mediaId);
        if (!m) continue;
        c.scale = Math.max(W / m.width, H / m.height) / Math.min(W / m.width, H / m.height);
        c.x = 0; c.y = 0;
        if (c.kf) { delete c.kf.scale; delete c.kf.x; delete c.kf.y; }
      }
      FL.changed();
    },
    resetMotion: () => {
      const c = FL.selected();
      if (!c) return;
      FL.pushUndo();
      Object.assign(c, { x: 0, y: 0, scale: 1, rotation: 0 });
      if (c.kf) ['x', 'y', 'scale', 'rotation'].forEach((k) => delete c.kf[k]);
      FL.changed();
    },
    revealMedia: (id) => {
      FL.dock.show('project');
      const el = bin.querySelector(`.media[data-id="${id}"]`);
      if (el) { bin.querySelectorAll('.media.sel').forEach((n) => n.classList.remove('sel')); el.classList.add('sel'); el.scrollIntoView({ block: 'nearest' }); }
    },

    title: () => {
      const clip = addClip(FL.makeTextClip({ font: 'Kohinoor Bangla' }));
      setTimeout(() => { const ta = document.querySelector('#inspector textarea'); if (ta) { ta.focus(); ta.select(); } }, 40);
      return clip;
    },
    adjustLayer: () => FL.insertGraphicItem('adjust', null, FL.time),
    colorMatte: () => FL.insertGraphicItem('matte', null, FL.time),
    addVideoTrack: () => { FL.pushUndo(); FL.addTrack('video'); FL.changed(); },
    addAudioTrack: () => { FL.pushUndo(); FL.addTrack('audio'); FL.changed(); },

    markIn: () => { FL.pushUndo(); const s = seq(); s.inPoint = FL.time; if (s.outPoint != null && s.outPoint <= s.inPoint) s.outPoint = null; FL.changed(); },
    markOut: () => { FL.pushUndo(); const s = seq(); s.outPoint = FL.time; if (s.inPoint != null && s.inPoint >= s.outPoint) s.inPoint = null; FL.changed(); },
    clearInOut: () => { FL.pushUndo(); seq().inPoint = null; seq().outPoint = null; FL.changed(); },
    goIn: () => { if (seq().inPoint != null) FL.seek(seq().inPoint); },
    goOut: () => { if (seq().outPoint != null) FL.seek(seq().outPoint); },
    addMarker: () => {
      const s = seq();
      const eps = 0.5 / FL.fps();
      if (s.markers.some((m) => Math.abs(m.t - FL.time) < eps)) return;
      FL.pushUndo();
      s.markers.push({ id: FL.uid('mk'), t: FL.time, name: '', color: '#3ddc84' });
      s.markers.sort((a, b) => a.t - b.t);
      FL.changed();
    },
    nextMarker: () => { const m = seq().markers.find((x) => x.t > FL.time + 1e-4); if (m) { FL.seek(m.t); FL.ensureVisible(m.t); } },
    prevMarker: () => { const m = seq().markers.filter((x) => x.t < FL.time - 1e-4).pop(); if (m) { FL.seek(m.t); FL.ensureVisible(m.t); } },
    toggleSnap: () => setSnap(!FL.snap),
    zoomIn: () => FL.zoomBy(1.5),
    zoomOut: () => FL.zoomBy(1 / 1.5),
    zoomFit: () => FL.zoomFit(),
    shortcuts: () => { $('#shortcuts-modal').hidden = false; },
    selectAll: () => { if (isTyping(document.activeElement)) return document.execCommand('selectAll'); FL.selectMany(seq().clips.map((c) => c.id)); FL.renderTimeline(); },
    deselect: () => { FL.select(null); FL.renderTimeline(); },

    duplicate: () => {
      const list = FL.selectedClips().filter((c) => !FL.isLocked(c));
      if (!list.length) return;
      FL.pushUndo();
      const end = Math.max(...list.map((c) => c.start + c.duration));
      const start = Math.min(...list.map((c) => c.start));
      const copies = FL.relink(list.map((c) => Object.assign(JSON.parse(JSON.stringify(c)), { id: FL.uid('clip'), start: c.start - start + end })));
      copies.forEach((d) => FL.placeClip(d, d.trackId, d.start));
      FL.selectMany(copies.map((d) => d.id));
      FL.changed();
    },
    copy: () => {
      const list = FL.selectedClips();
      if (!list.length) return;
      const start = Math.min(...list.map((c) => c.start));
      FL.clipboard = list.map((c) => Object.assign(JSON.parse(JSON.stringify(c)), { _off: c.start - start }));
      FL.toast(`${list.length} clip${list.length > 1 ? 's' : ''} copied`);
    },
    cut: () => { cmds.copy(); cmds.delete(); },
    paste: (trackId) => {
      const list = FL.clipboard;
      if (!list || !list.length) return;
      FL.pushUndo();
      const made = [];
      for (const src of list) {
        const kind = FL.kindFor(src.type);
        let track = list.length === 1 && trackId ? FL.track(trackId) : FL.track(src.trackId);
        if (!track || track.kind !== kind || track.locked) track = seq().tracks.find((t) => t.kind === kind && !t.locked) || FL.addTrack(kind);
        const d = Object.assign(JSON.parse(JSON.stringify(src)), { id: FL.uid('clip') });
        delete d._off;
        made.push(d);
        d._track = track.id;
      }
      FL.relink(made);
      for (const d of made) { const t = d._track; delete d._track; FL.placeClip(d, t, FL.time + list[made.indexOf(d)]._off); }
      FL.selectMany(made.map((d) => d.id), true);
      FL.changed();
      FL.seek(Math.max(...made.map((d) => d.start + d.duration)));
    },
    pasteAttributes: () => {
      const src = FL.clipboard && FL.clipboard[0];
      const list = FL.selectedClips();
      if (!src || !list.length) return FL.toast('Copy a clip first, then select clips to paste onto');
      FL.pushUndo();
      for (const c of list) {
        if (FL.isVisual(c) && FL.isVisual(src)) {
          for (const k of ['x', 'y', 'scale', 'rotation', 'opacity']) c[k] = src[k];
          c.kf = Object.assign({}, c.kf, Object.fromEntries(Object.entries(src.kf || {}).filter(([k]) => ['x', 'y', 'scale', 'rotation', 'opacity'].includes(k))));
          c.effects = c.effects.concat((src.effects || []).filter((e) => !FL.isAudioEffect(e.type)).map((e) => Object.assign(JSON.parse(JSON.stringify(e)), { id: FL.uid('fx') })));
        }
        if (FL.hasAudio(c) && FL.hasAudio(src)) {
          c.volume = src.volume; c.pan = src.pan;
          c.effects = c.effects.concat((src.effects || []).filter((e) => FL.isAudioEffect(e.type)).map((e) => Object.assign(JSON.parse(JSON.stringify(e)), { id: FL.uid('fx') })));
        }
      }
      FL.changed();
      FL.toast('Attributes pasted');
    },
    'panel:effects': () => { FL.dock.show('effects'); $('#fx-filter').focus(); },
    'panel:effectcontrols': () => { FL.dock.show('effectcontrols'); $('#inspector').scrollTop = 0; },
    maximize: () => FL.dock.toggleMax(),
    'ws:reset': () => FL.dock.reset(),
    toggleLinkSel: () => setLinkSel(!FL.linkSel),
  };
  for (const k of Object.keys(D.GRAPHICS)) cmds[`gfx:${k}`] = () => FL.insertGraphicItem(k, null, FL.time);
  for (const id of ['project', 'graphics', 'markers', 'source', 'program', 'timeline', 'meters']) cmds[`panel:${id}`] = () => FL.dock.show(id);
  for (const n of ['Editing', 'Effects', 'Assembly', 'Audio', 'Graphics', 'Classic']) cmds[`ws:${n}`] = () => FL.dock.workspace(n);
  FL.cmd = (name, arg) => { if (cmds[name]) cmds[name](arg); };
  api.onMenu((name) => FL.cmd(name));

  let lastClip = 0;
  const clipEvt = (name) => (e) => {
    if (isTyping(document.activeElement)) return;
    e.preventDefault();
    const now = Date.now();
    if (now - lastClip < 120) return;
    lastClip = now;
    FL.cmd(name);
  };
  document.addEventListener('copy', clipEvt('copy'));
  document.addEventListener('cut', clipEvt('cut'));
  document.addEventListener('paste', clipEvt('paste'));

  // ======================================================================
  // Keyboard (Premiere Pro defaults)
  // ======================================================================
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!$('#context-menu').hidden) return FL.hideMenu();
      const open = document.querySelector('.modal-backdrop:not([hidden])');
      if (open && open.id !== 'export-modal') { open.hidden = true; return; }
      if (isTyping(document.activeElement)) { document.activeElement.blur(); return; }
      if (FL.maskEdit) { FL.maskEdit = null; FL.renderInspector(); FL.requestDraw(); return; }
      FL.select(null);
      FL.renderTimeline();
      return;
    }
    if (isTyping(e.target) || document.querySelector('.modal-backdrop:not([hidden])')) return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod) {
      const k = e.key.toLowerCase();
      if (k === 'c' || k === 'x' || k === 'v') {
        if (k === 'v' && e.altKey) return;
        const now = Date.now();
        if (now - lastClip > 120) { lastClip = now; FL.cmd({ c: 'copy', x: 'cut', v: 'paste' }[k]); }
        e.preventDefault();
      }
      return;
    }
    const step = FL.frame();
    const k = e.key;
    const lower = k.length === 1 ? k.toLowerCase() : k;
    if (k === '`' || e.code === 'Backquote') { e.preventDefault(); return FL.dock.toggleMax(); }
    // Like Premiere, keys go to the focused panel (blue outline). Source has its own transport.
    if (FL.focusPanel === 'source') {
      if (k === ' ') { e.preventDefault(); return FL.sourceToggle(); }
      if (lower === 'i') return e.shiftKey ? FL.sourceGo('in') : FL.sourceMark('in');
      if (lower === 'o') return e.shiftKey ? FL.sourceGo('out') : FL.sourceMark('out');
      if ((lower === 'x' && e.altKey) || k === '≈') return FL.sourceClear();
      if (lower === 'j' || lower === 'k' || lower === 'l') return FL.sourceShuttle(lower);
      if (k === 'ArrowLeft') { e.preventDefault(); return FL.sourceStep(e.shiftKey ? -5 : -1); }
      if (k === 'ArrowRight') { e.preventDefault(); return FL.sourceStep(e.shiftKey ? 5 : 1); }
      if (k === 'Home') return FL.sourceGo('in');
    }
    switch (lower) {
      case ' ': e.preventDefault(); FL.togglePlay(); break;
      case 'k': if (FL.playing) FL.pause(); break;
      case 'l': if (!FL.playing) FL.play(); break;
      case 'j': if (FL.playing) FL.pause(); FL.seek(FL.time - 1); break;
      case 'ArrowLeft': e.preventDefault(); if (FL.playing) FL.pause(); FL.seek(FL.time - (e.shiftKey ? 5 * step : step)); FL.ensureVisible(FL.time); break;
      case 'ArrowRight': e.preventDefault(); if (FL.playing) FL.pause(); FL.seek(FL.time + (e.shiftKey ? 5 * step : step)); FL.ensureVisible(FL.time); break;
      case 'ArrowUp': { e.preventDefault(); const p = FL.editPoints().filter((x) => x < FL.time - 1e-4).pop(); FL.seek(p ?? 0); FL.ensureVisible(FL.time); break; }
      case 'ArrowDown': { e.preventDefault(); const p = FL.editPoints().find((x) => x > FL.time + 1e-4); if (p !== undefined) FL.seek(p); FL.ensureVisible(FL.time); break; }
      case 'Home': FL.seek(0); FL.ensureVisible(0); break;
      case 'End': FL.seek(FL.duration()); FL.ensureVisible(FL.time); break;
      case 'Delete': case 'Backspace': e.preventDefault(); FL.cmd(e.shiftKey ? 'rippleDelete' : 'delete'); break;
      case 'v': setTool('select'); break;
      case 'a': setTool('trackfwd'); break;
      case 'b': setTool('ripple'); break;
      case 'n': setTool('rolling'); break;
      case 'r': setTool('rate'); break;
      case 'c': setTool('razor'); break;
      case 'y': setTool('slip'); break;
      case 't': FL.cmd('title'); break;
      case 's': if (!e.shiftKey) setSnap(!FL.snap); break;
      case 'm': FL.cmd(e.shiftKey ? (e.altKey ? 'prevMarker' : 'nextMarker') : 'addMarker'); break;
      case 'i': FL.cmd(e.shiftKey ? 'goIn' : 'markIn'); break;
      case 'o': FL.cmd(e.shiftKey ? 'goOut' : 'markOut'); break;
      case 'x': if (e.altKey) FL.cmd('clearInOut'); break;
      case '≈': FL.cmd('clearInOut'); break;
      case 'q': FL.cmd('rippleTrimPrev'); break;
      case 'w': FL.cmd('rippleTrimNext'); break;
      case 'e': if (e.shiftKey) FL.cmd('toggleFx'); break;
      case ',': FL.sourceEdit('insert'); break;
      case '.': FL.sourceEdit('overwrite'); break;
      case ';': FL.cmd('lift'); break;
      case "'": FL.cmd('extract'); break;
      case '=': case '+': FL.zoomBy(1.5); break;
      case '-': case '_': FL.zoomBy(1 / 1.5); break;
      case '\\': FL.zoomFit(); break;
      default: {
        // Shift+1…7 open panels (Premiere's defaults); uses the physical key so any keyboard layout works
        const map = { Digit1: 'project', Digit2: 'source', Digit3: 'timeline', Digit4: 'program', Digit5: 'effectcontrols', Digit6: 'meters', Digit7: 'effects' };
        if (e.shiftKey && !e.altKey && map[e.code]) FL.dock.show(map[e.code]);
      }
    }
  });

  // ======================================================================
  // Toolbar, transport, misc UI
  // ======================================================================
  function setTool(t) {
    FL.tool = t;
    document.querySelectorAll('.tool[data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === t));
    document.body.dataset.tool = t;
  }
  function setSnap(v) { FL.snap = v; $('#snap-toggle').classList.toggle('active', v); }
  function setLinkSel(v) {
    FL.linkSel = v;
    $('#link-toggle').classList.toggle('active', v);
    try { localStorage.setItem('fl-linksel', v ? '1' : '0'); } catch (_) {}
    FL.toast(v ? 'Linked Selection on — video and its audio select together' : 'Linked Selection off — click picks one side');
  }
  try { if (localStorage.getItem('fl-linksel') === '0') { FL.linkSel = false; $('#link-toggle').classList.remove('active'); } } catch (_) {}
  $('#link-toggle').onclick = () => setLinkSel(!FL.linkSel);
  setTool('select');
  document.querySelectorAll('.tool[data-tool]').forEach((b) => { b.onclick = () => setTool(b.dataset.tool); });
  $('#snap-toggle').onclick = () => setSnap(!FL.snap);
  $('#tl-marker').onclick = () => FL.cmd('addMarker');
  $('#add-vtrack').onclick = () => FL.cmd('addVideoTrack');
  $('#add-atrack').onclick = () => FL.cmd('addAudioTrack');
  $('#btn-import').onclick = importDialog;
  $('#btn-import-2').onclick = importDialog;
  $('#btn-export').onclick = openExport;

  $('#t-play').onclick = () => FL.togglePlay();
  $('#t-back').onclick = () => { if (FL.playing) FL.pause(); FL.seek(FL.time - FL.frame()); };
  $('#t-fwd').onclick = () => { if (FL.playing) FL.pause(); FL.seek(FL.time + FL.frame()); };
  $('#t-prev').onclick = () => { const p = FL.editPoints().filter((x) => x < FL.time - 1e-4).pop(); FL.seek(p ?? 0); FL.ensureVisible(FL.time); };
  $('#t-next').onclick = () => { const p = FL.editPoints().find((x) => x > FL.time + 1e-4); if (p !== undefined) { FL.seek(p); FL.ensureVisible(p); } };
  $('#t-marker').onclick = () => FL.cmd('addMarker');
  $('#t-in').onclick = () => FL.cmd('markIn');
  $('#t-out').onclick = () => FL.cmd('markOut');
  $('#t-lift').onclick = () => FL.cmd('lift');
  $('#t-extract').onclick = () => FL.cmd('extract');
  $('#t-frame').onclick = () => FL.cmd('exportFrame');
  $('#preview-quality').onchange = (e) => FL.setPreviewQuality(+e.target.value);

  FL.on('playstate', (playing) => {
    $('#t-play').innerHTML = `<i class="ic ic-${playing ? 'pause' : 'play'}"></i>`;
    $('#t-play').classList.toggle('active', playing);
  });
  FL.on('time', (t) => { $('#tc-current').textContent = FL.timecode(t); $('#tl-tc').textContent = FL.timecode(t); });
  function updateInfo() {
    const s = FL.S();
    const sq = seq();
    const inout = sq.inPoint != null || sq.outPoint != null;
    $('#tc-duration').textContent = FL.timecode(inout ? (sq.outPoint ?? FL.duration()) - (sq.inPoint ?? 0) : FL.duration());
    $('#tc-current').textContent = FL.timecode(FL.time);
    $('#tl-tc').textContent = FL.timecode(FL.time);
  }
  FL.on('change', () => { updateInfo(); renderBin(); });
  FL.on('seq', updateInfo);
  FL.on('title', (name, dirty) => { $('#docname').innerHTML = `${FL.esc(name)}${dirty ? '<span class="edited">Edited</span>' : ''}`; });

  // context menu
  const menu = $('#context-menu');
  FL.showMenu = (x, y, items) => {
    menu.innerHTML = items.map((it, i) => (it.sep ? '<div class="sep"></div>'
      : `<button data-i="${i}" ${it.disabled ? 'disabled' : ''}><span>${FL.esc(it.label)}</span>${it.key ? `<kbd>${it.key}</kbd>` : ''}</button>`)).join('');
    menu.hidden = false;
    const r = menu.getBoundingClientRect();
    menu.style.left = Math.max(4, Math.min(x, innerWidth - r.width - 6)) + 'px';
    menu.style.top = Math.max(4, Math.min(y, innerHeight - r.height - 6)) + 'px';
    menu.onclick = (e) => {
      const b = e.target.closest('button[data-i]');
      if (!b) return;
      FL.hideMenu();
      items[+b.dataset.i].act();
    };
  };
  FL.hideMenu = () => { menu.hidden = true; };
  window.addEventListener('pointerdown', (e) => { if (!menu.contains(e.target)) FL.hideMenu(); });
  window.addEventListener('blur', FL.hideMenu);

  document.querySelectorAll('[data-close]').forEach((b) => {
    b.onclick = () => { const m = b.closest('.modal-backdrop'); if (m.id === 'export-modal') closeExport(); else m.hidden = true; };
  });

  const SHORTCUTS = [
    ['Tools', [['V', 'Selection'], ['A', 'Track Select Forward'], ['B', 'Ripple Edit'], ['N', 'Rolling Edit'], ['R', 'Rate Stretch'], ['C', 'Razor'], ['Y', 'Slip'], ['T', 'Type (new title)']]],
    ['Playback', [['Space', 'Play / Stop'], ['K / L', 'Stop / Play'], ['J', 'Back 1 second'], ['← →', 'Step one frame'], ['⇧← ⇧→', 'Step five frames'], ['↑ ↓', 'Previous / next edit'], ['Home / End', 'Start / end of sequence']]],
    ['Editing', [['⌘K', 'Add Edit'], ['⇧⌘K', 'Add Edit to All Tracks'], ['Q / W', 'Ripple trim previous / next edit to playhead'], ['⌫ / ⇧⌫', 'Clear / Ripple Delete'], ['⌘D', 'Apply Cross Dissolve'], ['⇧⌘D', 'Apply Constant Power crossfade'], ['⌥-drag', 'Duplicate clips'], ['⌘-drag edge', 'Ripple trim'], ['⌥⌘V', 'Paste Attributes'], ['⌘L', 'Detach Audio'], ['⇧E', 'Enable / disable effects']]],
    ['Marking', [['I / O', 'Mark In / Out'], ['⇧I / ⇧O', 'Go to In / Out'], ['⌥X', 'Clear In and Out'], ['; / \'', 'Lift / Extract'], ['M', 'Add Marker'], ['⇧M / ⌥⇧M', 'Next / previous marker'], [', / .', 'Insert / Overwrite from Source'], ['⌘ while dropping', 'Insert instead of overwrite']]],
    ['Panels', [['Click a panel', 'Focus it (keys go to the focused panel)'], ['Drag a tab', 'Move the panel anywhere: middle = join, edge = dock beside'], ['⌘-drag a tab', 'Float the panel'], ['`', 'Maximize / restore panel'], ['⌘L', 'Link / Unlink video and audio'], ['⌥-click', 'Select only the video or the audio']]],
    ['Timeline', [['S', 'Snap on/off'], ['= / −', 'Zoom in / out'], ['\\', 'Zoom to sequence'], ['⌥ + scroll', 'Zoom at pointer'], ['Shift while dragging', 'Bypass snapping']]],
    ['Project', [['⌘N', 'New Sequence'], ['⌥⌘N', 'New Project'], ['⌘O / ⌘S', 'Open / Save'], ['⌘I', 'Import'], ['⌘M', 'Export Media'], ['⇧⌘E', 'Export Frame'], ['⌘T', 'New Title'], ['⌘Z / ⇧⌘Z', 'Undo / Redo']]],
  ];
  $('#shortcuts-list').innerHTML = SHORTCUTS.map(([g, list]) => `<div class="sc-group"><h3>${g}</h3>${list.map(([k, d]) => `<div class="sc"><kbd>${k}</kbd><span>${d}</span></div>`).join('')}</div>`).join('');

  // ======================================================================
  // Sequence settings
  // ======================================================================
  const PRESETS = [
    ['1080p HD — 1920×1080', 1920, 1080], ['4K UHD — 3840×2160', 3840, 2160], ['720p HD — 1280×720', 1280, 720],
    ['Vertical (Reels / Shorts / TikTok) — 1080×1920', 1080, 1920], ['Square — 1080×1080', 1080, 1080], ['Portrait 4:5 — 1080×1350', 1080, 1350],
  ];
  function openSeqSettings() {
    const s = seq();
    const st = s.settings;
    const pi = PRESETS.findIndex((p) => p[1] === st.width && p[2] === st.height);
    $('#seq-form').innerHTML = `
      <label class="field"><span>Sequence name</span><input type="text" id="sq-name" value="${FL.esc(s.name)}"></label>
      <label class="field"><span>Frame size</span><select id="sq-preset">${PRESETS.map((p, i) => `<option value="${i}" ${i === pi ? 'selected' : ''}>${p[0]}</option>`).join('')}<option value="-1" ${pi < 0 ? 'selected' : ''}>Custom</option></select></label>
      <div class="row2"><label class="field"><span>Width</span><input type="number" id="sq-w" value="${st.width}" step="2" min="16"></label>
      <label class="field"><span>Height</span><input type="number" id="sq-h" value="${st.height}" step="2" min="16"></label></div>
      <div class="row2"><label class="field"><span>Timebase</span><select id="sq-fps">${[23.976, 24, 25, 29.97, 30, 50, 59.94, 60].map((f) => `<option ${f === st.fps ? 'selected' : ''}>${f}</option>`).join('')}</select></label>
      <label class="field"><span>Background</span><input type="color" id="sq-bg" value="${st.bg}"></label></div>`;
    $('#sq-preset').onchange = (e) => { const p = PRESETS[+e.target.value]; if (p) { $('#sq-w').value = p[1]; $('#sq-h').value = p[2]; } };
    $('#seq-modal').hidden = false;
    $('#seq-ok').onclick = () => {
      FL.pushUndo();
      s.name = $('#sq-name').value.trim() || s.name;
      st.width = Math.max(16, Math.round(+$('#sq-w').value / 2) * 2);
      st.height = Math.max(16, Math.round(+$('#sq-h').value / 2) * 2);
      st.fps = +$('#sq-fps').value;
      st.bg = $('#sq-bg').value;
      $('#seq-modal').hidden = true;
      FL.changed();
      FL.emit('seq');
    };
  }

  // ======================================================================
  // Save / open
  // ======================================================================
  async function saveProject(as) {
    const data = JSON.parse(JSON.stringify(FL.project));
    data.media.forEach((m) => { delete m.missing; });
    const p = await api.saveProject(data, as ? null : FL.filePath);
    if (!p) return false;
    FL.filePath = p;
    FL.setDirty(false);
    FL.toast('Project saved');
    return true;
  }
  function loadProject(data, filePath) {
    if (FL.playing) FL.pause();
    FL.project = FL.migrate(data);
    FL.filePath = filePath;
    FL.undoStack = [];
    FL.redoStack = [];
    FL.sel.clear();
    FL.selectedId = null;
    FL.selTrans = null;
    FL.time = 0;
    FL.emit('seq');
    FL.emit('change', {});
    FL.emit('select', null);
    FL.emit('time', 0);
    FL.setDirty(false);
    FL.project.media.forEach((m) => ensureAssets(m));
    setTimeout(() => FL.zoomFit(), 60);
  }
  FL.loadProject = loadProject;
  api.onProjectLoaded(async ({ path, data }) => { if (await api.confirmDiscard()) loadProject(data, path); });

  // ======================================================================
  // Export
  // ======================================================================
  const exModal = $('#export-modal');
  let exporting = false;
  let exportPath = null;

  function exportSeq() { return FL.project.sequences.find((s) => s.id === $('#ex-seq').value) || seq(); }
  function fillExportOptions() {
    const s = exportSeq().settings;
    const res = [1, 2, 2 / 3, 0.5].map((k) => {
      const w = Math.round((s.width * k) / 2) * 2;
      const h = Math.round((s.height * k) / 2) * 2;
      return { k, w, h, label: `${w}×${h}${k === 1 ? ' (match sequence)' : ''}` };
    }).filter((r, i, a) => a.findIndex((x) => x.w === r.w) === i && r.w <= 7680);
    $('#ex-res').innerHTML = res.map((r) => `<option value="${r.w}x${r.h}" ${r.k === 1 ? 'selected' : ''}>${r.label}</option>`).join('');
    const fpsList = [...new Set([s.fps, 24, 25, 30, 60])];
    $('#ex-fps').innerHTML = fpsList.map((f) => `<option value="${f}" ${f === s.fps ? 'selected' : ''}>${f}${f === s.fps ? ' (match sequence)' : ''} fps</option>`).join('');
    const sq = exportSeq();
    const hasIO = sq.inPoint != null || sq.outPoint != null;
    $('#ex-range').value = hasIO ? 'inout' : 'all';
    $('#ex-range').querySelector('[value="inout"]').disabled = !hasIO;
    updateSummary();
  }
  function rangeOf(sq) {
    if ($('#ex-range').value !== 'inout') return null;
    const end = FL.duration(sq);
    return { start: sq.inPoint ?? 0, end: Math.min(end, sq.outPoint ?? end) };
  }
  function openExport() {
    if (!seq().clips.length) return FL.toast('Add some clips to the timeline first');
    if (FL.playing) FL.pause();
    $('#ex-seq').innerHTML = FL.project.sequences.map((s) => `<option value="${s.id}" ${s.id === FL.project.activeSeq ? 'selected' : ''}>${FL.esc(s.name)}</option>`).join('');
    fillExportOptions();
    if (!exportPath) $('#ex-path').placeholder = `${FL.projectName()} - ${seq().name}.mp4`;
    $('#export-form').hidden = false;
    $('#export-progress').hidden = true;
    $('#ex-start').hidden = false;
    $('#ex-start').textContent = 'Export';
    delete $('#ex-start').dataset.mode;
    $('#ex-cancel').textContent = 'Cancel';
    exModal.hidden = false;
  }
  function updateSummary() {
    const sq = exportSeq();
    const r = rangeOf(sq);
    const dur = r ? r.end - r.start : FL.duration(sq);
    const [w, h] = $('#ex-res').value.split('x').map(Number);
    const mbps = { high: 0.12, standard: 0.075, draft: 0.04 }[$('#ex-quality').value] * (w * h * +$('#ex-fps').value) / 1e6;
    const mb = ((mbps + 0.192) * dur) / 8;
    $('#ex-summary').innerHTML = `<span>Duration <b>${FL.timecode(dur)}</b></span><span>Estimated size <b>~${mb < 1 ? mb.toFixed(1) : Math.round(mb)} MB</b></span>`;
  }
  ['#ex-res', '#ex-fps', '#ex-quality', '#ex-range'].forEach((s) => $(s).addEventListener('change', updateSummary));
  $('#ex-seq').addEventListener('change', fillExportOptions);
  async function browse() {
    const name = $('#ex-path').value || $('#ex-path').placeholder;
    const p = await api.pickExportPath(basename(name));
    if (p) { exportPath = p; $('#ex-path').value = p; }
    return p;
  }
  $('#ex-browse').onclick = browse;
  $('#ex-path').onclick = browse;
  function closeExport() { if (exporting) { api.cancelExport(); return; } exModal.hidden = true; }
  $('#ex-cancel').onclick = closeExport;

  $('#ex-start').onclick = async () => {
    if ($('#ex-start').dataset.mode === 'reveal') { api.reveal(exportPath); return; }
    if (!exportPath && !(await browse())) return;
    const sq = exportSeq();
    const missing = FL.project.media.filter((m) => m.missing && sq.clips.some((c) => c.mediaId === m.id));
    if (missing.length) return FL.toast(`Media offline: ${missing[0].name}`);
    const [w, h] = $('#ex-res').value.split('x').map(Number);

    // assets are drawn in the context of the exported sequence
    const prevActive = FL.project.activeSeq;
    FL.project.activeSeq = sq.id;
    let assets;
    try { assets = FL.R.exportAssets(sq); } finally { FL.project.activeSeq = prevActive; }

    exporting = true;
    $('#export-form').hidden = true;
    $('#export-progress').hidden = false;
    $('#ex-start').hidden = true;
    $('#ex-cancel').textContent = 'Stop';
    $('#ex-bar').style.width = '0%';
    $('#ex-bar').classList.remove('done', 'fail');
    $('#ex-pct').textContent = 'Starting…';
    $('#ex-eta').textContent = '';
    $('#ex-result').innerHTML = '';

    const result = await api.startExport({
      project: JSON.parse(JSON.stringify(FL.project)),
      seqId: sq.id,
      options: { width: w, height: h, fps: +$('#ex-fps').value, quality: $('#ex-quality').value, range: rangeOf(sq) },
      images: assets.images,
      meta: assets.meta,
      outPath: exportPath,
    });
    exporting = false;
    $('#ex-cancel').textContent = 'Close';
    if (result.ok) {
      $('#ex-bar').style.width = '100%';
      $('#ex-bar').classList.add('done');
      $('#ex-pct').textContent = 'Done';
      $('#ex-eta').textContent = `${Math.round(result.seconds)}s`;
      $('#ex-result').innerHTML = `<p class="ok">Saved to <b>${FL.esc(basename(result.path))}</b></p>`;
      $('#ex-start').hidden = false;
      $('#ex-start').textContent = api.platform === 'darwin' ? 'Show in Finder' : 'Show File';
      $('#ex-start').dataset.mode = 'reveal';
    } else if (result.cancelled) {
      $('#ex-pct').textContent = 'Export stopped';
      $('#ex-bar').classList.add('fail');
    } else {
      $('#ex-bar').classList.add('fail');
      $('#ex-pct').textContent = 'Export failed';
      $('#ex-result').innerHTML = `<pre class="err">${FL.esc(result.error)}</pre>`;
    }
  };
  api.onExportProgress(({ pct, eta }) => {
    $('#ex-bar').style.width = (pct * 100).toFixed(1) + '%';
    $('#ex-pct').textContent = `${Math.round(pct * 100)}%`;
    $('#ex-eta').textContent = eta != null ? `about ${eta > 90 ? Math.round(eta / 60) + ' min' : Math.max(1, Math.round(eta)) + ' s'} left` : '';
  });

  // ======================================================================
  // Startup
  // ======================================================================
  updateInfo();
  renderBin();
  FL.setDirty(false);
  FL.emit('time', 0);

  // Used only by automated screenshot tests (FRAMELINE_DEMO=<folder>).
  window.__demo = async (dir) => {
    const files = ['clipA.mp4', 'vertical.mp4', 'photo.jpg', 'music.mp3', 'portrait_src.mp4'].map((f) => dir + '/' + f);
    const [a, v, p, mu, b] = await FL.importPaths(files);
    await new Promise((r) => setTimeout(r, 1500));
    const V = FL.vTracks();
    const A = FL.aTracks();
    FL.placeMedia(a, { time: 0, dropTrack: V[0] });
    FL.placeMedia(b, { time: 8, dropTrack: V[0] });
    FL.placeMedia(p, { time: 14, dropTrack: V[0] });
    const pip = FL.placeMedia(v, { time: 2, dropTrack: V[1], part: 'video' })[0];
    Object.assign(pip, { scale: 0.45, x: 560, y: -150 });
    pip.kf = { x: [{ t: 0, v: 760 }, { t: 1.5, v: 560 }] };
    FL.placeMedia(mu, { time: 1, dropTrack: A[1] });
    const c2 = FL.seq().clips.find((c) => c.mediaId === b.id);
    c2.transIn = { type: 'crossdissolve', duration: 1 };
    const c1 = FL.seq().clips.find((c) => c.mediaId === a.id && c.type === 'video');
    c1.effects.push(FL.makeEffect('lumetri', D.LOOKS['Cinematic Warm']));
    FL.insertGraphicItem('headline', null, 0.5);
    FL.seq().clips[FL.seq().clips.length - 1].duration = 12;
    FL.seq().markers.push({ id: 'm1', t: 6, name: 'Interview', color: '#ffd34d' });
    FL.changed();
    FL.zoomFit();
    FL.select(c1.id);
    FL.seek(3.2);
  };
})();
