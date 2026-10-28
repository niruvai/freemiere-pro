/* Frameline — core model: project data, time helpers, undo/redo and edit operations.
   Every other script reads and mutates `FL.project` through these helpers. */
'use strict';

const FL = (window.FL = {
  project: null,
  filePath: null,
  dirty: false,
  time: 0,
  playing: false,
  selectedId: null,
  tool: 'select',
  snap: true,
  pxPerSec: 60,
  clipboard: null,
  undoStack: [],
  redoStack: [],
  listeners: {},
});

FL.MIN_CLIP = 1 / 30;
FL.uid = (p = 'id') => p + '_' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);

FL.on = (evt, fn) => { (FL.listeners[evt] = FL.listeners[evt] || []).push(fn); };
FL.emit = (evt, ...args) => { (FL.listeners[evt] || []).forEach((fn) => fn(...args)); };

FL.newProject = () => ({
  version: 1,
  settings: { width: 1920, height: 1080, fps: 30, bg: '#000000' },
  media: [],
  tracks: [
    { id: 'v2', kind: 'video', name: 'V2' },
    { id: 'v1', kind: 'video', name: 'V1' },
    { id: 'a1', kind: 'audio', name: 'A1' },
    { id: 'a2', kind: 'audio', name: 'A2' },
  ],
  clips: [],
});

// ---------- time ----------
FL.fps = () => FL.project.settings.fps;
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
FL.shortTime = (t) => {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return m ? `${m}:${s.toFixed(1).padStart(4, '0')}` : `${s.toFixed(1)}s`;
};
FL.duration = () => FL.project.clips.reduce((e, c) => Math.max(e, c.start + c.duration), 0);

// ---------- lookups ----------
FL.media = (id) => FL.project.media.find((m) => m.id === id);
FL.track = (id) => FL.project.tracks.find((t) => t.id === id);
FL.clip = (id) => FL.project.clips.find((c) => c.id === id);
FL.selected = () => (FL.selectedId ? FL.clip(FL.selectedId) : null);
FL.clipsOn = (trackId) => FL.project.clips.filter((c) => c.trackId === trackId).sort((a, b) => a.start - b.start);
FL.clipAt = (trackId, t) => FL.project.clips.find((c) => c.trackId === trackId && t >= c.start && t < c.start + c.duration);
FL.kindFor = (clipType) => (clipType === 'audio' ? 'audio' : 'video');
FL.clipName = (c) => {
  if (c.type === 'text') return (c.text || 'Title').split('\n')[0] || 'Title';
  const m = FL.media(c.mediaId);
  return m ? m.name : 'Missing media';
};
FL.mediaLimit = (c) => {
  // How long the clip may be (in timeline seconds) given its source in-point.
  if (c.type === 'text' || c.type === 'image') return Infinity;
  const m = FL.media(c.mediaId);
  if (!m || !m.duration) return Infinity;
  return (m.duration - (c.in || 0)) / (c.speed || 1);
};

// ---------- undo ----------
FL.snapshot = () => JSON.stringify({ project: FL.project, selectedId: FL.selectedId });
FL.pushUndo = () => {
  FL.undoStack.push(FL.snapshot());
  if (FL.undoStack.length > 200) FL.undoStack.shift();
  FL.redoStack = [];
};
FL.restore = (snap) => {
  const s = JSON.parse(snap);
  FL.project = s.project;
  FL.selectedId = s.selectedId && FL.clip(s.selectedId) ? s.selectedId : null;
};
FL.undo = () => {
  if (!FL.undoStack.length) return;
  FL.redoStack.push(FL.snapshot());
  FL.restore(FL.undoStack.pop());
  FL.changed();
};
FL.redo = () => {
  if (!FL.redoStack.length) return;
  FL.undoStack.push(FL.snapshot());
  FL.restore(FL.redoStack.pop());
  FL.changed();
};

// Call after any mutation of the project.
FL.changed = (opts = {}) => {
  FL.setDirty(true);
  FL.emit('change', opts);
};
FL.setDirty = (d) => {
  FL.dirty = d;
  const name = FL.filePath ? FL.filePath.split(/[\\/]/).pop().replace(/\.flproj$/, '') : 'Untitled';
  window.api.setDirty(d, `${name}${d ? ' — Edited' : ''} — Frameline`);
  FL.emit('title', name, d);
};

