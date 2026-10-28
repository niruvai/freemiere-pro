/* Frameline — Effect Controls: Motion, Opacity, Time, Volume/Pan (all
   keyframeable), the clip's effect stack with masks, titles, graphics
   templates and transitions. */
'use strict';

(() => {
  const D = window.FLDefs;
  const root = document.getElementById('inspector');
  const title = document.getElementById('inspector-title');
  let editing = false;
  const collapsed = {};
  const KFABLE = new Set(D.KF_PROPS);

  // ---------------------------------------------------------------- field builders
  // num: shown value = prop × mul. Labels can be dragged to scrub (Shift = ×10, Option = fine).
  function num(label, key, o = {}) {
    const { min = -1e9, max = 1e9, step = 1, mul = 1, unit = '', dec = 0, slider = false } = o;
    const kf = KFABLE.has(key);
    return `<div class="prop ${slider ? 'has-slider' : ''} ${kf ? 'kfable' : ''}" data-key="${key}" data-kind="num" data-min="${min}" data-max="${max}" data-step="${step}" data-mul="${mul}" data-dec="${dec}">
      ${kf ? `<button class="sw" data-sw="${key}" title="Toggle animation">${swIcon}</button>` : '<span class="sw-pad"></span>'}
      <label class="scrub" title="Drag to adjust">${label}</label>
      ${slider ? `<input type="range" min="${min}" max="${max}" step="${step}">` : ''}
      <span class="num-wrap"><input type="number" step="${step}" min="${min}" max="${max}"><span class="unit">${unit}</span></span>
      ${kf ? `<span class="kfnav"><button data-kfnav="prev" data-prop="${key}" title="Previous keyframe">‹</button><button class="kfdot" data-kfnav="toggle" data-prop="${key}" title="Add/Remove keyframe">◆</button><button data-kfnav="next" data-prop="${key}" title="Next keyframe">›</button></span>` : ''}
    </div>`;
  }
  const swIcon = '<svg viewBox="0 0 16 16" width="13" height="13"><circle cx="8" cy="9" r="5.2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M8 9V6.2M6.5 2.5h3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
  const color = (label, key) => `<div class="prop" data-key="${key}" data-kind="color"><span class="sw-pad"></span><label>${label}</label><input type="color"></div>`;
  const check = (label, key) => `<div class="prop" data-key="${key}" data-kind="check"><span class="sw-pad"></span><label>${label}</label><label class="switch"><input type="checkbox"><span></span></label></div>`;
  const text = (label, key, list) => `<div class="prop" data-key="${key}" data-kind="text"><span class="sw-pad"></span><label>${label}</label><input type="text" ${list ? `list="${list}"` : ''} spellcheck="false"></div>`;
  const area = (key, rows = 3) => `<div class="prop col" data-key="${key}" data-kind="textarea"><textarea rows="${rows}" spellcheck="false"></textarea></div>`;
  const select = (label, key, opts) => `<div class="prop" data-key="${key}" data-kind="select"><span class="sw-pad"></span><label>${label}</label><select>${opts.map(([v, l]) => `<option value="${v}">${FL.esc(l)}</option>`).join('')}</select></div>`;
  function section(id, name, body, extra = '', cls = '') {
    return `<div class="sec ${collapsed[id] ? 'collapsed' : ''} ${cls}" data-sec="${id}">
      <div class="sec-head"><i class="ic ic-chevron"></i><span class="sec-name">${name}</span>${extra}</div>
      <div class="sec-body">${body}</div>
    </div>`;
  }
  const fontList = () => `<datalist id="font-list">${FL.FONTS.map((f) => `<option value="${f}">`).join('')}</datalist>`;

  // ---------------------------------------------------------------- render
  function render() {
    if (FL.selTrans) return renderTransition();
    const many = FL.selectedClips();
    if (many.length > 1) return renderMany(many);
    const c = FL.selected();
    if (!c) return renderEmpty();
    const m = FL.media(c.mediaId);
    title.textContent = 'Effect Controls';
    const typeLabel = { video: 'Video', audio: 'Audio', image: 'Still', text: 'Title', graphic: 'Graphic', adjust: 'Adjustment Layer', solid: 'Color Matte' }[c.type];
    let html = `<div class="clip-card">
      <div class="clip-card-type ${c.type}">${typeLabel}</div>
      <div class="clip-card-name" title="${FL.esc(m ? m.path : '')}">${FL.esc(FL.clipName(c))}</div>
      <div class="clip-card-meta">${FL.esc(FL.track(c.trackId)?.name || '')} · ${FL.timecode(c.start)} – ${FL.timecode(c.start + c.duration)}${m && m.width ? ` · ${m.width}×${m.height}` : ''}</div>
    </div>`;

    if (FL.isVisual(c)) {
      html += '<div class="group-head">Video</div>';
      if (c.type === 'text') {
        html += section('title', 'Text',
          area('text') + text('Font', 'font', 'font-list') + num('Size', 'size', { min: 8, max: 600, unit: 'px' }) + color('Fill', 'color') +
          `<div class="prop"><span class="sw-pad"></span><label>Style</label><span class="seg">
            <button class="segbtn ${c.bold ? 'on' : ''}" data-toggle="bold"><b>B</b></button>
            <button class="segbtn ${c.italic ? 'on' : ''}" data-toggle="italic"><i>I</i></button></span><span class="seg">
            ${['left', 'center', 'right'].map((a) => `<button class="segbtn ${c.align === a ? 'on' : ''}" data-align="${a}"><i class="ic ic-align-${a}"></i></button>`).join('')}</span></div>` +
          check('Shadow', 'shadow') + num('Stroke', 'strokeWidth', { min: 0, max: 60, unit: 'px' }) + color('Stroke color', 'strokeColor') +
          check('Background', 'box') + color('Box color', 'boxColor') + num('Box opacity', 'boxOpacity', { min: 0, max: 100, mul: 100, unit: '%', slider: true }));
      }
      if (c.type === 'graphic') html += section('gfx', `Edit: ${FL.esc(D.GRAPHICS[c.template].name)}`, graphicFields(c));
      if (c.type === 'solid') html += section('matte', 'Color Matte', color('Color', 'color'));
      if (c.type !== 'adjust') {
        html += section('motion', 'Motion',
          num('Position X', 'x', { unit: 'px' }) + num('Position Y', 'y', { unit: 'px' }) +
          num('Scale', 'scale', { min: 0, max: 1000, mul: 100, unit: '%', slider: true }) +
          num('Rotation', 'rotation', { min: -3600, max: 3600, unit: '°' }) +
          `<div class="prop-actions">
            ${c.type === 'video' || c.type === 'image' ? '<button class="btn small" data-do="fit">Fit</button><button class="btn small" data-do="fill">Fill frame</button>' : '<button class="btn small" data-do="center">Center</button>'}
            <button class="btn small ghost" data-do="resetMotion">Reset</button>
          </div>`,
          `<button class="sec-reset" data-do="resetMotion" title="Reset Motion"><i class="ic ic-reset"></i></button>`);
      }
      html += section('opacity', 'Opacity',
        num('Opacity', 'opacity', { min: 0, max: 100, mul: 100, unit: '%', slider: true }) +
        num('Fade in', 'fadeIn', { min: 0, step: 0.1, unit: 's', dec: 2 }) + num('Fade out', 'fadeOut', { min: 0, step: 0.1, unit: 's', dec: 2 }));
    }
    html += section('time', 'Time',
      num('Duration', 'duration', { min: 0.04, step: 0.1, unit: 's', dec: 2 }) +
      (c.type === 'video' || c.type === 'audio' ? num('Speed', 'speed', { min: 10, max: 1000, step: 5, mul: 100, unit: '%' }) : ''));
    html += effectSections(c, 'video');
    if (FL.isVisual(c)) html += `<div class="add-fx"><button class="btn small" data-addfx="video">+ Video Effect</button><button class="btn small ghost" data-addfx="look">Lumetri Look ▾</button></div>`;

    if (FL.hasAudio(c)) {
      html += '<div class="group-head">Audio</div>';
      html += section('volume', 'Volume',
        num('Level', 'volume', { min: 0, max: 400, mul: 100, unit: '%', slider: true }) + check('Mute clip', 'muted'));
      html += section('panner', 'Panner', num('Balance', 'pan', { min: -100, max: 100, mul: 100, slider: true }));
      html += effectSections(c, 'audio');
      html += `<div class="add-fx"><button class="btn small" data-addfx="audio">+ Audio Effect</button><button class="btn small ghost" data-addfx="apreset">Preset ▾</button></div>`;
    }

    html += `<div class="clip-actions">
      <button class="btn small" data-do="split">Add Edit</button>
      <button class="btn small" data-do="duplicate">Duplicate</button>
      ${c.type === 'video' && m && m.hasAudio && !c.muted ? '<button class="btn small" data-do="detachAudio">Detach Audio</button>' : ''}
      <button class="btn small danger" data-do="delete">Delete</button>
    </div>`;
    root.innerHTML = html + fontList();
    refresh();
  }

  function graphicFields(c) {
    const g = c.g || {};
    const out = [];
    for (const k of Object.keys(D.GRAPHICS[c.template].fields)) {
      const key = `g:${k}`;
      const label = { label: 'Label', text: c.template === 'ticker' ? 'News items (one per line)' : 'Text', name: 'Name', title: 'Title', labelBg: 'Label color', labelColor: 'Label text', barBg: 'Bar color', textColor: 'Text color', accent: 'Accent', font: 'Font', bottom: 'From bottom', left: 'From left', speed: 'Crawl speed', boxOpacity: 'Box opacity', corner: 'Corner' }[k] || k;
      if (k === 'text' && (c.template === 'ticker' || c.template === 'caption')) out.push(`<div class="prop col"><label class="sub">${label}</label></div>` + area(key, 4));
      else if (/Bg$|Color$|^accent$/.test(k)) out.push(color(label, key));
      else if (k === 'font') out.push(text(label, key, 'font-list'));
      else if (k === 'corner') out.push(select(label, key, [['left', 'Left'], ['right', 'Right']]));
      else if (['bottom', 'left'].includes(k)) out.push(num(label, key, { min: 0, max: 90, unit: '%', step: 0.5, dec: 1 }));
      else if (k === 'speed') out.push(num(label, key, { min: 10, max: 1000, unit: 'px/s', step: 5 }));
      else if (k === 'boxOpacity') out.push(num(label, key, { min: 0, max: 100, unit: '%', slider: true }));
      else out.push(text(label, key));
    }
    return out.join('');
  }

  function effectSections(c, kind) {
    const list = (c.effects || []).filter((e) => (kind === 'audio') === FL.isAudioEffect(e.type));
    return list.map((e) => {
      const def = kind === 'audio' ? D.AUDIO_EFFECTS[e.type] : D.VIDEO_EFFECTS[e.type];
      if (!def) return '';
      let body = def.params.map((p) => {
        const key = `fx:${e.id}:${p.key}`;
        if (p.type === 'color') return color(p.label, key);
        return num(p.label, key, { min: p.min, max: p.max, step: p.step, unit: p.unit, dec: p.step < 1 ? 1 : 0, slider: true });
      }).join('');
      if (def.exportOnly) body += '<p class="hint">Heard in the exported file (not in live preview).</p>';
      if (e.type === 'lumetri') body += `<div class="prop-actions"><button class="btn small ghost" data-fx-act="look" data-fx="${e.id}">Looks ▾</button></div>`;
      if (kind === 'video' && !def.noMask) {
        if (!e.mask) {
          body += `<div class="mask-tools"><span class="hint">Mask:</span>
            <button class="mbtn" data-fx-act="mask-ellipse" data-fx="${e.id}" title="Create ellipse mask">◯</button>
            <button class="mbtn" data-fx-act="mask-rect" data-fx="${e.id}" title="Create rectangle mask">▭</button></div>`;
        } else {
          const editing = FL.maskEdit && FL.maskEdit.fxId === e.id;
          body += `<div class="mask-box">
            <div class="mask-head"><span>Mask (${e.mask.shape === 'ellipse' ? 'Ellipse' : 'Rectangle'})</span>
              <button class="btn small ${editing ? 'primary' : ''}" data-fx-act="mask-edit" data-fx="${e.id}" title="Drag the mask in the Program monitor">${editing ? 'Editing on monitor' : 'Move on monitor'}</button>
              <button class="mbtn" data-fx-act="mask-remove" data-fx="${e.id}" title="Remove mask">✕</button></div>
            ${num('Center X', `mask:${e.id}:cx`, { min: -50, max: 150, mul: 100, unit: '%', step: 0.5, dec: 1 })}
            ${num('Center Y', `mask:${e.id}:cy`, { min: -50, max: 150, mul: 100, unit: '%', step: 0.5, dec: 1 })}
            ${num('Width', `mask:${e.id}:w`, { min: 1, max: 200, mul: 100, unit: '%', step: 0.5, dec: 1 })}
            ${num('Height', `mask:${e.id}:h`, { min: 1, max: 200, mul: 100, unit: '%', step: 0.5, dec: 1 })}
            ${num('Feather', `mask:${e.id}:feather`, { min: 0, max: 300, unit: 'px' })}
            ${check('Inverted', `mask:${e.id}:invert`)}
          </div>`;
        }
      }
      const extra = `<span class="fx-tools">
        <button class="fxbtn ${e.enabled ? 'on' : ''}" data-fx-act="toggle" data-fx="${e.id}" title="Toggle effect">fx</button>
        <button class="fxbtn" data-fx-act="up" data-fx="${e.id}" title="Move up">↑</button>
        <button class="fxbtn" data-fx-act="down" data-fx="${e.id}" title="Move down">↓</button>
        <button class="fxbtn" data-fx-act="remove" data-fx="${e.id}" title="Remove effect">✕</button></span>`;
      return section(`fx-${e.id}`, FL.esc(def.name), body, extra, e.enabled ? '' : 'fx-off');
    }).join('');
  }

  function renderEmpty() {
    title.textContent = 'Effect Controls';
    const seq = FL.seq();
    root.innerHTML = `<div class="empty-state">
        <p class="muted">(no clip selected)</p>
        <div class="clip-card"><div class="clip-card-type seq">Sequence</div>
          <div class="clip-card-name">${FL.esc(seq.name)}</div>
          <div class="clip-card-meta">${seq.settings.width}×${seq.settings.height} · ${seq.settings.fps} fps · ${seq.clips.length} clips · ${FL.timecode(FL.duration())}</div>
          <div class="prop-actions" style="margin-top:8px"><button class="btn small" data-do="settings">Sequence Settings…</button><button class="btn small ghost" data-do="shortcuts">Shortcuts</button></div>
        </div>
        ${section('tips', 'Quick start', `<ol class="tips">
          <li><b>Import</b> or drop files, then drag them to a track.</li>
          <li>Edit with <kbd>V</kbd> select, <kbd>C</kbd> razor, <kbd>B</kbd> ripple, <kbd>N</kbd> rolling, <kbd>Y</kbd> slip, <kbd>R</kbd> rate stretch.</li>
          <li><kbd>⌘K</kbd> add edit, <kbd>Q</kbd>/<kbd>W</kbd> ripple trim, <kbd>⌘D</kbd> cross dissolve.</li>
          <li>Drag from <b>Effects</b> onto clips, from <b>Essential Graphics</b> onto tracks.</li>
          <li>Click the stopwatch next to a property to animate it with keyframes.</li>
        </ol>`)}
      </div>`;
  }

  function renderMany(list) {
    title.textContent = 'Effect Controls';
    root.innerHTML = `<div class="empty-state"><div class="clip-card"><div class="clip-card-type seq">Selection</div>
      <div class="clip-card-name">${list.length} clips selected</div>
      <div class="clip-card-meta">Drop an effect on any of them to apply it to all.</div></div>
      <div class="clip-actions">
        <button class="btn small" data-do="applyVideoTransition">Cross Dissolve</button>
        <button class="btn small" data-do="applyAudioTransition">Audio Crossfade</button>
        <button class="btn small" data-do="toggleFx">Toggle Effects</button>
        <button class="btn small danger" data-do="delete">Delete</button>
      </div></div>`;
  }

  function renderTransition() {
    const { clipId, side, audio } = FL.selTrans;
    const c = FL.clip(clipId);
    const key = (audio ? 'atrans' : 'trans') + (side === 'in' ? 'In' : 'Out');
    const tr = c && c[key];
    if (!tr) { FL.selTrans = null; return renderEmpty(); }
    const defs = audio ? D.AUDIO_TRANSITIONS : D.VIDEO_TRANSITIONS;
    const pair = side === 'in' && FL.prevAdj(c);
    title.textContent = 'Effect Controls';
    root.innerHTML = `<div class="clip-card"><div class="clip-card-type ${audio ? 'audio' : 'video'}">${audio ? 'Audio' : 'Video'} Transition</div>
        <div class="clip-card-name">${FL.esc((defs[tr.type] || {}).name || tr.type)}</div>
        <div class="clip-card-meta">${pair ? 'Center at cut' : side === 'in' ? 'Start of clip' : 'End of clip'} · ${FL.esc(FL.clipName(c))}</div></div>
      <div class="sec"><div class="sec-body" style="padding-top:12px">
        <div class="prop" data-kind="tsel"><span class="sw-pad"></span><label>Transition</label><select id="tr-type">${Object.entries(defs).map(([k, d]) => `<option value="${k}" ${k === tr.type ? 'selected' : ''}>${FL.esc(d.name)}</option>`).join('')}</select></div>
        <div class="prop"><span class="sw-pad"></span><label>Duration</label><span class="num-wrap"><input type="number" id="tr-dur" step="0.1" min="0.04" value="${+tr.duration.toFixed(2)}"><span class="unit">s</span></span></div>
        <p class="hint">${pair ? 'Uses frames beyond each clip\'s edge; if the media is too short the edge frame is held.' : 'One-sided: fades from/to the tracks below.'}</p>
      </div></div>
      <div class="clip-actions"><button class="btn small danger" data-do="deleteTransition">Delete Transition</button></div>`;
    root.querySelector('#tr-type').onchange = (e) => { FL.pushUndo(); tr.type = e.target.value; FL.changed({ source: 'inspector' }); };
    root.querySelector('#tr-dur').onchange = (e) => {
      const prev = FL.prevAdj(c);
      let max = c.duration;
      if (pair && prev) max = Math.min(c.duration, prev.duration) * 2;
      FL.pushUndo();
      tr.duration = FL.clamp(+e.target.value || 1, FL.frame(), Math.max(FL.frame(), max));
      FL.changed({ source: 'inspector' });
    };
  }

  // ---------------------------------------------------------------- value access
  function findFx(c, id) { return (c.effects || []).find((e) => e.id === id); }
  function getVal(c, key) {
    if (key.startsWith('fx:')) { const [, id, p] = key.split(':'); const e = findFx(c, id); return e ? e.params[p] : 0; }
    if (key.startsWith('mask:')) { const [, id, p] = key.split(':'); const e = findFx(c, id); return e && e.mask ? e.mask[p] : 0; }
    if (key.startsWith('g:')) return (c.g || {})[key.slice(2)];
    if (KFABLE.has(key)) return FL.kfValue(c, key, FL.localTime(c));
    return c[key];
  }
  function setVal(c, key, v) {
    if (key.startsWith('fx:')) { const [, id, p] = key.split(':'); const e = findFx(c, id); if (e) e.params[p] = v; return; }
    if (key.startsWith('mask:')) { const [, id, p] = key.split(':'); const e = findFx(c, id); if (e && e.mask) e.mask[p] = v; return; }
    if (key.startsWith('g:')) { c.g = c.g || {}; c.g[key.slice(2)] = v; return; }
    if (key === 'speed') {
      const old = c.speed || 1;
      const sp = FL.clamp(v, 0.1, 10);
      c.speed = sp;
      c.duration = Math.min(Math.max(FL.MIN_CLIP, (c.duration * old) / sp), FL.mediaLimit(c));
      return;
    }
    if (key === 'duration') { c.duration = FL.clamp(v, FL.MIN_CLIP, FL.mediaLimit(c)); return; }
    if (KFABLE.has(key)) { FL.setProp(c, key, v); return; }
    c[key] = v;
  }

  function refresh() {
    const c = FL.selected();
    if (!c || FL.selTrans || FL.sel.size > 1) return;
    const u = FL.localTime(c);
    root.querySelectorAll('.prop[data-key]').forEach((p) => {
      const key = p.dataset.key;
      const v = getVal(c, key);
      const kind = p.dataset.kind;
      if (kind === 'num') {
        const shown = +((v ?? 0) * +p.dataset.mul).toFixed(+p.dataset.dec);
        p.querySelectorAll('input').forEach((inp) => { if (document.activeElement !== inp) inp.value = shown; });
        if (KFABLE.has(key)) {
          const on = FL.hasKf(c, key);
          p.classList.toggle('animated', on);
          const dot = p.querySelector('.kfdot');
          if (dot) dot.classList.toggle('at', FL.kfAt(c, key, u));
        }
      } else if (kind === 'color') p.querySelector('input').value = v || '#000000';
      else if (kind === 'check') p.querySelector('input').checked = !!v;
      else if (kind === 'select') p.querySelector('select').value = v;
      else if (kind === 'text' || kind === 'textarea') {
        const inp = p.querySelector('input,textarea');
        if (document.activeElement !== inp) inp.value = v ?? '';
      }
    });
  }

  function begin() { if (!editing) { FL.pushUndo(); editing = true; } }
  function commit() {
    if (!editing) return;
    editing = false;
    const c = FL.selected();
    if (c) {
      FL.overwrite(c.trackId, c.start, c.start + c.duration, c.id);
      if (c.fadeIn + c.fadeOut > c.duration) { const k = c.duration / (c.fadeIn + c.fadeOut); c.fadeIn *= k; c.fadeOut *= k; }
    }
    FL.changed({ source: 'inspector' });
  }
  function live(key) {
    if (['speed', 'duration', 'fadeIn', 'fadeOut', 'muted', 'text'].includes(key) || KFABLE.has(key)) FL.renderTimeline();
    FL.requestDraw();
  }

  root.addEventListener('input', (e) => {
    const p = e.target.closest('.prop[data-key]');
    const c = FL.selected();
    if (!p || !c) return;
    begin();
    const kind = p.dataset.kind;
    const key = p.dataset.key;
    if (kind === 'num') {
      const raw = parseFloat(e.target.value);
      if (Number.isNaN(raw)) return;
      setVal(c, key, FL.clamp(raw, +p.dataset.min, +p.dataset.max) / +p.dataset.mul);
      p.querySelectorAll('input').forEach((inp) => { if (inp !== e.target) inp.value = raw; });
    } else if (kind === 'check') { setVal(c, key, e.target.checked); live(key); commit(); return; }
    else setVal(c, key, e.target.value);
    live(key);
  });
  root.addEventListener('change', (e) => { if (e.target.closest('.prop[data-key]')) commit(); });

  root.addEventListener('click', (e) => {
    const head = e.target.closest('.sec-head');
    if (head && !e.target.closest('.sec-reset,.fx-tools')) {
      const sec = head.parentNode;
      sec.classList.toggle('collapsed');
      collapsed[sec.dataset.sec] = sec.classList.contains('collapsed');
      return;
    }
    const c = FL.selected();
    const sw = e.target.closest('[data-sw]');
    if (sw && c) {
      const prop = sw.dataset.sw;
      FL.pushUndo();
      if (FL.hasKf(c, prop)) { c[prop] = FL.kfValue(c, prop, FL.localTime(c)); delete c.kf[prop]; }
      else FL.setKf(c, prop, FL.localTime(c), c[prop] ?? 0);
      FL.changed({ source: 'inspector' });
      return;
    }
    const nav = e.target.closest('[data-kfnav]');
    if (nav && c) {
      const prop = nav.dataset.prop;
      const u = FL.localTime(c);
      const list = (c.kf && c.kf[prop]) || [];
      if (nav.dataset.kfnav === 'toggle') {
        FL.pushUndo();
        if (FL.kfAt(c, prop, u)) FL.removeKfAt(c, prop, u);
        else FL.setKf(c, prop, u, FL.kfValue(c, prop, u) ?? 0);
        FL.changed({ source: 'inspector' });
      } else {
        const eps = 0.5 / FL.fps();
        const k = nav.dataset.kfnav === 'prev' ? list.filter((x) => x.t < u - eps).pop() : list.find((x) => x.t > u + eps);
        if (k) FL.seek(c.start + k.t);
      }
      return;
    }
    const fxBtn = e.target.closest('[data-fx-act]');
    if (fxBtn && c) return fxAction(c, fxBtn.dataset.fxAct, fxBtn.dataset.fx, fxBtn);
    const add = e.target.closest('[data-addfx]');
    if (add && c) return addFxMenu(c, add.dataset.addfx, add);
    const btn = e.target.closest('[data-do],[data-toggle],[data-align]');
    if (!btn) return;
    if (btn.dataset.toggle && c) { FL.pushUndo(); c[btn.dataset.toggle] = !c[btn.dataset.toggle]; return FL.changed(); }
    if (btn.dataset.align && c) { FL.pushUndo(); c.align = btn.dataset.align; return FL.changed(); }
    const act = btn.dataset.do;
    if (act === 'deleteTransition') return FL.cmd('delete');
    if (!c) return FL.cmd(act);
    const { width: W, height: H } = FL.S();
    const m = FL.media(c.mediaId);
    if (act === 'fit') { FL.pushUndo(); c.scale = 1; c.x = 0; c.y = 0; delete c.kf.scale; delete c.kf.x; delete c.kf.y; return FL.changed(); }
    if (act === 'fill' && m) return FL.cmd('fill');
    if (act === 'center') { FL.pushUndo(); c.x = 0; c.y = 0; delete c.kf.x; delete c.kf.y; return FL.changed(); }
    FL.cmd(act);
  });

  function fxAction(c, act, id, btn) {
    const list = c.effects;
    const i = list.findIndex((e) => e.id === id);
    const e = list[i];
    if (!e) return;
    if (act === 'look') {
      const r = btn.getBoundingClientRect();
      return FL.showMenu(r.left, r.bottom + 4, Object.keys(D.LOOKS).map((name) => ({ label: name, act: () => { FL.pushUndo(); Object.assign(e.params, D.LOOKS[name]); FL.changed(); } })));
    }
    if (act === 'mask-edit') { FL.maskEdit = FL.maskEdit && FL.maskEdit.fxId === id ? null : { clipId: c.id, fxId: id }; render(); FL.requestDraw(); return; }
    FL.pushUndo();
    if (act === 'toggle') e.enabled = !e.enabled;
    if (act === 'remove') { list.splice(i, 1); if (FL.maskEdit && FL.maskEdit.fxId === id) FL.maskEdit = null; }
    if (act === 'up' && i > 0) [list[i - 1], list[i]] = [list[i], list[i - 1]];
    if (act === 'down' && i < list.length - 1) [list[i + 1], list[i]] = [list[i], list[i + 1]];
    if (act === 'mask-ellipse' || act === 'mask-rect') {
      e.mask = { shape: act === 'mask-ellipse' ? 'ellipse' : 'rect', cx: 0.5, cy: 0.42, w: 0.3, h: 0.4, feather: 20, invert: false };
      FL.maskEdit = { clipId: c.id, fxId: id };
    }
    if (act === 'mask-remove') { e.mask = null; if (FL.maskEdit && FL.maskEdit.fxId === id) FL.maskEdit = null; }
    FL.changed();
  }

  function addFxMenu(c, kind, btn) {
    const r = btn.getBoundingClientRect();
    let items = [];
    if (kind === 'video') items = Object.entries(D.VIDEO_EFFECTS).map(([k, d]) => ({ label: d.name, act: () => FL.applyFxItem({ kind: 'vfx', id: k }, [c]) }));
    if (kind === 'audio') items = Object.entries(D.AUDIO_EFFECTS).map(([k, d]) => ({ label: d.name, act: () => FL.applyFxItem({ kind: 'afx', id: k }, [c]) }));
    if (kind === 'look') items = Object.keys(D.LOOKS).map((k) => ({ label: k, act: () => FL.applyFxItem({ kind: 'look', id: k }, [c]) }));
    if (kind === 'apreset') items = Object.keys(D.AUDIO_PRESETS).map((k) => ({ label: k, act: () => FL.applyFxItem({ kind: 'apreset', id: k }, [c]) }));
    FL.showMenu(r.left, r.bottom + 4, items);
  }

  // label scrubbing
  root.addEventListener('pointerdown', (e) => {
    const lab = e.target.closest('label.scrub');
    if (!lab) return;
    const p = lab.closest('.prop');
    const c = FL.selected();
    if (!c) return;
    e.preventDefault();
    const x0 = e.clientX;
    const mul = +p.dataset.mul;
    const step = +p.dataset.step;
    const start = (getVal(c, p.dataset.key) ?? 0) * mul;
    let moved = false;
    lab.setPointerCapture(e.pointerId);
    const move = (ev) => {
      const dx = ev.clientX - x0;
      if (!moved && Math.abs(dx) < 2) return;
      if (!moved) { begin(); moved = true; }
      const factor = ev.shiftKey ? 10 : ev.altKey ? 0.1 : 1;
      const v = FL.clamp(start + Math.round(dx) * step * factor, +p.dataset.min, +p.dataset.max);
      setVal(c, p.dataset.key, v / mul);
      refresh();
      live(p.dataset.key);
    };
    const up = () => {
      lab.removeEventListener('pointermove', move);
      lab.removeEventListener('pointerup', up);
      if (moved) commit();
    };
    lab.addEventListener('pointermove', move);
    lab.addEventListener('pointerup', up);
  });

  // effects dropped on the panel go to the selected clips
  root.addEventListener('dragover', (e) => { if ([...e.dataTransfer.types].includes('application/x-fl-fx') && FL.selected()) e.preventDefault(); });
  root.addEventListener('drop', (e) => {
    const raw = e.dataTransfer.getData('application/x-fl-fx');
    if (!raw || !FL.selected()) return;
    e.preventDefault();
    FL.applyFxItem(JSON.parse(raw), FL.selectedClips());
  });

  FL.renderInspector = render;
  FL.on('select', render);
  FL.on('change', (o) => { if (o && (o.source === 'inspector' || o.source === 'monitor')) { if (o.source === 'inspector' && FL.selTrans) render(); else refresh(); } else render(); });
  FL.on('inspector-refresh', refresh);
  FL.on('time', () => { if (!FL.playing) refresh(); });
  render();
})();
