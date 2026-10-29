// Freemiere Pro — main process
// Window, native menus, file dialogs, and every FFmpeg job (probe, thumbnails,
// waveforms, preview proxies, final export) live here.

const { app, BrowserWindow, ipcMain, dialog, Menu, shell, nativeTheme, protocol } = require('electron');
const { Readable } = require('stream');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { buildExportArgs } = require('./export');

app.setName('Freemiere Pro');
nativeTheme.themeSource = 'dark';

// ---------- flmedia:// — serves imported media to the editor with byte ranges and CORS,
// so video seeks, Web Audio and canvas read-back (chroma key, export frame) all work.
protocol.registerSchemesAsPrivileged([
  { scheme: 'flmedia', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true, bypassCSP: true } },
]);
const allowedMedia = new Set();
const MIME = {
  mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska',
  mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac', ogg: 'audio/ogg', opus: 'audio/ogg',
  aif: 'audio/aiff', aiff: 'audio/aiff', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', bmp: 'image/bmp', gif: 'image/gif',
};
function serveMedia(req) {
  const file = decodeURIComponent(new URL(req.url).pathname.slice(1));
  if (!allowedMedia.has(file) || !fs.existsSync(file)) return new Response('Not found', { status: 404 });
  const size = fs.statSync(file).size;
  const headers = {
    'Content-Type': MIME[path.extname(file).slice(1).toLowerCase()] || 'application/octet-stream',
    'Accept-Ranges': 'bytes',
    'Access-Control-Allow-Origin': '*',
  };
  const range = req.headers.get('range');
  const m = range && /bytes=(\d*)-(\d*)/.exec(range);
  if (m && (m[1] || m[2])) {
    let start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
    let end = m[1] && m[2] ? Number(m[2]) : size - 1;
    end = Math.min(end, size - 1);
    if (start >= size || start > end) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
    headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
    headers['Content-Length'] = String(end - start + 1);
    return new Response(Readable.toWeb(fs.createReadStream(file, { start, end })), { status: 206, headers });
  }
  headers['Content-Length'] = String(size);
  return new Response(Readable.toWeb(fs.createReadStream(file)), { status: 200, headers });
}

