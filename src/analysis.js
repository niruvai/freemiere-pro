// Freemiere Pro — media analysis that runs in the main process on decoded frames/samples:
//   • silence detection (FFmpeg silencedetect)
//   • mask tracking (normalised cross-correlation template matching, coarse-to-fine)
//   • Auto Reframe subject finding (skin tone + detail + motion saliency)
//   • multi-camera audio sync (cross-correlation of loudness envelopes)
'use strict';

const { spawn } = require('child_process');

let FFMPEG = 'ffmpeg';
const setFfmpeg = (p) => { FFMPEG = p; };

// One running analysis at a time can be cancelled from the UI.
let current = null;
function cancel() { if (current) { current.cancelled = true; try { current.child.kill('SIGKILL'); } catch (_) {} } }

// Decodes video into fixed-size frames and hands each one to onFrame(buffer, index).
function readFrames(file, { start = 0, duration, width, height, fps, pixFmt = 'gray' }, onFrame) {
  return new Promise((resolve, reject) => {
    const bpp = pixFmt === 'rgb24' ? 3 : 1;
    const size = width * height * bpp;
    const args = ['-v', 'error', '-nostdin'];
    if (start > 0) args.push('-ss', String(start));
    if (duration) args.push('-t', String(duration));
    args.push('-i', file, '-an', '-sn', '-vf', `fps=${fps},scale=${width}:${height}:flags=area,format=${pixFmt}`, '-f', 'rawvideo', 'pipe:1');
    const child = spawn(FFMPEG, args);
    const job = { child, cancelled: false };
    current = job;
    let buf = Buffer.alloc(0);
    let n = 0;
    let err = '';
    let stopped = false;
    child.stdout.on('data', (d) => {
      if (stopped) return;
      buf = buf.length ? Buffer.concat([buf, d]) : d;
      while (buf.length >= size && !stopped) {
        const frame = buf.subarray(0, size);
        buf = buf.subarray(size);
        if (onFrame(Buffer.from(frame), n++) === false) { stopped = true; try { child.kill('SIGKILL'); } catch (_) {} }
      }
    });
    child.stderr.on('data', (d) => { err += d; if (err.length > 20000) err = err.slice(-10000); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (current === job) current = null;
      if (job.cancelled) return reject(new Error('cancelled'));
      if (code === 0 || stopped) resolve(n);
      else reject(new Error(err.trim().split('\n').slice(-4).join('\n') || `ffmpeg exited with ${code}`));
    });
  });
}

// Decodes audio as mono float samples.
function readAudio(file, { start = 0, duration, rate = 8000 }) {
  return new Promise((resolve, reject) => {
    const args = ['-v', 'error', '-nostdin'];
    if (start > 0) args.push('-ss', String(start));
    if (duration) args.push('-t', String(duration));
    args.push('-i', file, '-vn', '-ac', '1', '-ar', String(rate), '-f', 'f32le', 'pipe:1');
    const child = spawn(FFMPEG, args);
    const job = { child, cancelled: false };
    current = job;
    const chunks = [];
    let err = '';
    child.stdout.on('data', (d) => chunks.push(d));
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (current === job) current = null;
      if (job.cancelled) return reject(new Error('cancelled'));
      if (code !== 0) return reject(new Error(err.trim().split('\n').slice(-3).join('\n') || `ffmpeg exited with ${code}`));
      const all = Buffer.concat(chunks);
      resolve(new Float32Array(all.buffer, all.byteOffset, Math.floor(all.length / 4)));
    });
  });
}

