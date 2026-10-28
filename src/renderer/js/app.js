/* Frameline — app shell: Project panel, importing, commands, keyboard,
   menus, panel splitters, save/open and the Export dialog. */
'use strict';

(() => {
  const api = window.api;
  const $ = (s) => document.querySelector(s);
  const bin = $('#bin');
  const binEmpty = $('#bin-empty');
  const basename = (p) => p.split(/[\\/]/).pop();
  const isTyping = (el) => el && (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' ||
    (el.tagName === 'INPUT' && !['range', 'checkbox', 'button', 'color'].includes(el.type)) || el.isContentEditable);

  document.body.classList.toggle('mac', api.platform === 'darwin');

  // ======================================================================
  // Project panel (media bin)
  // ======================================================================
  const status = {}; // mediaId -> 'proxy' | 'error'

  function renderBin() {
    const q = $('#bin-filter').value.trim().toLowerCase();
    const items = FL.project.media.filter((m) => !q || m.name.toLowerCase().includes(q));
    $('#media-count').textContent = `${FL.project.media.length} item${FL.project.media.length === 1 ? '' : 's'}`;
    binEmpty.hidden = FL.project.media.length > 0;
    bin.querySelectorAll('.media').forEach((n) => n.remove());
    for (const m of items) {
      const used = FL.project.clips.some((c) => c.mediaId === m.id);
      const el = document.createElement('div');
      el.className = `media ${m.type}${m.missing ? ' missing' : ''}`;
      el.draggable = true;
      el.dataset.id = m.id;
      el.title = m.path;
      const st = status[m.id];
      el.innerHTML = `
        <div class="media-thumb">${m.thumb ? `<img src="${api.fileUrl(m.thumb)}" draggable="false">` : `<i class="ic ic-${m.type === 'audio' ? 'audio' : m.type}"></i>`}
          ${m.type !== 'image' ? `<span class="media-dur">${FL.timecode(m.duration).slice(3)}</span>` : ''}
          ${st === 'proxy' ? '<span class="media-status">Preparing preview…</span>' : ''}
          ${m.missing ? '<span class="media-status err">Media offline</span>' : ''}
          ${used ? '<span class="media-used" title="Used in sequence"></span>' : ''}
        </div>
        <div class="media-name"><i class="ic ic-${m.type === 'audio' ? 'audio' : m.type}"></i><span>${FL.esc(m.name)}</span></div>`;
      bin.appendChild(el);
    }
  }
  FL.renderBin = renderBin;
  $('#bin-filter').addEventListener('input', renderBin);

  bin.addEventListener('dragstart', (e) => {
    const el = e.target.closest('.media');
    if (!el) return;
    FL.dragMedia = el.dataset.id;
    e.dataTransfer.setData('application/x-fl-media', el.dataset.id);
    e.dataTransfer.effectAllowed = 'copy';
    const img = el.querySelector('.media-thumb');
    if (img) e.dataTransfer.setDragImage(img, 40, 24);
  });
  bin.addEventListener('dragend', () => { FL.dragMedia = null; });
  bin.addEventListener('click', (e) => {
    const el = e.target.closest('.media');
    bin.querySelectorAll('.media.sel').forEach((n) => n.classList.remove('sel'));
    if (el) el.classList.add('sel');
  });
  bin.addEventListener('dblclick', (e) => {
    const el = e.target.closest('.media');
    if (el) FL.insertMedia(FL.media(el.dataset.id), null, FL.time);
  });
  bin.addEventListener('contextmenu', (e) => {
    const el = e.target.closest('.media');
    if (!el) return;
    e.preventDefault();
    const m = FL.media(el.dataset.id);
    FL.showMenu(e.clientX, e.clientY, [
      { label: 'Insert at Playhead', act: () => FL.insertMedia(m, null, FL.time) },
      { label: 'Reveal in Finder', act: () => api.reveal(m.path) },
      { sep: true },
      { label: 'Remove from Project', act: () => {
        FL.pushUndo();
        FL.project.clips = FL.project.clips.filter((c) => c.mediaId !== m.id);
        FL.project.media = FL.project.media.filter((x) => x.id !== m.id);
        if (FL.selectedId && !FL.clip(FL.selectedId)) FL.selectedId = null;
        FL.changed();
      } },
    ]);
  });

  // ======================================================================
  // Importing
  // ======================================================================
  function canPlay(m) {
    return new Promise((resolve) => {
      const url = api.fileUrl(m.path);
      const done = (ok) => { clearTimeout(t); el.removeAttribute('src'); try { el.load(); } catch (_) {} resolve(ok); };
      let el;
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
      const t = setTimeout(() => done(true), 10000);
      el.src = url;
    });
  }

  async function ensureAssets(m) {
    const exists = await api.exists(m.path);
    m.missing = !exists;
    if (!exists) { renderBin(); return; }
    const jobs = [];
    if (m.hasVideo && (!m.thumb || !(await api.exists(m.thumb)))) {
      jobs.push(api.thumb(m.path, m.type, m.duration).then((p) => { m.thumb = p; }).catch(() => {}));
    }
    if (m.hasAudio && (!m.wave || !(await api.exists(m.wave)))) {
      jobs.push(api.wave(m.path).then((p) => { m.wave = p; }).catch(() => {}));
    }
    if (m.proxy && !(await api.exists(m.proxy))) m.proxy = null;
    if (!m.proxy) {
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
  FL.ensureAssets = ensureAssets;

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

  // whole-window file drop (timeline lanes handle their own drops)
  const overlay = $('#drop-overlay');
  let dragDepth = 0;
  window.addEventListener('dragenter', (e) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    dragDepth++;
    overlay.hidden = false;
  });
  window.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) overlay.hidden = true; });
  window.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); });
  window.addEventListener('drop', (e) => {
    dragDepth = 0;
    overlay.hidden = true;
    if (!e.dataTransfer.files.length) return;
    e.preventDefault();
    const paths = [...e.dataTransfer.files].map((f) => api.pathForFile(f)).filter(Boolean);
    FL.importPaths(paths);
  });
  // overlay is purely visual; let drops pass to the timeline
  overlay.addEventListener('dragover', (e) => e.preventDefault());

  // ======================================================================
  // Commands
  // ======================================================================
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
    undo: () => (isTyping(document.activeElement) ? document.execCommand('undo') : FL.undo()),
    redo: () => (isTyping(document.activeElement) ? document.execCommand('redo') : FL.redo()),
    split: () => {
      const t = FL.time;
      const sel = FL.selected();
      const targets = sel && t > sel.start && t < sel.start + sel.duration
        ? [sel]
        : FL.project.clips.filter((c) => t > c.start && t < c.start + c.duration && !FL.isLocked(c));
      if (!targets.length) return FL.toast('Nothing under the playhead to split');
      FL.pushUndo();
      targets.forEach((c) => FL.splitClip(c, t));
      FL.changed();
    },
    delete: () => { const c = FL.selected(); if (!c || FL.isLocked(c)) return; FL.pushUndo(); FL.deleteClip(c.id); FL.changed(); FL.emit('select', null); },
    rippleDelete: () => { const c = FL.selected(); if (!c || FL.isLocked(c)) return; FL.pushUndo(); FL.deleteClip(c.id, true); FL.changed(); FL.emit('select', null); },
    detachAudio: () => {
      const c = FL.selected();
      const m = c && FL.media(c.mediaId);
      if (!c || c.type !== 'video' || !m || !m.hasAudio || c.muted) return FL.toast('Select a video clip that has sound');
      FL.pushUndo();
      const end = c.start + c.duration;
      let track = FL.project.tracks.find((t) => t.kind === 'audio' && !t.locked &&
        !FL.project.clips.some((o) => o.trackId === t.id && o.start < end && o.start + o.duration > c.start));
      if (!track) track = FL.addTrack('audio');
      const a = FL.makeClip({ type: 'audio', mediaId: c.mediaId, start: c.start, duration: c.duration, in: c.in, speed: c.speed,
        volume: c.volume, fadeIn: c.fadeIn, fadeOut: c.fadeOut });
      FL.placeClip(a, track.id, c.start);
      c.muted = true;
      FL.changed();
      FL.toast(`Audio moved to ${track.name}`);
    },
    title: () => {
      const t = FL.time;
      const tracks = FL.project.tracks.filter((tr) => tr.kind === 'video' && !tr.locked);
      let track = tracks.find((tr) => !FL.project.clips.some((o) => o.trackId === tr.id && o.start < t + 5 && o.start + o.duration > t));
      if (!track) track = FL.addTrack('video');
      FL.pushUndo();
      const clip = FL.makeTextClip({});
      FL.placeClip(clip, track.id, t);
      FL.selectedId = clip.id;
      FL.changed();
      FL.emit('select', clip.id);
      setTimeout(() => { const ta = document.querySelector('#inspector textarea'); if (ta) { ta.focus(); ta.select(); } }, 30);
    },
    addVideoTrack: () => { FL.pushUndo(); FL.addTrack('video'); FL.changed(); },
    addAudioTrack: () => { FL.pushUndo(); FL.addTrack('audio'); FL.changed(); },
    settings: () => FL.select(null),
    zoomIn: () => FL.zoomBy(1.5),
    zoomOut: () => FL.zoomBy(1 / 1.5),
    zoomFit: () => FL.zoomFit(),
    shortcuts: () => { $('#shortcuts-modal').hidden = false; },
    duplicate: () => {
      const c = FL.selected();
      if (!c || FL.isLocked(c)) return;
      FL.pushUndo();
      const d = Object.assign(JSON.parse(JSON.stringify(c)), { id: FL.uid('clip') });
      FL.placeClip(d, c.trackId, c.start + c.duration);
      FL.selectedId = d.id;
      FL.changed();
      FL.emit('select', d.id);
    },
    copy: () => { const c = FL.selected(); if (c) { FL.clipboard = JSON.parse(JSON.stringify(c)); FL.toast('Clip copied'); } },
    cut: () => { const c = FL.selected(); if (c) { FL.clipboard = JSON.parse(JSON.stringify(c)); cmds.delete(); } },
    paste: (trackId) => {
      const src = FL.clipboard;
      if (!src) return;
      const kind = FL.kindFor(src.type);
      let track = trackId && FL.track(trackId);
      if (!track || track.kind !== kind || track.locked) track = FL.track(src.trackId);
      if (!track || track.kind !== kind || track.locked) track = FL.project.tracks.find((t) => t.kind === kind && !t.locked);
      if (!track) return;
      FL.pushUndo();
      const d = Object.assign(JSON.parse(JSON.stringify(src)), { id: FL.uid('clip') });
      FL.placeClip(d, track.id, FL.time);
      FL.selectedId = d.id;
      FL.changed();
      FL.emit('select', d.id);
      FL.seek(d.start + d.duration);
    },
    quickFade: () => {
      const c = FL.selected();
      if (!c) return;
      FL.pushUndo();
      const f = Math.min(0.5, c.duration / 3);
      c.fadeIn = f;
      c.fadeOut = f;
      FL.changed();
    },
    resetMotion: () => {
      const c = FL.selected();
      if (!c) return;
      FL.pushUndo();
      Object.assign(c, { x: 0, y: 0, scale: 1, rotation: 0 });
      FL.changed();
    },
  };
  FL.cmd = (name, arg) => { if (cmds[name]) cmds[name](arg); };
  api.onMenu((name) => FL.cmd(name));

  // clipboard events from the Edit menu (and ⌘C/⌘X/⌘V)
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
  // Keyboard
  // ======================================================================
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!$('#context-menu').hidden) return FL.hideMenu();
      const open = document.querySelector('.modal-backdrop:not([hidden])');
      if (open && open.id !== 'export-modal') { open.hidden = true; return; }
      if (isTyping(document.activeElement)) { document.activeElement.blur(); return; }
      FL.select(null);
      return;
    }
    if (isTyping(e.target) || document.querySelector('.modal-backdrop:not([hidden])')) return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod) {
      const k = e.key.toLowerCase();
      if (k === 'c' || k === 'x' || k === 'v') {
        const now = Date.now();
        if (now - lastClip > 120) { lastClip = now; FL.cmd({ c: 'copy', x: 'cut', v: 'paste' }[k]); }
        e.preventDefault();
      }
      return;
    }
    const step = FL.frame();
    switch (e.key) {
      case ' ': e.preventDefault(); FL.togglePlay(); break;
      case 'k': case 'K': if (FL.playing) FL.pause(); break;
      case 'l': case 'L': if (!FL.playing) FL.play(); break;
      case 'j': case 'J': FL.seek(FL.time - 1); break;
      case 'ArrowLeft': e.preventDefault(); if (FL.playing) FL.pause(); FL.seek(FL.time - (e.shiftKey ? 1 : step)); FL.ensureVisible(FL.time); break;
      case 'ArrowRight': e.preventDefault(); if (FL.playing) FL.pause(); FL.seek(FL.time + (e.shiftKey ? 1 : step)); FL.ensureVisible(FL.time); break;
      case 'ArrowUp': { e.preventDefault(); const p = FL.editPoints().filter((x) => x < FL.time - 1e-4).pop(); FL.seek(p ?? 0); FL.ensureVisible(FL.time); break; }
      case 'ArrowDown': { e.preventDefault(); const p = FL.editPoints().find((x) => x > FL.time + 1e-4); if (p !== undefined) FL.seek(p); FL.ensureVisible(FL.time); break; }
      case 'Home': FL.seek(0); FL.ensureVisible(0); break;
      case 'End': FL.seek(FL.duration()); FL.ensureVisible(FL.time); break;
      case 'Delete': case 'Backspace': e.preventDefault(); FL.cmd(e.shiftKey ? 'rippleDelete' : 'delete'); break;
      case 'v': case 'V': setTool('select'); break;
      case 'c': case 'C': setTool('razor'); break;
      case 'n': case 'N': setSnap(!FL.snap); break;
      case '=': case '+': FL.zoomBy(1.5); break;
      case '-': case '_': FL.zoomBy(1 / 1.5); break;
      case 'z': case 'Z': if (e.shiftKey) FL.zoomFit(); break;
      case '\\': FL.zoomFit(); break;
      default:
    }
  });

  // ======================================================================
  // Toolbar, transport, misc UI
  // ======================================================================
  function setTool(t) {
    FL.tool = t;
    document.querySelectorAll('.tool[data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === t));
    document.body.classList.toggle('razor', t === 'razor');
  }
  function setSnap(v) {
    FL.snap = v;
    $('#snap-toggle').classList.toggle('active', v);
  }
  document.querySelectorAll('.tool[data-tool]').forEach((b) => { b.onclick = () => setTool(b.dataset.tool); });
  $('#snap-toggle').onclick = () => setSnap(!FL.snap);
  $('#add-vtrack').onclick = () => FL.cmd('addVideoTrack');
  $('#add-atrack').onclick = () => FL.cmd('addAudioTrack');
  $('#btn-import').onclick = importDialog;
  $('#btn-import-2').onclick = importDialog;
  $('#btn-title').onclick = () => FL.cmd('title');
  $('#btn-export').onclick = openExport;

  $('#t-play').onclick = () => FL.togglePlay();
  $('#t-start').onclick = () => { FL.seek(0); FL.ensureVisible(0); };
  $('#t-end').onclick = () => { FL.seek(FL.duration()); FL.ensureVisible(FL.time); };
  $('#t-back').onclick = () => { if (FL.playing) FL.pause(); FL.seek(FL.time - FL.frame()); };
  $('#t-fwd').onclick = () => { if (FL.playing) FL.pause(); FL.seek(FL.time + FL.frame()); };
  $('#t-prev').onclick = () => { const p = FL.editPoints().filter((x) => x < FL.time - 1e-4).pop(); FL.seek(p ?? 0); FL.ensureVisible(FL.time); };
  $('#t-next').onclick = () => { const p = FL.editPoints().find((x) => x > FL.time + 1e-4); if (p !== undefined) { FL.seek(p); FL.ensureVisible(p); } };
  $('#preview-quality').onchange = (e) => FL.setPreviewQuality(+e.target.value);

  FL.on('playstate', (playing) => {
    $('#t-play').innerHTML = `<i class="ic ic-${playing ? 'pause' : 'play'}"></i>`;
    $('#t-play').classList.toggle('active', playing);
  });
  FL.on('time', (t) => { $('#tc-current').textContent = FL.timecode(t); });
  function updateInfo() {
    const s = FL.project.settings;
    $('#seq-info').textContent = `${s.width}×${s.height} · ${s.fps} fps`;
    $('#tc-duration').textContent = FL.timecode(FL.duration());
    $('#tc-current').textContent = FL.timecode(FL.time);
  }
  FL.on('change', () => { updateInfo(); renderBin(); });
  FL.on('title', (name, dirty) => { $('#docname').innerHTML = `${FL.esc(name)}${dirty ? '<span class="edited">Edited</span>' : ''}`; });

  // context menu
  const menu = $('#context-menu');
  FL.showMenu = (x, y, items) => {
    menu.innerHTML = items.map((it, i) => (it.sep ? '<div class="sep"></div>'
      : `<button data-i="${i}" ${it.disabled ? 'disabled' : ''}><span>${FL.esc(it.label)}</span>${it.key ? `<kbd>${it.key}</kbd>` : ''}</button>`)).join('');
    menu.hidden = false;
    const r = menu.getBoundingClientRect();
    menu.style.left = Math.min(x, innerWidth - r.width - 6) + 'px';
    menu.style.top = Math.min(y, innerHeight - r.height - 6) + 'px';
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

  // modals close buttons
  document.querySelectorAll('[data-close]').forEach((b) => {
    b.onclick = () => { const m = b.closest('.modal-backdrop'); if (m.id === 'export-modal') closeExport(); else m.hidden = true; };
  });

  // shortcuts list
  const SHORTCUTS = [
    ['Playback', [['Space', 'Play / pause'], ['K / L', 'Pause / play'], ['J', 'Back 1 second'], ['← →', 'Previous / next frame'], ['⇧← ⇧→', 'Back / forward 1 second'], ['↑ ↓', 'Previous / next edit point'], ['Home / End', 'Start / end of sequence']]],
    ['Editing', [['V', 'Selection tool'], ['C', 'Razor tool'], ['⌘K', 'Split at playhead'], ['⌫', 'Delete clip'], ['⇧⌫', 'Ripple delete'], ['⌘C / ⌘X / ⌘V', 'Copy / cut / paste at playhead'], ['⌘D', 'Duplicate clip'], ['⌘L', 'Detach audio'], ['⌘T', 'New title'], ['N', 'Snapping on/off'], ['Shift while dragging', 'Temporarily disable snapping']]],
    ['Timeline', [['= / −', 'Zoom in / out'], ['⇧Z or \\', 'Zoom to fit'], ['⌥ + scroll / pinch', 'Zoom at pointer']]],
    ['Project', [['⌘N', 'New project'], ['⌘O', 'Open project'], ['⌘S', 'Save'], ['⌘I', 'Import media'], ['⌘M', 'Export video'], ['⌘Z / ⇧⌘Z', 'Undo / redo']]],
  ];
  $('#shortcuts-list').innerHTML = SHORTCUTS.map(([g, list]) => `<div class="sc-group"><h3>${g}</h3>${list.map(([k, d]) => `<div class="sc"><kbd>${k}</kbd><span>${d}</span></div>`).join('')}</div>`).join('');

  // ======================================================================
  // Panel splitters
  // ======================================================================
  const appEl = $('#app');
  const sizes = { left: 260, right: 300, timeline: 330 };
  try { Object.assign(sizes, JSON.parse(localStorage.getItem('fl-layout') || '{}')); } catch (_) {}
  function applySizes() {
    appEl.style.setProperty('--left-w', sizes.left + 'px');
    appEl.style.setProperty('--right-w', sizes.right + 'px');
    appEl.style.setProperty('--tl-h', sizes.timeline + 'px');
  }
  applySizes();
  document.querySelectorAll('.splitter').forEach((sp) => {
    sp.addEventListener('pointerdown', (e) => {
      sp.setPointerCapture(e.pointerId);
      sp.classList.add('active');
      const which = sp.dataset.split;
      const x0 = e.clientX;
      const y0 = e.clientY;
      const start = sizes[which];
      const move = (ev) => {
        if (which === 'left') sizes.left = FL.clamp(start + ev.clientX - x0, 180, 520);
        if (which === 'right') sizes.right = FL.clamp(start - (ev.clientX - x0), 240, 520);
        if (which === 'timeline') sizes.timeline = FL.clamp(start - (ev.clientY - y0), 160, innerHeight - 300);
        applySizes();
      };
      const up = () => {
        sp.classList.remove('active');
        sp.removeEventListener('pointermove', move);
        sp.removeEventListener('pointerup', up);
        try { localStorage.setItem('fl-layout', JSON.stringify(sizes)); } catch (_) {}
      };
      sp.addEventListener('pointermove', move);
      sp.addEventListener('pointerup', up);
    });
  });

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
    FL.emit('select', FL.selectedId);
    return true;
  }

  function loadProject(data, filePath) {
    if (FL.playing) FL.pause();
    const base = FL.newProject();
    FL.project = Object.assign(base, data, { settings: Object.assign(base.settings, data.settings || {}) });
    FL.project.clips = FL.project.clips.map((c) => FL.makeClip(c));
    FL.filePath = filePath;
    FL.undoStack = [];
    FL.redoStack = [];
    FL.selectedId = null;
    FL.time = 0;
    FL.emit('change', {});
    FL.emit('select', null);
    FL.emit('time', 0);
    FL.setDirty(false);
    FL.project.media.forEach((m) => ensureAssets(m));
    setTimeout(() => FL.zoomFit(), 50);
  }
  api.onProjectLoaded(async ({ path, data }) => {
    if (await api.confirmDiscard()) loadProject(data, path);
  });

  // ======================================================================
  // Export
  // ======================================================================
  const exModal = $('#export-modal');
  let exporting = false;
  let exportPath = null;

  function openExport() {
    if (!FL.project.clips.length) return FL.toast('Add some clips to the timeline first');
    if (FL.playing) FL.pause();
    const s = FL.project.settings;
    const res = [1, 2, 2 / 3, 0.5].map((k) => {
      const w = Math.round((s.width * k) / 2) * 2;
      const h = Math.round((s.height * k) / 2) * 2;
      return { k, w, h, label: `${w}×${h}${k === 1 ? ' (match sequence)' : ''}` };
    }).filter((r, i, a) => a.findIndex((x) => x.w === r.w) === i && r.w <= 7680);
    $('#ex-res').innerHTML = res.map((r) => `<option value="${r.w}x${r.h}" ${r.k === 1 ? 'selected' : ''}>${r.label}</option>`).join('');
    const fpsList = [...new Set([s.fps, 24, 25, 30, 60])];
    $('#ex-fps').innerHTML = fpsList.map((f) => `<option value="${f}" ${f === s.fps ? 'selected' : ''}>${f}${f === s.fps ? ' (match sequence)' : ''} fps</option>`).join('');
    if (!exportPath) {
      const name = (FL.filePath ? basename(FL.filePath).replace(/\.flproj$/, '') : 'Untitled') + '.mp4';
      exportPath = null;
      $('#ex-path').value = '';
      $('#ex-path').placeholder = name;
    }
    $('#export-form').hidden = false;
    $('#export-progress').hidden = true;
    $('#ex-start').hidden = false;
    $('#ex-start').textContent = 'Export';
    $('#ex-cancel').textContent = 'Cancel';
    updateSummary();
    exModal.hidden = false;
  }
  function updateSummary() {
    const dur = FL.duration();
    const [w, h] = $('#ex-res').value.split('x').map(Number);
    const q = $('#ex-quality').value;
    const mbps = { high: 0.12, standard: 0.075, draft: 0.04 }[q] * (w * h * +$('#ex-fps').value) / 1e6;
    const mb = ((mbps + 0.192) * dur) / 8;
    $('#ex-summary').innerHTML = `<span>Duration <b>${FL.timecode(dur)}</b></span><span>Estimated size <b>~${mb < 1 ? mb.toFixed(1) : Math.round(mb)} MB</b></span>`;
  }
  ['#ex-res', '#ex-fps', '#ex-quality'].forEach((s) => $(s).addEventListener('change', updateSummary));
  async function browse() {
    const name = $('#ex-path').value || $('#ex-path').placeholder;
    const p = await api.pickExportPath(basename(name));
    if (p) { exportPath = p; $('#ex-path').value = p; }
    return p;
  }
  $('#ex-browse').onclick = browse;
  $('#ex-path').onclick = browse;

  function closeExport() {
    if (exporting) { api.cancelExport(); return; }
    exModal.hidden = true;
  }
  $('#ex-cancel').onclick = closeExport;

  $('#ex-start').onclick = async () => {
    if ($('#ex-start').dataset.mode === 'reveal') { api.reveal(exportPath); return; }
    if (!exportPath && !(await browse())) return;
    const [w, h] = $('#ex-res').value.split('x').map(Number);
    const textImages = {};
    for (const c of FL.project.clips) if (c.type === 'text') textImages[c.id] = FL.renderTextPNG(c);
    const missing = FL.project.media.filter((m) => m.missing && FL.project.clips.some((c) => c.mediaId === m.id));
    if (missing.length) return FL.toast(`Media offline: ${missing[0].name}`);

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
      options: { width: w, height: h, fps: +$('#ex-fps').value, quality: $('#ex-quality').value },
      textImages,
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
  exModal.addEventListener('transitionend', () => {});
  const resetStart = () => { delete $('#ex-start').dataset.mode; };
  new MutationObserver(() => { if (exModal.hidden) resetStart(); }).observe(exModal, { attributes: true, attributeFilter: ['hidden'] });
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
    const v1 = FL.track('v1');
    const v2 = FL.track('v2');
    FL.insertMedia(a, v1, 0);
    FL.insertMedia(b, v1, 8);
    FL.insertMedia(p, v1, 14);
    const pip = FL.insertMedia(v, v2, 2);
    Object.assign(pip, { scale: 0.45, x: 560, y: -150, rotation: 0, fadeIn: 0.5 });
    FL.insertMedia(mu, FL.track('a1'), 1);
    FL.time = 3;
    FL.cmd('title');
    const t = FL.selected();
    Object.assign(t, { text: 'Frameline\nসম্পাদনা শুরু করুন', y: 300, size: 84, box: true });
    document.activeElement && document.activeElement.blur();
    FL.changed();
    FL.zoomFit();
    FL.select(pip.id);
    FL.seek(3.2);
  };
})();
