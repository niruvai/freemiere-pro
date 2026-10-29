/* Freemiere Pro — core model: project & sequences, selection, undo/redo,
   keyframes and the edit operations every panel uses. */
'use strict';

const D = window.FLDefs;

const FL = (window.FL = {
  project: null,
  filePath: null,
  dirty: false,
  time: 0,
  playing: false,
  selectedId: null,      // primary selected clip
  sel: new Set(),        // all selected clips
  selTrans: null,        // { clipId, side: 'in'|'out', audio: bool }
  selGap: null,          // { trackId, start, end } — empty space picked in the timeline
  tool: 'select',
  snap: true,
  linkSel: true,         // Premiere's "Linked Selection"
  focusPanel: 'timeline',
  pxPerSec: 60,
  clipboard: null,
  undoStack: [],
  redoStack: [],
  listeners: {},
});

FL.MIN_CLIP = 1 / 30;
FL.VISUAL = new Set(['video', 'image', 'text', 'graphic', 'solid', 'adjust']);
FL.uid = (p = 'id') => p + '_' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);

FL.on = (evt, fn) => { (FL.listeners[evt] = FL.listeners[evt] || []).push(fn); };
FL.emit = (evt, ...args) => { (FL.listeners[evt] || []).forEach((fn) => fn(...args)); };

// ---------------------------------------------------------------- project / sequences
FL.newSequence = (name, settings) => ({
  id: FL.uid('seq'),
  name: name || 'Sequence 01',
  settings: Object.assign({ width: 1920, height: 1080, fps: 30, bg: '#000000' }, settings || {}),
  tracks: [
    { id: FL.uid('v'), kind: 'video', name: 'V3' },
    { id: FL.uid('v'), kind: 'video', name: 'V2' },
    { id: FL.uid('v'), kind: 'video', name: 'V1' },
    { id: FL.uid('a'), kind: 'audio', name: 'A1' },
    { id: FL.uid('a'), kind: 'audio', name: 'A2' },
    { id: FL.uid('a'), kind: 'audio', name: 'A3' },
  ],
  clips: [],
  markers: [],
  inPoint: null,
  outPoint: null,
});

FL.newProject = () => {
  const seq = FL.newSequence('Sequence 01');
  return { version: 2, media: [], sequences: [seq], activeSeq: seq.id };
};

FL.seq = () => FL.project.sequences.find((s) => s.id === FL.project.activeSeq) || FL.project.sequences[0];
FL.S = () => FL.seq().settings;

// Brings projects saved by Freemiere Pro 1.x up to the current format.
FL.migrate = (data) => {
  const p = JSON.parse(JSON.stringify(data));
  if (!p.sequences) {
    const seq = FL.newSequence('Sequence 01', p.settings);
    seq.tracks = p.tracks || seq.tracks;
    seq.clips = p.clips || [];
    p.sequences = [seq];
    p.activeSeq = seq.id;
    delete p.tracks; delete p.clips; delete p.settings;
  }
  p.media = p.media || [];
  p.version = 2;
  for (const seq of p.sequences) {
    seq.markers = seq.markers || [];
    seq.patch = seq.patch || null;
    seq.inPoint = seq.inPoint ?? null;
    seq.outPoint = seq.outPoint ?? null;
    seq.clips = seq.clips.map((c) => {
      const n = FL.makeClip(c);
      if ((c.brightness || c.contrast || (c.saturation ?? 100) !== 100) && !(c.effects && c.effects.length)) {
        n.effects = [FL.makeEffect('lumetri', { exposure: c.brightness || 0, contrast: c.contrast || 0, saturation: c.saturation ?? 100 })];
      }
      delete n.brightness; delete n.contrast; delete n.saturation;
      return n;
    });
  }
  if (!p.sequences.find((s) => s.id === p.activeSeq)) p.activeSeq = p.sequences[0].id;
  return p;
};

