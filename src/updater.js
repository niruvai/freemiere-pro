// Freemiere Pro — updates from GitHub Releases.
//
// The app isn't signed with an Apple Developer ID, so the standard Squirrel
// updater can't be used. Instead: ask GitHub for the latest release, download
// the .zip built for this Mac's chip, unpack it with `ditto`, and let a small
// helper script swap the app bundle once Freemiere Pro has quit, then relaunch.

const { app, dialog, net, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');

const REPO = 'niruvai/freemiere-pro';
const RELEASES = `https://github.com/${REPO}/releases`;
const CHECK_EVERY = 6 * 60 * 60 * 1000;

let busy = false;
let hooks = { window: () => null, isDirty: () => false, clearDirty: () => {} };

const skipFile = () => path.join(app.getPath('userData'), 'skipped-update.json');
const readSkip = () => { try { return JSON.parse(fs.readFileSync(skipFile(), 'utf8')).version; } catch (_) { return null; } };
const writeSkip = (v) => { try { fs.writeFileSync(skipFile(), JSON.stringify({ version: v })); } catch (_) {} };

function compare(a, b) {
  const pa = String(a).split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const pb = String(b).split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

async function latestRelease() {
  const res = await net.fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Freemiere-Pro-Updater' },
  });
  if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
  return res.json();
}

const archName = () => (process.arch === 'arm64' ? 'arm64' : 'x64');
const assetFor = (rel, ext) => (rel.assets || []).find((a) => a.name.endsWith(`-${archName()}.${ext}`));

function bundlePath() {
  // …/Freemiere Pro.app/Contents/MacOS/Freemiere Pro → …/Freemiere Pro.app
  const p = path.resolve(path.dirname(app.getPath('exe')), '..', '..');
  return p.endsWith('.app') ? p : null;
}

async function download(url, dest, onProgress) {
  const res = await net.fetch(url, { headers: { 'User-Agent': 'Freemiere-Pro-Updater' } });
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status})`);
  const total = Number(res.headers.get('content-length')) || 0;
  const out = fs.createWriteStream(dest);
  const reader = res.body.getReader();
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    got += value.length;
    if (!out.write(Buffer.from(value))) await new Promise((r) => out.once('drain', r));
    if (total) onProgress(got / total);
  }
  await new Promise((r, j) => out.end((e) => (e ? j(e) : r())));
}

const run = (cmd, args) => new Promise((resolve, reject) => {
  execFile(cmd, args, (err, stdout, stderr) => (err ? reject(new Error(stderr || err.message)) : resolve(stdout)));
});

function message(opts) {
  const win = hooks.window();
  return win ? dialog.showMessageBox(win, opts) : dialog.showMessageBox(opts);
}

async function install(rel, version) {
  const win = hooks.window();
  const target = bundlePath();
  const zip = assetFor(rel, 'zip');
  const fallback = async (why) => {
    const r = await message({ type: 'info', buttons: ['Open Download Page', 'Cancel'], defaultId: 0, cancelId: 1, message: 'Update needs to be installed by hand', detail: why });
    if (r.response === 0) shell.openExternal((assetFor(rel, 'dmg') || {}).browser_download_url || rel.html_url);
  };
  if (process.platform !== 'darwin' || !target) return fallback('Automatic install works for the Mac app in your Applications folder.');
  if (target.startsWith('/Volumes/')) return fallback('Freemiere Pro is running from the disk image. Drag it into Applications first, open it from there, then update.');
  try { fs.accessSync(path.dirname(target), fs.constants.W_OK); } catch (_) { return fallback(`Freemiere Pro can't write to ${path.dirname(target)}. Download the new DMG and replace the app.`); }
  if (!zip) return fallback(`This release has no ${archName()} download yet.`);

  if (hooks.isDirty()) {
    const r = await message({ type: 'warning', buttons: ['Cancel', 'Update Without Saving'], defaultId: 0, cancelId: 0, message: 'You have unsaved changes', detail: 'Save your project (⌘S) before updating, or continue and lose the changes.' });
    if (r.response !== 1) return;
  }

  const tmp = fs.mkdtempSync(path.join(app.getPath('temp'), 'freemiere-update-'));
  try {
    const file = path.join(tmp, zip.name);
    await download(zip.browser_download_url, file, (p) => { if (win) win.setProgressBar(p); });
    if (win) win.setProgressBar(2); // indeterminate while unpacking
    const unpack = path.join(tmp, 'app');
    fs.mkdirSync(unpack);
    await run('/usr/bin/ditto', ['-x', '-k', file, unpack]);
    const found = fs.readdirSync(unpack).find((n) => n.endsWith('.app'));
    if (!found) throw new Error('The download did not contain the app.');
    const fresh = path.join(unpack, found);
    const script = path.join(tmp, 'swap.sh');
    fs.writeFileSync(script, `#!/bin/bash
PID="$1"; TARGET="$2"; NEW="$3"; TMP="$4"
for i in $(seq 1 240); do kill -0 "$PID" 2>/dev/null || break; sleep 0.25; done
xattr -cr "$NEW" 2>/dev/null
rm -rf "$TARGET.previous"
if mv "$TARGET" "$TARGET.previous" && mv "$NEW" "$TARGET"; then
  rm -rf "$TARGET.previous"
else
  [ -d "$TARGET.previous" ] && [ ! -d "$TARGET" ] && mv "$TARGET.previous" "$TARGET"
fi
open "$TARGET"
rm -rf "$TMP"
`, { mode: 0o755 });
    if (win) win.setProgressBar(-1);
    spawn('/bin/bash', [script, String(process.pid), target, fresh, tmp], { detached: true, stdio: 'ignore' }).unref();
    hooks.clearDirty();
    app.quit();
  } catch (err) {
    if (win) win.setProgressBar(-1);
    fs.rmSync(tmp, { recursive: true, force: true });
    const r = await message({ type: 'error', buttons: ['Open Download Page', 'Close'], defaultId: 0, cancelId: 1, message: 'The update could not be installed', detail: String(err.message || err) });
    if (r.response === 0) shell.openExternal(RELEASES + '/latest');
  }
}

