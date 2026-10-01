// Clip export engine: builds and runs the ffmpeg commands for the Clip
// Editor. Kept free of any Electron imports so it can be run and tested
// with plain Node (see test/ for the export tests).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const ASPECT_RATIOS = {
  vertical: { w: 9, h: 16 },
  square: { w: 1, h: 1 },
  portrait: { w: 4, h: 5 },
  landscape: { w: 16, h: 9 },
};

// ffmpeg filters for each "Look". Kept deliberately mild so they flatter
// phone footage instead of overpowering it. The renderer has a matching
// CSS approximation for the live preview (LOOK_PREVIEW in renderer.js).
const LOOK_FILTERS = {
  none: [],
  vivid: ['eq=saturation=1.35:contrast=1.08'],
  warm: ['colorbalance=rs=0.08:gs=0.02:bs=-0.08', 'eq=saturation=1.08'],
  cool: ['colorbalance=rs=-0.06:gs=0:bs=0.08'],
  gold: ['colorbalance=rs=0.10:gs=0.04:bs=-0.12', 'eq=saturation=1.15:contrast=1.05'],
  cinematic: ['eq=contrast=1.15:saturation=0.85', 'vignette=PI/5'],
  vintage: ['curves=preset=vintage'],
  faded: ['eq=contrast=0.88:brightness=0.03:saturation=0.8'],
  bw: ['hue=s=0', 'eq=contrast=1.1'],
};

const TRANSITIONS = new Set([
  'fade', 'dissolve', 'fadeblack', 'slideleft', 'slideup', 'wipeleft', 'circleopen', 'smoothleft',
]);

const TEXT_POSITIONS = {
  top: 'h*0.08',
  center: '(h-text_h)/2',
  bottom: 'h*0.86-text_h',
};

function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

function fmt(n) {
  // Short, locale-proof decimal for filter arguments.
  return String(Math.round(n * 1000) / 1000);
}