// ---------------------------------------------------------------- silence
// Returns silent stretches [{ s, e }] in file time inside [start, start + duration].
function detectSilence(file, { start = 0, duration, noiseDb = -38, minSilence = 0.5 }) {
  return new Promise((resolve, reject) => {
    const args = ['-v', 'info', '-nostdin', '-hide_banner'];
    if (start > 0) args.push('-ss', String(start));
    if (duration) args.push('-t', String(duration));
    args.push('-i', file, '-vn', '-af', `silencedetect=noise=${noiseDb}dB:d=${minSilence}`, '-f', 'null', '-');
    const child = spawn(FFMPEG, args);
    const job = { child, cancelled: false };
    current = job;
    let log = '';
    child.stderr.on('data', (d) => { log += d; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (current === job) current = null;
      if (job.cancelled) return reject(new Error('cancelled'));
      if (code !== 0) return reject(new Error(log.trim().split('\n').slice(-3).join('\n')));
      const out = [];
      let s = null;
      for (const line of log.split('\n')) {
        const a = line.match(/silence_start:\s*(-?[\d.]+)/);
        const b = line.match(/silence_end:\s*(-?[\d.]+)/);
        if (a) s = Math.max(0, parseFloat(a[1]));
        if (b && s != null) { out.push({ s: start + s, e: start + parseFloat(b[1]) }); s = null; }
      }
      // silence that runs to the end of the range
      if (s != null) out.push({ s: start + s, e: start + (duration || Infinity) });
      resolve(out);
    });
  });
}

// ---------------------------------------------------------------- tracking
// Normalised cross-correlation of template T (tw×th) against image I (iw wide) at (x, y).
function ncc(I, iw, T, tw, th, tMean, tNorm, x, y) {
  let s = 0; let s2 = 0; let st = 0;
  const n = tw * th;
  for (let j = 0; j < th; j++) {
    const row = (y + j) * iw + x;
    const trow = j * tw;
    for (let i = 0; i < tw; i++) {
      const v = I[row + i];
      s += v; s2 += v * v; st += v * T[trow + i];
    }
  }
  const mean = s / n;
  const varI = s2 - n * mean * mean;
  if (varI < 1e-6 || tNorm < 1e-6) return 0;
  return (st - n * mean * tMean) / Math.sqrt(varI * tNorm);
}
function crop(I, iw, x, y, w, h) {
  const out = new Float32Array(w * h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) out[j * w + i] = I[(y + j) * iw + x + i];
  return out;
}
function stats(T) {
  let s = 0;
  for (const v of T) s += v;
  const mean = s / T.length;
  let n = 0;
  for (const v of T) n += (v - mean) * (v - mean);
  return { mean, norm: n };
}
function downscale(I, w, h, k) {
  // box filter by integer factor k
  const ow = Math.floor(w / k); const oh = Math.floor(h / k);
  const out = new Float32Array(ow * oh);
  for (let y = 0; y < oh; y++) for (let x = 0; x < ow; x++) {
    let s = 0;
    for (let j = 0; j < k; j++) for (let i = 0; i < k; i++) s += I[(y * k + j) * w + x * k + i];
    out[y * ow + x] = s / (k * k);
  }
  return { I: out, w: ow, h: oh };
}
// Best match of template around (cx, cy) ± r; returns sub-pixel top-left and score.
function search(I, iw, ih, T, tw, th, st, x0, y0, r) {
  let best = -2; let bx = x0; let by = y0;
  const xs = Math.max(0, Math.round(x0 - r)); const xe = Math.min(iw - tw, Math.round(x0 + r));
  const ys = Math.max(0, Math.round(y0 - r)); const ye = Math.min(ih - th, Math.round(y0 + r));
  const scores = new Map();
  for (let y = ys; y <= ye; y++) for (let x = xs; x <= xe; x++) {
    const v = ncc(I, iw, T, tw, th, st.mean, st.norm, x, y);
    scores.set(y * iw + x, v);
    if (v > best) { best = v; bx = x; by = y; }
  }
  // parabolic sub-pixel refinement
  const sc = (x, y) => scores.get(y * iw + x);
  let fx = bx; let fy = by;
  const l = sc(bx - 1, by); const rr = sc(bx + 1, by);
  if (l != null && rr != null) { const d = l - 2 * best + rr; if (d < 0) fx = bx + FLclamp(0.5 * (l - rr) / d, -0.5, 0.5); }
  const u = sc(bx, by - 1); const dn = sc(bx, by + 1);
  if (u != null && dn != null) { const d = u - 2 * best + dn; if (d < 0) fy = by + FLclamp(0.5 * (u - dn) / d, -0.5, 0.5); }
  return { x: fx, y: fy, ix: bx, iy: by, score: best };
}
const FLclamp = (v, a, b) => Math.min(b, Math.max(a, v));