async function check({ interactive = false } = {}) {
  if (busy) return;
  busy = true;
  try {
    if (!app.isPackaged) {
      if (interactive) await message({ type: 'info', message: 'Updates are for the installed app', detail: `This copy is running from source (npm start). Use "git pull" to update it, or install the app from ${RELEASES}.` });
      return;
    }
    let rel;
    try { rel = await latestRelease(); } catch (err) {
      if (interactive) await message({ type: 'error', message: 'Couldn’t check for updates', detail: `${err.message || err}\n\nCheck your internet connection and try again.` });
      return;
    }
    const version = String(rel.tag_name || '').replace(/^v/, '');
    if (!version || compare(version, app.getVersion()) <= 0) {
      if (interactive) await message({ type: 'info', message: 'Freemiere Pro is up to date', detail: `You have the latest version (${app.getVersion()}).` });
      return;
    }
    if (!interactive && readSkip() === version) return;
    const notes = String(rel.body || '').replace(/\r/g, '').trim();
    const r = await message({
      type: 'info',
      buttons: ['Install and Restart', 'Download DMG', 'Later'],
      defaultId: 0,
      cancelId: 2,
      message: `Freemiere Pro ${version} is available`,
      detail: `You have version ${app.getVersion()}.${notes ? '\n\n' + (notes.length > 900 ? notes.slice(0, 900) + '…' : notes) : ''}`,
      checkboxLabel: interactive ? undefined : 'Skip this version',
    });
    if (r.checkboxChecked) writeSkip(version);
    if (r.response === 1) shell.openExternal((assetFor(rel, 'dmg') || {}).browser_download_url || rel.html_url);
    if (r.response === 0) await install(rel, version);
  } finally {
    busy = false;
  }
}

function start(h) {
  hooks = Object.assign(hooks, h);
  if (!app.isPackaged || process.env.FRAMELINE_SCREENSHOT) return;
  setTimeout(() => check(), 8000);
  setInterval(() => check(), CHECK_EVERY);
}

module.exports = { start, check, compare };
