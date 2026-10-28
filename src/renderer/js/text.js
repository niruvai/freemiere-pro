/* Frameline — title rendering. The same function draws titles in the Program
   monitor and renders them to transparent PNGs for export, so what you see is
   what you get (including Bangla and other complex scripts). */
'use strict';

FL.FONTS = [
  'Helvetica Neue', 'SF Pro Display', 'Avenir Next', 'Futura', 'Gill Sans', 'Arial', 'Arial Black',
  'Georgia', 'Times New Roman', 'Didot', 'Baskerville', 'Courier New', 'Menlo', 'Impact',
  'Kohinoor Bangla', 'Bangla Sangam MN', 'Bangla MN', 'Noto Sans Bengali', 'Hind Siliguri',
];

FL.textLayout = (ctx, c) => {
  const font = `${c.italic ? 'italic ' : ''}${c.bold ? '700' : '400'} ${c.size}px "${c.font}", "Kohinoor Bangla", "Helvetica Neue", sans-serif`;
  ctx.font = font;
  const lines = String(c.text || '').split('\n');
  const lh = c.size * 1.22;
  const widths = lines.map((l) => ctx.measureText(l || ' ').width);
  const w = Math.max(1, ...widths);
  const h = lines.length * lh;
  const pad = c.box ? c.size * 0.35 : 0;
  return { font, lines, lh, widths, w, h, pad, bw: w + pad * 2, bh: h + pad * 2 };
};

FL.drawText = (ctx, c, W, H, alpha = 1) => {
  const L = FL.textLayout(ctx, c);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(W / 2 + (c.x || 0), H / 2 + (c.y || 0));
  if (c.rotation) ctx.rotate((c.rotation * Math.PI) / 180);
  ctx.font = L.font;
  ctx.textBaseline = 'middle';

  if (c.box) {
    ctx.save();
    ctx.globalAlpha = alpha * (c.boxOpacity ?? 0.6);
    ctx.fillStyle = c.boxColor || '#000';
    const r = Math.min(c.size * 0.18, L.bh / 2);
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(-L.bw / 2, -L.bh / 2, L.bw, L.bh, r);
    else ctx.rect(-L.bw / 2, -L.bh / 2, L.bw, L.bh);
    ctx.fill();
    ctx.restore();
  }

  const top = -L.h / 2 + L.lh / 2;
  L.lines.forEach((line, i) => {
    const y = top + i * L.lh;
    let x;
    if (c.align === 'left') { ctx.textAlign = 'left'; x = -L.w / 2; }
    else if (c.align === 'right') { ctx.textAlign = 'right'; x = L.w / 2; }
    else { ctx.textAlign = 'center'; x = 0; }
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
  ctx.restore();
  return L;
};

// Full-frame transparent PNG for the exporter.
FL.renderTextPNG = (c) => {
  const { width: W, height: H } = FL.project.settings;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  FL.drawText(ctx, c, W, H, 1);
  return canvas.toDataURL('image/png');
};
