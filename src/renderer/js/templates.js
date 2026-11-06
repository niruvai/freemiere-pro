/* Freemiere Pro — graphics templates (.fpgfx): save any titles, news graphics, color
   mattes, logos (images) and adjustment layers as a reusable template, share it as a
   file, and drop it into any sequence. Images travel inside the file. */
'use strict';

(() => {
  const api = window.api;
  const D = window.FLDefs;
  const ALLOWED = ['text', 'graphic', 'solid', 'image', 'adjust'];
  const T = (FL.templates = { list: [] });

  // ---------------------------------------------------------------- saving
  function imageData(m) {
    return new Promise((resolve) => {
      const img = FL.imageFor(m);
      const done = () => {
        try {
          const k = Math.min(1, 1920 / Math.max(img.naturalWidth, img.naturalHeight));
          const cv = document.createElement('canvas');
          cv.width = Math.max(1, Math.round(img.naturalWidth * k));
          cv.height = Math.max(1, Math.round(img.naturalHeight * k));
          cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
          resolve(cv.toDataURL('image/png'));
        } catch (_) { resolve(null); }
      };
      if (img.complete && img.naturalWidth) done();
      else { img.addEventListener('load', done, { once: true }); img.addEventListener('error', () => resolve(null), { once: true }); }
    });
  }
  // A small preview of just these clips.
  function thumbnail(clips, span) {
    const { width: W, height: H } = FL.S();
    const q = 320 / W;
    const tmp = { id: FL.uid('seq'), name: 'tpl', settings: Object.assign({}, FL.S(), { bg: '#2a2f3a' }), tracks: FL.seq().tracks, clips, markers: [] };
    FL.project.sequences.push(tmp);
    const cv = document.createElement('canvas');
    cv.width = 320; cv.height = Math.round(H * q);
    try { FL.withSeq(tmp.id, () => FL.compose(cv, cv.getContext('2d'), Math.min(...clips.map((c) => c.start)) + Math.min(span * 0.5, 2), q)); }
    finally { FL.project.sequences = FL.project.sequences.filter((s) => s !== tmp); }
    return cv.toDataURL('image/jpeg', 0.8);
  }
  FL.addCmd('saveTemplate', async () => {
    const sel = FL.selectedClips();
    const list = sel.filter((c) => ALLOWED.includes(c.type));
    if (!list.length) return FL.toast('Select titles, graphics, color mattes or images to save as a template');
    const skipped = sel.length - list.length;
    const def = list.length === 1 ? FL.clipName(list[0]) : 'My Template';
    const name = await FL.dialog({
      title: 'Save as Graphics Template',
      ok: 'Save',
      html: `<label class="field"><span>Template name</span><input type="text" id="tp-name"></label>
        <p class="hint">${list.length} clip${list.length > 1 ? 's' : ''} with ${list.length > 1 ? 'their' : 'its'} position, animation and effects${list.some((c) => c.type === 'image') ? ' (images are stored inside the template)' : ''}.
        ${skipped ? `${skipped} video/audio clip${skipped > 1 ? 's are' : ' is'} left out.` : ''} It appears under <b>My Templates</b> in Essential Graphics.</p>`,
      onOpen: (b) => { b.querySelector('#tp-name').value = def; },
      collect: (b) => b.querySelector('#tp-name').value.trim() || null,
    });
    if (!name) return;
    const t0 = Math.min(...list.map((c) => c.start));
    const t1 = Math.max(...list.map((c) => c.start + c.duration));
    const idx = list.map((c) => FL.trackIndex(FL.track(c.trackId)));
    const low = Math.min(...idx);
    const clips = [];
    for (let i = 0; i < list.length; i++) {
      const c = JSON.parse(JSON.stringify(list[i]));
      const out = Object.assign(c, { start: +(c.start - t0).toFixed(4), track: idx[i] - low });
      for (const k of ['id', 'trackId', 'link', 'mediaId']) delete out[k];
      if (list[i].type === 'image') {
        const m = FL.media(list[i].mediaId);
        const data = m && !m.missing ? await imageData(m) : null;
        if (!data) { FL.toast(`Couldn’t read the image ${m ? m.name : ''}; it was left out`); continue; }
        out.image = data;
        out.imageName = m.name;
      }
      clips.push(out);
    }
    if (!clips.length) return;
    let thumb = null;
    try { thumb = thumbnail(list.map((c) => JSON.parse(JSON.stringify(c))), t1 - t0); } catch (err) { console.warn(err); }
    const tpl = { format: 'freemiere-graphic', version: 1, name, created: new Date().toISOString(), span: +(t1 - t0).toFixed(4), tracks: Math.max(...clips.map((c) => c.track)) + 1, size: { width: FL.S().width, height: FL.S().height }, thumb, clips };
    try {
      await api.saveTemplate(tpl);
      await T.refresh();
      FL.dock.show('graphics');
      FL.toast(`Template “${name}” saved`);
    } catch (err) { FL.toast(String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')); }
  });

  // ---------------------------------------------------------------- inserting
  T.insert = async (file, dropTrack, time) => {
    const tpl = T.list.find((t) => t.path === file);
    if (!tpl) return null;
    // images first (they are imported into the project like any still)
    const media = {};
    for (let i = 0; i < tpl.clips.length; i++) {
      const c = tpl.clips[i];
      if (c.type !== 'image') continue;
      try {
        const p = await api.templateAsset(c.image);
        const [m] = await FL.importPaths([p]);
        if (m) media[i] = m;
      } catch (err) { console.warn('template image', err); }
    }
    FL.pushUndo();
    const n = Math.max(1, tpl.tracks || 1);
    const t0 = Math.max(0, FL.snapToFrame(time ?? FL.time));
    const span = tpl.span || Math.max(...tpl.clips.map((c) => c.start + c.duration));
    const free = (tr) => tr && !tr.locked && !FL.seq().clips.some((o) => o.trackId === tr.id && o.start < t0 + span && o.start + o.duration > t0);
    const vt = () => FL.vTracks();
    let baseIdx = -1;
    const prefer = dropTrack && dropTrack.kind === 'video' ? FL.trackIndex(dropTrack) : 0;
    for (let b = prefer; b < prefer + 30 && baseIdx < 0; b++) {
      while (vt().length < b + n) FL.addTrack('video');
      if (vt().slice(b, b + n).every(free)) baseIdx = b;
    }
    if (baseIdx < 0) baseIdx = prefer;
    // a template made for another frame size keeps its layout proportionally
    const k = tpl.size ? Math.min(FL.S().width / tpl.size.width, FL.S().height / tpl.size.height) : 1;
    const made = [];
    tpl.clips.forEach((src, i) => {
      if (src.type === 'image' && !media[i]) return;
      const c = FL.makeClip(JSON.parse(JSON.stringify(src)));
      delete c.track; delete c.image; delete c.imageName;
      c.id = FL.uid('clip');
      c.start = t0 + (src.start || 0);
      if (src.type === 'image') c.mediaId = media[i].id;
      if (Math.abs(k - 1) > 0.01) {
        c.x = Math.round((c.x || 0) * k); c.y = Math.round((c.y || 0) * k);
        if (c.type === 'text') c.size = Math.round(c.size * k);
      }
      FL.refreshEffectIds(c);
      FL.placeClip(c, vt()[baseIdx + (src.track || 0)].id, c.start);
      made.push(c);
    });
    FL.selectMany(made.map((c) => c.id), true);
    FL.changed();
    return made[0] || null;
  };
  const insertGraphic = FL.insertGraphicItem;
  FL.insertGraphicItem = (id, track, time) => {
    if (String(id).startsWith('tpl:')) { T.insert(String(id).slice(4), track, time); return null; }
    return insertGraphic(id, track, time);
  };

  // ---------------------------------------------------------------- panel
  const gfxList = document.getElementById('gfx-list');
  const box = document.createElement('div');
  box.className = 'tpl-section';
  gfxList.appendChild(box);
  function render() {
    box.innerHTML = `<div class="gfx-head tpl-head"><span>My Templates</span>
        <span class="tpl-tools"><button class="btn small" data-tpl="save" title="Save the selected clips as a template">Save Selection</button>
        <button class="btn small ghost" data-tpl="import" title="Import .fpgfx templates">Import…</button>
        <button class="btn small ghost" data-tpl="folder" title="Open the templates folder">Folder</button></span></div>` +
      (T.list.length ? T.list.map((t) => `<div class="gfx-card tpl-card" data-path="${FL.esc(t.path)}" data-name="${FL.esc(t.name)}">
          <div class="gfx-thumb">${/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(t.thumb || '') ? `<img src="${t.thumb}" alt="">` : ''}</div>
          <div class="gfx-meta"><b>${FL.esc(t.name)}</b><span>${t.clips.length} layer${t.clips.length > 1 ? 's' : ''} · ${(t.span || 0).toFixed(1)}s</span></div>
        </div>`).join('')
        : '<p class="empty-note">Build a lower third, logo bug or title card, select its clips and choose <b>Save Selection</b> (or Graphics → Save Selection as Template). Templates are .fpgfx files you can share.</p>');
  }
  T.refresh = async () => { try { T.list = await api.templates(); } catch (_) { T.list = []; } render(); };
  box.addEventListener('click', (e) => {
    const b = e.target.closest('[data-tpl]');
    if (!b) return;
    if (b.dataset.tpl === 'save') FL.cmd('saveTemplate');
    if (b.dataset.tpl === 'import') FL.cmd('importTemplates');
    if (b.dataset.tpl === 'folder') FL.cmd('templatesFolder');
  });
  box.addEventListener('pointerdown', (e) => {
    const card = e.target.closest('.tpl-card');
    if (card && e.button === 0) FL.dnd.press(e, () => ({ kind: 'gfx', id: 'tpl:' + card.dataset.path }), card.dataset.name);
  });
  box.addEventListener('dblclick', (e) => {
    const card = e.target.closest('.tpl-card');
    if (card) T.insert(card.dataset.path, null, FL.time);
  });
  box.addEventListener('contextmenu', (e) => {
    const card = e.target.closest('.tpl-card');
    if (!card) return;
    e.preventDefault();
    const t = T.list.find((x) => x.path === card.dataset.path);
    FL.showMenu(e.clientX, e.clientY, [
      { label: 'Insert at Playhead', act: () => T.insert(t.path, null, FL.time) },
      { label: 'Export Template…', act: async () => { const p = await api.exportTemplate(t); if (p) FL.toast('Template exported — share the .fpgfx file'); } },
      { sep: true },
      { label: 'Delete Template', act: async () => {
        const ok = await FL.dialog({ title: 'Delete Template', ok: 'Delete', html: `<p>Delete “${FL.esc(t.name)}”? Clips already in your sequences are not affected.</p>` });
        if (ok) { await api.deleteTemplate(t.path); T.refresh(); }
      } },
    ]);
  });
  FL.addCmd('importTemplates', async () => {
    const r = await api.importTemplates();
    if (r.added) { await T.refresh(); FL.dock.show('graphics'); FL.toast(`${r.added} template${r.added > 1 ? 's' : ''} imported`); }
    if (r.errors.length) FL.toast(r.errors[0], 4000);
  });
  FL.addCmd('templatesFolder', () => api.templatesFolder());
  T.refresh();
})();