// Tracks a box through [start, start + duration] (backward if reverse). box is in
// normalised frame coordinates { cx, cy, w, h }. onProgress(fraction). Returns
// [{ t (file time), cx, cy, score }] in the order tracked; stops early when lost.
async function trackBox(file, { start, duration, fps, frameW, frameH, box, reverse = false }, onProgress) {
  const W = Math.min(640, frameW);
  const H = Math.max(2, Math.round((W * frameH) / frameW / 2) * 2);
  const step = Math.min(30, Math.max(10, fps || 30));
  const frames = [];
  const total = Math.max(1, Math.round(duration * step));
  const handle = (buf) => {
    const f = new Float32Array(buf.length);
    for (let k = 0; k < buf.length; k++) f[k] = buf[k];
    return f;
  };
  // forward tracking streams; backward needs the frames in reverse order
  const results = [];
  let state = null;
  const tw0 = Math.max(8, Math.round(box.w * W));
  const th0 = Math.max(8, Math.round(box.h * H));
  // matching works on a reduced copy so the template is at most ~40 px
  const k = Math.max(1, Math.floor(Math.max(tw0, th0) / 40));
  const step1 = (I, i) => {
    const t = reverse ? start + duration - i / step : start + i / step;
    const small = k > 1 ? downscale(I, W, H, k) : { I, w: W, h: H };
    if (!state) {
      const tw = Math.max(6, Math.round(tw0 / k)); const th = Math.max(6, Math.round(th0 / k));
      const x = FLclamp(Math.round(box.cx * small.w - tw / 2), 0, small.w - tw);
      const y = FLclamp(Math.round(box.cy * small.h - th / 2), 0, small.h - th);
      const T = crop(small.I, small.w, x, y, tw, th);
      // fine template at full analysis resolution
      const fw = Math.min(W, tw * k); const fh = Math.min(H, th * k);
      const fx = FLclamp(Math.round(box.cx * W - fw / 2), 0, W - fw);
      const fy = FLclamp(Math.round(box.cy * H - fh / 2), 0, H - fh);
      const TF = crop(I, W, fx, fy, fw, fh);
      state = { T, tw, th, st: stats(T), x, y, vx: 0, vy: 0, TF, fw, fh, sf: stats(TF), fx, fy, ox: box.cx * W - fx, oy: box.cy * H - fy, dx: fx - x * k, dy: fy - y * k };
      results.push({ t, cx: box.cx, cy: box.cy, score: 1 });
      return true;
    }
    const s = state;
    const r = Math.max(6, Math.round(Math.max(s.tw, s.th) * 0.6));
    // predict with the last motion, then search
    const m = search(small.I, small.w, small.h, s.T, s.tw, s.th, s.st, s.x + s.vx, s.y + s.vy, r);
    // refine at full resolution around the coarse result
    const f = search(I, W, H, s.TF, s.fw, s.fh, s.sf, m.ix * k + s.dx, m.iy * k + s.dy, k + 2);
    const score = Math.max(m.score, f.score);
    if (score < 0.35) return false; // lost
    const cx = (f.x + s.ox) / W;
    const cy = (f.y + s.oy) / H;
    results.push({ t, cx, cy, score });
    s.vx = 0.6 * (m.ix - s.x) + 0.4 * s.vx; s.vy = 0.6 * (m.iy - s.y) + 0.4 * s.vy;
    s.x = m.ix; s.y = m.iy;
    s.fx = f.ix; s.fy = f.iy;
    // let the templates follow slow changes in appearance
    if (score > 0.7) {
      const nT = crop(small.I, small.w, s.x, s.y, s.tw, s.th);
      for (let q = 0; q < s.T.length; q++) s.T[q] = 0.88 * s.T[q] + 0.12 * nT[q];
      s.st = stats(s.T);
      const nF = crop(I, W, s.fx, s.fy, s.fw, s.fh);
      for (let q = 0; q < s.TF.length; q++) s.TF[q] = 0.88 * s.TF[q] + 0.12 * nF[q];
      s.sf = stats(s.TF);
    }
    return true;
  };
  if (!reverse) {
    let lost = false;
    await readFrames(file, { start, duration, width: W, height: H, fps: step }, (buf, i) => {
      if (lost) return false;
      if (!step1(handle(buf), i)) { lost = true; return false; }
      if (i % 5 === 0 && onProgress) onProgress(Math.min(1, i / total));
      return true;
    });
  } else {
    await readFrames(file, { start, duration, width: W, height: H, fps: step }, (buf, i) => {
      frames.push(buf);
      if (i % 10 === 0 && onProgress) onProgress(Math.min(0.5, (i / total) * 0.5));
      return frames.length < 4000;
    });
    for (let i = frames.length - 1, n = 0; i >= 0; i--, n++) {
      if (!step1(handle(frames[i]), n)) break;
      if (n % 5 === 0 && onProgress) onProgress(0.5 + Math.min(0.5, (n / frames.length) * 0.5));
    }
  }
  return results;
}

