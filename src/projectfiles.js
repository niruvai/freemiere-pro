// Freemiere Pro — files around a project: auto-save and crash recovery, relinking
// offline media, graphics templates (.fpgfx) and reading .cube LUTs.
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let userData = null;
const init = (dir) => { userData = dir; };
const dirOf = (name) => { const d = path.join(userData, name); fs.mkdirSync(d, { recursive: true }); return d; };

// ---------------------------------------------------------------- auto-save
// Copies go to <userData>/Auto-Save/<project>-<hash>/<project> <date>.fpproj; the newest
// `keep` are kept per project. session.json remembers the newest copy while there are
// unsaved changes, so a crash can be recovered on the next launch.
const sessionFile = () => path.join(userData, 'session.json');
const stamp = () => new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
const safe = (s) => String(s || 'Untitled').replace(/[\\/:*?"<>|]/g, '-').slice(0, 80);

function autosave(data, { projectPath, name, keep = 10 }) {
  const key = crypto.createHash('sha1').update(projectPath || 'untitled:' + name).digest('hex').slice(0, 8);
  const dir = path.join(dirOf('Auto-Save'), `${safe(name)}-${key}`);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${safe(name)} ${stamp()}.fpproj`);
  const tmp = file + '.part';
  fs.writeFileSync(tmp, JSON.stringify(Object.assign({}, data, { autosave: { projectPath: projectPath || null, name, savedAt: Date.now() } })));
  fs.renameSync(tmp, file);
  const old = fs.readdirSync(dir).filter((f) => f.endsWith('.fpproj')).sort().reverse().slice(keep);
  for (const f of old) { try { fs.unlinkSync(path.join(dir, f)); } catch (_) {} }
  writeSession({ dirty: true, autosave: file, projectPath: projectPath || null, name, time: Date.now() });
  return file;
}
function writeSession(s) { try { fs.writeFileSync(sessionFile(), JSON.stringify(s)); } catch (_) {} }
function markClean() { try { fs.unlinkSync(sessionFile()); } catch (_) {} }
// What to offer at launch: the auto-save of a session that ended with unsaved changes.
function pendingRecovery() {
  try {
    const s = JSON.parse(fs.readFileSync(sessionFile(), 'utf8'));
    if (!s.dirty || !s.autosave || !fs.existsSync(s.autosave)) return null;
    // nothing to recover if the project was saved after the auto-save
    if (s.projectPath && fs.existsSync(s.projectPath) && fs.statSync(s.projectPath).mtimeMs >= fs.statSync(s.autosave).mtimeMs) return null;
    return s;
  } catch (_) { return null; }
}
function listAutosaves() {
  const root = dirOf('Auto-Save');
  const out = [];
  for (const d of fs.readdirSync(root)) {
    const dir = path.join(root, d);
    try {
      if (!fs.statSync(dir).isDirectory()) continue;
      for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith('.fpproj')) continue;
        const p = path.join(dir, f);
        out.push({ path: p, name: f.replace(/\.fpproj$/, ''), modified: fs.statSync(p).mtimeMs });
      }
    } catch (_) {}
  }
  return out.sort((a, b) => b.modified - a.modified).slice(0, 60);
}
function autosaveFolder() { return dirOf('Auto-Save'); }

// ---------------------------------------------------------------- relink
// Looks for files by name under `folder` (a few levels deep). names: [basename]
function searchFolder(folder, names, { depth = 5, limit = 20000 } = {}) {
  const want = new Map(names.map((n) => [n.toLowerCase(), n]));
  const found = {};
  let seen = 0;
  const walk = (dir, d) => {
    if (d > depth || seen > limit || Object.keys(found).length === want.size) return;
    let list;
    try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const e of list) {
      seen++;
      if (e.name.startsWith('.')) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (!/^(node_modules|Library|\.Trash)$/.test(e.name)) walk(p, d + 1); }
      else {
        const k = e.name.toLowerCase();
        if (want.has(k) && !found[want.get(k)]) found[want.get(k)] = p;
      }
    }
  };
  walk(folder, 0);
  return found;
}

// ---------------------------------------------------------------- graphics templates
const TEMPLATE_FORMAT = 'freemiere-graphic';
const templatesDir = () => dirOf('Templates');
function listTemplates() {
  const out = [];
  for (const f of fs.readdirSync(templatesDir())) {
    if (!f.endsWith('.fpgfx')) continue;
    const p = path.join(templatesDir(), f);
    try {
      const t = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (t.format !== TEMPLATE_FORMAT) continue;
      out.push(Object.assign(t, { path: p }));
    } catch (_) { /* skip broken files */ }
  }
  return out.sort((a, b) => String(a.name).localeCompare(String(b.name)));
}
function validTemplate(t) {
  return t && t.format === TEMPLATE_FORMAT && Array.isArray(t.clips) && t.clips.length > 0 && t.clips.length <= 40 &&
    t.clips.every((c) => c && typeof c === 'object' && ['text', 'graphic', 'solid', 'image', 'adjust'].includes(c.type));
}
function saveTemplate(t) {
  if (!validTemplate(t)) throw new Error('This selection can’t be saved as a template.');
  const file = path.join(templatesDir(), `${safe(t.name)}.fpgfx`);
  let target = file;
  for (let i = 2; fs.existsSync(target); i++) target = file.replace(/\.fpgfx$/, ` ${i}.fpgfx`);
  fs.writeFileSync(target, JSON.stringify(t, null, 1));
  return target;
}
function importTemplateFile(src) {
  const t = JSON.parse(fs.readFileSync(src, 'utf8'));
  if (!validTemplate(t)) throw new Error(`${path.basename(src)} is not a Freemiere Pro graphics template.`);
  return saveTemplate(t);
}
function deleteTemplate(file) {
  if (path.dirname(path.resolve(file)) !== path.resolve(templatesDir())) throw new Error('Not a template file');
  fs.unlinkSync(file);
}
// Images inside a template are embedded as data URLs; they are written out once by content hash.
function templateAsset(dataUrl, ext = 'png') {
  const m = /^data:image\/(png|jpeg|webp);base64,(.+)$/.exec(dataUrl || '');
  if (!m) throw new Error('Unsupported image in template');
  const buf = Buffer.from(m[2], 'base64');
  const file = path.join(dirOf('Templates/assets'), crypto.createHash('sha1').update(buf).digest('hex').slice(0, 16) + '.' + (m[1] === 'jpeg' ? 'jpg' : m[1] || ext));
  if (!fs.existsSync(file)) fs.writeFileSync(file, buf);
  return file;
}

// ---------------------------------------------------------------- LUTs
// Parses an Adobe/Resolve .cube 3D LUT: { size, data: [r,g,b,…] } with red changing fastest.
function readCube(file) {
  const text = fs.readFileSync(file, 'utf8');
  let size = 0;
  let min = [0, 0, 0];
  let max = [1, 1, 1];
  const vals = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split(/\s+/);
    const key = parts[0].toUpperCase();
    if (key === 'LUT_3D_SIZE') { size = parseInt(parts[1], 10); continue; }
    if (key === 'LUT_1D_SIZE') throw new Error('1D LUTs are not supported — use a 3D .cube file');
    if (key === 'DOMAIN_MIN') { min = parts.slice(1, 4).map(Number); continue; }
    if (key === 'DOMAIN_MAX') { max = parts.slice(1, 4).map(Number); continue; }
    if (/^[A-Z_]+$/.test(key)) continue; // TITLE and other keywords
    if (parts.length >= 3) {
      for (let i = 0; i < 3; i++) vals.push((Number(parts[i]) - min[i]) / ((max[i] - min[i]) || 1));
    }
  }
  if (!size || size < 2 || size > 128) throw new Error('Missing or invalid LUT_3D_SIZE');
  if (vals.length !== size * size * size * 3) throw new Error(`Expected ${size ** 3} entries, found ${vals.length / 3}`);
  return { size, data: vals };
}

module.exports = {
  init, autosave, markClean, writeSession, pendingRecovery, listAutosaves, autosaveFolder,
  searchFolder, listTemplates, saveTemplate, importTemplateFile, deleteTemplate, templateAsset, templatesDir,
  readCube, TEMPLATE_FORMAT,
};
