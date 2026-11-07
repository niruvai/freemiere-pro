/* Freemiere Pro — multi-camera editing: build a synced multi-camera source sequence
   (each camera on its own video track, synced by audio), cut between angles with the
   number keys, and the Multi-Camera view with live angle previews. */
'use strict';

(() => {
  const api = window.api;
  const $ = (s) => document.querySelector(s);

  // Video tracks of a sequence, V1 first (camera 1 = V1).
  FL.vTracksOf = (seqId) => {
    const s = FL.seqById(seqId);
    return s ? s.tracks.filter((t) => t.kind === 'video').reverse() : [];
  };
  const angleCount = (c) => FL.vTracksOf(c.seqId).length;

  // Switch a multicam clip to camera k. While playing, cut at the playhead first (Premiere's live switching).
  FL.setAngle = (c, k, { cut = false } = {}) => {
    if (!c || !c.multicam || k < 0 || k >= angleCount(c)) return;
    if ((c.angle || 0) === k && !cut) return;
    FL.pushUndo();
    let target = c;
    if (cut && FL.time > c.start + FL.frame() && FL.time < c.start + c.duration - FL.frame()) {
      const right = FL.splitClip(c, FL.snapToFrame(FL.time));
      if (right) target = right;
    }
    if ((target.angle || 0) === k && target === c) { FL.undoStack.pop(); return; }
    target.angle = k;
    FL.changed({ source: FL.playing ? 'monitor' : undefined });
    if (!FL.playing) FL.toast(`Camera ${k + 1}`, 900);
  };
  // the topmost multicam clip under the playhead
  const multicamAt = (t) => {
    for (const tr of FL.vTracks().slice().reverse()) {
      if (tr.hidden || tr.locked) continue;
      const c = FL.clipAt(tr.id, t);
      if (c && c.multicam) return c;
    }
    return null;
  };
  FL.multicamAt = multicamAt;

  // 1–9 switch angles (the Program monitor or Timeline has focus)
  window.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const el = document.activeElement;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
    if (document.querySelector('.modal-backdrop:not([hidden])') || (FL.home && FL.home.visible())) return;
    if (e.shiftKey && e.code === 'Digit0') { e.preventDefault(); FL.cmd('multicamView'); return; }
    if (e.shiftKey || !/^Digit[1-9]$/.test(e.code)) return;
    if (FL.focusPanel === 'source') return;
    const c = multicamAt(FL.time);
    if (!c) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    FL.setAngle(c, +e.code.slice(5) - 1, { cut: FL.playing });
  }, true);

  // ---------------------------------------------------------------- create
  FL.addCmd('multicam', async () => {
    let cams = FL.binSelection ? FL.binSelection().filter((m) => m.type === 'video' && !m.missing) : [];
    if (cams.length < 2) {
      // from timeline selection: the media of the selected video clips
      const ids = [...new Set(FL.selectedClips().filter((c) => c.type === 'video').map((c) => c.mediaId))];
      cams = ids.map(FL.media).filter((m) => m && !m.missing);
    }
    if (cams.length < 2) return FL.toast('Select 2 or more camera clips in the Project panel (⌘-click), then try again', 3500);
    if (cams.length > 9) cams = cams.slice(0, 9);
    const withAudio = cams.every((m) => m.hasAudio);
    const o = await FL.dialog({
      title: 'Create Multi-Camera Sequence',
      ok: 'Create',
      html: `<label class="field"><span>Name</span><input type="text" id="mc-name"></label>
        <div class="mc-cams">${cams.map((m, i) => `<div class="mc-cam"><span class="mc-n">Cam ${i + 1}</span><span>${FL.esc(m.name)}</span><span class="hint">${FL.timecode(m.duration)}</span></div>`).join('')}</div>
        <div class="row2">
          <label class="field"><span>Synchronize by</span><select id="mc-sync">
            ${withAudio ? '<option value="audio" selected>Audio (recommended)</option>' : ''}
            <option value="start">Start of each clip</option>
          </select></label>
          <label class="field"><span>Sound</span><select id="mc-audio">
            <option value="cam1">Camera 1 only</option>
            <option value="all">All cameras (mixed)</option>
          </select></label>
        </div>
        <p class="hint">Each camera goes on its own video track. Then cut between them with the number keys 1–${cams.length} while playing, or open Window → Multi-Camera View.</p>`,
      onOpen: (b) => { b.querySelector('#mc-name').value = `${cams[0].name.replace(/\.[^.]+$/, '')} Multi-Camera`; },
      collect: (b) => ({ name: b.querySelector('#mc-name').value.trim() || 'Multi-Camera', sync: b.querySelector('#mc-sync').value, audio: b.querySelector('#mc-audio').value }),
    });
    if (!o) return;
    let offsets = cams.map(() => 0);
    if (o.sync === 'audio') {
      const prog = FL.progress('Synchronizing cameras', 'Comparing the sound of each camera…');
      const id = 'mc' + Date.now();
      FL.progressHandlers.set(id, (p) => prog.set(p));
      try {
        const res = await api.syncByAudio(cams.map((m) => m.path), { id, analyse: Math.min(600, Math.max(30, Math.min(...cams.map((m) => m.duration)))) });
        offsets = res.map((r) => r.offset);
        const weak = res.slice(1).filter((r) => r.confidence < 0.15).length;
        prog.close();
        if (weak) FL.toast(`${weak} camera${weak > 1 ? 's' : ''} may be out of sync — check them and slip with the Y tool if needed`, 5000);
      } catch (err) {
        prog.close();
        if (!/cancelled/i.test(String(err.message || err))) FL.toast(`Couldn't sync by audio: ${String(err.message || err).slice(0, 100)}`, 4000);
        return;
      } finally { FL.progressHandlers.delete(id); }
    }
    FL.pushUndo();
    const m0 = cams[0];
    const rates = [23.976, 24, 25, 29.97, 30, 50, 59.94, 60];
    const settings = Object.assign({}, FL.S(), {
      width: Math.max(2, Math.round(m0.width / 2) * 2), height: Math.max(2, Math.round(m0.height / 2) * 2),
      fps: m0.fps ? rates.reduce((a, b) => (Math.abs(b - m0.fps) < Math.abs(a - m0.fps) ? b : a)) : FL.S().fps,
    });
    const src = FL.newSequence(o.name, settings);
    src.multicam = true;
    src.tracks = [];
    for (let i = cams.length - 1; i >= 0; i--) src.tracks.push({ id: FL.uid('v'), kind: 'video', name: `Cam ${i + 1}` });
    cams.forEach((m, i) => src.tracks.push({ id: FL.uid('a'), kind: 'audio', name: `A${i + 1}`, muted: o.audio === 'cam1' && i > 0 }));
    // a later "offset" means that camera's recording started earlier: place it earlier
    const starts = offsets.map((off) => -off);
    const min = Math.min(...starts);
    const vT = src.tracks.filter((t) => t.kind === 'video').reverse();
    const aT = src.tracks.filter((t) => t.kind === 'audio');
    cams.forEach((m, i) => {
      const start = starts[i] - min;
      const link = FL.uid('lnk');
      src.clips.push(FL.makeClip({ type: 'video', mediaId: m.id, start, duration: m.duration, trackId: vT[i].id, noAudio: true, link: m.hasAudio ? link : null }));
      if (m.hasAudio) src.clips.push(FL.makeClip({ type: 'audio', mediaId: m.id, start, duration: m.duration, trackId: aT[i].id, link }));
    });
    FL.project.sequences.push(src);
    // the editing sequence holds one multicam clip spanning the time all cameras cover
    const edit = FL.newSequence(`${o.name} Edit`, Object.assign({}, settings));
    const total = FL.duration(src);
    edit.clips.push(FL.makeNestClip(src, { multicam: true, angle: 0, duration: total, trackId: edit.tracks.find((t) => t.kind === 'video' && t.name === 'V1').id }));
    FL.project.sequences.push(edit);
    FL.changed();
    FL.openSequence(edit.id);
    setTimeout(() => FL.zoomFit(), 50);
    FL.showMulticam(true);
    FL.toast('Multi-camera sequence ready — play and press 1–9 to cut between cameras', 4500);
  });

  // ---------------------------------------------------------------- Multi-Camera view
  // A strip of live angle previews under the Program monitor; click one to switch.
  const prog = document.querySelector('.pc[data-panel="program"]');
  const strip = document.createElement('div');
  strip.id = 'mc-strip';
  strip.hidden = true;
  prog.insertBefore(strip, prog.querySelector('#prog-bar'));
  let shown = false;
  let current = null; // { clipId, seqId, n }
  FL.showMulticam = (on) => {
    shown = on ?? !shown;
    strip.hidden = !shown;
    if (FL.layoutPreview) FL.layoutPreview();
    FL.requestDraw();
    if (!shown) current = null;
  };
  FL.addCmd('multicamView', () => { FL.dock.show('program'); FL.showMulticam(); });

  function build(c) {
    const n = angleCount(c);
    strip.innerHTML = Array.from({ length: n }, (_, k) => `<button class="mc-angle" data-k="${k}" title="Camera ${k + 1} (${k + 1})"><canvas></canvas><span>${k + 1}</span></button>`).join('');
    current = { clipId: c.id, seqId: c.seqId, n };
  }
  strip.addEventListener('pointerdown', (e) => {
    const b = e.target.closest('.mc-angle');
    if (!b) return;
    e.preventDefault();
    const c = multicamAt(FL.time);
    if (c) FL.setAngle(c, +b.dataset.k, { cut: FL.playing });
  });

  // called from the preview loop: keeps the angle videos in step and draws them
  FL.multicamView = {
    sync(t, active) {
      if (!shown) return;
      const c = multicamAt(t);
      if (!c) { if (current) { strip.innerHTML = '<p class="hint">Park the playhead on a multi-camera clip to see its cameras here.</p>'; current = null; } return; }
      if (!current || current.seqId !== c.seqId || current.n !== angleCount(c)) build(c);
      current.clipId = c.id;
      const inner = (c.in || 0) + (t - c.start);
      FL.syncNested(c.seqId, inner, active, { gain: 0 }, 'mcv/');
      const q = 0.2;
      strip.querySelectorAll('.mc-angle').forEach((b, k) => {
        b.classList.toggle('on', k === (c.angle || 0));
        const frame = FL.angleFrame(c.seqId, k, inner, q, 'mcv/');
        if (!frame) return;
        const cv = b.querySelector('canvas');
        if (cv.width !== frame.width || cv.height !== frame.height) { cv.width = frame.width; cv.height = frame.height; }
        cv.getContext('2d').drawImage(frame, 0, 0);
      });
    },
  };
  FL.on('seq', () => { if (shown) { current = null; FL.requestDraw(); } });
})();