// ---------------------------------------------------------------- Auto Reframe
// Finds where the subject is over time. cropW/cropH: the fraction of the frame that will
// stay visible (1 = whole axis). Returns [{ t, cx, cy }] in file time, normalised.
async function findSubject(file, { start, duration, frameW, frameH, cropW = 1, cropH = 1, rate = 4 }, onProgress) {
  const W = 192;
  const H = Math.max(2, Math.round((W * frameH) / frameW / 2) * 2);
  const out = [];
  let prev = null;
  const total = Math.max(1, Math.round(duration * rate));
  const winW = Math.max(1, Math.round(W * Math.min(1, cropW)));
  const winH = Math.max(1, Math.round(H * Math.min(1, cropH)));
  await readFrames(file, { start, duration, width: W, height: H, fps: rate, pixFmt: 'rgb24' }, (buf, i) => {
    const Y = new Float32Array(W * H);
    const score = new Float32Array(W * H);
    for (let p = 0, q = 0; p < W * H; p++, q += 3) {
      const r = buf[q]; const g = buf[q + 1]; const b = buf[q + 2];
      const y = 0.299 * r + 0.587 * g + 0.114 * b;
      const cb = 128 - 0.1687 * r - 0.3313 * g + 0.5 * b;
      const cr = 128 + 0.5 * r - 0.4187 * g - 0.0813 * b;
      Y[p] = y;
      // skin tones (wide range of complexions) weigh most: people are usually the subject
      const skin = cb > 77 && cb < 127 && cr > 133 && cr < 173 && y > 40 ? 1 : 0;
      score[p] = skin * 3;
    }
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const p = y * W + x;
      const gx = Y[p + 1] - Y[p - 1];
      const gy = Y[p + W] - Y[p - W];
      score[p] += Math.min(1, Math.hypot(gx, gy) / 60) * 0.6;
      if (prev) score[p] += Math.min(1, Math.abs(Y[p] - prev[p]) / 30) * 1.2;
    }
    prev = Y;
    // the visible window (crop size) that holds the most interest
    const col = new Float32Array(W);
    const row = new Float32Array(H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const v = score[y * W + x] * (1.2 - 0.4 * (y / H)); col[x] += v; row[y] += v; }
    const best = (arr, n, win) => {
      if (win >= n) return 0.5;
      let s = 0;
      for (let k = 0; k < win; k++) s += arr[k];
      let bestS = s; let bestK = 0;
      for (let k = win; k < n; k++) { s += arr[k] - arr[k - win]; if (s > bestS) { bestS = s; bestK = k - win + 1; } }
      // centre of mass inside the best window
      let m = 0; let w = 0;
      for (let k = bestK; k < bestK + win; k++) { m += arr[k] * k; w += arr[k]; }
      return w > 0 ? (m / w + 0.5) / n : (bestK + win / 2) / n;
    };
    out.push({ t: start + i / rate, cx: best(col, W, winW), cy: best(row, H, winH) });
    if (onProgress && i % 4 === 0) onProgress(Math.min(1, i / total));
    return true;
  });
  return out;
}

