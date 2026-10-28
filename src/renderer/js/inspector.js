/* Frameline — Effect Controls: per-clip properties (motion, opacity, colour,
   speed, audio, titles) and sequence settings when nothing is selected. */
'use strict';

(() => {
  const root = document.getElementById('inspector');
  const title = document.getElementById('inspector-title');
  let editing = false;
  let collapsed = {};

  const PRESETS = [
    { label: '1080p HD — 1920×1080', w: 1920, h: 1080 },
    { label: '4K UHD — 3840×2160', w: 3840, h: 2160 },
    { label: '720p HD — 1280×720', w: 1280, h: 720 },
    { label: 'Vertical (Reels/Shorts/TikTok) — 1080×1920', w: 1080, h: 1920 },
    { label: 'Square — 1080×1080', w: 1080, h: 1080 },
    { label: 'Portrait 4:5 — 1080×1350', w: 1080, h: 1350 },
  ];
  FL.SEQ_PRESETS = PRESETS;

  // ---- field builders ----
  // num: value shown = prop * mul; label can be dragged left/right to scrub.
  function num(label, key, o = {}) {
    const { min = -1e9, max = 1e9, step = 1, mul = 1, unit = '', dec = 0 } = o;
    return `<div class="prop" data-key="${key}" data-kind="num" data-min="${min}" data-max="${max}" data-step="${step}" data-mul="${mul}" data-dec="${dec}">
      <label class="scrub" title="Drag to adjust">${label}</label>
      <span class="num-wrap"><input type="number" step="${step}" min="${min}" max="${max}"><span class="unit">${unit}</span></span>
    </div>`;
  }
  function slider(label, key, o = {}) {
    const { min = 0, max = 100, step = 1, mul = 1, unit = '%', dec = 0 } = o;
    return `<div class="prop has-slider" data-key="${key}" data-kind="num" data-min="${min}" data-max="${max}" data-step="${step}" data-mul="${mul}" data-dec="${dec}">
      <label class="scrub" title="Drag to adjust">${label}</label>
      <input type="range" min="${min}" max="${max}" step="${step}">
      <span class="num-wrap"><input type="number" step="${step}" min="${min}" max="${max}"><span class="unit">${unit}</span></span>
    </div>`;
  }
  function color(label, key) {
    return `<div class="prop" data-key="${key}" data-kind="color"><label>${label}</label><input type="color"></div>`;
  }
  function check(label, key) {
    return `<div class="prop" data-key="${key}" data-kind="check"><label>${label}</label><label class="switch"><input type="checkbox"><span></span></label></div>`;
  }
  function section(id, name, body, extra = '') {
    const c = collapsed[id];
    return `<div class="sec ${c ? 'collapsed' : ''}" data-sec="${id}">
      <div class="sec-head"><i class="ic ic-chevron"></i><span>${name}</span>${extra}</div>
      <div class="sec-body">${body}</div>
    </div>`;
  }

  // ---- render ----
  function render() {
    const c = FL.selected();
    if (!c) return renderSequence();
    const m = FL.media(c.mediaId);
    title.textContent = 'Effect Controls';
    const typeLabel = { video: 'Video', audio: 'Audio', image: 'Image', text: 'Title' }[c.type];
    let html = `<div class="clip-card">
      <div class="clip-card-type ${c.type}">${typeLabel}</div>
      <div class="clip-card-name" title="${FL.esc(m ? m.path : '')}">${FL.esc(FL.clipName(c))}</div>
      <div class="clip-card-meta">${FL.esc(FL.track(c.trackId)?.name || '')} · starts ${FL.timecode(c.start)}${m && m.width ? ` · ${m.width}×${m.height}` : ''}</div>
    </div>`;

    html += section('timing', 'Timing',
      num('Duration', 'duration', { min: 0.04, step: 0.1, unit: 's', dec: 2 }) +
      (c.type === 'video' || c.type === 'audio' ? num('Speed', 'speed', { min: 10, max: 1000, step: 5, mul: 100, unit: '%' }) : ''));

    if (c.type === 'text') {
      html += section('title', 'Text',
        `<div class="prop col" data-key="text" data-kind="textarea"><textarea rows="3" spellcheck="false"></textarea></div>
         <div class="prop" data-key="font" data-kind="text"><label>Font</label><input type="text" list="font-list"></div>
         ${num('Size', 'size', { min: 8, max: 600, step: 1, unit: 'px' })}
         ${color('Color', 'color')}
         <div class="prop"><label>Style</label><span class="seg">
           <button class="segbtn ${c.bold ? 'on' : ''}" data-toggle="bold"><b>B</b></button>
           <button class="segbtn ${c.italic ? 'on' : ''}" data-toggle="italic"><i>I</i></button>
         </span><span class="seg">
           ${['left', 'center', 'right'].map((a) => `<button class="segbtn ${c.align === a ? 'on' : ''}" data-align="${a}"><i class="ic ic-align-${a}"></i></button>`).join('')}
         </span></div>
         ${check('Shadow', 'shadow')}`);
      html += section('stroke', 'Outline & Background',
        num('Outline', 'strokeWidth', { min: 0, max: 60, unit: 'px' }) + color('Outline color', 'strokeColor') +
        check('Background', 'box') + color('Box color', 'boxColor') +
        slider('Box opacity', 'boxOpacity', { min: 0, max: 100, mul: 100 }));
    }

    if (c.type !== 'audio') {
      html += section('motion', 'Motion',
        num('Position X', 'x', { step: 1, unit: 'px' }) +
        num('Position Y', 'y', { step: 1, unit: 'px' }) +
        (c.type !== 'text' ? slider('Scale', 'scale', { min: 1, max: 400, mul: 100 }) : '') +
        num('Rotation', 'rotation', { min: -360, max: 360, step: 1, unit: '°' }) +
        `<div class="prop-actions">
          ${c.type !== 'text' ? '<button class="btn small" data-do="fit">Fit</button><button class="btn small" data-do="fill">Fill</button>' : '<button class="btn small" data-do="center">Center</button><button class="btn small" data-do="lower-third">Lower third</button>'}
          <button class="btn small ghost" data-do="resetMotion">Reset</button>
        </div>`,
        `<button class="sec-reset" data-do="resetMotion" title="Reset"><i class="ic ic-reset"></i></button>`);
      html += section('opacity', 'Opacity & Fades',
        slider('Opacity', 'opacity', { min: 0, max: 100, mul: 100 }) +
        num('Fade in', 'fadeIn', { min: 0, step: 0.1, unit: 's', dec: 2 }) +
        num('Fade out', 'fadeOut', { min: 0, step: 0.1, unit: 's', dec: 2 }));
    } else {
      html += section('fades', 'Fades',
        num('Fade in', 'fadeIn', { min: 0, step: 0.1, unit: 's', dec: 2 }) +
        num('Fade out', 'fadeOut', { min: 0, step: 0.1, unit: 's', dec: 2 }));
    }

    if (c.type === 'video' || c.type === 'image') {
      html += section('color', 'Color',
        slider('Brightness', 'brightness', { min: -100, max: 100, unit: '' }) +
        slider('Contrast', 'contrast', { min: -100, max: 100, unit: '' }) +
        slider('Saturation', 'saturation', { min: 0, max: 200 }),
        `<button class="sec-reset" data-do="resetColor" title="Reset"><i class="ic ic-reset"></i></button>`);
    }

    if (c.type === 'audio' || (c.type === 'video' && m && m.hasAudio)) {
      html += section('audio', 'Audio',
        slider('Volume', 'volume', { min: 0, max: 200, mul: 100 }) + check('Mute', 'muted') +
        (c.type === 'video' ? `<div class="prop-actions"><button class="btn small" data-do="detachAudio">Detach audio to A track</button></div>` : '') +
        `<p class="hint">Fades also apply to the sound.</p>`);
    }

    html += `<div class="clip-actions">
      <button class="btn small" data-do="split">Split at playhead</button>
      <button class="btn small" data-do="duplicate">Duplicate</button>
      <button class="btn small danger" data-do="delete">Delete</button>
    </div>`;
    root.innerHTML = html + fontList();
    refresh();
  }

  function fontList() {
    return `<datalist id="font-list">${FL.FONTS.map((f) => `<option value="${f}">`).join('')}</datalist>`;
  }

  function renderSequence() {
    title.textContent = 'Sequence';
    const s = FL.project.settings;
    const presetIdx = PRESETS.findIndex((p) => p.w === s.width && p.h === s.height);
    const dur = FL.duration();
    root.innerHTML = `
      <div class="clip-card"><div class="clip-card-type seq">Sequence</div>
        <div class="clip-card-name">${FL.esc(FL.filePath ? FL.filePath.split(/[\\/]/).pop().replace(/\.flproj$/, '') : 'Untitled')}</div>
        <div class="clip-card-meta">${FL.project.clips.length} clips · ${FL.timecode(dur)}</div></div>
      ${section('seq', 'Sequence Settings', `
        <div class="prop col"><label>Frame size</label>
          <select id="seq-preset">${PRESETS.map((p, i) => `<option value="${i}" ${i === presetIdx ? 'selected' : ''}>${p.label}</option>`).join('')}
          ${presetIdx < 0 ? `<option selected>Custom — ${s.width}×${s.height}</option>` : ''}</select></div>
        <div class="prop"><label>Width</label><span class="num-wrap"><input type="number" id="seq-w" value="${s.width}" step="2" min="16"><span class="unit">px</span></span></div>
        <div class="prop"><label>Height</label><span class="num-wrap"><input type="number" id="seq-h" value="${s.height}" step="2" min="16"><span class="unit">px</span></span></div>
        <div class="prop"><label>Frame rate</label><select id="seq-fps">${[23.976, 24, 25, 29.97, 30, 50, 59.94, 60].map((f) => `<option ${f === s.fps ? 'selected' : ''}>${f}</option>`).join('')}</select></div>
        <div class="prop"><label>Background</label><input type="color" id="seq-bg" value="${s.bg}"></div>
      `)}
      ${section('tips', 'Getting Started', `
        <ol class="tips">
          <li>Import clips with <b>Import</b> or drop files on the window.</li>
          <li>Drag media from Project onto a track.</li>
          <li>Drag clip edges to trim, <kbd>C</kbd> for the razor, <kbd>⌘K</kbd> to split.</li>
          <li>Select a clip to change motion, opacity, colour, speed and volume here.</li>
          <li><b>Export</b> renders an MP4 you can upload anywhere.</li>
        </ol>
        <button class="btn small" data-do="shortcuts">All keyboard shortcuts</button>`)}
    `;
    const apply = (fn) => { FL.pushUndo(); fn(); FL.changed(); };
    root.querySelector('#seq-preset').onchange = (e) => { const p = PRESETS[+e.target.value]; if (p) apply(() => { s.width = p.w; s.height = p.h; }); };
    root.querySelector('#seq-w').onchange = (e) => apply(() => { s.width = Math.max(16, Math.round(+e.target.value / 2) * 2); });
    root.querySelector('#seq-h').onchange = (e) => apply(() => { s.height = Math.max(16, Math.round(+e.target.value / 2) * 2); });
    root.querySelector('#seq-fps').onchange = (e) => apply(() => { s.fps = +e.target.value; });
    root.querySelector('#seq-bg').onchange = (e) => apply(() => { s.bg = e.target.value; });
  }

  // update input values from the clip without rebuilding (keeps focus)
  function refresh() {
    const c = FL.selected();
    if (!c) return;
    root.querySelectorAll('.prop[data-key]').forEach((p) => {
      const key = p.dataset.key;
      const v = c[key];
      if (p.dataset.kind === 'num') {
        const mul = +p.dataset.mul;
        const dec = +p.dataset.dec;
        const shown = +((v ?? 0) * mul).toFixed(dec);
        p.querySelectorAll('input').forEach((inp) => { if (document.activeElement !== inp) inp.value = shown; });
      } else if (p.dataset.kind === 'color') {
        p.querySelector('input').value = v || '#000000';
      } else if (p.dataset.kind === 'check') {
        p.querySelector('input').checked = !!v;
      } else if (p.dataset.kind === 'text' || p.dataset.kind === 'textarea') {
        const inp = p.querySelector('input,textarea');
        if (document.activeElement !== inp) inp.value = v ?? '';
      }
    });
  }

  // ---- applying edits ----
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

  function setProp(c, key, value) {
    if (key === 'speed') {
      const old = c.speed || 1;
      const sp = FL.clamp(value, 0.1, 10);
      c.speed = sp;
      c.duration = Math.max(FL.MIN_CLIP, (c.duration * old) / sp);
      c.duration = Math.min(c.duration, FL.mediaLimit(c));
    } else if (key === 'duration') {
      c.duration = FL.clamp(value, FL.MIN_CLIP, FL.mediaLimit(c));
    } else {
      c[key] = value;
    }
    const timelineKeys = ['speed', 'duration', 'fadeIn', 'fadeOut', 'muted', 'text'];
    if (timelineKeys.includes(key)) FL.renderTimeline();
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
      const v = FL.clamp(raw, +p.dataset.min, +p.dataset.max) / +p.dataset.mul;
      setProp(c, key, v);
      p.querySelectorAll('input').forEach((inp) => { if (inp !== e.target) inp.value = raw; });
    } else if (kind === 'color' || kind === 'text' || kind === 'textarea') {
      setProp(c, key, e.target.value);
    } else if (kind === 'check') {
      setProp(c, key, e.target.checked);
      commit();
    }
  });
  root.addEventListener('change', (e) => {
    if (e.target.closest('.prop[data-key]')) commit();
  });

  root.addEventListener('click', (e) => {
    const head = e.target.closest('.sec-head');
    if (head && !e.target.closest('.sec-reset')) {
      const sec = head.parentNode;
      sec.classList.toggle('collapsed');
      collapsed[sec.dataset.sec] = sec.classList.contains('collapsed');
      return;
    }
    const c = FL.selected();
    const btn = e.target.closest('[data-do],[data-toggle],[data-align]');
    if (!btn) return;
    if (btn.dataset.do === 'shortcuts') return FL.cmd('shortcuts');
    if (!c) return;
    if (btn.dataset.toggle) { FL.pushUndo(); c[btn.dataset.toggle] = !c[btn.dataset.toggle]; return FL.changed(); }
    if (btn.dataset.align) { FL.pushUndo(); c.align = btn.dataset.align; return FL.changed(); }
    const act = btn.dataset.do;
    const { width: W, height: H } = FL.project.settings;
    const m = FL.media(c.mediaId);
    if (act === 'fit') { FL.pushUndo(); c.scale = 1; c.x = 0; c.y = 0; return FL.changed(); }
    if (act === 'fill' && m) { FL.pushUndo(); c.scale = Math.max(W / m.width, H / m.height) / Math.min(W / m.width, H / m.height); c.x = 0; c.y = 0; return FL.changed(); }
    if (act === 'center') { FL.pushUndo(); c.x = 0; c.y = 0; return FL.changed(); }
    if (act === 'lower-third') { FL.pushUndo(); c.x = 0; c.y = Math.round(H * 0.32); return FL.changed(); }
    if (act === 'resetColor') { FL.pushUndo(); c.brightness = 0; c.contrast = 0; c.saturation = 100; return FL.changed(); }
    FL.cmd(act);
  });

  // drag a label to scrub its value, like Premiere
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
    const start = (c[p.dataset.key] ?? 0) * mul;
    let moved = false;
    lab.setPointerCapture(e.pointerId);
    const move = (ev) => {
      const dx = ev.clientX - x0;
      if (!moved && Math.abs(dx) < 2) return;
      if (!moved) { begin(); moved = true; }
      const factor = ev.shiftKey ? 10 : ev.altKey ? 0.1 : 1;
      let v = start + Math.round(dx) * step * factor;
      v = FL.clamp(v, +p.dataset.min, +p.dataset.max);
      setProp(c, p.dataset.key, v / mul);
      refresh();
      FL.emit('inspector-live');
    };
    const up = () => {
      lab.removeEventListener('pointermove', move);
      lab.removeEventListener('pointerup', up);
      if (moved) commit();
    };
    lab.addEventListener('pointermove', move);
    lab.addEventListener('pointerup', up);
  });

  FL.on('select', render);
  FL.on('change', (o) => { if (o && o.source === 'inspector') refresh(); else render(); });
  FL.on('inspector-refresh', refresh);
  render();
})();