function safeFileName(name) {
  return String(name || '').replace(/[\\/:*?"<>|]+/g, '_').trim() || 'clip';
}

// File PATHS need escaping inside a filtergraph (Windows drive letters
// contain a colon, and backslashes are the filter escape character).
function escPath(p) {
  return String(p).replace(/\\/g, '/').replace(/:/g, '\\:');
}

function writeTextFile(tmpDir, text) {
  fs.mkdirSync(tmpDir, { recursive: true });
  const filePath = path.join(tmpDir, `t-${crypto.randomBytes(6).toString('hex')}.txt`);
  fs.writeFileSync(filePath, String(text == null ? '' : text), 'utf8');
  return filePath;
}

function getSpeed(clip) {
  return clamp(num(clip.speed, 1), 0.25, 4);
}

function sourceDuration(clip) {
  return Math.max(0.1, num(clip.end, 0) - num(clip.start, 0));
}

function outputDuration(clip) {
  return sourceDuration(clip) / getSpeed(clip);
}

function resolutionBase(settings) {
  const r = settings && settings.resolution;
  if (r === '720' || r === '1080' || r === '1440' || r === '2160') return Number(r);
  return null; // keep source resolution
}

// Output size for a reframed clip: the short side is `base` pixels.
function getOutputDims(rw, rh, base) {
  const b = base || 1080;
  let outW;
  let outH;
  if (rw <= rh) {
    outW = b;
    outH = Math.round((b * rh) / rw);
  } else {
    outH = b;
    outW = Math.round((b * rw) / rh);
  }
  return { outW: Math.round(outW / 2) * 2, outH: Math.round(outH / 2) * 2 };
}

function isReframed(clip) {
  return !!(clip.aspect && clip.aspect !== 'original' && clip.crop);
}

function getRatio(clip) {
  const ratio = clip.aspect === 'custom' ? clip.customRatio : ASPECT_RATIOS[clip.aspect];
  return { w: (ratio && ratio.w) || 9, h: (ratio && ratio.h) || 16 };
}

// atempo only accepts 0.5..2 per instance, so chain it for bigger changes.
function atempoChain(speed) {
  if (Math.abs(speed - 1) < 0.001) return [];
  const parts = [];
  let s = speed;
  while (s > 2) { parts.push('atempo=2'); s /= 2; }
  while (s < 0.5) { parts.push('atempo=0.5'); s /= 0.5; }
  parts.push(`atempo=${fmt(s)}`);
  return parts;
}

function lookFilters(clip) {
  const look = clip.look || {};
  const out = [...(LOOK_FILTERS[look.preset] || [])];
  const b = clamp(num(look.brightness, 0), -0.5, 0.5);
  const c = clamp(num(look.contrast, 1), 0.3, 2);
  const s = clamp(num(look.saturation, 1), 0, 3);
  if (Math.abs(b) > 0.001 || Math.abs(c - 1) > 0.001 || Math.abs(s - 1) > 0.001) {
    out.push(`eq=brightness=${fmt(b)}:contrast=${fmt(c)}:saturation=${fmt(s)}`);
  }
  return out;
}

// Slow zoom in/out ("Ken Burns"). Scales every frame up a little more (or
// less) and crops the centre back to the original size.
const MOTION = {
  zoomin: { amount: 0.15, dir: 1 },
  zoomout: { amount: 0.15, dir: -1 },
  punchin: { amount: 0.35, dir: 1 },
};

function motionFilters(clip, width, height) {
  const m = MOTION[clip.motion];
  if (!m || !width || !height) return [];
  const W = Math.round(width / 2) * 2;
  const H = Math.round(height / 2) * 2;
  const D = fmt(Math.max(0.1, outputDuration(clip)));
  const progress = m.dir > 0 ? `min(t/${D},1)` : `max(1-t/${D},0)`;
  const z = `(1+${m.amount}*${progress})`;
  return [
    `scale=w='${W}*${z}':h=-2:eval=frame`,
    `crop=w=${W}:h=${H}:x='${W}*(${z}-1)/2':y='${H}*(${z}-1)/2'`,
    'setsar=1',
  ];
}

function hexColor(color, fallback) {
  return /^#[0-9a-f]{6}$/i.test(String(color || '')) ? `0x${color.slice(1)}` : fallback;
}

// Auto-captions are stored with absolute source-video times (so trimming
// the clip later keeps them in sync) and drawn like text with a shared style.
function captionTexts(clip) {
  const cap = clip.captions;
  if (!cap || cap.enabled === false || !Array.isArray(cap.lines)) return [];
  const style = cap.style || {};
  const speed = getSpeed(clip);
  const start = num(clip.start, 0);
  const end = num(clip.end, start);
  const out = [];
  for (const line of cap.lines) {
    const a = Math.max(start, num(line.start, 0));
    const b = Math.min(end, num(line.end, 0));
    if (b - a < 0.05) continue;
    let text = String(line.text || '').trim();
    if (!text) continue;
    if (style.upper) text = text.toUpperCase();
    out.push({
      text,
      size: style.size != null ? style.size : 5,
      color: style.color || '#ffffff',
      position: style.position || 'bottom',
      style: style.style || 'box',
      start: (a - start) / speed,
      end: (b - start) / speed,
    });
  }
  return out;
}

// Text layout shared with the preview (renderer.js has the same maths):
// lines are wrapped to fit 90% of the frame width, and each line is drawn
// centred on its own, LINE_GAP font-heights apart.
const LINE_GAP = 1.3;

function wrapForFrame(text, sizePct, aspect) {
  const out = [];
  for (const raw of String(text).split('\n')) {
    const upper = /[A-Z]/.test(raw) && raw === raw.toUpperCase();
    const charW = (upper ? 0.68 : 0.58) * (sizePct / 100);
    const maxChars = Math.max(6, Math.floor((0.9 * aspect) / charW));
    let line = '';
    for (const word of raw.split(/\s+/).filter(Boolean)) {
      if (!line) line = word;
      else if ((line + ' ' + word).length <= maxChars) line += ` ${word}`;
      else { out.push(line); line = word; }
    }
    out.push(line);
  }
  return out.filter((l, i, arr) => l || (i > 0 && i < arr.length - 1));
}

function lineY(position, index, count, sizeFrac) {
  const lh = `h*${fmt(sizeFrac * LINE_GAP)}`;
  if (position === 'top') return `h*0.08+${index}*${lh}`;
  if (position === 'center') return `(h-${count}*${lh})/2+${index}*${lh}`;
  return `h*0.86-${count - index}*${lh}`;
}

function textFilters(clip, ctx) {
  const texts = [...(Array.isArray(clip.texts) ? clip.texts : []), ...captionTexts(clip)];
  if (ctx.hasDrawtext === false) {
    if (texts.some((t) => String(t.text || '').trim()) && ctx.warn) {
      ctx.warn('This copy of ffmpeg cannot draw text, so text was left out of the export.');
    }
    return [];
  }
  const dur = outputDuration(clip);
  const aspect = ctx.frameAspect > 0 ? ctx.frameAspect : 16 / 9;
  const filters = [];
  for (const t of texts) {
    const content = String(t.text || '').trim();
    if (!content) continue;
    const sizePct = clamp(num(t.size, 7), 2, 30);
    const size = sizePct / 100;
    const start = clamp(num(t.start, 0), 0, dur);
    const end = clamp(num(t.end, dur), start + 0.05, Math.max(start + 0.05, dur + 1));
    const lines = wrapForFrame(content, sizePct, aspect);
    lines.forEach((line, i) => {
      if (!line) return;
      const txtFile = writeTextFile(ctx.tmpDir, line);
      const parts = [
        `fontfile=${escPath(ctx.fontPath)}`,
        `textfile=${escPath(txtFile)}`,
        'expansion=none',
        `fontsize=h*${fmt(size)}`,
        `fontcolor=${hexColor(t.color, '0xffffff')}`,
        'x=(w-text_w)/2',
        `y=${lineY(t.position, i, lines.length, size)}`,
      ];
      if (t.style === 'box') {
        parts.push('box=1', 'boxcolor=black@0.55', `boxborderw=${Math.max(6, Math.round(18 * (sizePct / 7)))}`);
      } else if (t.style !== 'plain') {
        parts.push('borderw=4', 'bordercolor=black@0.85');
      }
      parts.push(`enable='between(t,${fmt(start)},${fmt(end)})'`);
      filters.push(`drawtext=${parts.join(':')}`);
    });
  }
  return filters;
}

function fadeValues(clip) {
  const dur = outputDuration(clip);
  const fade = clip.fade || {};
  const fi = clamp(num(fade.in, 0), 0, dur / 2);
  const fo = clamp(num(fade.out, 0), 0, dur / 2);
  return { fi, fo, dur };
}

// Builds the full ffmpeg argument list for one clip.
// opts: { sourcePath, outPath, clip, hasSourceAudio, settings, forceAudio,
//         getStickerPath, fontPath, tmpDir, intermediate }
function buildClipArgs(opts) {
  const { sourcePath, outPath, clip, hasSourceAudio, settings = {}, forceAudio = false } = opts;
  const sourceWidth = num(opts.sourceWidth, 0);
  const sourceHeight = num(opts.sourceHeight, 0);
  const start = num(clip.start, 0);
  const end = num(clip.end, start + 0.1);
  const speed = getSpeed(clip);
  const dur = outputDuration(clip);
  const base = resolutionBase(settings);
  const reframed = isReframed(clip);

  const inputs = ['-i', sourcePath];
  let nextInput = 1;

  const hasImported = !!(clip.audio && clip.audio.path);
  let importedIdx = -1;
  if (hasImported) {
    if (clip.audio.loop !== false) inputs.push('-stream_loop', '-1');
    inputs.push('-i', clip.audio.path);
    importedIdx = nextInput++;
  }

  const hasVoice = !!(clip.voiceover && clip.voiceover.path);
  let voiceIdx = -1;
  if (hasVoice) {
    inputs.push('-i', clip.voiceover.path);
    voiceIdx = nextInput++;
  }

  const stickers = (Array.isArray(clip.stickers) ? clip.stickers : [])
    .filter((s) => opts.getStickerPath && opts.getStickerPath(s.key));
  const stickerStart = nextInput;
  stickers.forEach((s) => {
    inputs.push('-loop', '1', '-i', opts.getStickerPath(s.key));
    nextInput += 1;
  });

  const chains = [];

  // --- Video: trim -> speed -> reframe ---
  const v = [`trim=start=${fmt(start)}:end=${fmt(end)}`, 'setpts=PTS-STARTPTS'];
  if (Math.abs(speed - 1) > 0.001) v.push(`setpts=PTS/${fmt(speed)}`);
  let outDims = null;
  if (reframed) {
    const { x, y, w, h } = clip.crop;
    const cropW = Math.max(2, Math.round(w / 2) * 2);
    const cropH = Math.max(2, Math.round(h / 2) * 2);
    const ratio = getRatio(clip);
    outDims = getOutputDims(ratio.w, ratio.h, base);
    v.push(
      `crop=${cropW}:${cropH}:${Math.max(0, Math.round(x))}:${Math.max(0, Math.round(y))}`,
      `scale=${outDims.outW}:${outDims.outH}`,
      'setsar=1'
    );
    v.push(...motionFilters(clip, outDims.outW, outDims.outH));
  } else {
    v.push(...motionFilters(clip, sourceWidth, sourceHeight));
  }
  chains.push(`[0:v]${v.join(',')}[vbase]`);

  // --- Stickers (positioned against the source frame by the user) ---
  let vLabel = 'vbase';
  let transform = null;
  if (reframed) {
    transform = {
      scaleX: outDims.outW / clip.crop.w,
      scaleY: outDims.outH / clip.crop.h,
      offX: clip.crop.x,
      offY: clip.crop.y,
    };
  }
  stickers.forEach((sticker, i) => {
    let x = num(sticker.x, 0);
    let y = num(sticker.y, 0);
    let size = num(sticker.size, 200);
    if (transform) {
      x = (x - transform.offX) * transform.scaleX;
      y = (y - transform.offY) * transform.scaleY;
      size *= transform.scaleX;
    }
    size = Math.max(2, Math.round(size));
    const sStart = Math.max(0, num(sticker.start, 0));
    const sEnd = Math.max(sStart + 0.1, num(sticker.end, dur));
    chains.push(`[${stickerStart + i}:v]scale=${size}:${size}[stk${i}]`);
    chains.push(`[${vLabel}][stk${i}]overlay=${Math.round(x)}:${Math.round(y)}:enable='between(t,${fmt(sStart)},${fmt(sEnd)})'[vst${i}]`);
    vLabel = `vst${i}`;
  });

  // --- Resize (original aspect), look, text, fades ---
  const post = [];
  if (!reframed && base) {
    post.push(`scale=w=${base}:h=${base}:force_original_aspect_ratio=increase:force_divisible_by=2`, 'setsar=1');
  }
  post.push(...lookFilters(clip));
  const frameAspect = reframed
    ? outDims.outW / outDims.outH
    : (sourceWidth && sourceHeight ? sourceWidth / sourceHeight : 16 / 9);
  post.push(...textFilters(clip, { ...opts, frameAspect }));
  const { fi, fo } = fadeValues(clip);
  if (fi > 0) post.push(`fade=t=in:st=0:d=${fmt(fi)}`);
  if (fo > 0) post.push(`fade=t=out:st=${fmt(Math.max(0, dur - fo))}:d=${fmt(fo)}`);
  post.push('format=yuv420p');
  chains.push(`[${vLabel}]${post.join(',')}[vfinal]`);

  // --- Audio ---
  let aLabel = null;
  const origVol = clamp(num(clip.origVolume, 1), 0, 3);
  const useOrig = hasSourceAudio && !(hasImported && clip.audio.muteOriginal) && origVol > 0;
  if (useOrig) {
    const a = [`atrim=start=${fmt(start)}:end=${fmt(end)}`, 'asetpts=PTS-STARTPTS', ...atempoChain(speed)];
    if (Math.abs(origVol - 1) > 0.001) a.push(`volume=${fmt(origVol)}`);
    if (clip.denoise) a.push('afftdn=nf=-25');
    chains.push(`[0:a]${a.join(',')}[aorig]`);
    aLabel = 'aorig';
  }
  const mixInputs = aLabel ? [aLabel] : [];
  if (hasImported) {
    const vol = clamp(num(clip.audio.volume, 1), 0, 3);
    // offset: where in the song this clip starts (set when a clip is split,
    // so the second half carries on from where the first half stopped).
    const off = Math.max(0, num(clip.audio.offset, 0));
    chains.push(`[${importedIdx}:a]atrim=start=${fmt(off)}:end=${fmt(off + dur)},asetpts=PTS-STARTPTS,volume=${fmt(vol)}[aimp]`);
    mixInputs.push('aimp');
  }
  if (hasVoice) {
    const vol = clamp(num(clip.voiceover.volume, 1), 0, 3);
    const off = Math.max(0, num(clip.voiceover.offset, 0));
    chains.push(`[${voiceIdx}:a]aresample=48000,atrim=start=${fmt(off)}:end=${fmt(off + dur)},asetpts=PTS-STARTPTS,volume=${fmt(vol)}[avoice]`);
    mixInputs.push('avoice');
  }
  if (mixInputs.length === 1) {
    aLabel = mixInputs[0];
  } else if (mixInputs.length > 1) {
    // Sum the tracks at the volumes the user chose; the limiter stops the
    // combined sound from clipping.
    const pads = mixInputs.map((l) => `[${l}]`).join('');
    chains.push(`${pads}amix=inputs=${mixInputs.length}:duration=longest:dropout_transition=0:normalize=0,alimiter=limit=0.95[amix]`);
    aLabel = 'amix';
  }
  if (!aLabel && forceAudio) {
    inputs.push('-f', 'lavfi', '-t', fmt(dur), '-i', 'anullsrc=r=48000:cl=stereo');
    aLabel = `${nextInput}:a`;
    nextInput += 1;
  }
  if (aLabel) {
    const ap = [];
    if (fi > 0) ap.push(`afade=t=in:st=0:d=${fmt(fi)}`);
    if (fo > 0) ap.push(`afade=t=out:st=${fmt(Math.max(0, dur - fo))}:d=${fmt(fo)}`);
    if (forceAudio) ap.push('aresample=48000', 'aformat=channel_layouts=stereo');
    // Pad short audio (e.g. non-looping music) so it never cuts the clip.
    if (forceAudio || hasImported || hasVoice) ap.push(`apad=whole_dur=${fmt(dur)}`);
    if (ap.length) {
      chains.push(`[${aLabel}]${ap.join(',')}[afinal]`);
      aLabel = 'afinal';
    }
  }

  const high = settings.quality === 'high' || opts.intermediate;
  const args = ['-y', ...inputs, '-filter_complex', chains.join(';'), '-map', '[vfinal]'];
  if (aLabel) args.push('-map', aLabel.includes(':') ? aLabel : `[${aLabel}]`);
  args.push(
    '-t', fmt(dur),
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', opts.intermediate ? '16' : (high ? '18' : '22')
  );
  if (aLabel) args.push('-c:a', 'aac', '-b:a', '192k');
  args.push('-movflags', '+faststart', outPath);
  return { args, duration: dur };
}

function runFfmpeg(ffmpegPath, args, duration, onProgress) {
  return new Promise((resolve, reject) => {
    const ff = spawn(ffmpegPath, args);
    let stderrBuf = '';
    ff.stderr.on('data', (chunk) => {
      stderrBuf += chunk.toString();
      if (stderrBuf.length > 200000) stderrBuf = stderrBuf.slice(-50000);
      const matches = stderrBuf.match(/time=(\d+):(\d+):(\d+\.\d+)/g);
      if (matches && onProgress) {
        const m = matches[matches.length - 1].match(/time=(\d+):(\d+):(\d+\.\d+)/);
        const elapsed = (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]);
        onProgress(Math.min(100, Math.round((elapsed / Math.max(0.1, duration)) * 100)));
      }
    });
    ff.on('error', (err) => reject(err));
    ff.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}\n${stderrBuf.slice(-800)}`));
    });
  });
}

// Which optional filters this ffmpeg build has (cached per binary).
const filterCache = new Map();
function getFilterSupport(ffmpegPath) {
  if (!filterCache.has(ffmpegPath)) {
    filterCache.set(ffmpegPath, new Promise((resolve) => {
      const ff = spawn(ffmpegPath, ['-hide_banner', '-filters']);
      let out = '';
      ff.stdout.on('data', (d) => { out += d.toString(); });
      ff.on('error', () => resolve({ drawtext: true }));
      ff.on('close', () => resolve({ drawtext: !out || /\sdrawtext\s/.test(out) }));
    }));
  }
  return filterCache.get(ffmpegPath);
}

// Reads basic info from `ffmpeg -i` output (no ffprobe in ffmpeg-static).
function probeMedia(ffmpegPath, filePath) {
  return new Promise((resolve) => {
    const ff = spawn(ffmpegPath, ['-hide_banner', '-i', filePath]);
    let out = '';
    ff.stderr.on('data', (d) => { out += d.toString(); });
    ff.on('error', () => resolve({ hasAudio: false, duration: 0, width: 0, height: 0 }));
    ff.on('close', () => {
      const dm = out.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
      const duration = dm ? (+dm[1]) * 3600 + (+dm[2]) * 60 + parseFloat(dm[3]) : 0;
      const vm = out.match(/Stream #\d+:\d+[^\n]*Video:[^\n]*?\b(\d{2,5})x(\d{2,5})\b/);
      resolve({
        hasAudio: /Stream #\d+:\d+[^\n]*Audio:/i.test(out),
        duration,
        width: vm ? +vm[1] : 0,
        height: vm ? +vm[2] : 0,
      });
    });
  });
}

async function exportClip(ctx, { sourcePath, outPath, clip, hasSourceAudio, sourceWidth, sourceHeight, settings, forceAudio, intermediate }, onProgress) {
  const { args, duration } = buildClipArgs({
    ...ctx, sourcePath, outPath, clip, hasSourceAudio, sourceWidth, sourceHeight, settings, forceAudio, intermediate,
  });
  await runFfmpeg(ctx.ffmpegPath, args, duration, onProgress);
  return duration;
}

// Builds the join command for already-rendered parts.
// parts: [{ path, duration }], all with video + audio.
function buildJoinArgs({ parts, width, height, transition, transitionDuration, settings = {}, outPath }) {
  const W = Math.max(2, Math.round(width / 2) * 2);
  const H = Math.max(2, Math.round(height / 2) * 2);
  const n = parts.length;
  const inputs = [];
  const chains = [];
  parts.forEach((p, i) => {
    inputs.push('-i', p.path);
    // Clips with a different shape sit on a blurred, zoomed copy of
    // themselves instead of black bars.
    chains.push(`[${i}:v]setsar=1,split=2[bgsrc${i}][fgsrc${i}]`);
    chains.push(`[bgsrc${i}]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=20:2,eq=brightness=-0.08[bg${i}]`);
    chains.push(`[fgsrc${i}]scale=${W}:${H}:force_original_aspect_ratio=decrease:force_divisible_by=2[fg${i}]`);
    chains.push(`[bg${i}][fg${i}]overlay=(W-w)/2:(H-h)/2,setsar=1,fps=30,format=yuv420p[v${i}]`);
    chains.push(`[${i}:a]aresample=48000,aformat=channel_layouts=stereo[a${i}]`);
  });

  // Each part may say how it hands over to the next one. Parts without
  // their own setting fall back to the single project-wide transition.
  const boundary = (i) => {
    const own = parts[i - 1].transition;
    const type = own ? own.type : transition;
    const dur = own ? own.duration : transitionDuration;
    return { type: TRANSITIONS.has(type) ? type : 'none', duration: num(dur, 0.5) };
  };
  const anyTransition = n > 1 && parts.slice(1).some((_, j) => boundary(j + 1).type !== 'none');
  let total = parts.reduce((sum, p) => sum + p.duration, 0);
  if (!anyTransition) {
    const pads = parts.map((_, i) => `[v${i}][a${i}]`).join('');
    chains.push(`${pads}concat=n=${n}:v=1:a=1[vout][aout]`);
  } else {
    let vPrev = 'v0';
    let aPrev = 'a0';
    let merged = parts[0].duration;
    for (let i = 1; i < n; i++) {
      const b = boundary(i);
      const last = i === n - 1;
      const vOut = last ? 'vout' : `vx${i}`;
      const aOut = last ? 'aout' : `ax${i}`;
      // A "none" boundary inside a chain of transitions is a one-frame
      // dissolve, which looks like a straight cut.
      const type = b.type === 'none' ? 'fade' : b.type;
      const limit = Math.max(0.034, Math.min(parts[i - 1].duration, parts[i].duration) / 2 - 0.05);
      const T = b.type === 'none' ? 0.034 : clamp(b.duration, 0.1, Math.max(0.1, limit));
      chains.push(`[${vPrev}][v${i}]xfade=transition=${type}:duration=${fmt(T)}:offset=${fmt(Math.max(0, merged - T))}[${vOut}]`);
      chains.push(`[${aPrev}][a${i}]acrossfade=d=${fmt(T)}[${aOut}]`);
      vPrev = vOut;
      aPrev = aOut;
      merged = merged + parts[i].duration - T;
    }
    total = merged;
  }

  const high = settings.quality === 'high';
  const args = [
    '-y', ...inputs,
    '-filter_complex', chains.join(';'),
    '-map', '[vout]', '-map', '[aout]',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', high ? '18' : '22',
    '-c:a', 'aac', '-b:a', '192k',
    '-movflags', '+faststart',
    outPath,
  ];
  return { args, duration: total };
}

// Renders every clip, then joins them into one video.
// onProgress({ id, percent }) - id is a clip id, or 'combined' for the join.
async function exportCombined(ctx, { clips, settings = {}, outPath, sourceInfo }, onProgress) {
  const partsDir = path.join(ctx.tmpDir, `parts-${Date.now()}`);
  fs.mkdirSync(partsDir, { recursive: true });
  const parts = [];
  try {
    for (let i = 0; i < clips.length; i++) {
      const clip = clips[i];
      const partPath = path.join(partsDir, `part-${i}.mp4`);
      const info = await sourceInfo(clip.sourcePath);
      await exportClip(ctx, {
        sourcePath: clip.sourcePath,
        outPath: partPath,
        clip,
        hasSourceAudio: info.hasAudio,
        sourceWidth: info.width,
        sourceHeight: info.height,
        settings,
        forceAudio: true,
        intermediate: true,
      }, (percent) => onProgress({ id: clip.id, percent }));
      const probed = await probeMedia(ctx.ffmpegPath, partPath);
      parts.push({
        path: partPath,
        duration: probed.duration || outputDuration(clip),
        width: probed.width,
        height: probed.height,
        transition: clip.transitionOut && clip.transitionOut.type
          ? { type: clip.transitionOut.type, duration: num(clip.transitionOut.duration, 0.5) }
          : null,
      });
      onProgress({ id: clip.id, percent: 100, done: true });
    }
    const first = parts[0];
    const { args, duration } = buildJoinArgs({
      parts,
      width: first.width || 1080,
      height: first.height || 1920,
      transition: settings.transition,
      transitionDuration: settings.transitionDuration,
      settings,
      outPath,
    });
    await runFfmpeg(ctx.ffmpegPath, args, duration, (percent) => onProgress({ id: 'combined', percent }));
    return { outPath, duration };
  } finally {
    for (const p of parts) {
      try { fs.unlinkSync(p.path); } catch (e) { /* temp file */ }
    }
    try { fs.rmdirSync(partsDir); } catch (e) { /* temp dir */ }
  }
}

module.exports = {
  ASPECT_RATIOS,
  LOOK_FILTERS,
  TRANSITIONS,
  MOTION,
  safeFileName,
  captionTexts,
  wrapForFrame,
  getOutputDims,
  outputDuration,
  atempoChain,
  buildClipArgs,
  buildJoinArgs,
  runFfmpeg,
  probeMedia,
  getFilterSupport,
  exportClip,
  exportCombined,
};
