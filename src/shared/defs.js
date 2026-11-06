/* Freemiere Pro — definitions shared by the editor (preview) and the exporter:
   effects, transitions, looks, graphics templates and keyframe maths.
   Loaded as a <script> in the renderer (window.FLDefs) and via require() in Node. */
(function (root, factory) {
  const defs = factory();
  if (typeof module === 'object' && module.exports) module.exports = defs;
  else root.FLDefs = defs;
})(typeof self !== 'undefined' ? self : this, () => {
  'use strict';

  // kf: whether the parameter can be animated with keyframes (preview and export both support it).
  const P = (key, label, min, max, def, o = {}) => ({ key, label, min, max, def, step: o.step ?? 1, unit: o.unit ?? '', type: o.type || 'num', options: o.options, kf: o.kf ?? (o.type !== 'color' && o.type !== 'file') });

  // ---------------------------------------------------------------- video effects
  const VIDEO_EFFECTS = {
    lumetri: {
      name: 'Lumetri Color', cat: 'Color Correction',
      params: [
        P('exposure', 'Exposure', -100, 100, 0),
        P('contrast', 'Contrast', -100, 100, 0),
        P('temperature', 'Temperature', -100, 100, 0),
        P('tint', 'Tint', -100, 100, 0),
        P('saturation', 'Saturation', 0, 200, 100, { unit: '%' }),
        P('fade', 'Faded Film', 0, 100, 0),
      ],
    },
    lut: {
      name: 'LUT (Look File)', cat: 'Color Correction',
      params: [P('file', 'LUT file (.cube)', 0, 0, '', { type: 'file' }), P('intensity', 'Intensity', 0, 100, 100, { unit: '%' })],
    },
    bw: { name: 'Black & White', cat: 'Color Correction', params: [P('amount', 'Amount', 0, 100, 100, { unit: '%' })] },
    blur: { name: 'Gaussian Blur', cat: 'Blur & Sharpen', params: [P('amount', 'Blurriness', 0, 200, 30)] },
    sharpen: { name: 'Sharpen', cat: 'Blur & Sharpen', params: [P('amount', 'Amount', 0, 100, 35, { kf: false })] },
    mosaic: { name: 'Mosaic', cat: 'Stylize', params: [P('blocks', 'Blocks', 2, 200, 40, { kf: false })] },
    vignette: { name: 'Vignette', cat: 'Stylize', params: [P('amount', 'Amount', 0, 100, 55, { kf: false }), P('size', 'Size', 10, 100, 60, { kf: false })] },
    crop: {
      name: 'Crop', cat: 'Transform',
      params: ['left', 'top', 'right', 'bottom'].map((k) => P(k, k[0].toUpperCase() + k.slice(1), 0, 100, 0, { unit: '%', kf: false })),
      noMask: true,
    },
    hflip: { name: 'Horizontal Flip', cat: 'Transform', params: [], noMask: true },
    vflip: { name: 'Vertical Flip', cat: 'Transform', params: [], noMask: true },
    chromakey: {
      name: 'Ultra Key (Chroma Key)', cat: 'Keying',
      params: [P('color', 'Key Color', 0, 0, '#00ff00', { type: 'color' }), P('similarity', 'Similarity', 1, 100, 30, { kf: false }), P('blend', 'Softness', 0, 100, 10, { kf: false })],
      noMask: true,
    },
  };

  // ---------------------------------------------------------------- audio effects
  const AUDIO_EFFECTS = {
    gain: { name: 'Gain', cat: 'Amplitude', params: [P('gain', 'Gain', -20, 20, 0, { unit: 'dB', step: 0.5 })] },
    eq: { name: 'Simple EQ', cat: 'Filter and EQ', params: [P('bass', 'Bass', -15, 15, 0, { unit: 'dB', step: 0.5 }), P('mid', 'Mid', -15, 15, 0, { unit: 'dB', step: 0.5 }), P('treble', 'Treble', -15, 15, 0, { unit: 'dB', step: 0.5 })] },
    highpass: { name: 'Highpass', cat: 'Filter and EQ', params: [P('freq', 'Cutoff', 20, 1000, 80, { unit: 'Hz' })] },
    lowpass: { name: 'Lowpass', cat: 'Filter and EQ', params: [P('freq', 'Cutoff', 1000, 20000, 12000, { unit: 'Hz', step: 100 })] },
    denoise: { name: 'DeNoise', cat: 'Noise Reduction', params: [P('amount', 'Reduction', 1, 40, 12, { unit: 'dB' })], exportOnly: true },
    compressor: { name: 'Dynamics (Compressor)', cat: 'Amplitude', params: [P('threshold', 'Threshold', -60, 0, -18, { unit: 'dB' }), P('ratio', 'Ratio', 1, 20, 4, { step: 0.5 })] },
  };
  // audio effect settings are static (the exporter applies them as fixed filters)
  for (const d of Object.values(AUDIO_EFFECTS)) for (const p of d.params) p.kf = false;

  // ---------------------------------------------------------------- transitions
  // `xfade` is the FFmpeg transition used on export; the preview mirrors its maths.
  const VIDEO_TRANSITIONS = {
    crossdissolve: { name: 'Cross Dissolve', cat: 'Dissolve', xfade: 'fade' },
    dipblack: { name: 'Dip to Black', cat: 'Dissolve', xfade: 'fadeblack' },
    dipwhite: { name: 'Dip to White', cat: 'Dissolve', xfade: 'fadewhite' },
    pushleft: { name: 'Push Left', cat: 'Slide', xfade: 'slideleft' },
    pushright: { name: 'Push Right', cat: 'Slide', xfade: 'slideright' },
    pushup: { name: 'Push Up', cat: 'Slide', xfade: 'slideup' },
    pushdown: { name: 'Push Down', cat: 'Slide', xfade: 'slidedown' },
    wipeleft: { name: 'Wipe Left', cat: 'Wipe', xfade: 'wipeleft' },
    wiperight: { name: 'Wipe Right', cat: 'Wipe', xfade: 'wiperight' },
    wipeup: { name: 'Wipe Up', cat: 'Wipe', xfade: 'wipeup' },
    wipedown: { name: 'Wipe Down', cat: 'Wipe', xfade: 'wipedown' },
    iris: { name: 'Iris Round', cat: 'Iris', xfade: 'circleopen' },
    clock: { name: 'Clock Wipe', cat: 'Wipe', xfade: 'radial' },
    zoom: { name: 'Cross Zoom', cat: 'Zoom', xfade: 'zoomin' },
  };
  const AUDIO_TRANSITIONS = {
    constantpower: { name: 'Constant Power', curve: 'qsin' },
    constantgain: { name: 'Constant Gain', curve: 'tri' },
    exponential: { name: 'Exponential Fade', curve: 'exp' },
  };
  const DEFAULT_TRANSITION_DURATION = 1;

  // ---------------------------------------------------------------- presets
  const LOOKS = {
    'Cinematic Warm': { exposure: 4, contrast: 22, temperature: 28, tint: -4, saturation: 108, fade: 6 },
    'Cool Blue': { exposure: 0, contrast: 16, temperature: -34, tint: 2, saturation: 92, fade: 0 },
    'Vivid Pop': { exposure: 3, contrast: 18, temperature: 4, tint: 0, saturation: 145, fade: 0 },
    'Bright & Airy': { exposure: 18, contrast: -12, temperature: 8, tint: 0, saturation: 92, fade: 4 },
    'Vintage Film': { exposure: 0, contrast: -10, temperature: 18, tint: 4, saturation: 72, fade: 38 },
    'Muted Documentary': { exposure: -2, contrast: -8, temperature: 0, tint: 0, saturation: 66, fade: 16 },
    'High Contrast Mono': { exposure: 2, contrast: 48, temperature: 0, tint: 0, saturation: 0, fade: 0 },
    'Night Teal': { exposure: -10, contrast: 24, temperature: -24, tint: -10, saturation: 90, fade: 0 },
  };
  const AUDIO_PRESETS = {
    'Voice Clean-up': [
      { type: 'highpass', params: { freq: 90 } },
      { type: 'denoise', params: { amount: 12 } },
      { type: 'eq', params: { bass: -2, mid: 2, treble: 3 } },
      { type: 'compressor', params: { threshold: -20, ratio: 3 } },
    ],
    'Background Music (−12 dB)': [{ type: 'gain', params: { gain: -12 } }],
    'Phone / Radio Voice': [{ type: 'highpass', params: { freq: 320 } }, { type: 'lowpass', params: { freq: 3400 } }, { type: 'gain', params: { gain: 3 } }],
    'Loud & Punchy': [{ type: 'compressor', params: { threshold: -24, ratio: 5 } }, { type: 'gain', params: { gain: 4 } }],
  };

  // ---------------------------------------------------------------- graphics templates
  const GRAPHICS = {
    headline: {
      name: 'News Headline Bar', desc: 'Red label + white headline strip',
      fields: { label: 'শিরোনাম', text: 'আপনার শিরোনাম এখানে লিখুন', labelBg: '#d81f26', labelColor: '#ffffff', barBg: '#ffffff', textColor: '#111111', font: 'Kohinoor Bangla', bottom: 13 },
    },
    ticker: {
      name: 'Scrolling Ticker', desc: 'Label + crawling news text',
      fields: { label: 'গরম খবর | দেশের সংবাদ', text: 'প্রথম খবর এখানে\nদ্বিতীয় খবর এখানে\nতৃতীয় খবর এখানে', labelBg: '#0b7a3b', labelColor: '#ffffff', barBg: '#ffffff', textColor: '#111111', font: 'Kohinoor Bangla', speed: 160, bottom: 4 },
    },
    lowerthird: {
      name: 'Lower Third', desc: 'Name and title strap',
      fields: { name: 'নাম লিখুন', title: 'পদবি / পরিচয়', accent: '#e8202a', barBg: '#101318', textColor: '#ffffff', font: 'Kohinoor Bangla', left: 6, bottom: 18 },
    },
    breaking: {
      name: 'Breaking News', desc: 'Big alert banner',
      fields: { label: 'ব্রেকিং নিউজ', text: 'গুরুত্বপূর্ণ সংবাদ এখানে', labelBg: '#e3001b', labelColor: '#ffffff', barBg: '#0e1a33', textColor: '#ffffff', font: 'Kohinoor Bangla', bottom: 13 },
    },
    live: {
      name: 'Live Bug', desc: 'LIVE badge + channel name (top corner)',
      fields: { label: 'LIVE', text: 'চ্যানেলের নাম', labelBg: '#e3001b', labelColor: '#ffffff', barBg: '#000000', textColor: '#ffffff', font: 'Kohinoor Bangla', corner: 'right' },
    },
    caption: {
      name: 'Caption Box', desc: 'Subtitle-style caption',
      fields: { text: 'এখানে ক্যাপশন লিখুন', barBg: '#000000', boxOpacity: 70, textColor: '#ffffff', font: 'Kohinoor Bangla', bottom: 8 },
    },
  };

  // ---------------------------------------------------------------- keyframes
  // Animatable clip properties. Effect parameters and mask positions are animatable too; their
  // keyframes live in clip.kf under "fx:<effectId>:<param>" and "mask:<effectId>:<cx|cy>".
  const KF_PROPS = ['x', 'y', 'scale', 'rotation', 'opacity', 'volume', 'pan', 'speed'];
  const MASK_KF = ['cx', 'cy'];
  const easeFn = (p, mode) => (mode === 'hold' ? 0 : mode === 'ease' ? p * p * (3 - 2 * p) : p);

  const findFx = (clip, id) => (clip.effects || []).find((e) => e.id === id);
  // The value a property has when it is not animated.
  function baseValue(clip, prop) {
    if (prop.startsWith('fx:')) { const [, id, p] = prop.split(':'); const e = findFx(clip, id); return e ? e.params[p] : 0; }
    if (prop.startsWith('mask:')) { const [, id, p] = prop.split(':'); const e = findFx(clip, id); return e && e.mask ? e.mask[p] : 0; }
    return clip[prop];
  }
  function setBase(clip, prop, v) {
    if (prop.startsWith('fx:')) { const [, id, p] = prop.split(':'); const e = findFx(clip, id); if (e) e.params[p] = v; return; }
    if (prop.startsWith('mask:')) { const [, id, p] = prop.split(':'); const e = findFx(clip, id); if (e && e.mask) e.mask[p] = v; return; }
    clip[prop] = v;
  }
  function isKfable(prop) {
    if (KF_PROPS.includes(prop)) return true;
    const [kind, , p] = prop.split(':');
    if (kind === 'mask') return MASK_KF.includes(p);
    return false;
  }
  function paramKfable(type, key) {
    const def = VIDEO_EFFECTS[type];
    const prm = def && def.params.find((x) => x.key === key);
    return !!(prm && prm.kf);
  }
  // Effect parameters and mask at clip-local time u.
  function effectAt(clip, e, u) {
    const out = Object.assign({}, e, { params: Object.assign({}, e.params) });
    for (const k of Object.keys(e.params)) {
      const prop = `fx:${e.id}:${k}`;
      if (hasKf(clip, prop)) out.params[k] = kfValue(clip, prop, u);
    }
    if (e.mask) {
      out.mask = Object.assign({}, e.mask);
      for (const k of MASK_KF) { const prop = `mask:${e.id}:${k}`; if (hasKf(clip, prop)) out.mask[k] = kfValue(clip, prop, u); }
    }
    return out;
  }
  const effectAnimated = (clip, e) => Object.keys(clip.kf || {}).some((k) => k.startsWith(`fx:${e.id}:`) && clip.kf[k].length > 1);
  const maskAnimated = (clip, e) => Object.keys(clip.kf || {}).some((k) => k.startsWith(`mask:${e.id}:`) && clip.kf[k].length > 1);

  function kfValue(clip, prop, u) {
    const k = clip.kf && clip.kf[prop];
    if (!k || !k.length) return baseValue(clip, prop);
    if (u <= k[0].t) return k[0].v;
    for (let i = 0; i < k.length - 1; i++) {
      if (u < k[i + 1].t) {
        const p = (u - k[i].t) / Math.max(1e-6, k[i + 1].t - k[i].t);
        return k[i].v + (k[i + 1].v - k[i].v) * easeFn(p, clip.kfMode && clip.kfMode[prop]);
      }
    }
    return k[k.length - 1].v;
  }
  function hasKf(clip, prop) { return !!(clip.kf && clip.kf[prop] && clip.kf[prop].length); }

  const fmt = (n) => {
    const s = Number(n.toFixed(5)).toString();
    return s === '-0' ? '0' : s;
  };
  // Piecewise FFmpeg expression for a keyframed property. U is the clip-local time expression.
  function kfExpr(clip, prop, U, map = (v) => v) {
    const k = clip.kf && clip.kf[prop];
    if (!k || !k.length) return fmt(map(baseValue(clip, prop)));
    if (k.length === 1) return fmt(map(k[0].v));
    const mode = clip.kfMode && clip.kfMode[prop];
    let expr = fmt(map(k[k.length - 1].v));
    for (let i = k.length - 2; i >= 0; i--) {
      const a = k[i];
      const b = k[i + 1];
      const va = map(a.v);
      const vb = map(b.v);
      const span = Math.max(1e-6, b.t - a.t);
      const pp = `((${U})-${fmt(a.t)})/${fmt(span)}`;
      const ep = mode === 'ease' ? `(${pp})*(${pp})*(3-2*(${pp}))` : pp;
      const seg = mode === 'hold' || va === vb ? fmt(va) : `${fmt(va)}+(${fmt(vb - va)})*(${ep})`;
      expr = `if(lt(${U},${fmt(b.t)}),${seg},${expr})`;
    }
    return `if(lt(${U},${fmt(k[0].t)}),${fmt(map(k[0].v))},${expr})`;
  }

  // ---------------------------------------------------------------- time remapping (speed ramps)
  // A clip's speed is either constant (clip.speed) or keyframed (clip.kf.speed, linear or hold).
  // S(u) = source seconds played between clip-local time 0 and u (negative before 0);
  // the source time shown at u is clip.in + S(u). Speeds are kept within 10 %–1000 %.
  const SPEED_MIN = 0.1;
  const SPEED_MAX = 10;
  const clampSpeed = (v) => Math.min(SPEED_MAX, Math.max(SPEED_MIN, +v || 1));
  const isRamped = (clip) => !!(clip.kf && clip.kf.speed && clip.kf.speed.length > 1);
  function rampModel(clip) {
    const k = clip.kf.speed.map((x) => ({ t: x.t, v: clampSpeed(x.v) }));
    const hold = clip.kfMode && clip.kfMode.speed === 'hold';
    const segs = [];
    let cum = 0;
    for (let i = 0; i < k.length - 1; i++) {
      const span = Math.max(1e-6, k[i + 1].t - k[i].t);
      const slope = hold ? 0 : (k[i + 1].v - k[i].v) / span;
      segs.push({ t0: k[i].t, t1: k[i + 1].t, v0: k[i].v, slope, c0: cum });
      cum += k[i].v * span + 0.5 * slope * span * span;
    }
    const m = { k, segs, cumEnd: cum, vFirst: k[0].v, vLast: k[k.length - 1].v, tFirst: k[0].t, tLast: k[k.length - 1].t };
    m.F0 = rampF(m, 0);
    return m;
  }
  // integral of speed from the first keyframe to u
  function rampF(m, u) {
    if (u <= m.tFirst) return m.vFirst * (u - m.tFirst);
    for (const s of m.segs) if (u < s.t1) { const d = u - s.t0; return s.c0 + s.v0 * d + 0.5 * s.slope * d * d; }
    return m.cumEnd + m.vLast * (u - m.tLast);
  }
  function rampFinv(m, y) {
    if (y <= 0) return m.tFirst + y / m.vFirst;
    for (const s of m.segs) {
      const end = s.c0 + s.v0 * (s.t1 - s.t0) + 0.5 * s.slope * (s.t1 - s.t0) ** 2;
      if (y < end) {
        const d = y - s.c0;
        if (Math.abs(s.slope) < 1e-9) return s.t0 + d / s.v0;
        return s.t0 + (-s.v0 + Math.sqrt(Math.max(0, s.v0 * s.v0 + 2 * s.slope * d))) / s.slope;
      }
    }
    return m.tLast + (y - m.cumEnd) / m.vLast;
  }
  function speedAt(clip, u) {
    if (!isRamped(clip)) return clip.speed || 1;
    return clampSpeed(kfValue(Object.assign({}, clip, { kfMode: { speed: clip.kfMode && clip.kfMode.speed === 'hold' ? 'hold' : 'linear' } }), 'speed', u));
  }
  function srcOffset(clip, u) {
    if (!isRamped(clip)) return u * (clip.speed || 1);
    const m = rampModel(clip);
    return rampF(m, u) - m.F0;
  }
  // clip-local time at which `off` source seconds (relative to clip.in) are reached
  function srcInverse(clip, off) {
    if (!isRamped(clip)) return off / (clip.speed || 1);
    const m = rampModel(clip);
    return rampFinv(m, off + m.F0);
  }
  // FFmpeg expression for srcInverse, given an expression Y for the source offset.
  function srcInverseExpr(clip, Y) {
    if (!isRamped(clip)) return `(${Y})/${fmt(clip.speed || 1)}`;
    const m = rampModel(clip);
    const y = `((${Y})+${fmt(m.F0)})`;
    let expr = `${fmt(m.tLast)}+(${y}-${fmt(m.cumEnd)})/${fmt(m.vLast)}`;
    for (let i = m.segs.length - 1; i >= 0; i--) {
      const s = m.segs[i];
      const end = s.c0 + s.v0 * (s.t1 - s.t0) + 0.5 * s.slope * (s.t1 - s.t0) ** 2;
      const d = `(${y}-${fmt(s.c0)})`;
      const seg = Math.abs(s.slope) < 1e-9
        ? `${fmt(s.t0)}+${d}/${fmt(s.v0)}`
        : `${fmt(s.t0)}+(sqrt(max(0,${fmt(s.v0 * s.v0)}+${fmt(2 * s.slope)}*${d}))-${fmt(s.v0)})/${fmt(s.slope)}`;
      expr = `if(lt(${y},${fmt(end)}),${seg},${expr})`;
    }
    return `if(lt(${y},0),${fmt(m.tFirst)}+${y}/${fmt(m.vFirst)},${expr})`;
  }

  // ---------------------------------------------------------------- colour maths
  // Lumetri-style grade as per-channel linear (gain/offset) + 3×3 saturation matrix,
  // identical in the canvas preview (SVG filter) and in FFmpeg (lutrgb + colorchannelmixer).
  const LUMA = [0.2126, 0.7152, 0.0722];
  function colorOps(effect) {
    const p = effect.params || {};
    const lin = [[1, 0], [1, 0], [1, 0]]; // [gain, offset] per R,G,B
    let sat = 1;
    if (effect.type === 'lumetri') {
      const g = Math.pow(2, (p.exposure || 0) / 50);
      const k = 1 + (p.contrast || 0) / 100;
      const t = (p.temperature || 0) / 100;
      const ti = (p.tint || 0) / 100;
      const m = [(1 + t * 0.22) * (1 + ti * 0.08), 1 - ti * 0.16, (1 - t * 0.22) * (1 + ti * 0.08)];
      const ff = ((p.fade || 0) / 100) * 0.22;
      for (let c = 0; c < 3; c++) {
        let [a, b] = lin[c];
        a *= g; b *= g;
        a *= k; b = (b - 0.5) * k + 0.5;
        a *= m[c]; b *= m[c];
        a *= 1 - ff; b = b * (1 - ff) + ff;
        lin[c] = [a, b];
      }
      sat = (p.saturation ?? 100) / 100;
    } else if (effect.type === 'bw') {
      sat = 1 - (p.amount ?? 100) / 100;
    }
    const M = [];
    for (let r = 0; r < 3; r++) {
      const row = [];
      for (let c = 0; c < 3; c++) row.push((1 - sat) * LUMA[c] + (r === c ? sat : 0));
      M.push(row);
    }
    return { lin, M };
  }

  const DEFAULT_GRAPHIC_DURATION = 6;

  return {
    VIDEO_EFFECTS, AUDIO_EFFECTS, VIDEO_TRANSITIONS, AUDIO_TRANSITIONS, DEFAULT_TRANSITION_DURATION,
    LOOKS, AUDIO_PRESETS, GRAPHICS, DEFAULT_GRAPHIC_DURATION,
    KF_PROPS, MASK_KF, kfValue, kfExpr, hasKf, easeFn, colorOps, fmt,
    baseValue, setBase, isKfable, paramKfable, effectAt, effectAnimated, maskAnimated,
    SPEED_MIN, SPEED_MAX, clampSpeed, isRamped, speedAt, srcOffset, srcInverse, srcInverseExpr,
  };
});
