// Frameline — turns a project (tracks + clips) into one FFmpeg command.
// Video tracks are composited bottom-up over a solid background with `overlay`;
// every clip's audio is trimmed, faded, delayed to its start and mixed with `amix`.

function num(n, d = 4) {
  return Number(n.toFixed(d)).toString();
}
function even(n) {
  n = Math.max(2, Math.round(n));
  return n % 2 ? n + 1 : n;
}
function atempoChain(speed) {
  const parts = [];
  let r = speed;
  while (r > 2) { parts.push(2); r /= 2; }
  while (r < 0.5) { parts.push(0.5); r /= 0.5; }
  if (Math.abs(r - 1) > 1e-6) parts.push(r);
  return parts.map((p) => `atempo=${num(p, 5)}`);
}
function hexColor(c) {
  return '0x' + String(c || '#000000').replace('#', '').slice(0, 6);
}

function projectDuration(project) {
  let end = 0;
  for (const c of project.clips) end = Math.max(end, c.start + c.duration);
  return Math.max(end, 0.04);
}

function buildExportArgs(project, options, textImages, outPath) {
  const seq = project.settings;
  const SW = seq.width;
  const SH = seq.height;
  const fps = options.fps || seq.fps;
  const OW = even(options.width || SW);
  const OH = even(options.height || SH);
  const total = projectDuration(project);
  const media = Object.fromEntries(project.media.map((m) => [m.id, m]));
  const trackById = Object.fromEntries(project.tracks.map((t) => [t.id, t]));

  const inputs = [];
  const filters = [];
  const addInput = (args) => { inputs.push(...args); return inputs.filter((a) => a === '-i').length - 1; };

  filters.push(`color=c=${hexColor(seq.bg)}:s=${SW}x${SH}:r=${fps}:d=${num(total)},format=rgba[bg0]`);
  let last = 'bg0';
  let n = 0;

  // ---- picture ----
  const videoTracks = project.tracks.filter((t) => t.kind === 'video').reverse(); // V1 first
  const audioJobs = [];
  for (const track of videoTracks) {
    const clips = project.clips.filter((c) => c.trackId === track.id).sort((a, b) => a.start - b.start);
    for (const clip of clips) {
      const m = media[clip.mediaId];
      const dur = clip.duration;
      const chain = [];
      let input;
      if (clip.type === 'text') {
        if (!textImages[clip.id]) continue;
        input = addInput(['-f', 'image2', '-pattern_type', 'none', '-loop', '1', '-framerate', String(fps), '-t', num(dur), '-i', textImages[clip.id]]);
        chain.push('format=rgba');
      } else if (clip.type === 'image') {
        if (!m) continue;
        input = addInput(['-f', 'image2', '-pattern_type', 'none', '-loop', '1', '-framerate', String(fps), '-t', num(dur), '-i', m.path]);
      } else if (clip.type === 'video') {
        if (!m) continue;
        input = addInput(['-ss', num(clip.in || 0), '-t', num(dur * (clip.speed || 1) + 0.1), '-i', m.path]);
        if (m.hasAudio && !clip.muted && (clip.volume ?? 1) > 0) audioJobs.push({ clip, input, track });
      } else continue;

      if (track.hidden) continue; // audio of a hidden video track still plays

      if (clip.type !== 'text') {
        const speed = clip.speed || 1;
        chain.push(speed !== 1 ? `setpts=(PTS-STARTPTS)/${num(speed, 5)}` : 'setpts=PTS-STARTPTS');
        chain.push(`fps=${fps}`);
        const fit = Math.min(SW / m.width, SH / m.height) * (clip.scale ?? 1);
        chain.push(`scale=${even(m.width * fit)}:${even(m.height * fit)}:flags=bicubic`, 'setsar=1');
        const b = clip.brightness || 0;
        const c = clip.contrast || 0;
        const s = clip.saturation ?? 100;
        if (b || c || s !== 100) chain.push(`eq=brightness=${num(b / 100 * 0.25)}:contrast=${num(1 + c / 100)}:saturation=${num(s / 100)}`);
        chain.push('format=rgba');
        if (clip.rotation) {
          const rad = num((clip.rotation * Math.PI) / 180, 6);
          chain.push(`rotate=${rad}:c=none:ow=rotw(${rad}):oh=roth(${rad})`);
        }
      }
      chain.push(`trim=duration=${num(dur)}`);
      const op = clip.opacity ?? 1;
      if (op < 1) chain.push(`colorchannelmixer=aa=${num(op)}`);
      if (clip.fadeIn > 0) chain.push(`fade=t=in:st=0:d=${num(Math.min(clip.fadeIn, dur))}:alpha=1`);
      if (clip.fadeOut > 0) chain.push(`fade=t=out:st=${num(Math.max(0, dur - clip.fadeOut))}:d=${num(Math.min(clip.fadeOut, dur))}:alpha=1`);
      chain.push(`setpts=PTS-STARTPTS+${num(clip.start)}/TB`);

      const label = `v${n}`;
      filters.push(`[${input}:v]${chain.join(',')}[${label}]`);
      const x = clip.type === 'text' ? 0 : clip.x || 0;
      const y = clip.type === 'text' ? 0 : clip.y || 0;
      const next = `bg${++n}`;
      filters.push(`[${last}][${label}]overlay=x='(main_w-overlay_w)/2+${num(x, 2)}':y='(main_h-overlay_h)/2+${num(y, 2)}'` +
        `:enable='between(t,${num(clip.start)},${num(clip.start + dur)})':eof_action=pass:format=auto[${next}]`);
      last = next;
    }
  }
  const finalV = [];
  if (OW !== SW || OH !== SH) finalV.push(`scale=${OW}:${OH}:flags=lanczos`);
  finalV.push('format=yuv420p');
  filters.push(`[${last}]${finalV.join(',')}[vout]`);

  // ---- sound ----
  for (const track of project.tracks.filter((t) => t.kind === 'audio')) {
    if (track.muted) continue;
    for (const clip of project.clips.filter((c) => c.trackId === track.id)) {
      const m = media[clip.mediaId];
      if (!m || !m.hasAudio || clip.muted || (clip.volume ?? 1) <= 0) continue;
      const input = addInput(['-ss', num(clip.in || 0), '-t', num(clip.duration * (clip.speed || 1) + 0.1), '-i', m.path]);
      audioJobs.push({ clip, input, track });
    }
  }
  const mixLabels = [];
  filters.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${num(total)}[asil]`);
  audioJobs.forEach(({ clip, input }, i) => {
    const chain = ['aresample=48000', 'aformat=sample_fmts=fltp:channel_layouts=stereo', 'asetpts=PTS-STARTPTS'];
    chain.push(...atempoChain(clip.speed || 1));
    chain.push(`atrim=duration=${num(clip.duration)}`);
    if ((clip.volume ?? 1) !== 1) chain.push(`volume=${num(clip.volume)}`);
    if (clip.fadeIn > 0) chain.push(`afade=t=in:st=0:d=${num(Math.min(clip.fadeIn, clip.duration))}`);
    if (clip.fadeOut > 0) chain.push(`afade=t=out:st=${num(Math.max(0, clip.duration - clip.fadeOut))}:d=${num(Math.min(clip.fadeOut, clip.duration))}`);
    const ms = Math.round(clip.start * 1000);
    if (ms > 0) chain.push(`adelay=${ms}:all=1`);
    filters.push(`[${input}:a]${chain.join(',')}[a${i}]`);
    mixLabels.push(`[a${i}]`);
  });
  filters.push(`[asil]${mixLabels.join('')}amix=inputs=${mixLabels.length + 1}:duration=first:dropout_transition=0:normalize=0,alimiter=limit=0.98[aout]`);

  const q = { high: ['medium', '18'], standard: ['fast', '21'], draft: ['veryfast', '27'] }[options.quality || 'standard'];
  return [
    '-y', '-hide_banner', '-nostdin',
    ...inputs,
    '-filter_complex', filters.join(';\n'),
    '-map', '[vout]', '-map', '[aout]',
    '-c:v', 'libx264', '-preset', q[0], '-crf', q[1], '-pix_fmt', 'yuv420p', '-r', String(fps),
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
    '-t', num(total),
    '-movflags', '+faststart',
    '-progress', 'pipe:1', '-nostats',
    outPath,
  ];
}

module.exports = { buildExportArgs, projectDuration };