// ---------------------------------------------------------------- audio sync
function fft(re, im, inverse) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (2 * Math.PI / len) * (inverse ? 1 : -1);
    const wr = Math.cos(ang); const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1; let ci = 0;
      for (let j = 0; j < len / 2; j++) {
        const a = i + j; const b = a + len / 2;
        const xr = re[b] * cr - im[b] * ci; const xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr; im[b] = im[a] - xi;
        re[a] += xr; im[a] += xi;
        const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
}
// loudness-change envelope at `rate` Hz: robust to different mics and levels
function envelope(samples, srcRate, rate) {
  const hop = Math.round(srcRate / rate);
  const n = Math.floor(samples.length / hop);
  const env = new Float32Array(n);
  let prevS = 0;
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let k = 0; k < hop; k++) { const v = samples[i * hop + k]; const hp = v - prevS; prevS = v; s += hp * hp; }
    env[i] = Math.log(1e-6 + s / hop);
  }
  const d = new Float32Array(n);
  for (let i = 1; i < n; i++) d[i] = Math.max(0, env[i] - env[i - 1]);
  let m = 0; for (const v of d) m += v; m /= n || 1;
  for (let i = 0; i < n; i++) d[i] -= m;
  return d;
}
// offset (seconds) to add to clip B's start so it lines up with clip A. Positive = B starts later.
function correlate(a, b, rate, maxLag) {
  let n = 1;
  while (n < a.length + b.length) n <<= 1;
  const ar = new Float64Array(n); const ai = new Float64Array(n);
  const br = new Float64Array(n); const bi = new Float64Array(n);
  ar.set(a); br.set(b);
  fft(ar, ai, false); fft(br, bi, false);
  for (let i = 0; i < n; i++) {
    const r = ar[i] * br[i] + ai[i] * bi[i];
    const im = ai[i] * br[i] - ar[i] * bi[i];
    ar[i] = r; ai[i] = im;
  }
  fft(ar, ai, true);
  let best = -Infinity; let lag = 0;
  const L = Math.min(n / 2, Math.round(maxLag * rate));
  for (let k = -L; k <= L; k++) {
    const v = ar[(k + n) % n];
    if (v > best) { best = v; lag = k; }
  }
  // peak at lag k means a[i] ≈ b[i - k]: B's events come -k samples later in B than in A
  let sumA = 0; for (const v of a) sumA += v * v;
  let sumB = 0; for (const v of b) sumB += v * v;
  const conf = best / n / (Math.sqrt(sumA * sumB) || 1);
  return { offset: -lag / rate, confidence: conf };
}
// files: [path]; returns, for each file, how many seconds later the same moment is heard in it
// than in the first file (+ confidence 0–1).
async function syncByAudio(files, { analyse = 300 } = {}, onProgress) {
  const RATE = 8000;
  const ENV = 200;
  const envs = [];
  for (let i = 0; i < files.length; i++) {
    const s = await readAudio(files[i], { duration: analyse, rate: RATE });
    envs.push(envelope(s, RATE, ENV));
    if (onProgress) onProgress((i + 1) / (files.length + 1));
  }
  const out = [{ offset: 0, confidence: 1 }];
  for (let i = 1; i < envs.length; i++) out.push(correlate(envs[0], envs[i], ENV, analyse));
  return out;
}

module.exports = { setFfmpeg, cancel, detectSilence, trackBox, findSubject, syncByAudio, readFrames };