// ---------- clip factory ----------
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
  muted: false,
  opacity: 1,
  scale: 1,
  x: 0,
  y: 0,
  rotation: 0,
  fadeIn: 0,
  fadeOut: 0,
  brightness: 0,
  contrast: 0,
  saturation: 100,
}, props);

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

FL.clipFromMedia = (media, trackKind) => {
  if (media.type === 'image') return FL.makeClip({ type: 'image', mediaId: media.id, duration: 5 });
  if (media.type === 'audio' || trackKind === 'audio') return FL.makeClip({ type: 'audio', mediaId: media.id, duration: media.duration });
  return FL.makeClip({ type: 'video', mediaId: media.id, duration: media.duration });
};

// ---------- editing operations (callers push undo first) ----------

// Premiere-style overwrite: clears [start, end) on a track, trimming or splitting what's there.
FL.overwrite = (trackId, start, end, exceptId) => {
  const eps = 1e-6;
  for (const c of FL.project.clips.slice()) {
    if (c.trackId !== trackId || c.id === exceptId) continue;
    const cs = c.start;
    const ce = c.start + c.duration;
    if (ce <= start + eps || cs >= end - eps) continue;
    if (cs >= start - eps && ce <= end + eps) {
      FL.project.clips.splice(FL.project.clips.indexOf(c), 1);
    } else if (cs < start && ce > end) {
      const tail = JSON.parse(JSON.stringify(c));
      tail.id = FL.uid('clip');
      const cut = end - cs;
      tail.start = end;
      tail.duration = ce - end;
      tail.in = (c.in || 0) + cut * (c.speed || 1);
      tail.fadeIn = 0;
      c.duration = start - cs;
      c.fadeOut = 0;
      FL.project.clips.push(tail);
    } else if (cs < start) {
      c.duration = start - cs;
    } else {
      const cut = end - cs;
      c.start = end;
      c.duration = ce - end;
      c.in = (c.in || 0) + cut * (c.speed || 1);
    }
  }
};

FL.placeClip = (clip, trackId, start) => {
  clip.trackId = trackId;
  clip.start = Math.max(0, start);
  FL.overwrite(trackId, clip.start, clip.start + clip.duration, clip.id);
  if (!FL.project.clips.includes(clip)) FL.project.clips.push(clip);
};

FL.splitClip = (clip, t) => {
  if (!clip || t <= clip.start + FL.MIN_CLIP || t >= clip.start + clip.duration - FL.MIN_CLIP) return null;
  const right = JSON.parse(JSON.stringify(clip));
  right.id = FL.uid('clip');
  const offset = t - clip.start;
  right.start = t;
  right.duration = clip.duration - offset;
  right.in = (clip.in || 0) + offset * (clip.speed || 1);
  right.fadeIn = 0;
  clip.duration = offset;
  clip.fadeOut = 0;
  FL.project.clips.push(right);
  return right;
};

FL.deleteClip = (id, ripple = false) => {
  const c = FL.clip(id);
  if (!c) return;
  FL.project.clips.splice(FL.project.clips.indexOf(c), 1);
  if (ripple) {
    for (const o of FL.project.clips) if (o.trackId === c.trackId && o.start >= c.start + c.duration - 1e-6) o.start -= c.duration;
  }
  if (FL.selectedId === id) FL.selectedId = null;
};

FL.isLocked = (clip) => {
  const t = clip && FL.track(clip.trackId);
  return !!(t && t.locked);
};

FL.addTrack = (kind) => {
  const same = FL.project.tracks.filter((t) => t.kind === kind);
  const n = same.length + 1;
  const prefix = kind === 'video' ? 'V' : 'A';
  const track = { id: FL.uid(prefix.toLowerCase()), kind, name: prefix + n };
  if (kind === 'video') FL.project.tracks.unshift(track);
  else FL.project.tracks.push(track);
  return track;
};

// Edit points for ↑/↓ navigation and snapping.
FL.editPoints = (excludeId) => {
  const pts = new Set([0]);
  for (const c of FL.project.clips) {
    if (c.id === excludeId) continue;
    pts.add(+c.start.toFixed(6));
    pts.add(+(c.start + c.duration).toFixed(6));
  }
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