// ---------------------------------------------------------------- time
FL.fps = () => FL.S().fps;
FL.frame = () => 1 / FL.fps();
FL.snapToFrame = (t) => Math.round(t * FL.fps()) / FL.fps();
FL.timecode = (t) => {
  const fps = Math.round(FL.fps());
  const total = Math.max(0, Math.round(t * fps));
  const f = total % fps;
  const s = Math.floor(total / fps);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}:${pad(f)}`;
};
// Accepts 00:01:02:15 (h:m:s:f), 1:02:15, 1:02, plain seconds (12.5) or frames with "f" (90f).
FL.parseTimecode = (str, fps = FL.fps()) => {
  const s = String(str || '').trim();
  if (!s) return null;
  if (/^[+-]?\d+(\.\d+)?$/.test(s)) return Math.max(0, parseFloat(s));
  if (/^\d+f$/i.test(s)) return parseInt(s, 10) / fps;
  const parts = s.split(/[:;.]/).map((x) => parseInt(x, 10));
  if (parts.some((n) => Number.isNaN(n))) return null;
  while (parts.length < 4) parts.unshift(0);
  const [h, m, sec, f] = parts.slice(-4);
  return Math.max(0, h * 3600 + m * 60 + sec + f / fps);
};
FL.duration = (seq = FL.seq()) => seq.clips.reduce((e, c) => Math.max(e, c.start + c.duration), 0);

// ---------------------------------------------------------------- lookups
FL.media = (id) => FL.project.media.find((m) => m.id === id);
FL.track = (id) => FL.seq().tracks.find((t) => t.id === id);
FL.clip = (id) => FL.seq().clips.find((c) => c.id === id);
FL.selected = () => (FL.selectedId ? FL.clip(FL.selectedId) : null);
FL.selectedClips = () => [...FL.sel].map(FL.clip).filter(Boolean);
FL.clipsOn = (trackId) => FL.seq().clips.filter((c) => c.trackId === trackId).sort((a, b) => a.start - b.start);
FL.clipAt = (trackId, t) => FL.seq().clips.find((c) => c.trackId === trackId && t >= c.start && t < c.start + c.duration);
FL.kindFor = (clipType) => (clipType === 'audio' ? 'audio' : 'video');
FL.isVisual = (c) => FL.VISUAL.has(c.type);
FL.hasAudio = (c) => {
  if (c.type === 'audio') return true;
  if (c.type !== 'video' || c.noAudio) return false;
  const m = FL.media(c.mediaId);
  return !!(m && m.hasAudio);
};
FL.clipName = (c) => {
  if (c.type === 'text') return (c.text || 'Title').split('\n')[0] || 'Title';
  if (c.type === 'graphic') return (D.GRAPHICS[c.template] || {}).name || 'Graphic';
  if (c.type === 'adjust') return 'Adjustment Layer';
  if (c.type === 'solid') return 'Color Matte';
  const m = FL.media(c.mediaId);
  return m ? m.name : 'Missing media';
};
FL.mediaLimit = (c) => {
  if (c.type !== 'video' && c.type !== 'audio') return Infinity;
  const m = FL.media(c.mediaId);
  if (!m || !m.duration) return Infinity;
  return (m.duration - (c.in || 0)) / (c.speed || 1);
};

// adjacency on the same track (for two-sided transitions)
FL.prevAdj = (c) => {
  const eps = 0.5 / FL.fps();
  return FL.seq().clips.find((o) => o.trackId === c.trackId && o.id !== c.id && Math.abs(o.start + o.duration - c.start) < eps) || null;
};
FL.nextAdj = (c) => {
  const eps = 0.5 / FL.fps();
  return FL.seq().clips.find((o) => o.trackId === c.trackId && o.id !== c.id && Math.abs(c.start + c.duration - o.start) < eps) || null;
};
// How far a clip's picture / sound extends beyond its edges because of transitions.
FL.vExt = (c) => {
  if (!FL.isVisual(c) || c.type === 'adjust') return { head: 0, tail: 0 };
  const prev = c.transIn && FL.prevAdj(c);
  const next = FL.nextAdj(c);
  return {
    head: prev ? c.transIn.duration / 2 : 0,
    tail: next && next.transIn ? next.transIn.duration / 2 : 0,
  };
};
FL.aExt = (c) => {
  if (!FL.hasAudio(c)) return { head: 0, tail: 0 };
  const prev = c.atransIn && FL.prevAdj(c);
  const next = FL.nextAdj(c);
  return {
    head: prev ? c.atransIn.duration / 2 : 0,
    tail: next && next.atransIn ? next.atransIn.duration / 2 : 0,
  };
};

// ---------------------------------------------------------------- linked clips
// A video with sound is placed as two clips (picture on a V track, sound on an
// A track) that share a `link` id, exactly like Premiere's linked clips.
FL.partners = (c) => (c && c.link ? FL.seq().clips.filter((o) => o.link === c.link && o.id !== c.id) : []);
FL.withPartners = (ids, solo) => {
  const out = new Set(ids.filter(Boolean));
  if (FL.linkSel && !solo) for (const id of [...out]) for (const p of FL.partners(FL.clip(id))) out.add(p.id);
  return [...out];
};
// Frames a linked partner has drifted out of sync (0 = in sync).
FL.syncOffset = (c, p) => Math.round((((c.start - (c.in || 0) / (c.speed || 1)) - (p.start - (p.in || 0) / (p.speed || 1)))) * FL.fps());
// Gives copied clips fresh link ids (a link survives only when both sides were copied).
FL.relink = (copies) => {
  const count = {};
  copies.forEach((c) => { if (c.link) count[c.link] = (count[c.link] || 0) + 1; });
  const map = {};
  copies.forEach((c) => {
    if (!c.link) return;
    const old = c.link;
    c.link = count[old] > 1 ? (map[old] = map[old] || FL.uid('lnk')) : null;
  });
  return copies;
};

// ---------------------------------------------------------------- selection
// opts.solo (Option-click) selects only one side of a linked pair.
FL.select = (id, opts = {}) => {
  FL.selTrans = null;
  FL.selGap = null;
  const group = id ? FL.withPartners([id], opts.solo) : [];
  if (!id) { FL.sel.clear(); FL.selectedId = null; }
  else if (opts.toggle) {
    if (FL.sel.has(id)) { group.forEach((g) => FL.sel.delete(g)); if (!FL.sel.has(FL.selectedId)) FL.selectedId = [...FL.sel].pop() || null; }
    else { group.forEach((g) => FL.sel.add(g)); FL.selectedId = id; }
  } else if (opts.add) { group.forEach((g) => FL.sel.add(g)); FL.selectedId = id; }
  else if (!(opts.keep && FL.sel.has(id))) { FL.sel = new Set(group); FL.selectedId = id; }
  else FL.selectedId = id;
  FL.emit('select', FL.selectedId);
};
FL.selectMany = (ids, solo) => {
  FL.selTrans = null;
  FL.selGap = null;
  ids = FL.withPartners(ids, solo);
  FL.sel = new Set(ids);
  FL.selectedId = ids[ids.length - 1] || null;
  FL.emit('select', FL.selectedId);
};
FL.selectGap = (gap) => {
  FL.sel.clear();
  FL.selectedId = null;
  FL.selTrans = null;
  FL.selGap = gap;
  FL.emit('select', null);
};
FL.selectTransition = (clipId, side, audio) => {
  FL.selGap = null;
  FL.sel.clear();
  FL.selectedId = null;
  FL.selTrans = { clipId, side, audio: !!audio };
  FL.emit('select', null);
};
FL.cleanSelection = () => {
  for (const id of [...FL.sel]) if (!FL.clip(id)) FL.sel.delete(id);
  if (FL.selectedId && !FL.clip(FL.selectedId)) FL.selectedId = [...FL.sel].pop() || null;
  if (FL.selTrans) {
    const c = FL.clip(FL.selTrans.clipId);
    const key = (FL.selTrans.audio ? 'atrans' : 'trans') + (FL.selTrans.side === 'in' ? 'In' : 'Out');
    if (!c || !c[key]) FL.selTrans = null;
  }
};

// ---------------------------------------------------------------- undo
FL.snapshot = () => JSON.stringify({ project: FL.project, selectedId: FL.selectedId, sel: [...FL.sel] });
FL.pushUndo = () => {
  FL.undoStack.push(FL.snapshot());
  if (FL.undoStack.length > 200) FL.undoStack.shift();
  FL.redoStack = [];
};
FL.restore = (snap) => {
  const s = JSON.parse(snap);
  FL.project = s.project;
  FL.sel = new Set(s.sel || []);
  FL.selectedId = s.selectedId;
  FL.cleanSelection();
};
FL.undo = () => {
  if (!FL.undoStack.length) return;
  FL.redoStack.push(FL.snapshot());
  FL.restore(FL.undoStack.pop());
  FL.changed();
  FL.emit('select', FL.selectedId);
};
FL.redo = () => {
  if (!FL.redoStack.length) return;
  FL.undoStack.push(FL.snapshot());
  FL.restore(FL.redoStack.pop());
  FL.changed();
  FL.emit('select', FL.selectedId);
};

FL.changed = (opts = {}) => {
  FL.cleanSelection();
  FL.setDirty(true);
  FL.emit('change', opts);
};
FL.setDirty = (d) => {
  FL.dirty = d;
  const name = FL.projectName();
  window.api.setDirty(d, `${name}${d ? ' — Edited' : ''} — Freemiere Pro`);
  FL.emit('title', name, d);
};
FL.projectName = () => (FL.filePath ? FL.filePath.split(/[\\/]/).pop().replace(/\.(fpproj|flproj)$/, '') : 'Untitled');

// ---------------------------------------------------------------- factories
FL.makeClip = (props) => Object.assign({
  id: FL.uid('clip'),
  trackId: null,
  mediaId: null,
  type: 'video',
  start: 0,
  duration: 5,
  in: 0,
  speed: 1,
  volume: 1,
  pan: 0,
  muted: false,
  opacity: 1,
  scale: 1,
  x: 0,
  y: 0,
  rotation: 0,
  fadeIn: 0,
  fadeOut: 0,
  effects: [],
  kf: {},
  kfMode: {},
  transIn: null,
  transOut: null,
  atransIn: null,
  atransOut: null,
  link: null,
  noAudio: false,
}, props);

FL.makeEffect = (type, params = {}) => {
  const def = D.VIDEO_EFFECTS[type] || D.AUDIO_EFFECTS[type];
  const p = {};
  for (const prm of def.params) p[prm.key] = prm.def;
  return { id: FL.uid('fx'), type, enabled: true, params: Object.assign(p, params), mask: null };
};
FL.isAudioEffect = (type) => !!D.AUDIO_EFFECTS[type];

FL.makeTextClip = (props) => FL.makeClip(Object.assign({
  type: 'text',
  duration: 5,
  text: 'Your Title',
  font: 'Helvetica Neue',
  size: 96,
  color: '#ffffff',
  bold: true,
  italic: false,
  align: 'center',
  strokeColor: '#000000',
  strokeWidth: 0,
  box: false,
  boxColor: '#000000',
  boxOpacity: 0.6,
  shadow: true,
}, props));

FL.makeGraphicClip = (template, props) => FL.makeClip(Object.assign({
  type: 'graphic',
  template,
  duration: D.DEFAULT_GRAPHIC_DURATION,
  g: JSON.parse(JSON.stringify(D.GRAPHICS[template].fields)),
}, props));

FL.makeAdjustClip = (props) => FL.makeClip(Object.assign({ type: 'adjust', duration: 5 }, props));
FL.makeSolidClip = (props) => FL.makeClip(Object.assign({ type: 'solid', duration: 5, color: '#1a3a8f' }, props));

FL.clipFromMedia = (media, trackKind) => {
  if (media.type === 'image') return FL.makeClip({ type: 'image', mediaId: media.id, duration: 5 });
  if (media.type === 'audio' || trackKind === 'audio') return FL.makeClip({ type: 'audio', mediaId: media.id, duration: media.duration });
  return FL.makeClip({ type: 'video', mediaId: media.id, duration: media.duration });
};

// Clips for a media item. part: 'both' | 'video' | 'audio'.
FL.clipsFromMedia = (media, part = 'both', range = null) => {
  const out = [];
  const dur = range && media.type !== 'image' ? Math.max(FL.MIN_CLIP, range.out - range.in) : media.type === 'image' ? 5 : media.duration;
  const inP = range && media.type !== 'image' ? range.in : 0;
  if (media.type === 'image') { if (part !== 'audio') out.push(FL.makeClip({ type: 'image', mediaId: media.id, duration: dur })); return out; }
  if (media.type === 'audio') { if (part !== 'video') out.push(FL.makeClip({ type: 'audio', mediaId: media.id, duration: dur, in: inP })); return out; }
  if (part !== 'audio') out.push(FL.makeClip({ type: 'video', mediaId: media.id, duration: dur, in: inP, noAudio: true }));
  if (part !== 'video' && media.hasAudio) out.push(FL.makeClip({ type: 'audio', mediaId: media.id, duration: dur, in: inP }));
  if (out.length === 2) { const link = FL.uid('lnk'); out.forEach((c) => { c.link = link; }); }
  return out;
};

// Tracks numbered like Premiere: V1 is the bottom video track, A1 the top audio track.
FL.vTracks = () => FL.seq().tracks.filter((t) => t.kind === 'video').reverse();
FL.aTracks = () => FL.seq().tracks.filter((t) => t.kind === 'audio');
FL.trackIndex = (t) => (t.kind === 'video' ? FL.vTracks() : FL.aTracks()).indexOf(t);
// The matching track of the other kind (V2 <-> A2), created if it doesn't exist.
FL.pairTrack = (t, create = true) => {
  const kind = t.kind === 'video' ? 'audio' : 'video';
  const idx = FL.trackIndex(t);
  let list = kind === 'video' ? FL.vTracks() : FL.aTracks();
  while (create && list.length <= idx) { FL.addTrack(kind); list = kind === 'video' ? FL.vTracks() : FL.aTracks(); }
  return list[Math.min(idx, list.length - 1)] || null;
};

// Source patching: which V and A track Insert/Overwrite use, and whether each is on.
FL.patch = () => {
  const seq = FL.seq();
  const p = seq.patch || (seq.patch = { v: null, a: null, vOn: true, aOn: true });
  if (!p.v || !FL.track(p.v)) p.v = (FL.vTracks()[0] || {}).id || null;
  if (!p.a || !FL.track(p.a)) p.a = (FL.aTracks()[0] || {}).id || null;
  return p;
};

// ---------------------------------------------------------------- keyframes
FL.kfValue = (c, prop, u) => D.kfValue(c, prop, u);
FL.hasKf = (c, prop) => D.hasKf(c, prop);
FL.localTime = (c) => FL.clamp(FL.time - c.start, 0, c.duration);
FL.setKf = (c, prop, u, v) => {
  c.kf = c.kf || {};
  const list = (c.kf[prop] = c.kf[prop] || []);
  const eps = 0.5 / FL.fps();
  const hit = list.find((k) => Math.abs(k.t - u) < eps);
  if (hit) hit.v = v;
  else { list.push({ t: +u.toFixed(4), v }); list.sort((a, b) => a.t - b.t); }
};
FL.removeKfAt = (c, prop, u) => {
  const eps = 0.5 / FL.fps();
  if (!c.kf || !c.kf[prop]) return;
  c.kf[prop] = c.kf[prop].filter((k) => Math.abs(k.t - u) >= eps);
  if (!c.kf[prop].length) delete c.kf[prop];
};
FL.kfAt = (c, prop, u) => {
  const eps = 0.5 / FL.fps();
  return !!(c.kf && c.kf[prop] && c.kf[prop].some((k) => Math.abs(k.t - u) < eps));
};
FL.kfTimes = (c) => {
  const s = new Set();
  for (const list of Object.values(c.kf || {})) for (const k of list) s.add(k.t);
  return [...s].sort((a, b) => a - b);
};
// Split keyframes when a clip is cut at local time `off`.
function splitKf(left, right, off) {
  const lk = {};
  const rk = {};
  for (const [prop, list] of Object.entries(left.kf || {})) {
    const mid = D.kfValue(left, prop, off);
    const l = list.filter((k) => k.t < off - 1e-6);
    const r = list.filter((k) => k.t > off + 1e-6).map((k) => ({ t: +(k.t - off).toFixed(4), v: k.v }));
    if (l.length) { l.push({ t: off, v: mid }); lk[prop] = l; }
    if (r.length) { r.unshift({ t: 0, v: mid }); rk[prop] = r; }
    if (!l.length) left[prop] = mid;
    if (!r.length) right[prop] = mid;
  }
  left.kf = lk;
  right.kf = rk;
}
function shiftKf(c, by) {
  for (const prop of Object.keys(c.kf || {})) {
    const v0 = D.kfValue(c, prop, by);
    c.kf[prop] = c.kf[prop].filter((k) => k.t >= by).map((k) => ({ t: +(k.t - by).toFixed(4), v: k.v }));
    if (!c.kf[prop].length || c.kf[prop][0].t > 1e-4) c.kf[prop].unshift({ t: 0, v: v0 });
  }
}
FL.trimHeadKf = shiftKf;

// ---------------------------------------------------------------- edit operations (callers push undo first)
FL.overwrite = (trackId, start, end, exceptIds) => {
  const except = new Set([].concat(exceptIds || []));
  const eps = 1e-6;
  const clips = FL.seq().clips;
  for (const c of clips.slice()) {
    if (c.trackId !== trackId || except.has(c.id)) continue;
    const cs = c.start;
    const ce = c.start + c.duration;
    if (ce <= start + eps || cs >= end - eps) continue;
    if (cs >= start - eps && ce <= end + eps) {
      clips.splice(clips.indexOf(c), 1);
    } else if (cs < start && ce > end) {
      const tail = FL.splitClip(c, end);
      if (tail) { tail.start = end; tail.link = null; }
      c.duration = start - cs;
      c.transOut = null;
    } else if (cs < start) {
      c.duration = start - cs;
      c.transOut = null;
    } else {
      const cut = end - cs;
      shiftKf(c, cut);
      c.start = end;
      c.duration = ce - end;
      c.in = (c.in || 0) + cut * (c.speed || 1);
      c.transIn = null;
    }
  }
};

FL.placeClip = (clip, trackId, start) => {
  clip.trackId = trackId;
  clip.start = Math.max(0, start);
  FL.overwrite(trackId, clip.start, clip.start + clip.duration, clip.id);
  if (!FL.seq().clips.includes(clip)) FL.seq().clips.push(clip);
};

FL.splitClip = (clip, t) => {
  if (!clip || t <= clip.start + FL.MIN_CLIP / 2 || t >= clip.start + clip.duration - FL.MIN_CLIP / 2) return null;
  const right = JSON.parse(JSON.stringify(clip));
  right.id = FL.uid('clip');
  const offset = t - clip.start;
  right.start = t;
  right.duration = clip.duration - offset;
  right.in = (clip.in || 0) + offset * (clip.speed || 1);
  right.fadeIn = 0;
  right.transIn = null;
  right.atransIn = null;
  clip.duration = offset;
  clip.fadeOut = 0;
  clip.transOut = null;
  clip.atransOut = null;
  splitKf(clip, right, offset);
  // effects get fresh ids so they can be edited independently
  right.effects = (right.effects || []).map((e) => Object.assign(e, { id: FL.uid('fx') }));
  FL.seq().clips.push(right);
  return right;
};

// Splits several clips at t; the right-hand pieces of a linked pair stay linked to each other.
FL.splitClips = (list, t) => {
  const map = {};
  const rights = [];
  for (const c of [...new Set(list)]) {
    const r = FL.splitClip(c, t);
    if (!r) continue;
    if (c.link) r.link = map[c.link] = map[c.link] || FL.uid('lnk');
    rights.push(r);
  }
  return rights;
};

// ---------------------------------------------------------------- gaps
// The empty space on a track around time t, if there is a clip after it to pull left.
FL.gapAt = (trackId, t) => {
  const clips = FL.clipsOn(trackId);
  if (clips.some((c) => t >= c.start && t < c.start + c.duration)) return null;
  const before = clips.filter((c) => c.start + c.duration <= t + 1e-6);
  const after = clips.filter((c) => c.start >= t - 1e-6);
  if (!after.length) return null;
  const start = before.length ? Math.max(...before.map((c) => c.start + c.duration)) : 0;
  const end = Math.min(...after.map((c) => c.start));
  return end - start > 1e-3 ? { trackId, start, end } : null;
};
// Ripple-deletes a gap: later clips on that track slide left. Tracks holding their
// linked partners move by the same amount so video and audio stay in sync.
// Returns the amount closed (0 if nothing could move).
FL.closeGap = (gap) => {
  const eps = 1e-6;
  const clips = FL.seq().clips;
  const tracks = new Set([gap.trackId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const c of clips) {
      if (!tracks.has(c.trackId) || c.start < gap.end - eps) continue;
      for (const p of FL.partners(c)) if (!tracks.has(p.trackId)) { tracks.add(p.trackId); grew = true; }
    }
  }
  let amount = gap.end - gap.start;
  for (const tid of tracks) {
    const tr = FL.track(tid);
    if (!tr || tr.locked) return 0;
    const moving = clips.filter((c) => c.trackId === tid && c.start >= gap.end - eps);
    if (!moving.length) continue;
    const first = Math.min(...moving.map((c) => c.start));
    const staticEnd = Math.max(0, ...clips.filter((c) => c.trackId === tid && c.start < gap.end - eps).map((c) => c.start + c.duration));
    amount = Math.min(amount, first - staticEnd);
  }
  amount = Math.floor(amount * FL.fps() + 1e-6) / FL.fps();
  if (amount <= 1e-6) return 0;
  for (const c of clips) if (tracks.has(c.trackId) && c.start >= gap.end - eps) c.start = Math.max(0, c.start - amount);
  for (const m of FL.seq().markers) if (m.t >= gap.end - eps && tracks.size === FL.seq().tracks.length) m.t -= amount;
  return amount;
};
// Sequence ▸ Close Gaps: removes every gap between clips (not the space before the first clip).
FL.closeAllGaps = () => {
  let total = 0;
  for (let guard = 0; guard < 2000; guard++) {
    let done = false;
    for (const tr of [...FL.vTracks(), ...FL.aTracks()]) {
      const clips = FL.clipsOn(tr.id);
      for (let i = 1; i < clips.length && !done; i++) {
        const end = Math.max(...clips.slice(0, i).map((c) => c.start + c.duration));
        if (clips[i].start - end > 0.5 / FL.fps()) {
          const a = FL.closeGap({ trackId: tr.id, start: end, end: clips[i].start });
          if (a > 0) { total += a; done = true; }
        }
      }
      if (done) break;
    }
    if (!done) break;
  }
  return total;
};

FL.deleteClip = (id, ripple = false) => {
  const clips = FL.seq().clips;
  const c = FL.clip(id);
  if (!c) return;
  clips.splice(clips.indexOf(c), 1);
  if (ripple) {
    for (const o of clips) if (o.trackId === c.trackId && o.start >= c.start + c.duration - 1e-6) o.start -= c.duration;
  }
  FL.sel.delete(id);
  if (FL.selectedId === id) FL.selectedId = [...FL.sel].pop() || null;
};

FL.isLocked = (clip) => {
  const t = clip && FL.track(clip.trackId);
  return !!(t && t.locked);
};

FL.addTrack = (kind) => {
  const tracks = FL.seq().tracks;
  const same = tracks.filter((t) => t.kind === kind);
  const prefix = kind === 'video' ? 'V' : 'A';
  let n = same.length + 1;
  while (same.some((t) => t.name === prefix + n)) n++;
  const track = { id: FL.uid(prefix.toLowerCase()), kind, name: prefix + n };
  if (kind === 'video') tracks.unshift(track);
  else tracks.push(track);
  return track;
};

// first unlocked video track (top-down) that's free over [t0, t1); adds one if needed
FL.freeVideoTrack = (t0, t1) => {
  const tracks = FL.seq().tracks.filter((tr) => tr.kind === 'video' && !tr.locked).reverse();
  return tracks.find((tr) => !FL.seq().clips.some((o) => o.trackId === tr.id && o.start < t1 && o.start + o.duration > t0)) || FL.addTrack('video');
};

FL.editPoints = (excludeIds) => {
  const ex = new Set([].concat(excludeIds || []));
  const pts = new Set([0]);
  const seq = FL.seq();
  for (const c of seq.clips) {
    if (ex.has(c.id)) continue;
    pts.add(+c.start.toFixed(6));
    pts.add(+(c.start + c.duration).toFixed(6));
  }
  for (const m of seq.markers) pts.add(+m.t.toFixed(6));
  if (seq.inPoint != null) pts.add(seq.inPoint);
  if (seq.outPoint != null) pts.add(seq.outPoint);
  return [...pts].sort((a, b) => a - b);
};

FL.fadeFactor = (c, t) => {
  const local = t - c.start;
  let f = 1;
  if (c.fadeIn > 0 && local < c.fadeIn) f = Math.min(f, Math.max(0, local / c.fadeIn));
  if (c.fadeOut > 0 && local > c.duration - c.fadeOut) f = Math.min(f, Math.max(0, (c.duration - local) / c.fadeOut));
  return f;
};

FL.clamp = (v, a, b) => Math.min(b, Math.max(a, v));
FL.esc = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

FL.toast = (msg, ms = 2400) => {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(FL._toastT);
  FL._toastT = setTimeout(() => { el.hidden = true; }, ms);
};

FL.project = FL.newProject();
