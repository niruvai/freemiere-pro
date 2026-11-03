/* Freemiere Pro — splash screen: version, loading status and the release artwork,
   painted procedurally (seeded by the version, so each release looks different). */
'use strict';

(() => {
  const version = new URLSearchParams(location.search).get('v') || '';
  document.getElementById('ver').textContent = `Version ${version}`;
  const steps = ['Starting…', 'Checking FFmpeg…', 'Loading editor…', 'Restoring workspace…'];
  window.setStatus = (t) => {
    document.getElementById('status').textContent = t;
    const i = Math.max(0, steps.indexOf(t));
    document.getElementById('bar').style.width = `${((i + 1) / steps.length) * 100}%`;
  };
  window.setStatus('Starting…');

  // ---- seeded random
  let seed = 0;
  for (const ch of 'freemiere' + version) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  const rnd = () => { seed = (seed + 0x6D2B79F5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

  const PALETTES = [
    ['#120c2e', '#3b1d7a', '#c2367a', '#ff8a4c', '#ffd27a'],
    ['#07182b', '#0f4c75', '#3282b8', '#7b5cff', '#ff6fb5'],
    ['#140a1f', '#5a189a', '#ff006e', '#fb5607', '#ffbe0b'],
    ['#06141b', '#11505e', '#1fa39a', '#9ee493', '#f6f7b8'],
  ];
  const pal = PALETTES[Math.floor(rnd() * PALETTES.length)];

  const cv = document.getElementById('art');
  const dpr = window.devicePixelRatio || 1;
  function paint() {
    const W = cv.clientWidth; const H = cv.clientHeight;
    cv.width = W * dpr; cv.height = H * dpr;
    const x = cv.getContext('2d');
    x.scale(dpr, dpr);
    // sky
    const g = x.createLinearGradient(0, 0, W * 0.4, H);
    g.addColorStop(0, pal[0]); g.addColorStop(0.55, pal[1]); g.addColorStop(1, pal[2]);
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    // glow
    const gx = W * (0.55 + rnd() * 0.3); const gy = H * (0.2 + rnd() * 0.25);
    const rg = x.createRadialGradient(gx, gy, 0, gx, gy, W * 0.8);
    rg.addColorStop(0, pal[4] + 'cc'); rg.addColorStop(0.25, pal[3] + '66'); rg.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = rg; x.fillRect(0, 0, W, H);
    // ribbons
    x.globalCompositeOperation = 'screen';
    for (let r = 0; r < 7; r++) {
      const base = H * (0.3 + r * 0.075 + rnd() * 0.04);
      const amp = 18 + rnd() * 36; const freq = 0.006 + rnd() * 0.01; const ph = rnd() * 6.28;
      const col = pal[1 + Math.floor(rnd() * 4)];
      const lg = x.createLinearGradient(0, 0, W, 0);
      lg.addColorStop(0, col + '00'); lg.addColorStop(0.5, col + '88'); lg.addColorStop(1, col + '10');
      x.strokeStyle = lg; x.lineWidth = 1 + rnd() * 9;
      x.beginPath();
      for (let px = 0; px <= W; px += 4) {
        const y = base + Math.sin(px * freq + ph) * amp + Math.sin(px * freq * 2.3 + ph * 1.7) * amp * 0.35;
        if (px) x.lineTo(px, y); else x.moveTo(px, y);
      }
      x.stroke();
    }
    // bokeh
    for (let i = 0; i < 26; i++) {
      const bx = rnd() * W; const by = rnd() * H * 0.7; const br = 2 + rnd() * 14;
      const bg = x.createRadialGradient(bx, by, 0, bx, by, br);
      bg.addColorStop(0, 'rgba(255,255,255,' + (0.18 + rnd() * 0.3).toFixed(2) + ')'); bg.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = bg; x.beginPath(); x.arc(bx, by, br, 0, 6.29); x.fill();
    }
    x.globalCompositeOperation = 'source-over';
    // timeline motif
    const ty = H * 0.72; const lane = 15; const colors = ['#c4467f', '#4b63c8', '#8857c9', '#2b8a5c'];
    for (let l = 0; l < 4; l++) {
      let cx = 18 + rnd() * 30;
      while (cx < W - 30) {
        const w = 30 + rnd() * 90;
        if (rnd() > 0.25) {
          x.fillStyle = colors[l] + 'd8';
          x.beginPath(); x.roundRect(cx, ty + l * (lane + 5), Math.min(w, W - 18 - cx), lane, 4); x.fill();
        }
        cx += w + 4 + rnd() * 20;
      }
    }
    const phx = W * (0.35 + rnd() * 0.3);
    x.fillStyle = '#ff4f4f';
    x.fillRect(phx - 1, ty - 14, 2, 4 * (lane + 5) + 12);
    x.beginPath(); x.moveTo(phx - 6, ty - 18); x.lineTo(phx + 6, ty - 18); x.lineTo(phx + 6, ty - 12); x.lineTo(phx, ty - 6); x.lineTo(phx - 6, ty - 12); x.fill();
    // grain
    const img = x.getImageData(0, 0, cv.width, cv.height);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) { const n = (Math.random() - 0.5) * 14; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
    x.putImageData(img, 0, 0);
  }
  requestAnimationFrame(paint);
})();
