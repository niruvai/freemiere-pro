#!/usr/bin/env node
// Makes sure the Electron runtime and the FFmpeg/FFprobe binaries are really
// installed. Newer npm versions can skip dependency install scripts, which
// leaves Electron without its app bundle ("Electron failed to install
// correctly"). This script fixes that by downloading and unpacking it directly.
// It runs on postinstall and before every `npm start`, and is instant when
// everything is already in place.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');

const root = path.resolve(__dirname, '..');
const quiet = process.argv.includes('--quiet');
const log = (...a) => { if (!quiet) console.log('[setup]', ...a); };

function electronPlatformPath() {
  if (process.platform === 'darwin' || process.platform === 'mas') return 'Electron.app/Contents/MacOS/Electron';
  if (process.platform === 'win32') return 'electron.exe';
  return 'electron';
}

async function download(url, dest) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`Download failed (${res.status}) ${url}`);
  const total = Number(res.headers.get('content-length')) || 0;
  let got = 0;
  let lastPct = -10;
  const body = Readable.fromWeb(res.body);
  body.on('data', (chunk) => {
    got += chunk.length;
    if (total && !quiet && process.stdout.isTTY) {
      const pct = Math.floor((got / total) * 100);
      if (pct >= lastPct + 10) { lastPct = pct; process.stdout.write(`\r[setup] downloading… ${pct}%`); }
    }
  });
  await pipeline(body, fs.createWriteStream(dest));
  if (!quiet && total && process.stdout.isTTY) process.stdout.write('\n');
}

function unzip(zip, dir) {
  fs.mkdirSync(dir, { recursive: true });
  if (process.platform === 'darwin') execFileSync('ditto', ['-x', '-k', zip, dir]);
  else if (process.platform === 'win32') execFileSync('powershell', ['-NoProfile', '-Command', `Expand-Archive -Force -Path '${zip}' -DestinationPath '${dir}'`]);
  else execFileSync('unzip', ['-q', '-o', zip, '-d', dir]);
}

async function ensureElectron() {
  const dir = path.join(root, 'node_modules', 'electron');
  if (!fs.existsSync(path.join(dir, 'package.json'))) {
    console.error('[setup] Electron is not installed. Run "npm install" first.');
    process.exit(1);
  }
  const { version } = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  const platformPath = electronPlatformPath();
  const exe = path.join(dir, 'dist', platformPath);
  const pathTxt = path.join(dir, 'path.txt');
  if (fs.existsSync(exe) && fs.existsSync(pathTxt)) return;

  const arch = process.env.npm_config_arch || process.arch;
  const plat = process.platform === 'win32' ? 'win32' : process.platform;
  const name = `electron-v${version}-${plat}-${arch}.zip`;
  const mirror = (process.env.ELECTRON_MIRROR || 'https://github.com/electron/electron/releases/download/').replace(/\/?$/, '/');
  const url = `${mirror}v${version}/${name}`;
  log(`Electron ${version} is missing its app bundle — fetching ${name}`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'freemiere-electron-'));
  const zip = path.join(tmp, name);
  try {
    await download(url, zip);
    fs.rmSync(path.join(dir, 'dist'), { recursive: true, force: true });
    unzip(zip, path.join(dir, 'dist'));
    fs.writeFileSync(pathTxt, platformPath);
    fs.writeFileSync(path.join(dir, 'dist', 'version'), version);
    log('Electron is ready.');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function ensureFfmpeg() {
  let bin = null;
  try { bin = require(path.join(root, 'node_modules', 'ffmpeg-static')); } catch (_) { return; }
  if (bin && fs.existsSync(bin)) return;
  log('Fetching FFmpeg…');
  const script = path.join(root, 'node_modules', 'ffmpeg-static', 'install.js');
  const r = spawnSync(process.execPath, [script], { cwd: path.dirname(script), stdio: quiet ? 'ignore' : 'inherit' });
  if (r.status !== 0) log('FFmpeg download failed; Freemiere Pro will fall back to a system ffmpeg (e.g. Homebrew).');
}

function ensureFfprobe() {
  try {
    const p = require(path.join(root, 'node_modules', '@ffprobe-installer', 'ffprobe')).path;
    if (p && fs.existsSync(p) && process.platform !== 'win32') fs.chmodSync(p, 0o755);
  } catch (_) { /* optional */ }
}

(async () => {
  try {
    await ensureElectron();
    ensureFfmpeg();
    ensureFfprobe();
  } catch (err) {
    console.error('[setup]', err.message || err);
    process.exit(1);
  }
})();
