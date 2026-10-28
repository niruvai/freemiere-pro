// Frameline — main process
// Window, native menus, file dialogs, and every FFmpeg job (probe, thumbnails,
// waveforms, preview proxies, final export) live here.

const { app, BrowserWindow, ipcMain, dialog, Menu, shell, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { buildExportArgs, projectDuration } = require('./export');

nativeTheme.themeSource = 'dark';

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
    title: 'Frameline',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
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
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'New Project', accelerator: 'CmdOrCtrl+N', click: cmd('new') },
        { label: 'Open Project…', accelerator: 'CmdOrCtrl+O', click: cmd('open') },
        { role: 'recentDocuments', submenu: [{ role: 'clearRecentDocuments' }] },
        { type: 'separator' },
        { label: 'Save', accelerator: 'CmdOrCtrl+S', click: cmd('save') },
        { label: 'Save As…', accelerator: 'Shift+CmdOrCtrl+S', click: cmd('saveAs') },
        { type: 'separator' },
        { label: 'Import Media…', accelerator: 'CmdOrCtrl+I', click: cmd('import') },
        { label: 'Export Video…', accelerator: 'CmdOrCtrl+M', click: cmd('export') },
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
        { label: 'Duplicate Clip', accelerator: 'CmdOrCtrl+D', click: cmd('duplicate') },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'Clip',
      submenu: [
        { label: 'Split at Playhead', accelerator: 'CmdOrCtrl+K', click: cmd('split') },
        { label: 'Ripple Delete', accelerator: 'Shift+Backspace', registerAccelerator: false, click: cmd('rippleDelete') },
        { label: 'Detach Audio', accelerator: 'CmdOrCtrl+L', click: cmd('detachAudio') },
        { type: 'separator' },
        { label: 'New Title', accelerator: 'CmdOrCtrl+T', click: cmd('title') },
      ],
    },
    {
      label: 'Sequence',
      submenu: [
        { label: 'Add Video Track', click: cmd('addVideoTrack') },
        { label: 'Add Audio Track', click: cmd('addAudioTrack') },
        { type: 'separator' },
        { label: 'Sequence Settings…', click: cmd('settings') },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Zoom Timeline In', accelerator: 'CmdOrCtrl+=', click: cmd('zoomIn') },
        { label: 'Zoom Timeline Out', accelerator: 'CmdOrCtrl+-', click: cmd('zoomOut') },
        { label: 'Zoom to Fit', accelerator: 'Shift+Z', registerAccelerator: false, click: cmd('zoomFit') },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
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
ipcMain.handle('media:proxy', (_e, file, type) => proxy(file, type));
ipcMain.handle('fs:exists', (_e, file) => fs.existsSync(file));

ipcMain.handle('project:save', async (_e, data, filePath) => {
  let target = filePath;
  if (!target) {
    const res = await dialog.showSaveDialog(win, {
      title: 'Save Project',
      defaultPath: 'Untitled.flproj',
      filters: [{ name: 'Frameline Project', extensions: ['flproj'] }],
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
    filters: [{ name: 'Frameline Project', extensions: ['flproj'] }],
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
  const tmp = fs.mkdtempSync(path.join(app.getPath('temp'), 'frameline-export-'));
  const textImages = {};
  for (const [clipId, dataUrl] of Object.entries(job.textImages || {})) {
    const file = path.join(tmp, `text-${clipId}.png`);
    fs.writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64'));
    textImages[clipId] = file;
  }
  const total = projectDuration(job.project);
  const args = buildExportArgs(job.project, job.options, textImages, job.outPath);
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
  buildMenu();
  createWindow();
  app.on('activate', () => { if (!win) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
