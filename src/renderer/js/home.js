/* Freemiere Pro — Home screen (welcome, New/Open Project, recent projects, Learn)
   and the New Project / New Sequence dialogs with sequence presets. */
'use strict';

(() => {
  const api = window.api;
  const $ = (s, el = document) => el.querySelector(s);

  // ---------------------------------------------------------------- sequence presets
  const P = (id, name, w, h, fps, note) => ({ id, name, w, h, fps, note });
  const PRESETS = [
    { group: 'Automatic', items: [
      P('auto', 'Match first clip', 0, 0, 0, 'The sequence takes the frame size and frame rate of the first clip you put on the timeline — the easiest choice if you don’t know your footage settings.'),
    ] },
    { group: 'HD 1080p', items: [
      P('1080p2398', '1080p 23.976', 1920, 1080, 23.976, 'Cinematic film rate.'),
      P('1080p24', '1080p 24', 1920, 1080, 24, 'Film rate.'),
      P('1080p25', '1080p 25', 1920, 1080, 25, 'TV broadcast in Bangladesh, India, Europe (PAL regions).'),
      P('1080p2997', '1080p 29.97', 1920, 1080, 29.97, 'TV broadcast in North America and Japan (NTSC).'),
      P('1080p30', '1080p 30', 1920, 1080, 30, 'Most phone and web video.'),
      P('1080p50', '1080p 50', 1920, 1080, 50, 'Smooth motion, PAL regions.'),
      P('1080p60', '1080p 60', 1920, 1080, 60, 'Smooth motion, sports and gaming.'),
    ] },
    { group: '4K UHD', items: [
      P('2160p25', '2160p 25', 3840, 2160, 25, 'Ultra HD, PAL regions.'),
      P('2160p30', '2160p 30', 3840, 2160, 30, 'Ultra HD from phones and cameras.'),
      P('2160p60', '2160p 60', 3840, 2160, 60, 'Ultra HD, smooth motion.'),
    ] },
    { group: 'HD 720p', items: [
      P('720p25', '720p 25', 1280, 720, 25, 'Smaller files, faster editing.'),
      P('720p30', '720p 30', 1280, 720, 30, 'Smaller files, faster editing.'),
    ] },
    { group: 'Social media', items: [
      P('vert30', 'Vertical 9:16 · 30', 1080, 1920, 30, 'Facebook & Instagram Reels, YouTube Shorts, TikTok.'),
      P('vert25', 'Vertical 9:16 · 25', 1080, 1920, 25, 'Reels and Shorts from 25 fps footage.'),
      P('square30', 'Square 1:1 · 30', 1080, 1080, 30, 'Facebook and Instagram feed posts.'),
      P('portrait30', 'Portrait 4:5 · 30', 1080, 1350, 30, 'Instagram feed, takes more screen space than square.'),
    ] },
  ];
  const ALL = PRESETS.flatMap((g) => g.items);
  const presetById = (id) => ALL.find((p) => p.id === id) || ALL.find((p) => p.id === '1080p30');
  const lastPreset = () => { try { return localStorage.getItem('fp-last-preset') || '1080p30'; } catch (_) { return '1080p30'; } };
  const rememberPreset = (id) => { try { localStorage.setItem('fp-last-preset', id); } catch (_) {} };
  FL.SEQ_PRESETS = PRESETS;

  const gcd = (a, b) => (b ? gcd(b, a % b) : a);
  const aspect = (w, h) => { const g = gcd(w, h); return `${w / g}:${h / g}`; };

  // Builds the preset list + description pane inside `root`. Returns { get() }.
  function presetPicker(root, initial) {
    let current = presetById(initial);
    root.innerHTML = `<div class="pp-list">${PRESETS.map((g) => `<div class="pp-group"><div class="pp-group-name">${FL.esc(g.group)}</div>${g.items.map((p) => `<button type="button" class="pp-item" data-id="${p.id}"><span>${FL.esc(p.name)}</span>${p.w ? `<em>${p.w}×${p.h}</em>` : '<em>auto</em>'}</button>`).join('')}</div>`).join('')}</div>
      <div class="pp-desc"></div>`;
    const desc = $('.pp-desc', root);
    function show() {
      root.querySelectorAll('.pp-item').forEach((b) => b.classList.toggle('active', b.dataset.id === current.id));
      const p = current;
      const shape = p.w ? (p.h > p.w ? 'portrait' : p.h === p.w ? 'square' : 'landscape') : 'auto';
      desc.innerHTML = `<div class="pp-frame ${shape}"><span>${p.w ? aspect(p.w, p.h) : 'AUTO'}</span></div>
        <h4>${FL.esc(p.name)}</h4>
        <p>${FL.esc(p.note)}</p>
        ${p.w ? `<dl><dt>Frame size</dt><dd>${p.w} × ${p.h}</dd><dt>Aspect</dt><dd>${aspect(p.w, p.h)}</dd><dt>Frame rate</dt><dd>${p.fps} fps</dd><dt>Audio</dt><dd>48 kHz stereo</dd></dl>` : '<dl><dt>Frame size</dt><dd>from first clip</dd><dt>Frame rate</dt><dd>from first clip</dd><dt>Audio</dt><dd>48 kHz stereo</dd></dl>'}`;
    }
    root.addEventListener('click', (e) => {
      const b = e.target.closest('.pp-item');
      if (b) { current = presetById(b.dataset.id); show(); }
    });
    show();
    requestAnimationFrame(() => { const a = $('.pp-item.active', root); if (a) a.scrollIntoView({ block: 'nearest' }); });
    return { get: () => current };
  }
  const settingsFor = (p) => (p.id === 'auto' ? { width: 1920, height: 1080, fps: 30, bg: '#000000' } : { width: p.w, height: p.h, fps: p.fps, bg: '#000000' });

  // ---------------------------------------------------------------- home screen
  const home = document.createElement('div');
  home.id = 'home';
  home.hidden = true;
  home.innerHTML = `
    <header class="home-top">
      <div class="home-logo"><img src="assets/icon.png" alt=""><span>Freemiere Pro</span></div>
      <div class="home-top-right">
        <button class="home-back" id="h-back" hidden>← Back to project</button>
        <span class="home-ver" id="h-ver"></span>
      </div>
    </header>
    <aside class="home-side">
      <button class="btn primary home-new" id="h-new">New Project</button>
      <button class="home-link" id="h-open">Open Project</button>
      <div class="home-sep"></div>
      <button class="home-nav active" data-page="home"><i class="ic ic-home"></i>Home</button>
      <button class="home-nav" data-page="learn"><i class="ic ic-learn"></i>Learn</button>
      <div class="home-label">PROJECTS</div>
      <button class="home-link small" id="h-scratch">Start without saving</button>
      <div class="spacer"></div>
      <button class="home-link small" id="h-updates">Check for Updates</button>
    </aside>
    <main class="home-main">
      <section class="home-page" data-page="home">
        <div class="home-head">
          <h1 id="h-welcome">Welcome to Freemiere Pro</h1>
        </div>
        <div class="home-recent-head">
          <h2>Recent</h2>
          <span class="spacer"></span>
          <label class="home-filter">Filter <input type="search" id="h-filter" placeholder="Filter recent files"></label>
        </div>
        <div class="home-table">
          <div class="ht-row ht-head"><span>NAME</span><span>SEQUENCES</span><span>RECENT ↓</span><span>SIZE</span></div>
          <div id="h-rows"></div>
        </div>
      </section>
      <section class="home-page" data-page="learn" hidden>
        <div class="home-head"><h1>Learn Freemiere Pro</h1></div>
        <div class="learn-grid" id="h-learn"></div>
      </section>
    </main>`;
  document.body.appendChild(home);

  let user = '';
  let hasProject = false;
  const visible = () => !home.hidden;

  function ago(ms) {
    const s = Math.max(1, (Date.now() - ms) / 1000);
    if (s < 60) return 'just now';
    const m = s / 60;
    if (m < 60) return `${Math.floor(m)} minute${Math.floor(m) === 1 ? '' : 's'} ago`;
    const h = m / 60;
    if (h < 24) return `${Math.floor(h)} hour${Math.floor(h) === 1 ? '' : 's'} ago`;
    const d = h / 24;
    if (d < 30) return `${Math.floor(d)} day${Math.floor(d) === 1 ? '' : 's'} ago`;
    return new Date(ms).toLocaleDateString();
  }
  const size = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

  let recent = [];
  async function loadRecent() {
    try { recent = await api.recentList(); } catch (_) { recent = []; }
    renderRecent();
  }
  function renderRecent() {
    const q = $('#h-filter', home).value.trim().toLowerCase();
    const list = recent.filter((r) => !q || r.name.toLowerCase().includes(q) || r.path.toLowerCase().includes(q));
    const rows = $('#h-rows', home);
    if (!recent.length) {
      rows.innerHTML = `<div class="home-empty"><div class="home-empty-art"></div><h3>No recent projects</h3><p>Create a project to start editing. Projects you open or save will appear here.</p><button class="btn primary" data-act="new">New Project</button></div>`;
      return;
    }
    if (!list.length) { rows.innerHTML = '<div class="home-empty small"><p>No projects match your filter.</p></div>'; return; }
    rows.innerHTML = list.map((r) => `<div class="ht-row ${r.exists ? '' : 'missing'}" data-path="${FL.esc(r.path)}" title="${FL.esc(r.path)}">
        <span class="ht-name"><i class="ic ic-project"></i><span><b>${FL.esc(r.name)}</b><small>${FL.esc(r.path.replace(/^\/Users\/[^/]+/, '~'))}</small></span></span>
        <span>${r.exists ? (r.sequences != null ? r.sequences : '—') : '<em class="miss">Missing</em>'}</span>
        <span>${ago(r.opened)}</span>
        <span>${r.exists ? size(r.size) : '—'}</span>
      </div>`).join('');
  }
  $('#h-filter', home).addEventListener('input', renderRecent);
  $('#h-filter', home).addEventListener('keydown', (e) => e.stopPropagation());

  async function openPath(p) {
    const r = recent.find((x) => x.path === p);
    if (r && !r.exists) {
      FL.showMenu(innerWidth / 2 - 120, innerHeight / 2 - 40, [
        { label: 'This project file was moved or deleted', disabled: true },
        { label: 'Remove from Recent', act: async () => { await api.recentRemove(p); loadRecent(); } },
      ]);
      return;
    }
    if (hasProject && !(await api.confirmDiscard())) return;
    try {
      const res = await api.readProject(p);
      FL.loadProject(res.data, res.path);
      FL.home.hide();
    } catch (err) {
      FL.toast(`Couldn’t open this project: ${String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')}`, 4000);
    }
  }
  home.addEventListener('click', (e) => {
    const row = e.target.closest('.ht-row[data-path]');
    if (row) { openPath(row.dataset.path); return; }
    const nav = e.target.closest('.home-nav');
    if (nav) {
      home.querySelectorAll('.home-nav').forEach((n) => n.classList.toggle('active', n === nav));
      home.querySelectorAll('.home-page').forEach((p) => { p.hidden = p.dataset.page !== nav.dataset.page; });
      return;
    }
    if (e.target.closest('[data-act="new"]')) FL.home.newProject();
  });
  home.addEventListener('contextmenu', (e) => {
    const row = e.target.closest('.ht-row[data-path]');
    if (!row) return;
    e.preventDefault();
    const p = row.dataset.path;
    FL.showMenu(e.clientX, e.clientY, [
      { label: 'Open', act: () => openPath(p) },
      { label: api.platform === 'darwin' ? 'Reveal in Finder' : 'Show in Folder', act: () => api.reveal(p) },
      { sep: true },
      { label: 'Remove from Recent', act: async () => { await api.recentRemove(p); loadRecent(); } },
      { label: 'Clear Recent List', act: async () => { await api.recentClear(); loadRecent(); } },
    ]);
  });
  $('#h-new', home).onclick = () => FL.home.newProject();
  $('#h-open', home).onclick = async () => {
    if (hasProject && !(await api.confirmDiscard())) return;
    const res = await api.openProject();
    if (res) { FL.loadProject(res.data, res.path); FL.home.hide(); }
  };
  $('#h-back', home).onclick = () => FL.home.hide();
  $('#h-scratch', home).onclick = () => { hasProject = true; FL.home.hide(); FL.toast('Untitled project — press ⌘S to save it when you’re ready'); };
  $('#h-updates', home).onclick = () => FL.cmd('checkUpdates');

  // Learn page
  $('#h-learn', home).innerHTML = [
    ['1', 'Create a project', 'Click <b>New Project</b>, give it a name and folder, and pick a sequence preset (or <i>Match first clip</i>).'],
    ['2', 'Import media', 'Press <kbd>⌘I</kbd> or drop video, audio and photos onto the window. They appear in the <b>Project</b> panel.'],
    ['3', 'Cut in the Source monitor', 'Double-click a clip, mark <kbd>I</kbd> and <kbd>O</kbd>, choose Video and/or Audio, then press <kbd>.</kbd> to overwrite or <kbd>,</kbd> to insert.'],
    ['4', 'Edit on the timeline', 'Trim edges, <kbd>⌘K</kbd> to split, click a gap and press <kbd>⌫</kbd> to close it. <kbd>V</kbd> <kbd>B</kbd> <kbd>N</kbd> <kbd>R</kbd> <kbd>C</kbd> <kbd>Y</kbd> switch tools.'],
    ['5', 'Effects & graphics', 'Drag effects and transitions onto clips; drag news templates from <b>Essential Graphics</b>. Adjust everything in <b>Effect Controls</b>.'],
    ['6', 'Export', 'Press <kbd>⌘M</kbd>, pick size and quality, and choose where to save the MP4.'],
  ].map(([n, t, d]) => `<div class="learn-card"><div class="learn-n">${n}</div><h3>${t}</h3><p>${d}</p></div>`).join('') +
    `<div class="learn-card wide"><h3>Keyboard shortcuts</h3><p>The full list is under <b>Help → Keyboard Shortcuts</b>.</p><button class="btn small" id="h-shortcuts">Show shortcuts</button></div>`;
  $('#h-shortcuts', home).onclick = () => FL.cmd('shortcuts');

  // ---------------------------------------------------------------- dialogs
  function modal(id, title, bodyHtml, okLabel) {
    let m = document.getElementById(id);
    if (!m) {
      m = document.createElement('div');
      m.className = 'modal-backdrop';
      m.id = id;
      document.body.appendChild(m);
    }
    m.innerHTML = `<div class="modal np-modal"><div class="modal-head"><h2>${title}</h2><button class="x" data-x>×</button></div>
      <div class="modal-body">${bodyHtml}</div>
      <div class="modal-foot"><button class="btn" data-x>Cancel</button><button class="btn primary" data-ok>${okLabel}</button></div></div>`;
    m.hidden = false;
    m.querySelectorAll('[data-x]').forEach((b) => { b.onclick = () => { m.hidden = true; }; });
    m.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') m.hidden = true;
      if (e.key === 'Enter' && e.target.tagName === 'INPUT') m.querySelector('[data-ok]').click();
    });
    return m;
  }

  FL.home = {
    visible,
    show: async () => {
      if (FL.playing) FL.pause();
      home.hidden = false;
      $('#h-back', home).hidden = !hasProject;
      $('#h-back', home).textContent = `← Back to ${FL.projectName()}`;
      document.body.classList.add('home-open');
      loadRecent();
    },
    hide: () => {
      home.hidden = true;
      hasProject = true;
      document.body.classList.remove('home-open');
      FL.dock && FL.dock.updateTitles();
    },
    markProject: () => { hasProject = true; },

    newProject: async () => {
      if (hasProject && FL.dirty && !(await api.confirmDiscard())) return;
      let folder = '';
      try { folder = await api.defaultFolder(); } catch (_) {}
      const m = modal('np-modal', 'New Project', `
        <div class="row2">
          <label class="field"><span>Project name</span><input type="text" id="np-name" value="Untitled Project" spellcheck="false"></label>
          <label class="field"><span>Location</span><div class="file-pick"><input type="text" id="np-folder" readonly><button class="btn" id="np-browse">Choose…</button></div></label>
        </div>
        <div class="np-seq-head"><span>Sequence</span><label class="field inline"><span>Name</span><input type="text" id="np-seq" value="Sequence 01" spellcheck="false"></label></div>
        <div class="preset-picker" id="np-presets"></div>`, 'Create');
      const nameEl = $('#np-name', m);
      const folderEl = $('#np-folder', m);
      folderEl.value = folder;
      folderEl.title = folder;
      const picker = presetPicker($('#np-presets', m), lastPreset());
      const browse = async () => { const f = await api.pickFolder(folderEl.value); if (f) { folderEl.value = f; folderEl.title = f; } };
      $('#np-browse', m).onclick = browse;
      folderEl.onclick = browse;
      setTimeout(() => { nameEl.focus(); nameEl.select(); }, 30);
      $('[data-ok]', m).onclick = async () => {
        const name = nameEl.value.trim() || 'Untitled Project';
        const p = picker.get();
        const project = FL.newProject();
        const seq = project.sequences[0];
        seq.name = $('#np-seq', m).value.trim() || 'Sequence 01';
        seq.settings = settingsFor(p);
        if (p.id === 'auto') seq.autoMatch = true;
        try {
          const file = await api.createProject(project, folderEl.value, name);
          if (!file) return;
          rememberPreset(p.id);
          m.hidden = true;
          FL.loadProject(project, file);
          FL.home.hide();
          FL.toast(`Project “${name}” created — import media with ⌘I or drop files here`, 3500);
        } catch (err) {
          FL.toast(String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), 4000);
        }
      };
    },

    newSequence: () => {
      const n = FL.project.sequences.length + 1;
      const m = modal('ns-modal', 'New Sequence', `
        <div class="preset-picker" id="ns-presets"></div>
        <label class="field"><span>Sequence name</span><input type="text" id="ns-name" value="Sequence ${String(n).padStart(2, '0')}" spellcheck="false"></label>`, 'OK');
      const picker = presetPicker($('#ns-presets', m), lastPreset());
      setTimeout(() => { const i = $('#ns-name', m); i.focus(); i.select(); }, 30);
      $('[data-ok]', m).onclick = () => {
        const p = picker.get();
        rememberPreset(p.id);
        FL.pushUndo();
        const s = FL.newSequence($('#ns-name', m).value.trim() || `Sequence ${String(n).padStart(2, '0')}`, settingsFor(p));
        if (p.id === 'auto') s.autoMatch = true;
        FL.project.sequences.push(s);
        m.hidden = true;
        FL.changed();
        FL.openSequence(s.id);
      };
    },

    closeProject: async () => {
      if (!(await api.confirmDiscard())) return;
      FL.loadProject(FL.newProject(), null);
      hasProject = false;
      FL.home.show();
    },
  };

  // ---------------------------------------------------------------- startup
  api.startup().then((s) => {
    user = s.user || '';
    $('#h-ver', home).textContent = `Version ${s.version}`;
    $('#h-welcome', home).textContent = user ? `Welcome to Freemiere Pro, ${user}` : 'Welcome to Freemiere Pro';
    if (s.showHome && !hasProject) FL.home.show();
    else hasProject = true;
  }).catch(() => { hasProject = true; });
})();
