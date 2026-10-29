/* Freemiere Pro — audio engine: every playing clip is routed through Web Audio
   (clip effects → volume → pan → track bus → master) so preview matches the
   export, volume can go above 100 % and the master meters are real. */
'use strict';

(() => {
  const A = (FL.audio = {});
  let ac = null;
  let master = null;
  let anL = null;
  let anR = null;
  const buses = new Map();   // trackId -> GainNode
  const graphs = new Map();  // element -> graph

  function ensure() {
    if (ac) return ac;
    ac = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
    master = ac.createGain();
    const split = ac.createChannelSplitter(2);
    anL = ac.createAnalyser();
    anR = ac.createAnalyser();
    anL.fftSize = 1024; anR.fftSize = 1024;
    master.connect(split);
    split.connect(anL, 0);
    split.connect(anR, 1);
    master.connect(ac.destination);
    return ac;
  }
  A.context = () => ensure();
  A.resume = () => { ensure(); if (ac.state !== 'running') ac.resume().catch(() => {}); };

  function bus(trackId) {
    ensure();
    let b = buses.get(trackId);
    if (!b) { b = ac.createGain(); b.connect(master); buses.set(trackId, b); }
    return b;
  }
  // mute / solo per track
  A.updateBuses = () => {
    const tracks = FL.seq().tracks;
    const anySolo = tracks.some((t) => t.kind === 'audio' && t.solo);
    for (const t of tracks) {
      let g = 1;
      if (t.kind === 'audio') g = t.muted || (anySolo && !t.solo) ? 0 : 1;
      else g = anySolo ? 0 : 1;
      bus(t.id).gain.setTargetAtTime(g, ac.currentTime, 0.01);
    }
  };

  function fxSignature(c) {
    return JSON.stringify((c.effects || []).filter((e) => e.enabled && FL.isAudioEffect(e.type) && !window.FLDefs.AUDIO_EFFECTS[e.type].exportOnly).map((e) => [e.type, e.params]));
  }
  function buildFx(c) {
    const nodes = [];
    for (const e of c.effects || []) {
      if (!e.enabled || !FL.isAudioEffect(e.type)) continue;
      const p = e.params;
      if (e.type === 'gain') { const g = ac.createGain(); g.gain.value = Math.pow(10, p.gain / 20); nodes.push(g); }
      if (e.type === 'eq') {
        const lo = ac.createBiquadFilter(); lo.type = 'lowshelf'; lo.frequency.value = 120; lo.gain.value = p.bass;
        const mid = ac.createBiquadFilter(); mid.type = 'peaking'; mid.frequency.value = 1000; mid.Q.value = 0.7; mid.gain.value = p.mid;
        const hi = ac.createBiquadFilter(); hi.type = 'highshelf'; hi.frequency.value = 4000; hi.gain.value = p.treble;
        nodes.push(lo, mid, hi);
      }
      if (e.type === 'highpass' || e.type === 'lowpass') { const f = ac.createBiquadFilter(); f.type = e.type; f.frequency.value = p.freq; f.Q.value = 0.707; nodes.push(f); }
      if (e.type === 'compressor') { const k = ac.createDynamicsCompressor(); k.threshold.value = p.threshold; k.ratio.value = p.ratio; k.attack.value = 0.02; k.release.value = 0.25; nodes.push(k); }
    }
    return nodes;
  }

  // Connect a media element for a clip (called once per element).
  A.attach = (el, c) => {
    ensure();
    let g = graphs.get(el);
    if (!g) {
      let src;
      try { src = ac.createMediaElementSource(el); } catch (err) { console.warn('audio attach failed', err); return null; }
      const gain = ac.createGain();
      gain.channelCount = 2;
      gain.channelCountMode = 'explicit';
      gain.channelInterpretation = 'speakers';
      const split = ac.createChannelSplitter(2);
      const gl = ac.createGain();
      const gr = ac.createGain();
      const merge = ac.createChannelMerger(2);
      gain.connect(split);
      split.connect(gl, 0); split.connect(gr, 1);
      gl.connect(merge, 0, 0); gr.connect(merge, 0, 1);
      g = { src, gain, gl, gr, merge, fx: [], sig: null, trackId: null };
      gain.gain.value = 0;
      graphs.set(el, g);
    }
    const sig = fxSignature(c);
    if (g.sig !== sig) {
      g.src.disconnect();
      g.fx.forEach((n) => n.disconnect());
      g.fx = buildFx(c);
      let prev = g.src;
      for (const n of g.fx) { prev.connect(n); prev = n; }
      prev.connect(g.gain);
      g.sig = sig;
    }
    if (g.trackId !== c.trackId) {
      g.merge.disconnect();
      g.merge.connect(bus(c.trackId));
      g.trackId = c.trackId;
    }
    return g;
  };

  // Per-frame level for a clip: volume keyframes × fades × audio transitions; pan as balance.
  A.set = (el, level, pan) => {
    const g = graphs.get(el);
    if (!g) return;
    const t = ac.currentTime;
    g.gain.gain.setTargetAtTime(Math.max(0, level), t, 0.012);
    const p = FL.clamp(pan || 0, -1, 1);
    g.gl.gain.setTargetAtTime(Math.min(1, 1 - p), t, 0.012);
    g.gr.gain.setTargetAtTime(Math.min(1, 1 + p), t, 0.012);
  };
  A.detach = (el) => {
    const g = graphs.get(el);
    if (!g) return;
    try { g.src.disconnect(); g.fx.forEach((n) => n.disconnect()); g.gain.disconnect(); g.merge.disconnect(); } catch (_) {}
    graphs.delete(el);
  };

  // ---------------------------------------------------------------- meters
  const meter = document.getElementById('meter');
  const mctx = meter.getContext('2d');
  const buf = new Float32Array(1024);
  const peak = [-60, -60];
  const hold = [{ v: -60, t: 0 }, { v: -60, t: 0 }];
  let clipLit = [0, 0];
  function level(an) {
    an.getFloatTimeDomainData(buf);
    let m = 0;
    for (let i = 0; i < buf.length; i++) { const v = Math.abs(buf[i]); if (v > m) m = v; }
    return m > 0 ? 20 * Math.log10(m) : -100;
  }
  const dbToY = (db, h) => h * (1 - (FL.clamp(db, -60, 0) + 60) / 60);
  function drawMeter(now) {
    const dpr = window.devicePixelRatio || 1;
    const w = meter.clientWidth;
    const h = meter.clientHeight;
    if (!w || !h) { requestAnimationFrame(drawMeter); return; }
    if (meter.width !== Math.round(w * dpr) || meter.height !== Math.round(h * dpr)) { meter.width = Math.round(w * dpr); meter.height = Math.round(h * dpr); }
    mctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    mctx.clearRect(0, 0, w, h);
    const top = 14;
    const mh = h - top - 4;
    const vals = ac && FL.playing ? [level(anL), level(anR)] : [-100, -100];
    const barW = Math.floor((w - 16) / 2) - 2;
    for (let ch = 0; ch < 2; ch++) {
      peak[ch] = Math.max(vals[ch], peak[ch] - 1.2);
      if (peak[ch] >= hold[ch].v || now - hold[ch].t > 1200) { hold[ch] = { v: peak[ch], t: now }; }
      if (vals[ch] >= -0.1) clipLit[ch] = now;
      const x = 2 + ch * (barW + 3);
      mctx.fillStyle = '#0c0c0e';
      mctx.fillRect(x, top, barW, mh);
      const y = dbToY(peak[ch], mh);
      const grad = mctx.createLinearGradient(0, top, 0, top + mh);
      grad.addColorStop(0, '#ff4f4f');
      grad.addColorStop(0.1, '#ffd34d');
      grad.addColorStop(0.3, '#3ddc84');
      grad.addColorStop(1, '#1f9e5a');
      mctx.fillStyle = grad;
      mctx.fillRect(x, top + y, barW, mh - y);
      if (hold[ch].v > -59) { mctx.fillStyle = '#e8e8ec'; mctx.fillRect(x, top + dbToY(hold[ch].v, mh), barW, 1.5); }
      mctx.fillStyle = now - clipLit[ch] < 1500 ? '#ff3b3b' : '#3a1515';
      mctx.fillRect(x, 3, barW, 7);
    }
    mctx.fillStyle = '#6b6b74';
    mctx.font = '9px "SF Mono", Menlo, monospace';
    mctx.textAlign = 'left';
    for (const db of [0, -6, -12, -18, -24, -36, -48]) {
      const y = top + dbToY(db, mh);
      mctx.fillText(String(db), 2 + 2 * (barW + 3) + 1, y + 3);
    }
    requestAnimationFrame(drawMeter);
  }
  requestAnimationFrame(drawMeter);
  FL.on('change', () => { if (ac) A.updateBuses(); });
  FL.on('seq', () => { if (ac) A.updateBuses(); });
})();
