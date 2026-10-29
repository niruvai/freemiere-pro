/* Freemiere Pro — dockable panels, like Premiere Pro.
   The layout is a tree of rows/columns whose leaves are panel groups (tab
   stacks). Drag any panel tab:
     • onto the middle of a group (or its tab bar)  → joins that group as a tab
     • onto a group's left/right/top/bottom edge    → docks beside it (new split)
     • with ⌘ held, or outside every group          → floats as its own window
   Workspaces (Editing, Effects, Assembly, Audio, Graphics, Classic) are presets;
   each remembers your changes until you choose "Reset to Saved Layout". */
'use strict';

(() => {
  const $ = (s) => document.querySelector(s);
  const root = $('#dock-root');
  const floatLayer = $('#dock-floats');
  const store = $('#panel-store');
  const indicator = document.createElement('div');
  indicator.id = 'dock-indicator';
  indicator.hidden = true;
  document.body.appendChild(indicator);
  const tabGhost = document.createElement('div');
  tabGhost.id = 'dock-tab-ghost';
  tabGhost.hidden = true;
  document.body.appendChild(tabGhost);

  // ---------------------------------------------------------------- panels
  const panels = {};
  store.querySelectorAll('.pc[data-panel]').forEach((el) => { panels[el.dataset.panel] = el; });
  const TITLES = {
    project: () => 'Project',
    effects: () => 'Effects',
    graphics: () => 'Essential Graphics',
    markers: () => 'Markers',
    effectcontrols: () => 'Effect Controls',
    source: () => `Source: ${FL.source && FL.source.media ? FL.source.media.name : '(no clips)'}`,
    program: () => `Program: ${FL.seq().name}`,
    timeline: () => `Timeline: ${FL.seq().name}`,
    meters: () => 'Audio Meters',
  };
  // Where a closed panel goes when it's reopened (first open neighbour wins).
  const HOME = {
    project: ['effects', 'graphics', 'markers'], effects: ['project', 'graphics'], graphics: ['effects', 'project'],
    markers: ['project', 'effects'], effectcontrols: ['source', 'program'], source: ['effectcontrols', 'program'],
    program: ['source', 'effectcontrols'], timeline: [], meters: [],
  };
  FL.PANEL_IDS = Object.keys(panels);

  // ---------------------------------------------------------------- workspaces
  let gid = 0;
  const G = (tabs, active) => ({ type: 'group', id: 'g' + (++gid), tabs, active: active || tabs[0] });
  const S = (type, sizes, children) => ({ type, sizes, children });
  const PRESETS = {
    Editing: () => S('col', [0.56, 0.44], [
      S('row', [0.5, 0.5], [G(['source', 'effectcontrols', 'markers']), G(['program'])]),
      S('row', [0.27, 0.69, 0.04], [G(['project', 'effects', 'graphics']), G(['timeline']), G(['meters'])]),
    ]),
    Effects: () => S('row', [0.79, 0.21], [
      S('col', [0.56, 0.44], [
        S('row', [0.44, 0.56], [G(['effectcontrols', 'source'], 'effectcontrols'), G(['program'])]),
        S('row', [0.25, 0.71, 0.04], [G(['project', 'markers']), G(['timeline']), G(['meters'])]),
      ]),
      G(['effects', 'graphics']),
    ]),
    Assembly: () => S('col', [0.58, 0.42], [
      S('row', [0.5, 0.5], [G(['project', 'effects', 'graphics', 'markers']), G(['program', 'source', 'effectcontrols'])]),
      S('row', [0.96, 0.04], [G(['timeline']), G(['meters'])]),
    ]),
    Audio: () => S('col', [0.52, 0.48], [
      S('row', [0.48, 0.52], [G(['effectcontrols', 'source'], 'effectcontrols'), G(['program'])]),
      S('row', [0.25, 0.67, 0.08], [G(['project', 'effects', 'markers'], 'effects'), G(['timeline']), G(['meters'])]),
    ]),
    Graphics: () => S('row', [0.78, 0.22], [
      S('col', [0.58, 0.42], [
        S('row', [0.45, 0.55], [G(['effectcontrols', 'source'], 'effectcontrols'), G(['program'])]),
        S('row', [0.25, 0.71, 0.04], [G(['project', 'effects', 'markers']), G(['timeline']), G(['meters'])]),
      ]),
      G(['graphics']),
    ]),
    Classic: () => S('col', [0.6, 0.4], [
      S('row', [0.22, 0.53, 0.25], [G(['project', 'effects', 'graphics', 'markers']), G(['program', 'source']), G(['effectcontrols'])]),
      S('row', [0.96, 0.04], [G(['timeline']), G(['meters'])]),
    ]),
  };
  FL.WORKSPACES = Object.keys(PRESETS);

  const load = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (_) { return null; } };
  const saveLS = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} };
  let wsName = load('fl-ws') || 'Editing';
  if (!PRESETS[wsName]) wsName = 'Editing';
  let state = null;       // { tree, floats: [{ x, y, w, h, group }] }
  let maximized = null;   // group id shown full-size (` key)
  let focusedGroup = null;

  function fresh(name) { return { tree: PRESETS[name](), floats: [] }; }
  function valid(st) {
    if (!st || !st.tree) return false;
    const seen = [];
    let ok = true;
    const walk = (n) => {
      if (!n || !n.type) { ok = false; return; }
      if (n.type === 'group') {
        if (!Array.isArray(n.tabs) || !n.tabs.length) ok = false;
        for (const t of n.tabs || []) { if (!panels[t] || seen.includes(t)) ok = false; seen.push(t); }
      } else {
        if (!Array.isArray(n.children) || !n.children.length || n.children.length !== (n.sizes || []).length) ok = false;
        (n.children || []).forEach(walk);
      }
    };
    walk(st.tree);
    (st.floats || []).forEach((f) => walk(f.group));
    return ok;
  }
  function loadWorkspace(name) {
    wsName = name;
    const saved = load('fl-ws-layout-' + name);
    state = valid(saved) ? saved : fresh(name);
    state.floats = state.floats || [];
    // keep group ids unique after loading
    allGroups().forEach((g) => { const n = +String(g.id).slice(1); if (n > gid) gid = n; });
    maximized = null;
    saveLS('fl-ws', wsName);
  }
  const persist = () => saveLS('fl-ws-layout-' + wsName, state);

  // ---------------------------------------------------------------- tree helpers
  function allGroups() {
    const out = [];
    const walk = (n) => { if (n.type === 'group') out.push(n); else n.children.forEach(walk); };
    walk(state.tree);
    state.floats.forEach((f) => out.push(f.group));
    return out;
  }
  const groupById = (id) => allGroups().find((g) => g.id === id);
  const groupOf = (panel) => allGroups().find((g) => g.tabs.includes(panel));
  function parentOf(node, cur = state.tree) {
    if (cur.type === 'group') return null;
    for (const c of cur.children) {
      if (c === node) return cur;
      const p = parentOf(node, c);
      if (p) return p;
    }
    return null;
  }
  function replaceNode(oldN, newN) {
    if (state.tree === oldN) { state.tree = newN; return; }
    const p = parentOf(oldN);
    if (p) p.children[p.children.indexOf(oldN)] = newN;
  }
  function removeGroup(g) {
    const fi = state.floats.findIndex((f) => f.group === g);
    if (fi >= 0) { state.floats.splice(fi, 1); return; }
    const p = parentOf(g);
    if (!p) { state.tree = null; return; }
    const i = p.children.indexOf(g);
    const freed = p.sizes[i];
    p.children.splice(i, 1);
    p.sizes.splice(i, 1);
    const sum = p.sizes.reduce((a, b) => a + b, 0) || 1;
    p.sizes = p.sizes.map((x) => x + (freed * x) / sum);
    if (p.children.length === 1) {
      const only = p.children[0];
      // collapse; a child split of the same direction merges into the grandparent
      replaceNode(p, only);
    }
    normalize(state.tree);
  }
  function normalize(n) {
    if (!n || n.type === 'group') return;
    for (let i = 0; i < n.children.length; i++) {
      const c = n.children[i];
      normalize(c);
      if (c.type === n.type) {
        const share = n.sizes[i];
        n.children.splice(i, 1, ...c.children);
        n.sizes.splice(i, 1, ...c.sizes.map((x) => x * share));
        i += c.children.length - 1;
      }
    }
  }
  function detachPanel(id) {
    const g = groupOf(id);
    if (!g) return;
    g.tabs = g.tabs.filter((t) => t !== id);
    if (g.active === id) g.active = g.tabs[0];
    if (!g.tabs.length) removeGroup(g);
  }

  // ---------------------------------------------------------------- render
  const SCROLLERS = ['#timeline-scroll', '#bin', '#inspector', '#fx-tree', '#gfx-list', '#markers-list'];
  function render() {
    const scroll = SCROLLERS.map((sel) => { const e = $(sel); return e ? [e, e.scrollLeft, e.scrollTop] : null; }).filter(Boolean);
    for (const el of Object.values(panels)) store.appendChild(el);
    root.innerHTML = '';
    floatLayer.innerHTML = '';
    if (!state.tree) {
      if (state.floats.length) state.tree = state.floats.shift().group;
      else state.tree = G([FL.PANEL_IDS.find((id) => !groupOf(id)) || 'timeline']);
    }
    const max = maximized && groupById(maximized);
    root.appendChild(max ? buildGroup(max) : build(state.tree));
    if (!max) {
      state.floats.forEach((f, i) => {
        const fe = document.createElement('div');
        fe.className = 'dock-float';
        Object.assign(fe.style, { left: f.x + 'px', top: f.y + 'px', width: f.w + 'px', height: f.h + 'px' });
        fe.appendChild(buildGroup(f.group, i));
        const rs = document.createElement('div');
        rs.className = 'float-resize';
        rs.addEventListener('pointerdown', (e) => resizeFloat(e, f, fe));
        fe.appendChild(rs);
        floatLayer.appendChild(fe);
      });
    }
    document.querySelectorAll('[data-ws]').forEach((b) => b.classList.toggle('active', b.dataset.ws === wsName));
    markFocus();
    requestAnimationFrame(() => scroll.forEach(([e, l, t]) => { e.scrollLeft = l; e.scrollTop = t; }));
    FL.emit('dock');
  }

  function build(n) {
    if (n.type === 'group') return buildGroup(n);
    const el = document.createElement('div');
    el.className = `dock-split ${n.type}`;
    n.children.forEach((c, i) => {
      if (i > 0) {
        const gut = document.createElement('div');
        gut.className = 'dock-gutter';
        gut.addEventListener('pointerdown', (e) => dragGutter(e, n, i - 1, el));
        el.appendChild(gut);
      }
      const ce = build(c);
      ce.style.flex = `${n.sizes[i]} 1 0px`;
      el.appendChild(ce);
    });
    return el;
  }

  function buildGroup(g, floatIndex) {
    const el = document.createElement('div');
    el.className = 'dock-group';
    el.dataset.group = g.id;
    if (!g.tabs.includes(g.active)) g.active = g.tabs[0];
    const head = document.createElement('div');
    head.className = 'dock-tabs';
    head.innerHTML = g.tabs.map((t) => `<div class="dock-tab ${t === g.active ? 'active' : ''}" data-panel="${t}" title="Drag to move this panel (⌘-drag to float it)"><span class="dock-tab-title">${FL.esc(TITLES[t]())}</span>${t === g.active ? '<button class="dock-menu" title="Panel menu">≡</button>' : ''}</div>`).join('') +
      '<div class="dock-tabs-space"></div>';
    el.appendChild(head);
    const body = document.createElement('div');
    body.className = 'dock-body';
    for (const t of g.tabs) {
      const p = panels[t];
      p.hidden = t !== g.active;
      body.appendChild(p);
    }
    el.appendChild(body);
    head.addEventListener('pointerdown', (e) => {
      const tab = e.target.closest('.dock-tab');
      if (e.target.closest('.dock-menu')) return;
      if (tab) tabPointerDown(e, tab.dataset.panel, g);
      else if (floatIndex !== undefined) moveFloat(e, state.floats[floatIndex], el.parentNode);
    });
    head.addEventListener('click', (e) => {
      const m = e.target.closest('.dock-menu');
      if (m) { const r = m.getBoundingClientRect(); panelMenu(r.left, r.bottom + 2, g.active); }
    });
    head.addEventListener('contextmenu', (e) => {
      const tab = e.target.closest('.dock-tab');
      if (!tab) return;
      e.preventDefault();
      panelMenu(e.clientX, e.clientY, tab.dataset.panel);
    });
    head.addEventListener('dblclick', (e) => { if (e.target.closest('.dock-tab')) toggleMax(g.id); });
    return el;
  }

  function panelMenu(x, y, id) {
    const g = groupOf(id);
    FL.showMenu(x, y, [
      { label: 'Close Panel', act: () => FL.dock.close(id) },
      { label: 'Undock Panel', act: () => floatPanel(id, x - 40, y + 10) },
      { label: 'Close Other Panels in Group', disabled: !g || g.tabs.length < 2, act: () => { g.tabs.filter((t) => t !== id).forEach(detachPanel); commit(); } },
      { label: maximized ? 'Restore Panel Size' : 'Maximize Panel', key: '`', act: () => toggleMax(g && g.id) },
      { sep: true },
      { label: 'Reset to Saved Layout', act: () => FL.dock.reset() },
    ]);
  }

  function markFocus() {
    document.querySelectorAll('.dock-group.focused').forEach((n) => n.classList.remove('focused'));
    const g = focusedGroup && document.querySelector(`.dock-group[data-group="${focusedGroup}"]`);
    if (g) g.classList.add('focused');
  }
  function setFocusGroup(id) {
    focusedGroup = id;
    const g = groupById(id);
    FL.focusPanel = g ? g.active : FL.focusPanel;
    markFocus();
    FL.emit('focus', FL.focusPanel);
  }
  // Clicking anywhere in a panel focuses it (keyboard shortcuts go to the focused panel).
  document.addEventListener('pointerdown', (e) => {
    const g = e.target.closest && e.target.closest('.dock-group');
    if (g) setFocusGroup(g.dataset.group);
  }, true);

  function commit() { persist(); render(); }

  // ---------------------------------------------------------------- gutters
  function dragGutter(e, node, i, el) {
    e.preventDefault();
    const gut = e.currentTarget;
    gut.setPointerCapture(e.pointerId);
    gut.classList.add('active');
    const horiz = node.type === 'row';
    const total = horiz ? el.clientWidth : el.clientHeight;
    const start = horiz ? e.clientX : e.clientY;
    const a0 = node.sizes[i];
    const b0 = node.sizes[i + 1];
    const sum = node.sizes.reduce((x, y) => x + y, 0);
    const minF = (40 / total) * sum;
    const kids = [...el.children].filter((c) => !c.classList.contains('dock-gutter'));
    const move = (ev) => {
      const d = (((horiz ? ev.clientX : ev.clientY) - start) / total) * sum;
      const a = FL.clamp(a0 + d, minF, a0 + b0 - minF);
      node.sizes[i] = a;
      node.sizes[i + 1] = a0 + b0 - a;
      kids[i].style.flex = `${node.sizes[i]} 1 0px`;
      kids[i + 1].style.flex = `${node.sizes[i + 1]} 1 0px`;
    };
    const up = () => {
      gut.classList.remove('active');
      gut.removeEventListener('pointermove', move);
      gut.removeEventListener('pointerup', up);
      persist();
    };
    gut.addEventListener('pointermove', move);
    gut.addEventListener('pointerup', up);
  }

  // ---------------------------------------------------------------- floats
  function moveFloat(e, f, fe) {
    e.preventDefault();
    const x0 = e.clientX; const y0 = e.clientY; const fx = f.x; const fy = f.y;
    const move = (ev) => {
      f.x = FL.clamp(fx + ev.clientX - x0, -f.w + 80, innerWidth - 80);
      f.y = FL.clamp(fy + ev.clientY - y0, 0, innerHeight - 40);
      fe.style.left = f.x + 'px';
      fe.style.top = f.y + 'px';
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); persist(); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }
  function resizeFloat(e, f, fe) {
    e.preventDefault();
    e.stopPropagation();
    const x0 = e.clientX; const y0 = e.clientY; const w0 = f.w; const h0 = f.h;
    const move = (ev) => {
      f.w = Math.max(220, w0 + ev.clientX - x0);
      f.h = Math.max(140, h0 + ev.clientY - y0);
      fe.style.width = f.w + 'px';
      fe.style.height = f.h + 'px';
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); persist(); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }
  function floatPanel(id, x, y) {
    detachPanel(id);
    const w = id === 'timeline' ? 900 : id === 'meters' ? 90 : 420;
    const h = id === 'timeline' ? 320 : id === 'meters' ? 320 : 360;
    const g = G([id]);
    state.floats.push({ x: FL.clamp(x, 0, innerWidth - 200), y: FL.clamp(y, 44, innerHeight - 120), w, h, group: g });
    focusedGroup = g.id;
    commit();
  }

  // ---------------------------------------------------------------- tab dragging
  function tabPointerDown(e, id, g) {
    if (e.button !== 0) return;
    const x0 = e.clientX; const y0 = e.clientY;
    let dragging = false;
    let drop = null;
    const move = (ev) => {
      if (!dragging) {
        if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 6) return;
        dragging = true;
        tabGhost.textContent = TITLES[id]();
        tabGhost.hidden = false;
        document.body.classList.add('docking');
      }
      tabGhost.style.transform = `translate(${ev.clientX + 10}px, ${ev.clientY + 8}px)`;
      drop = dropAt(ev, id, g);
      showIndicator(drop);
    };
    const up = (ev) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (!dragging) { activate(g, id); return; }
      tabGhost.hidden = true;
      indicator.hidden = true;
      document.body.classList.remove('docking');
      if (drop) applyDrop(id, drop, ev);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  function dropAt(ev, id, srcGroup) {
    if (ev.metaKey || ev.ctrlKey) return { zone: 'float', x: ev.clientX, y: ev.clientY };
    const el = document.elementFromPoint(ev.clientX, ev.clientY);
    const ge = el && el.closest('.dock-group');
    if (!ge) return { zone: 'float', x: ev.clientX, y: ev.clientY };
    const g = groupById(ge.dataset.group);
    const r = ge.getBoundingClientRect();
    const head = ge.querySelector('.dock-tabs').getBoundingClientRect();
    if (ev.clientY <= head.bottom) {
      // over the tab bar: join the group at a position
      const tabs = [...ge.querySelectorAll('.dock-tab')];
      let index = tabs.findIndex((t) => { const b = t.getBoundingClientRect(); return ev.clientX < b.left + b.width / 2; });
      if (index < 0) index = tabs.length;
      return { zone: 'center', group: g, index, rect: r };
    }
    const fx = (ev.clientX - r.left) / r.width;
    const fy = (ev.clientY - head.bottom) / (r.bottom - head.bottom);
    const edge = Math.min(fx, 1 - fx, fy, 1 - fy);
    let zone = 'center';
    if (edge < 0.28) zone = edge === fx ? 'left' : edge === 1 - fx ? 'right' : edge === fy ? 'top' : 'bottom';
    if (g === srcGroup && g.tabs.length === 1) return null;
    // floating windows hold one tab group: anything dropped on them joins it
    if (state.floats.some((f) => f.group === g)) zone = 'center';
    return { zone, group: g, rect: r, index: g.tabs.length };
  }

  function showIndicator(d) {
    if (!d) { indicator.hidden = true; return; }
    indicator.hidden = false;
    indicator.className = d.zone === 'float' ? 'float' : '';
    let { left, top, width, height } = d.rect || { left: d.x - 120, top: d.y - 20, width: 260, height: 180 };
    if (d.zone === 'left') width /= 2;
    if (d.zone === 'right') { left += width / 2; width /= 2; }
    if (d.zone === 'top') height /= 2;
    if (d.zone === 'bottom') { top += height / 2; height /= 2; }
    Object.assign(indicator.style, { left: left + 'px', top: top + 'px', width: width + 'px', height: height + 'px' });
  }

  function applyDrop(id, d, ev) {
    if (d.zone === 'float') { floatPanel(id, ev.clientX - 60, ev.clientY - 12); return; }
    const target = d.group;
    const src = groupOf(id);
    if (d.zone === 'center') {
      if (src === target) {
        const from = target.tabs.indexOf(id);
        target.tabs.splice(from, 1);
        target.tabs.splice(d.index > from ? d.index - 1 : d.index, 0, id);
      } else {
        detachPanel(id);
        target.tabs.splice(Math.min(d.index, target.tabs.length), 0, id);
      }
      target.active = id;
      focusedGroup = target.id;
      commit();
      return;
    }
    detachPanel(id);
    if (!allGroups().includes(target)) { commit(); return; }
    const ng = G([id]);
    const dir = d.zone === 'left' || d.zone === 'right' ? 'row' : 'col';
    const before = d.zone === 'left' || d.zone === 'top';
    const parent = parentOf(target);
    if (parent && parent.type === dir) {
      const i = parent.children.indexOf(target);
      const half = parent.sizes[i] / 2;
      parent.sizes[i] = half;
      parent.children.splice(before ? i : i + 1, 0, ng);
      parent.sizes.splice(before ? i : i + 1, 0, half);
    } else {
      replaceNode(target, S(dir, [0.5, 0.5], before ? [ng, target] : [target, ng]));
    }
    normalize(state.tree);
    focusedGroup = ng.id;
    commit();
  }

  // Switching tabs only flips visibility, so scroll positions and playback stay put.
  function activate(g, id) {
    g.active = id;
    focusedGroup = g.id;
    FL.focusPanel = id;
    const ge = document.querySelector(`.dock-group[data-group="${g.id}"]`);
    if (!ge) { commit(); FL.emit('focus', id); return; }
    ge.querySelectorAll('.dock-tab').forEach((t) => {
      const on = t.dataset.panel === id;
      t.classList.toggle('active', on);
      const m = t.querySelector('.dock-menu');
      if (on && !m) t.insertAdjacentHTML('beforeend', '<button class="dock-menu" title="Panel menu">≡</button>');
      if (!on && m) m.remove();
    });
    for (const t of g.tabs) panels[t].hidden = t !== id;
    persist();
    markFocus();
    FL.emit('dock');
    FL.emit('focus', id);
  }

  function toggleMax(id) {
    if (maximized) maximized = null;
    else maximized = id || focusedGroup || (groupOf('timeline') || {}).id;
    render();
  }

  // ---------------------------------------------------------------- API
  FL.dock = {
    // Bring a panel to the front, reopening it if it was closed.
    show: (id, focus = true) => {
      if (!panels[id]) return;
      let g = groupOf(id);
      let rebuilt = false;
      if (!g) {
        const home = (HOME[id] || []).map(groupOf).find(Boolean) || null;
        if (home) { home.tabs.push(id); g = home; }
        else { floatPanel(id, innerWidth / 2 - 200, 140); g = groupOf(id); }
        rebuilt = true;
      }
      if (maximized && maximized !== g.id) { maximized = null; rebuilt = true; }
      const onScreen = document.querySelector(`.dock-group[data-group="${g.id}"]`);
      if (rebuilt || !onScreen) { g.active = id; commit(); }
      if (focus) activate(g, id);
      else if (g.active !== id) {
        g.active = id;
        for (const t of g.tabs) panels[t].hidden = t !== id;
        const ge = document.querySelector(`.dock-group[data-group="${g.id}"]`);
        if (ge) ge.querySelectorAll('.dock-tab').forEach((t) => t.classList.toggle('active', t.dataset.panel === id));
        persist();
      }
    },
    close: (id) => { detachPanel(id); commit(); },
    isOpen: (id) => !!groupOf(id),
    isVisible: (id) => { const g = groupOf(id); return !!g && g.active === id && (!maximized || maximized === g.id); },
    toggle: (id) => { if (FL.dock.isVisible(id)) FL.dock.close(id); else FL.dock.show(id); },
    workspace: (name) => { if (!PRESETS[name]) return; persist(); loadWorkspace(name); persist(); render(); },
    current: () => wsName,
    reset: () => { state = fresh(wsName); maximized = null; commit(); FL.toast(`${wsName} workspace reset`); },
    toggleMax: () => toggleMax(focusedGroup),
    focus: (id) => { const g = groupOf(id); if (g) { focusedGroup = g.id; FL.focusPanel = id; markFocus(); } },
    updateTitles: () => {
      document.querySelectorAll('.dock-tab').forEach((t) => {
        const span = t.querySelector('.dock-tab-title');
        const v = TITLES[t.dataset.panel]();
        if (span.textContent !== v) span.textContent = v;
      });
    },
  };

  // workspace switcher in the title bar
  const wsBar = $('#ws-bar');
  wsBar.innerHTML = FL.WORKSPACES.map((n) => `<button class="ws-btn" data-ws="${n}">${n}</button>`).join('') +
    '<button class="ws-btn ws-more" title="Workspace options">⋯</button>';
  wsBar.addEventListener('click', (e) => {
    const b = e.target.closest('[data-ws]');
    if (b) { FL.dock.workspace(b.dataset.ws); return; }
    if (e.target.closest('.ws-more')) {
      const r = e.target.getBoundingClientRect();
      FL.showMenu(r.left, r.bottom + 4, [
        { label: `Reset “${wsName}” to Saved Layout`, act: () => FL.dock.reset() },
        { label: 'Reset All Workspaces', act: () => { FL.WORKSPACES.forEach((n) => { try { localStorage.removeItem('fl-ws-layout-' + n); } catch (_) {} }); loadWorkspace(wsName); render(); } },
        { sep: true },
        ...FL.PANEL_IDS.map((id) => ({ label: `${FL.dock.isOpen(id) ? '✓ ' : '   '}${TITLES[id]().split(':')[0]}`, act: () => FL.dock.toggle(id) })),
      ]);
    }
  });

  FL.on('change', () => FL.dock.updateTitles());
  FL.on('seq', () => FL.dock.updateTitles());
  FL.on('source', () => FL.dock.updateTitles());
  window.addEventListener('resize', () => {
    let moved = false;
    for (const f of state.floats) {
      const nx = FL.clamp(f.x, 0, Math.max(0, innerWidth - 120));
      const ny = FL.clamp(f.y, 44, Math.max(44, innerHeight - 60));
      if (nx !== f.x || ny !== f.y) { f.x = nx; f.y = ny; moved = true; }
    }
    if (moved) render();
  });

  loadWorkspace(wsName);
  render();
  const tg = groupOf('timeline');
  if (tg) setFocusGroup(tg.id);
})();