// ---------- FFmpeg binaries ----------
function unpacked(p) {
  return p ? p.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`) : p;
}
function findBinary(name) {
  const envKey = name === 'ffmpeg' ? 'FRAMELINE_FFMPEG' : 'FRAMELINE_FFPROBE';
  if (process.env[envKey] && fs.existsSync(process.env[envKey])) return process.env[envKey];
  try {
    const p = name === 'ffmpeg'
      ? unpacked(require('ffmpeg-static'))
      : unpacked(require('@ffprobe-installer/ffprobe').path);
    if (p && fs.existsSync(p)) return p;
  } catch (_) { /* fall through to system copies */ }
  for (const dir of ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin']) {
    const p = path.join(dir, name);
    if (fs.existsSync(p)) return p;
  }
  return name;
}
const FFMPEG = findBinary('ffmpeg');
const FFPROBE = findBinary('ffprobe');

function run(bin, args, { onStdout, onStderr } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args);
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d; onStdout && onStdout(d.toString()); });
    child.stderr.on('data', (d) => { err += d; if (err.length > 200000) err = err.slice(-100000); onStderr && onStderr(d.toString()); });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(err.split('\n').slice(-12).join('\n') || `exit ${code}`))));
  });
}

// ---------- Cache folder for thumbnails / waveforms / proxies ----------
function cacheDir() {
  const dir = path.join(app.getPath('userData'), 'media-cache');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
function cacheName(file, suffix) {
  let stamp = '';
  try { const s = fs.statSync(file); stamp = `${s.size}-${s.mtimeMs}`; } catch (_) {}
  return path.join(cacheDir(), crypto.createHash('sha1').update(file + stamp).digest('hex').slice(0, 20) + suffix);
}

const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'tif', 'tiff'];
const AUDIO_EXT = ['mp3', 'wav', 'aac', 'm4a', 'flac', 'ogg', 'opus', 'aif', 'aiff'];
const VIDEO_EXT = ['mp4', 'mov', 'm4v', 'mkv', 'webm', 'avi', 'mts', 'm2ts', 'mpg', 'mpeg', 'gif', '3gp', 'wmv', 'flv'];

async function probe(file) {
  const ext = path.extname(file).slice(1).toLowerCase();
  const json = JSON.parse(await run(FFPROBE, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file]));
  const streams = json.streams || [];
  const v = streams.find((s) => s.codec_type === 'video' && !(s.disposition && s.disposition.attached_pic));
  const a = streams.find((s) => s.codec_type === 'audio');
  let duration = parseFloat(json.format && json.format.duration) || parseFloat(v && v.duration) || parseFloat(a && a.duration) || 0;
  let type;
  if (IMAGE_EXT.includes(ext)) type = 'image';
  else if (v) type = 'video';
  else if (a) type = 'audio';
  else throw new Error('No playable video or audio stream found');

  let width = v ? v.width : 0;
  let height = v ? v.height : 0;
  let rotation = 0;
  if (v) {
    if (v.tags && v.tags.rotate) rotation = parseInt(v.tags.rotate, 10) || 0;
    const sd = (v.side_data_list || []).find((d) => d.rotation !== undefined);
    if (sd) rotation = sd.rotation;
    if (Math.abs(rotation) % 180 === 90) [width, height] = [height, width];
    // honour non-square pixels
    if (v.sample_aspect_ratio && /^\d+:\d+$/.test(v.sample_aspect_ratio) && v.sample_aspect_ratio !== '0:1' && v.sample_aspect_ratio !== '1:1') {
      const [n, d] = v.sample_aspect_ratio.split(':').map(Number);
      if (n && d) width = Math.round((width * n) / d);
    }
  }
  let fps = 0;
  if (v && v.avg_frame_rate && v.avg_frame_rate.includes('/')) {
    const [n, d] = v.avg_frame_rate.split('/').map(Number);
    if (d) fps = n / d;
  }
  if (type === 'image') duration = 0;
  return {
    type,
    duration,
    width,
    height,
    fps,
    hasAudio: !!a && type !== 'image',
    channels: a ? a.channels || 2 : 0,
    hasVideo: type !== 'audio',
    videoCodec: v ? v.codec_name : null,
    audioCodec: a ? a.codec_name : null,
  };
}

async function thumbnail(file, type, duration) {
  const out = cacheName(file, '.jpg');
  if (fs.existsSync(out)) return out;
  const args = ['-y', '-v', 'error'];
  if (type === 'video') args.push('-ss', String(Math.min(1, (duration || 0) / 3)));
  args.push('-i', file, '-frames:v', '1', '-vf', 'scale=320:-2', '-q:v', '4', out);
  await run(FFMPEG, args);
  return out;
}

async function waveform(file) {
  const out = cacheName(file, '.wave.png');
  if (fs.existsSync(out)) return out;
  await run(FFMPEG, ['-y', '-v', 'error', '-i', file, '-filter_complex',
    'aformat=channel_layouts=mono,showwavespic=s=4000x120:colors=0xb6f2c8:scale=sqrt', '-frames:v', '1', out]);
  return out;
}

async function proxy(file, type) {
  if (type === 'image') {
    const out = cacheName(file, '.proxy.png');
    if (!fs.existsSync(out)) await run(FFMPEG, ['-y', '-v', 'error', '-i', file, '-frames:v', '1', out]);
    return out;
  }
  const out = cacheName(file, '.proxy.mp4');
  if (fs.existsSync(out)) return out;
  const tmp = out + '.part.mp4';
  await run(FFMPEG, ['-y', '-v', 'error', '-i', file, '-map', '0:v:0', '-map', '0:a:0?',
    '-vf', "scale='min(1280,iw)':-2,format=yuv420p", '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '24',
    '-g', '15', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', tmp]);
  fs.renameSync(tmp, out);
  return out;
}
async function proxyAllowed(file, type) {
  const out = await proxy(file, type);
  allowedMedia.add(out);
  return out;
}

// ---------- Window ----------
let win = null;
let dirty = false;
let pendingOpenFile = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1500,
    height: 920,
    minWidth: 1100,
    minHeight: 680,
    backgroundColor: '#141416',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 14, y: 14 },
    title: 'Freemiere Pro',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());
  win.webContents.once('did-finish-load', () => {
    if (pendingOpenFile) { openProjectFile(pendingOpenFile); pendingOpenFile = null; }
  });
  win.on('close', (e) => {
    if (!dirty) return;
    const choice = dialog.showMessageBoxSync(win, {
      type: 'warning',
      buttons: ['Quit Without Saving', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      message: 'You have unsaved changes.',
      detail: 'Your edits since the last save will be lost.',
    });
    if (choice === 1) e.preventDefault();
  });
  win.on('closed', () => { win = null; });

  // Test hook: FRAMELINE_SCREENSHOT=path writes a screenshot after load and quits.
  if (process.env.FRAMELINE_SCREENSHOT) {
    win.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        try {
          if (process.env.FRAMELINE_DEMO) await win.webContents.executeJavaScript(`window.__demo && window.__demo(${JSON.stringify(process.env.FRAMELINE_DEMO)})`);
          await new Promise((r) => setTimeout(r, Number(process.env.FRAMELINE_WAIT || 3000)));
          if (process.env.FRAMELINE_EVAL) {
            const out = await win.webContents.executeJavaScript(fs.readFileSync(process.env.FRAMELINE_EVAL, 'utf8'));
            console.log('EVAL_RESULT ' + JSON.stringify(out));
            await new Promise((r) => setTimeout(r, 1500));
          }
          const img = await win.webContents.capturePage();
          fs.writeFileSync(process.env.FRAMELINE_SCREENSHOT, img.toPNG());
        } catch (err) { console.error(err); }
        dirty = false;
        app.exit(0);
      }, 800);
    });
  }
}

function send(channel, ...args) { if (win) win.webContents.send(channel, ...args); }

async function openProjectFile(file) {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    send('project:loaded', { path: file, data });
    app.addRecentDocument(file);
  } catch (err) {
    dialog.showErrorBox('Could not open project', String(err.message || err));
  }
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const cmd = (name) => () => send('menu', name);
  // Single-key shortcuts are shown in menus but handled by the editor, so they never steal typing.
  const show = (accelerator) => ({ accelerator, registerAccelerator: false });
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'New Project', accelerator: 'Alt+CmdOrCtrl+N', click: cmd('new') },
        { label: 'New Sequence', accelerator: 'CmdOrCtrl+N', click: cmd('newSequence') },
        { label: 'Open Project…', accelerator: 'CmdOrCtrl+O', click: cmd('open') },
        { role: 'recentDocuments', submenu: [{ role: 'clearRecentDocuments' }] },
        { type: 'separator' },
        { label: 'Save', accelerator: 'CmdOrCtrl+S', click: cmd('save') },
        { label: 'Save As…', accelerator: 'Shift+CmdOrCtrl+S', click: cmd('saveAs') },
        { type: 'separator' },
        { label: 'Import…', accelerator: 'CmdOrCtrl+I', click: cmd('import') },
        { label: 'Export Media…', accelerator: 'CmdOrCtrl+M', click: cmd('export') },
        { label: 'Export Frame…', accelerator: 'Shift+CmdOrCtrl+E', click: cmd('exportFrame') },
        ...(isMac ? [] : [{ type: 'separator' }, { role: 'quit' }]),
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: cmd('undo') },
        { label: 'Redo', accelerator: 'Shift+CmdOrCtrl+Z', click: cmd('redo') },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { label: 'Paste Attributes', accelerator: 'Alt+CmdOrCtrl+V', click: cmd('pasteAttributes') },
        { label: 'Duplicate', accelerator: 'Alt+CmdOrCtrl+D', click: cmd('duplicate') },
        { label: 'Clear', ...show('Backspace'), click: cmd('delete') },
        { label: 'Ripple Delete', ...show('Shift+Backspace'), click: cmd('rippleDelete') },
        { type: 'separator' },
        { label: 'Select All', accelerator: 'CmdOrCtrl+A', click: cmd('selectAll') },
        { label: 'Deselect All', accelerator: 'Shift+CmdOrCtrl+A', click: cmd('deselect') },
      ],
    },
    {
      label: 'Clip',
      submenu: [
        { label: 'Add Edit', accelerator: 'CmdOrCtrl+K', click: cmd('split') },
        { label: 'Add Edit to All Tracks', accelerator: 'Shift+CmdOrCtrl+K', click: cmd('splitAll') },
        { label: 'Ripple Trim Previous Edit to Playhead', ...show('Q'), click: cmd('rippleTrimPrev') },
        { label: 'Ripple Trim Next Edit to Playhead', ...show('W'), click: cmd('rippleTrimNext') },
        { type: 'separator' },
        { label: 'Apply Video Transition', accelerator: 'CmdOrCtrl+D', click: cmd('applyVideoTransition') },
        { label: 'Apply Audio Transition', accelerator: 'Shift+CmdOrCtrl+D', click: cmd('applyAudioTransition') },
        { type: 'separator' },
        { label: 'Link / Unlink', accelerator: 'CmdOrCtrl+L', click: cmd('toggleLink') },
        { label: 'Linked Selection', click: cmd('toggleLinkSel') },
        { label: 'Enable / Disable Effects', accelerator: 'Shift+E', registerAccelerator: false, click: cmd('toggleFx') },
        { label: 'Scale to Frame Size', click: cmd('fill') },
      ],
    },
    {
      label: 'Sequence',
      submenu: [
        { label: 'Sequence Settings…', click: cmd('settings') },
        { type: 'separator' },
        { label: 'Mark In', ...show('I'), click: cmd('markIn') },
        { label: 'Mark Out', ...show('O'), click: cmd('markOut') },
        { label: 'Clear In and Out', ...show('Alt+X'), click: cmd('clearInOut') },
        { type: 'separator' },
        { label: 'Add Marker', ...show('M'), click: cmd('addMarker') },
        { label: 'Go to Next Marker', ...show('Shift+M'), click: cmd('nextMarker') },
        { label: 'Go to Previous Marker', ...show('Alt+Shift+M'), click: cmd('prevMarker') },
        { type: 'separator' },
        { label: 'Snap in Timeline', ...show('S'), click: cmd('toggleSnap') },
        { label: 'Add Video Track', click: cmd('addVideoTrack') },
        { label: 'Add Audio Track', click: cmd('addAudioTrack') },
      ],
    },
    {
      label: 'Graphics',
      submenu: [
        { label: 'New Title', accelerator: 'CmdOrCtrl+T', click: cmd('title') },
        { label: 'New Adjustment Layer', click: cmd('adjustLayer') },
        { label: 'New Color Matte', click: cmd('colorMatte') },
        { type: 'separator' },
        { label: 'News Headline Bar', click: cmd('gfx:headline') },
        { label: 'Scrolling Ticker', click: cmd('gfx:ticker') },
        { label: 'Lower Third', click: cmd('gfx:lowerthird') },
        { label: 'Breaking News', click: cmd('gfx:breaking') },
        { label: 'Live Bug', click: cmd('gfx:live') },
        { label: 'Caption Box', click: cmd('gfx:caption') },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Zoom Timeline In', ...show('='), click: cmd('zoomIn') },
        { label: 'Zoom Timeline Out', ...show('-'), click: cmd('zoomOut') },
        { label: 'Zoom to Sequence', ...show('\\'), click: cmd('zoomFit') },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        {
          label: 'Workspaces',
          submenu: [
            ...['Editing', 'Effects', 'Assembly', 'Audio', 'Graphics', 'Classic'].map((n, i) => ({ label: n, accelerator: `Alt+Shift+${i + 1}`, click: cmd(`ws:${n}`) })),
            { type: 'separator' },
            { label: 'Reset to Saved Layout', accelerator: 'Alt+Shift+0', click: cmd('ws:reset') },
          ],
        },
        { label: 'Maximize / Restore Panel', accelerator: '`', registerAccelerator: false, click: cmd('maximize') },
        { type: 'separator' },
        { label: 'Project', accelerator: 'Shift+1', registerAccelerator: false, click: cmd('panel:project') },
        { label: 'Source Monitor', accelerator: 'Shift+2', registerAccelerator: false, click: cmd('panel:source') },
        { label: 'Timeline', accelerator: 'Shift+3', registerAccelerator: false, click: cmd('panel:timeline') },
        { label: 'Program Monitor', accelerator: 'Shift+4', registerAccelerator: false, click: cmd('panel:program') },
        { label: 'Effect Controls', accelerator: 'Shift+5', registerAccelerator: false, click: cmd('panel:effectcontrols') },
        { label: 'Audio Meters', accelerator: 'Shift+6', registerAccelerator: false, click: cmd('panel:meters') },
        { label: 'Effects', accelerator: 'Shift+7', registerAccelerator: false, click: cmd('panel:effects') },
        { label: 'Essential Graphics', click: cmd('panel:graphics') },
        { label: 'Markers', click: cmd('panel:markers') },
        { type: 'separator' },
        { role: 'minimize' },
        { role: 'zoom' },
      ],
    },
    {
      role: 'help',
      submenu: [{ label: 'Keyboard Shortcuts', click: cmd('shortcuts') }],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------- IPC ----------
ipcMain.handle('media:pick', async () => {
  const res = await dialog.showOpenDialog(win, {
    title: 'Import Media',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Media', extensions: [...VIDEO_EXT, ...AUDIO_EXT, ...IMAGE_EXT] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });
  return res.canceled ? [] : res.filePaths;
});
ipcMain.handle('media:probe', (_e, file) => probe(file));
ipcMain.handle('media:thumb', (_e, file, type, duration) => thumbnail(file, type, duration));
ipcMain.handle('media:wave', (_e, file) => waveform(file));
ipcMain.handle('media:proxy', (_e, file, type) => proxyAllowed(file, type));
ipcMain.handle('media:allow', (_e, files) => { for (const f of files || []) if (f) allowedMedia.add(f); return true; });
ipcMain.handle('frame:save', async (_e, dataUrl, name) => {
  const res = await dialog.showSaveDialog(win, {
    title: 'Export Frame',
    defaultPath: path.join(app.getPath('pictures'), name || 'Frame.png'),
    filters: [{ name: 'PNG Image', extensions: ['png'] }],
  });
  if (res.canceled || !res.filePath) return null;
  fs.writeFileSync(res.filePath, Buffer.from(dataUrl.split(',')[1], 'base64'));
  allowedMedia.add(res.filePath);
  return res.filePath;
});
ipcMain.handle('fs:exists', (_e, file) => fs.existsSync(file));

ipcMain.handle('project:save', async (_e, data, filePath) => {
  let target = filePath;
  if (!target) {
    const res = await dialog.showSaveDialog(win, {
      title: 'Save Project',
      defaultPath: 'Untitled.fpproj',
      filters: [{ name: 'Freemiere Pro Project', extensions: ['fpproj'] }],
    });
    if (res.canceled) return null;
    target = res.filePath;
  }
  fs.writeFileSync(target, JSON.stringify(data, null, 2));
  app.addRecentDocument(target);
  return target;
});
ipcMain.handle('project:open', async () => {
  const res = await dialog.showOpenDialog(win, {
    title: 'Open Project',
    properties: ['openFile'],
    filters: [{ name: 'Freemiere Pro Project', extensions: ['fpproj', 'flproj'] }],
  });
  if (res.canceled || !res.filePaths[0]) return null;
  const file = res.filePaths[0];
  app.addRecentDocument(file);
  return { path: file, data: JSON.parse(fs.readFileSync(file, 'utf8')) };
});
ipcMain.handle('confirm:discard', async () => {
  if (!dirty) return true;
  const r = await dialog.showMessageBox(win, {
    type: 'warning',
    buttons: ['Discard Changes', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    message: 'Discard unsaved changes?',
  });
  return r.response === 0;
});
ipcMain.on('state:dirty', (_e, value, title) => {
  dirty = !!value;
  if (win) {
    win.setDocumentEdited && win.setDocumentEdited(dirty);
    if (title) win.setTitle(title);
  }
});
ipcMain.handle('shell:reveal', (_e, file) => shell.showItemInFolder(file));

ipcMain.handle('export:pick', async (_e, defaultName) => {
  const res = await dialog.showSaveDialog(win, {
    title: 'Export Video',
    defaultPath: path.join(app.getPath('movies'), defaultName || 'Untitled.mp4'),
    filters: [{ name: 'MPEG-4 Video', extensions: ['mp4'] }, { name: 'QuickTime Movie', extensions: ['mov'] }],
  });
  return res.canceled ? null : res.filePath;
});

let exportChild = null;
let exportCancelled = false;
ipcMain.handle('export:start', async (_e, job) => {
  const tmp = fs.mkdtempSync(path.join(app.getPath('temp'), 'freemiere-export-'));
  const images = {};
  let n = 0;
  for (const [key, dataUrl] of Object.entries(job.images || {})) {
    const file = path.join(tmp, `asset-${n++}.png`);
    fs.writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64'));
    images[key] = file;
  }
  // projects made before channel counts were recorded: look them up now
  for (const m of job.project.media || []) {
    if (m.hasAudio && !m.channels) { try { m.channels = (await probe(m.path)).channels; } catch (_) { /* keep default */ } }
  }
  let built;
  try {
    built = buildExportArgs(job.project, Object.assign({ seqId: job.seqId }, job.options), { images, meta: job.meta || {} }, job.outPath, tmp);
  } catch (err) {
    fs.rmSync(tmp, { recursive: true, force: true });
    return { ok: false, error: 'Could not prepare export: ' + (err.message || err) };
  }
  const { args, total } = built;
  exportCancelled = false;
  const started = Date.now();
  try {
    await new Promise((resolve, reject) => {
      exportChild = spawn(FFMPEG, args);
      let err = '';
      let buf = '';
      exportChild.stdout.on('data', (d) => {
        buf += d.toString();
        const lines = buf.split('\n');
        buf = lines.pop();
        for (const line of lines) {
          const m = line.match(/^out_time_(?:us|ms)=(\d+)/);
          if (m) {
            const sec = Number(m[1]) / 1e6;
            const pct = Math.max(0, Math.min(1, sec / total));
            const elapsed = (Date.now() - started) / 1000;
            send('export:progress', { pct, eta: pct > 0.02 ? (elapsed / pct) * (1 - pct) : null });
          }
        }
      });
      exportChild.stderr.on('data', (d) => { err += d; if (err.length > 200000) err = err.slice(-100000); });
      exportChild.on('error', reject);
      exportChild.on('close', (code) => {
        exportChild = null;
        if (exportCancelled) return reject(new Error('cancelled'));
        if (code === 0) resolve();
        else reject(new Error(err.split('\n').filter(Boolean).slice(-8).join('\n')));
      });
    });
    send('export:progress', { pct: 1, eta: 0 });
    return { ok: true, path: job.outPath, seconds: (Date.now() - started) / 1000 };
  } catch (err) {
    if (exportCancelled) { try { fs.unlinkSync(job.outPath); } catch (_) {} }
    return { ok: false, cancelled: exportCancelled, error: String(err.message || err) };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
ipcMain.handle('export:cancel', () => {
  if (exportChild) { exportCancelled = true; exportChild.kill('SIGKILL'); }
});

// ---------- App lifecycle ----------
app.on('open-file', (e, file) => {
  e.preventDefault();
  if (win && !win.webContents.isLoading()) openProjectFile(file);
  else pendingOpenFile = file;
});

app.whenReady().then(() => {
  protocol.handle('flmedia', serveMedia);
  buildMenu();
  createWindow();
  app.on('activate', () => { if (!win) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
