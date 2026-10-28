/* Frameline — picture rendering shared by the Program monitor and the
   exporter: titles, graphics templates, video effects (with masks),
   motion/opacity and transitions. Everything the exporter needs as an image
   (titles, graphics, masks, vignettes) is drawn here so preview == export. */
'use strict';

(() => {
  const R = (FL.R = {});
  const smooth = (e0, e1, x) => { const t = FL.clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
  R.smoothstep = smooth;

  // ---------------------------------------------------------------- canvas pool
  const pool = new Map();
  R.canvas = (key, w, h) => {
    let c = pool.get(key);
    if (!c) { c = document.createElement('canvas'); pool.set(key, c); }
    w = Math.max(1, Math.round(w));
    h = Math.max(1, Math.round(h));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    return c;
  };
  R.forget = (prefix) => { for (const k of [...pool.keys()]) if (k.startsWith(prefix)) pool.delete(k); };

  const fontStack = (f) => `"${f}", "Kohinoor Bangla", "Noto Sans Bengali", "Helvetica Neue", sans-serif`;
  R.fontStack = fontStack;

  // ---------------------------------------------------------------- titles
  FL.FONTS = [
    'Kohinoor Bangla', 'Bangla Sangam MN', 'Bangla MN', 'Noto Sans Bengali', 'Hind Siliguri', 'SolaimanLipi',
    'Helvetica Neue', 'SF Pro Display', 'Avenir Next', 'Futura', 'Gill Sans', 'Arial', 'Arial Black',
    'Georgia', 'Times New Roman', 'Didot', 'Baskerville', 'Courier New', 'Menlo', 'Impact',
  ];
  const measureCtx = document.createElement('canvas').getContext('2d');

  function textLayout(c) {
    const font = `${c.italic ? 'italic ' : ''}${c.bold ? '700' : '400'} ${c.size}px ${fontStack(c.font)}`;
    measureCtx.font = font;
    const lines = String(c.text || '').split('\n');
    const lh = c.size * 1.22;
    const widths = lines.map((l) => measureCtx.measureText(l || ' ').width);
    const w = Math.max(1, ...widths);
    const h = lines.length * lh;
    const pad = c.box ? c.size * 0.35 : 0;
    return { font, lines, lh, w, h, pad, bw: w + pad * 2, bh: h + pad * 2 };
  }

  const textCache = new Map();
  R.textImage = (c) => {
    const key = JSON.stringify([c.text, c.font, c.size, c.color, c.bold, c.italic, c.align, c.strokeColor, c.strokeWidth, c.box, c.boxColor, c.boxOpacity, c.shadow]);
    const hit = textCache.get(c.id);
    if (hit && hit.key === key) return hit.canvas;
    const L = textLayout(c);
    const margin = Math.ceil(c.size * 0.25 + (c.strokeWidth || 0) + (c.shadow ? c.size * 0.2 : 0));
    const cw = Math.ceil(L.bw + margin * 2);
    const ch = Math.ceil(L.bh + margin * 2);
    const canvas = document.createElement('canvas');
    canvas.width = cw + (cw % 2);
    canvas.height = ch + (ch % 2);
    const ctx = canvas.getContext('2d');
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.font = L.font;
    ctx.textBaseline = 'middle';
    if (c.box) {
      ctx.save();
      ctx.globalAlpha = c.boxOpacity ?? 0.6;
      ctx.fillStyle = c.boxColor || '#000';
      ctx.beginPath();
      ctx.roundRect(-L.bw / 2, -L.bh / 2, L.bw, L.bh, Math.min(c.size * 0.18, L.bh / 2));
      ctx.fill();
      ctx.restore();
    }
    const top = -L.h / 2 + L.lh / 2;
    L.lines.forEach((line, i) => {
      const y = top + i * L.lh;
      let x = 0;
      if (c.align === 'left') { ctx.textAlign = 'left'; x = -L.w / 2; }
      else if (c.align === 'right') { ctx.textAlign = 'right'; x = L.w / 2; }
      else ctx.textAlign = 'center';
      if (c.shadow) {
        ctx.save();
        ctx.shadowColor = 'rgba(0,0,0,0.55)';
        ctx.shadowBlur = c.size * 0.12;
        ctx.shadowOffsetY = c.size * 0.04;
        ctx.fillStyle = c.color;
        ctx.fillText(line, x, y);
        ctx.restore();
      }
      if (c.strokeWidth > 0) {
        ctx.lineJoin = 'round';
        ctx.lineWidth = c.strokeWidth * 2;
        ctx.strokeStyle = c.strokeColor || '#000';
        ctx.strokeText(line, x, y);
      }
      ctx.fillStyle = c.color || '#fff';
      ctx.fillText(line, x, y);
    });
    textCache.set(c.id, { key, canvas });
    return canvas;
  };

  // ---------------------------------------------------------------- graphics templates
  function fitFont(ctx, text, weight, size, font, maxW, minScale = 0.55) {
    let s = size;
    ctx.font = `${weight} ${s}px ${fontStack(font)}`;
    let w = ctx.measureText(text).width;
    if (w > maxW) { s = Math.max(size * minScale, (size * maxW) / w); ctx.font = `${weight} ${s}px ${fontStack(font)}`; w = ctx.measureText(text).width; }
    return { s, w };
  }
  function labelBox(ctx, x, y, h, text, bg, color, font, size) {
    ctx.font = `700 ${size}px ${fontStack(font)}`;
    const pad = size * 0.55;
    const w = ctx.measureText(text).width + pad * 2;
    ctx.fillStyle = bg;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = color;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText(text, x + pad, y + h / 2 + size * 0.04);
    return w;
  }

  const gfxCache = new Map();
  R.graphic = (c, W, H) => {
    const g = c.g || {};
    const key = JSON.stringify([c.template, g, W, H]);
    const hit = gfxCache.get(c.id);
    if (hit && hit.key === key) return hit.out;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    const k = Math.min(W / 1920, H / 1080) * (W < H ? 1.7 : 1);
    const mx = W * 0.025;
    let crawl = null;
    ctx.textBaseline = 'middle';

    if (c.template === 'headline' || c.template === 'ticker') {
      const h = (c.template === 'ticker' ? 64 : 80) * k;
      const y = H - (g.bottom / 100) * H - h;
      const lw = labelBox(ctx, mx, y, h, g.label || '', g.labelBg, g.labelColor, g.font, (c.template === 'ticker' ? 34 : 44) * k);
      ctx.fillStyle = g.barBg;
      ctx.fillRect(mx + lw, y, W - mx * 2 - lw, h);
      const tx = mx + lw + 22 * k;
      const tw = W - mx - tx - 22 * k;
      if (c.template === 'headline') {
        const f = fitFont(ctx, g.text || '', 600, 44 * k, g.font, tw);
        ctx.fillStyle = g.textColor;
        ctx.textAlign = 'left';
        ctx.fillText(g.text || '', tx, y + h / 2 + f.s * 0.04);
      } else {
        // crawl strip: items joined with a bullet, repeated so it can loop seamlessly
        const items = String(g.text || '').split('\n').map((s) => s.trim()).filter(Boolean);
        const line = items.join('    ●    ') + '    ●    ';
        const size = 36 * k;
        const font = `600 ${size}px ${fontStack(g.font)}`;
        measureCtx.font = font;
        const period = Math.max(50, Math.ceil(measureCtx.measureText(line).width));
        const rx = Math.round(mx + lw + 4 * k);
        const rw = Math.round(W - mx - rx);
        const rh = Math.round(h);
        const copies = Math.ceil((rw + period) / period) + 1;
        const strip = document.createElement('canvas');
        strip.width = Math.min(30000, period * copies);
        strip.height = rh;
        const sctx = strip.getContext('2d');
        sctx.font = font;
        sctx.fillStyle = g.textColor;
        sctx.textBaseline = 'middle';
        for (let i = 0; i < copies; i++) sctx.fillText(line, i * period, rh / 2 + size * 0.04);
        crawl = { strip, period, speed: Math.max(10, +g.speed || 160) * k, rx, ry: Math.round(y), rw, rh };
      }
    } else if (c.template === 'lowerthird') {
      const x = (g.left / 100) * W;
      const nameF = 58 * k;
      const titleF = 34 * k;
      ctx.font = `700 ${nameF}px ${fontStack(g.font)}`;
      const nw = ctx.measureText(g.name || '').width;
      ctx.font = `500 ${titleF}px ${fontStack(g.font)}`;
      const tw = ctx.measureText(g.title || '').width;
      const padX = 30 * k;
      const boxW = Math.max(nw, tw) + padX * 2;
      const h1 = nameF * 1.45;
      const h2 = titleF * 1.6;
      const y = H - (g.bottom / 100) * H - h1 - h2;
      ctx.fillStyle = g.accent;
      ctx.fillRect(x, y, 12 * k, h1 + h2);
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = g.barBg;
      ctx.fillRect(x + 12 * k, y, boxW, h1);
      ctx.globalAlpha = 1;
      ctx.fillStyle = g.accent;
      ctx.fillRect(x + 12 * k, y + h1, Math.max(tw + padX * 2, boxW * 0.6), h2);
      ctx.fillStyle = g.textColor;
      ctx.textAlign = 'left';
      ctx.font = `700 ${nameF}px ${fontStack(g.font)}`;
      ctx.fillText(g.name || '', x + 12 * k + padX, y + h1 / 2 + nameF * 0.04);
      ctx.font = `500 ${titleF}px ${fontStack(g.font)}`;
      ctx.fillText(g.title || '', x + 12 * k + padX, y + h1 + h2 / 2 + titleF * 0.04);
    } else if (c.template === 'breaking') {
      const h1 = 62 * k;
      const h2 = 92 * k;
      const y2 = H - (g.bottom / 100) * H - h2;
      const y1 = y2 - h1;
      labelBox(ctx, mx, y1, h1, g.label || '', g.labelBg, g.labelColor, g.font, 40 * k);
      ctx.fillStyle = g.barBg;
      ctx.fillRect(mx, y2, W - mx * 2, h2);
      ctx.fillStyle = g.labelBg;
      ctx.fillRect(mx, y2 + h2 - 6 * k, W - mx * 2, 6 * k);
      const f = fitFont(ctx, g.text || '', 700, 52 * k, g.font, W - mx * 2 - 60 * k);
      ctx.fillStyle = g.textColor;
      ctx.textAlign = 'left';
      ctx.fillText(g.text || '', mx + 30 * k, y2 + h2 / 2 + f.s * 0.02);
    } else if (c.template === 'live') {
      const h = 58 * k;
      const y = H * 0.05;
      ctx.font = `700 ${32 * k}px ${fontStack(g.font)}`;
      const bw = ctx.measureText(g.label || '').width + 70 * k;
      ctx.font = `600 ${30 * k}px ${fontStack(g.font)}`;
      const cw = ctx.measureText(g.text || '').width + 40 * k;
      const total = bw + cw;
      const x = g.corner === 'left' ? W * 0.04 : W - W * 0.04 - total;
      ctx.fillStyle = g.labelBg;
      ctx.fillRect(x, y, bw, h);
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(x + 26 * k, y + h / 2, 8 * k, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = g.labelColor;
      ctx.textAlign = 'left';
      ctx.font = `700 ${32 * k}px ${fontStack(g.font)}`;
      ctx.fillText(g.label || '', x + 46 * k, y + h / 2 + 2 * k);
      ctx.globalAlpha = 0.75;
      ctx.fillStyle = g.barBg;
      ctx.fillRect(x + bw, y, cw, h);
      ctx.globalAlpha = 1;
      ctx.fillStyle = g.textColor;
      ctx.font = `600 ${30 * k}px ${fontStack(g.font)}`;
      ctx.fillText(g.text || '', x + bw + 20 * k, y + h / 2 + 2 * k);
    } else if (c.template === 'caption') {
      const size = 46 * k;
      const lines = String(g.text || '').split('\n');
      ctx.font = `600 ${size}px ${fontStack(g.font)}`;
      const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + size * 1.2;
      const lh = size * 1.35;
      const h = lines.length * lh + size * 0.5;
      const y = H - (g.bottom / 100) * H - h;
      ctx.globalAlpha = (g.boxOpacity ?? 70) / 100;
      ctx.fillStyle = g.barBg;
      ctx.beginPath();
      ctx.roundRect((W - w) / 2, y, w, h, size * 0.25);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = g.textColor;
      ctx.textAlign = 'center';
      lines.forEach((l, i) => ctx.fillText(l, W / 2, y + size * 0.25 + lh * (i + 0.5) + size * 0.04));
    }
    const out = { static: canvas, crawl };
    gfxCache.set(c.id, { key, out });
    return out;
  };
  R.crawlX = (cr, u) => {
    const d = cr.speed * Math.max(0, u);
    return d < cr.rw ? cr.rw - d : -((d - cr.rw) % cr.period);
  };
  R.graphicThumb = (template) => {
    const c = FL.makeGraphicClip(template, { id: 'thumb_' + template });
    const out = R.graphic(c, 1920, 1080);
    const t = document.createElement('canvas');
    t.width = 320;
    t.height = 180;
    const ctx = t.getContext('2d');
    const grd = ctx.createLinearGradient(0, 0, 320, 180);
    grd.addColorStop(0, '#3b4252');
    grd.addColorStop(1, '#1d222b');
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, 320, 180);
    // zoom into the part of the frame the graphic actually uses
    const full = document.createElement('canvas');
    full.width = 1920; full.height = 1080;
    const fctx = full.getContext('2d');
    fctx.drawImage(out.static, 0, 0);
    if (out.crawl) fctx.drawImage(out.crawl.strip, 0, 0, out.crawl.rw, out.crawl.rh, out.crawl.rx, out.crawl.ry, out.crawl.rw, out.crawl.rh);
    const d = fctx.getImageData(0, 0, 1920, 1080).data;
    let x0 = 1920, y0 = 1080, x1 = 0, y1 = 0;
    for (let y = 0; y < 1080; y += 4) for (let x = 0; x < 1920; x += 4) {
      if (d[(y * 1920 + x) * 4 + 3] > 10) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    if (x1 <= x0) { x0 = 0; y0 = 0; x1 = 1920; y1 = 1080; }
    let bw = (x1 - x0) * 1.15 + 40;
    let bh = (y1 - y0) * 1.15 + 40;
    if (bw / bh > 16 / 9) bh = (bw * 9) / 16; else bw = (bh * 16) / 9;
    if (bw > 820) { bw = 820; bh = (bw * 9) / 16; }
    bw = Math.min(1920, bw); bh = Math.min(1080, bh);
    const cx = bw === 820 ? FL.clamp(x0 - 20, 0, 1920 - bw) : FL.clamp((x0 + x1) / 2 - bw / 2, 0, 1920 - bw);
    const cy = FL.clamp((y0 + y1) / 2 - bh / 2, 0, 1080 - bh);
    ctx.drawImage(full, cx, cy, bw, bh, 0, 0, 320, 180);
    return t;
  };

  // ---------------------------------------------------------------- geometry
  R.baseSize = (c) => {
    const { width: W, height: H } = FL.S();
    if (c.type === 'text') { const t = R.textImage(c); return { bw: t.width, bh: t.height }; }
    if (c.type === 'graphic' || c.type === 'solid' || c.type === 'adjust') return { bw: W, bh: H };
    const m = FL.media(c.mediaId);
    if (!m || !m.width) return { bw: W, bh: H };
    const fit = Math.min(W / m.width, H / m.height);
    return { bw: Math.max(2, Math.round((m.width * fit) / 2) * 2), bh: Math.max(2, Math.round((m.height * fit) / 2) * 2) };
  };
  R.motion = (c, u) => ({
    x: FL.kfValue(c, 'x', u) || 0,
    y: FL.kfValue(c, 'y', u) || 0,
    s: FL.kfValue(c, 'scale', u) ?? 1,
    r: FL.kfValue(c, 'rotation', u) || 0,
    o: FL.kfValue(c, 'opacity', u) ?? 1,
  });

  // ---------------------------------------------------------------- SVG filters (colour, sharpen)
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('width', '0');
  svg.setAttribute('height', '0');
  svg.style.position = 'absolute';
  const defs = document.createElementNS(svgNS, 'defs');
  svg.appendChild(defs);
  document.body.appendChild(svg);
  const filterIds = new Map();
  function svgFilter(key, inner) {
    if (filterIds.has(key)) return filterIds.get(key);
    const id = 'flf' + filterIds.size;
    const f = document.createElementNS(svgNS, 'filter');
    f.setAttribute('id', id);
    f.setAttribute('color-interpolation-filters', 'sRGB');
    f.setAttribute('x', '0'); f.setAttribute('y', '0'); f.setAttribute('width', '1'); f.setAttribute('height', '1');
    f.innerHTML = inner;
    defs.appendChild(f);
    filterIds.set(key, id);
    return id;
  }
  function colorFilter(effect) {
    const { lin, M } = window.FLDefs.colorOps(effect);
    const n = (v) => +v.toFixed(5);
    const funcs = ['R', 'G', 'B'].map((ch, i) => `<feFunc${ch} type="linear" slope="${n(lin[i][0])}" intercept="${n(lin[i][1])}"/>`).join('');
    const vals = [...M[0], 0, 0, ...M[1], 0, 0, ...M[2], 0, 0, 0, 0, 0, 1, 0].map(n).join(' ');
    const key = 'c' + funcs + vals;
    return svgFilter(key, `<feComponentTransfer>${funcs}<feFuncA type="identity"/></feComponentTransfer><feColorMatrix type="matrix" values="${vals}"/>`);
  }
  function sharpenFilter(amount) {
    const k = +((amount / 100) * 1.5).toFixed(4);
    return svgFilter('s' + k, `<feConvolveMatrix order="3" preserveAlpha="true" edgeMode="duplicate" kernelMatrix="0 ${-k} 0 ${-k} ${1 + 4 * k} ${-k} 0 ${-k} 0"/>`);
  }
  R.sharpenKernel = (amount) => { const k = (amount / 100) * 1.5; return [0, -k, 0, -k, 1 + 4 * k, -k, 0, -k, 0]; };

  // ---------------------------------------------------------------- masks & vignette images
  R.maskCanvas = (mask, w, h, q = 1, opaque = false) => {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * q));
    c.height = Math.max(1, Math.round(h * q));
    const ctx = c.getContext('2d');
    if (opaque) { ctx.fillStyle = mask.invert ? '#fff' : '#000'; ctx.fillRect(0, 0, c.width, c.height); }
    const color = opaque ? (mask.invert ? '#000' : '#fff') : '#fff';
    const feather = (mask.feather || 0) * q;
    if (feather > 0) ctx.filter = `blur(${feather / 2}px)`;
    ctx.fillStyle = color;
    const cx = mask.cx * c.width;
    const cy = mask.cy * c.height;
    const mw = mask.w * c.width;
    const mh = mask.h * c.height;
    ctx.beginPath();
    if (mask.shape === 'ellipse') ctx.ellipse(cx, cy, Math.max(1, mw / 2), Math.max(1, mh / 2), 0, 0, Math.PI * 2);
    else ctx.rect(cx - mw / 2, cy - mh / 2, mw, mh);
    ctx.fill();
    if (!opaque && mask.invert) {
      // keep everything except the shape
      const inv = document.createElement('canvas');
      inv.width = c.width; inv.height = c.height;
      const ictx = inv.getContext('2d');
      ictx.fillStyle = '#fff';
      ictx.fillRect(0, 0, inv.width, inv.height);
      ictx.globalCompositeOperation = 'destination-out';
      ictx.drawImage(c, 0, 0);
      return inv;
    }
    return c;
  };
  const maskCache = new Map();
  function cachedMask(mask, w, h, q) {
    const key = JSON.stringify([mask, Math.round(w * q), Math.round(h * q)]);
    if (!maskCache.has(key)) { if (maskCache.size > 60) maskCache.clear(); maskCache.set(key, R.maskCanvas(mask, w, h, q)); }
    return maskCache.get(key);
  }
  R.vignetteCanvas = (p, w, h, q = 1) => {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * q));
    c.height = Math.max(1, Math.round(h * q));
    const ctx = c.getContext('2d');
    const r = Math.hypot(c.width, c.height) / 2;
    const g = ctx.createRadialGradient(c.width / 2, c.height / 2, r * (p.size / 100) * 0.75, c.width / 2, c.height / 2, r);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, `rgba(0,0,0,${(p.amount / 100).toFixed(3)})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, c.width, c.height);
    return c;
  };
  const vigCache = new Map();
  function cachedVignette(p, w, h, q) {
    const key = JSON.stringify([p.amount, p.size, Math.round(w * q), Math.round(h * q)]);
    if (!vigCache.has(key)) { if (vigCache.size > 30) vigCache.clear(); vigCache.set(key, R.vignetteCanvas(p, w, h, q)); }
    return vigCache.get(key);
  }

  // ---------------------------------------------------------------- effect pipeline (base space)
  function chromaKey(src, dst, p) {
    const sctx = src.getContext('2d', { willReadFrequently: true });
    let img;
    try { img = sctx.getImageData(0, 0, src.width, src.height); } catch (_) { dst.getContext('2d').drawImage(src, 0, 0); return; }
    const d = img.data;
    const hex = p.color || '#00ff00';
    const kr = parseInt(hex.slice(1, 3), 16);
    const kg = parseInt(hex.slice(3, 5), 16);
    const kb = parseInt(hex.slice(5, 7), 16);
    const ku = -0.1687 * kr - 0.3313 * kg + 0.5 * kb + 128;
    const kv = 0.5 * kr - 0.4187 * kg - 0.0813 * kb + 128;
    const sim = (p.similarity / 100) * 0.4;
    const blend = (p.blend / 100) * 0.4;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i]; const g = d[i + 1]; const b = d[i + 2];
      const du = -0.1687 * r - 0.3313 * g + 0.5 * b + 128 - ku;
      const dv = 0.5 * r - 0.4187 * g - 0.0813 * b + 128 - kv;
      const diff = Math.sqrt((du * du + dv * dv) / (255 * 255 * 2));
      const a = blend > 0.0001 ? FL.clamp((diff - sim) / blend, 0, 1) : (diff > sim ? 1 : 0);
      d[i + 3] = d[i + 3] * a;
    }
    const dctx = dst.getContext('2d');
    dctx.putImageData(img, 0, 0);
  }

  function runEffect(e, src, dst, q) {
    const ctx = dst.getContext('2d');
    const w = dst.width;
    const h = dst.height;
    ctx.save();
    ctx.clearRect(0, 0, w, h);
    const p = e.params || {};
    switch (e.type) {
      case 'crop': {
        const l = (p.left / 100) * w; const t = (p.top / 100) * h;
        const r = (p.right / 100) * w; const b = (p.bottom / 100) * h;
        const cw = Math.max(0, w - l - r); const ch = Math.max(0, h - t - b);
        if (cw > 0 && ch > 0) ctx.drawImage(src, l, t, cw, ch, l, t, cw, ch);
        break;
      }
      case 'hflip': ctx.translate(w, 0); ctx.scale(-1, 1); ctx.drawImage(src, 0, 0); break;
      case 'vflip': ctx.translate(0, h); ctx.scale(1, -1); ctx.drawImage(src, 0, 0); break;
      case 'lumetri': case 'bw': ctx.filter = `url(#${colorFilter(e)})`; ctx.drawImage(src, 0, 0); break;
      case 'blur': ctx.filter = `blur(${(p.amount * 0.5 * q).toFixed(2)}px)`; ctx.drawImage(src, 0, 0); break;
      case 'sharpen': ctx.filter = `url(#${sharpenFilter(p.amount)})`; ctx.drawImage(src, 0, 0); break;
      case 'mosaic': {
        const bwN = Math.max(1, Math.round(p.blocks));
        const bhN = Math.max(1, Math.round((p.blocks * h) / w));
        const tiny = R.canvas('mosaic-tiny', bwN, bhN);
        const tctx = tiny.getContext('2d');
        tctx.clearRect(0, 0, bwN, bhN);
        tctx.imageSmoothingQuality = 'high';
        tctx.drawImage(src, 0, 0, bwN, bhN);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(tiny, 0, 0, w, h);
        break;
      }
      case 'vignette': ctx.drawImage(src, 0, 0); ctx.drawImage(cachedVignette(p, w / q, h / q, q), 0, 0, w, h); break;
      case 'chromakey': ctx.restore(); chromaKey(src, dst, p); return;
      default: ctx.drawImage(src, 0, 0);
    }
    ctx.restore();
  }

  // Applies a clip's video effects to `src` (a canvas in base space × q). Returns the result canvas.
  R.applyEffects = (src, effects, key, q) => {
    let cur = src;
    effects.forEach((e, i) => {
      const out = R.canvas(`${key}:fx${i}`, src.width, src.height);
      runEffect(e, cur, out, q);
      if (e.mask && !window.FLDefs.VIDEO_EFFECTS[e.type].noMask) {
        const masked = R.canvas(`${key}:fxm${i}`, src.width, src.height);
        const mctx = masked.getContext('2d');
        mctx.save();
        mctx.clearRect(0, 0, masked.width, masked.height);
        mctx.drawImage(out, 0, 0);
        mctx.globalCompositeOperation = 'destination-in';
        mctx.drawImage(cachedMask(e.mask, src.width / q, src.height / q, q), 0, 0, masked.width, masked.height);
        mctx.restore();
        const fin = R.canvas(`${key}:fxf${i}`, src.width, src.height);
        const fctx = fin.getContext('2d');
        fctx.clearRect(0, 0, fin.width, fin.height);
        fctx.drawImage(cur, 0, 0);
        fctx.drawImage(masked, 0, 0);
        cur = fin;
      } else cur = out;
    });
    return cur;
  };

  // ---------------------------------------------------------------- drawing a clip
  // ctx is in sequence coordinates (already scaled by q). `src` is the media element/image for media clips.
  R.drawClip = (ctx, c, u, src, q) => {
    const { width: W, height: H } = FL.S();
    const mo = R.motion(c, u);
    const alpha = mo.o * FL.fadeFactor(c, c.start + u);
    if (alpha <= 0.001) return;
    const { bw, bh } = R.baseSize(c);
    const fx = (c.effects || []).filter((e) => e.enabled && !FL.isAudioEffect(e.type));
    let img = null;
    let needBase = fx.length > 0 || c.type === 'graphic' || c.type === 'solid';

    if (c.type === 'text') img = R.textImage(c);
    else if (c.type === 'video' || c.type === 'image') {
      if (!src) return;
      if (c.type === 'video' && (src.readyState < 2 || !src.videoWidth)) return;
      if (c.type === 'image' && !(src.complete && src.naturalWidth)) return;
      img = src;
    }

    if (needBase) {
      const base = R.canvas(`base:${c.id}`, bw * q, bh * q);
      const bctx = base.getContext('2d');
      bctx.clearRect(0, 0, base.width, base.height);
      if (c.type === 'solid') { bctx.fillStyle = c.color || '#000'; bctx.fillRect(0, 0, base.width, base.height); }
      else if (c.type === 'graphic') {
        const gr = R.graphic(c, W, H);
        bctx.drawImage(gr.static, 0, 0, base.width, base.height);
        if (gr.crawl) {
          const cr = gr.crawl;
          bctx.save();
          bctx.beginPath();
          bctx.rect(cr.rx * q, cr.ry * q, cr.rw * q, cr.rh * q);
          bctx.clip();
          bctx.drawImage(cr.strip, (cr.rx + R.crawlX(cr, u)) * q, cr.ry * q, cr.strip.width * q, cr.rh * q);
          bctx.restore();
        }
      } else bctx.drawImage(img, 0, 0, base.width, base.height);
      img = fx.length ? R.applyEffects(base, fx, `clip:${c.id}`, q) : base;
    }

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(W / 2 + mo.x, H / 2 + mo.y);
    if (mo.r) ctx.rotate((mo.r * Math.PI) / 180);
    const dw = bw * mo.s;
    const dh = bh * mo.s;
    ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh);
    ctx.restore();
  };

  // Adjustment layer: applies effects to everything already drawn on the canvas.
  R.drawAdjust = (canvas, ctx, c, u, q) => {
    const mo = R.motion(c, u);
    const alpha = mo.o * FL.fadeFactor(c, c.start + u);
    const fx = (c.effects || []).filter((e) => e.enabled && !FL.isAudioEffect(e.type));
    if (alpha <= 0.001 || !fx.length) return;
    const snap = R.canvas(`adj:${c.id}`, canvas.width, canvas.height);
    const sctx = snap.getContext('2d');
    sctx.clearRect(0, 0, snap.width, snap.height);
    sctx.drawImage(canvas, 0, 0);
    const out = R.applyEffects(snap, fx, `adjclip:${c.id}`, q);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = alpha;
    ctx.drawImage(out, 0, 0);
    ctx.restore();
  };

  // ---------------------------------------------------------------- transitions (mirror FFmpeg xfade)
  // p is xfade "progress": 1 at the start of the transition (all A), 0 at the end (all B).
  // drawA / drawB draw each side into a context in sequence coordinates.
  R.transition = (ctx, type, p, drawA, drawB, q) => {
    const { width: W, height: H } = FL.S();
    const def = window.FLDefs.VIDEO_TRANSITIONS[type] || window.FLDefs.VIDEO_TRANSITIONS.crossdissolve;
    const mk = (key, fn) => {
      const c = R.canvas(key, W * q, H * q);
      const x = c.getContext('2d');
      x.setTransform(1, 0, 0, 1, 0, 0);
      x.clearRect(0, 0, c.width, c.height);
      x.setTransform(q, 0, 0, q, 0, 0);
      if (fn) fn(x);
      return c;
    };
    const A = mk('tr:A', drawA);
    const B = mk('tr:B', drawB);
    const put = (img, opts = {}) => {
      ctx.save();
      if (opts.alpha != null) ctx.globalAlpha = opts.alpha;
      if (opts.clip) { ctx.beginPath(); ctx.rect(...opts.clip); ctx.clip(); }
      ctx.drawImage(img, opts.dx || 0, opts.dy || 0, W, H);
      ctx.restore();
    };
    const weighted = (wA, wB, bgColor) => {
      const out = mk('tr:C');
      const o = out.getContext('2d');
      o.setTransform(1, 0, 0, 1, 0, 0);
      o.globalCompositeOperation = 'lighter';
      o.globalAlpha = wA; o.drawImage(A, 0, 0);
      o.globalAlpha = wB; o.drawImage(B, 0, 0);
      const rest = 1 - wA - wB;
      if (bgColor && rest > 0) { o.globalAlpha = rest; o.fillStyle = bgColor; o.fillRect(0, 0, out.width, out.height); }
      put(out);
    };
    switch (def.xfade) {
      case 'fade': weighted(p, 1 - p); break;
      case 'fadeblack': case 'fadewhite': {
        const s1 = smooth(0.8, 1, p);
        const s2 = smooth(0.2, 1, p);
        weighted(p * s1, (1 - p) * (1 - s2), def.xfade === 'fadeblack' ? '#000' : '#fff');
        break;
      }
      case 'wipeleft': put(A, { clip: [0, 0, W * p, H] }); put(B, { clip: [W * p, 0, W * (1 - p), H] }); break;
      case 'wiperight': put(B, { clip: [0, 0, W * (1 - p), H] }); put(A, { clip: [W * (1 - p), 0, W * p, H] }); break;
      case 'wipeup': put(A, { clip: [0, 0, W, H * p] }); put(B, { clip: [0, H * p, W, H * (1 - p)] }); break;
      case 'wipedown': put(B, { clip: [0, 0, W, H * (1 - p)] }); put(A, { clip: [0, H * (1 - p), W, H * p] }); break;
      case 'slideleft': put(A, { dx: -(1 - p) * W }); put(B, { dx: p * W }); break;
      case 'slideright': put(A, { dx: (1 - p) * W }); put(B, { dx: -p * W }); break;
      case 'slideup': put(A, { dy: -(1 - p) * H }); put(B, { dy: p * H }); break;
      case 'slidedown': put(A, { dy: (1 - p) * H }); put(B, { dy: -p * H }); break;
      case 'circleopen': {
        const pp = (p - 0.5) * 3;
        const m = B.getContext('2d');
        m.setTransform(1, 0, 0, 1, 0, 0);
        m.globalCompositeOperation = 'destination-in';
        const z = Math.hypot(B.width / 2, B.height / 2);
        const g = m.createRadialGradient(B.width / 2, B.height / 2, 0, B.width / 2, B.height / 2, z);
        for (let i = 0; i <= 20; i++) { const r = i / 20; g.addColorStop(r, `rgba(0,0,0,${(1 - smooth(0, 1, r + pp)).toFixed(4)})`); }
        m.fillStyle = g;
        m.fillRect(0, 0, B.width, B.height);
        m.globalCompositeOperation = 'source-over';
        put(A); put(B);
        break;
      }
      case 'radial': {
        const m = B.getContext('2d');
        m.setTransform(1, 0, 0, 1, 0, 0);
        m.globalCompositeOperation = 'destination-in';
        const g = m.createConicGradient(0, B.width / 2, B.height / 2);
        const N = 180;
        const shift = (p - 0.5) * Math.PI * 2.5;
        for (let i = 0; i <= N; i++) {
          const o = i / N;
          let th = Math.PI / 2 - o * Math.PI * 2;
          while (th <= -Math.PI) th += Math.PI * 2;
          while (th > Math.PI) th -= Math.PI * 2;
          g.addColorStop(o, `rgba(0,0,0,${smooth(0, 1, th - shift).toFixed(4)})`);
        }
        m.fillStyle = g;
        m.fillRect(0, 0, B.width, B.height);
        m.globalCompositeOperation = 'source-over';
        put(A); put(B);
        break;
      }
      case 'zoomin': {
        const zf = Math.max(0.02, smooth(0.5, 1, p));
        const wA = smooth(0, 0.5, p);
        const Z = mk('tr:Z');
        const zc = Z.getContext('2d');
        zc.setTransform(1, 0, 0, 1, 0, 0);
        const sw = A.width * zf;
        const sh = A.height * zf;
        zc.drawImage(A, (A.width - sw) / 2, (A.height - sh) / 2, sw, sh, 0, 0, Z.width, Z.height);
        const out = mk('tr:C');
        const o = out.getContext('2d');
        o.setTransform(1, 0, 0, 1, 0, 0);
        o.globalCompositeOperation = 'lighter';
        o.globalAlpha = wA; o.drawImage(Z, 0, 0);
        o.globalAlpha = 1 - wA; o.drawImage(B, 0, 0);
        put(out);
        break;
      }
      default: weighted(p, 1 - p);
    }
  };

  // ---------------------------------------------------------------- export assets
  // Everything the exporter can't draw itself, rendered at full sequence resolution.
  R.exportAssets = (seq) => {
    const images = {};
    const meta = {};
    const { width: W, height: H } = seq.settings;
    for (const c of seq.clips) {
      if (!FL.isVisual(c)) continue;
      const { bw, bh } = R.baseSize(c);
      meta[c.id] = { bw, bh };
      if (c.type === 'text') images[`text:${c.id}`] = R.textImage(c).toDataURL('image/png');
      if (c.type === 'graphic') {
        const gr = R.graphic(c, W, H);
        images[`gfx:${c.id}`] = gr.static.toDataURL('image/png');
        if (gr.crawl) {
          const cr = gr.crawl;
          images[`crawl:${c.id}`] = cr.strip.toDataURL('image/png');
          meta[c.id].crawl = { rx: cr.rx, ry: cr.ry, rw: cr.rw, rh: cr.rh, period: cr.period, speed: cr.speed, stripW: cr.strip.width };
        }
      }
      for (const e of c.effects || []) {
        if (!e.enabled || FL.isAudioEffect(e.type)) continue;
        if (e.mask && !window.FLDefs.VIDEO_EFFECTS[e.type].noMask) images[`mask:${c.id}:${e.id}`] = R.maskCanvas(e.mask, bw, bh, 1, true).toDataURL('image/png');
        if (e.type === 'vignette') images[`vig:${c.id}:${e.id}`] = R.vignetteCanvas(e.params, bw, bh, 1).toDataURL('image/png');
      }
    }
    return { images, meta };
  };
})();
