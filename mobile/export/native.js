// The link between the export code and the phone's native layer.
//
// On iPhone `native` is the NineJaCutNative Capacitor plugin (written in
// Swift, mobile/plugins/native). In tests it is a stand-in that runs the
// computer's own ffmpeg. Either way it has this shape:
//
//   writeTextFiles({ files: [{ path, text }] })        -> Promise
//   removeFiles({ paths: [...] })                       -> Promise
//   run({ jobId, args: [...] })                         -> Promise<{ returnCode }>
//   cancel({ jobId })                                   -> Promise
//   addListener('ffmpegLog', ({ jobId, text }) => {})   -> handle or Promise<handle>
//
// The desktop code (clip-export.js, promo-export.js) writes small text files
// with fs.writeFileSync, which is synchronous. The phone can only write
// asynchronously, so those writes are queued here and flushed right before
// the next ffmpeg command starts: the only time ffmpeg needs them.

const state = {
  native: null,
  pendingWrites: new Map(),
  pendingRemoves: new Set(),
  listeners: new Map(), // jobId -> (text) => void
  listening: null,
  // 'videotoolbox' on iPhone; tests use 'libx264' because Linux has no
  // Apple encoder.
  videoEncoder: 'videotoolbox',
  // Swap FFmpeg's GPL-only filters for LGPL ones (the iPhone FFmpeg is LGPL).
  lgplFilters: true,
  nextJob: 1,
};

function setNative(native) {
  state.native = native;
  state.listening = null;
}

function setVideoEncoder(name) {
  state.videoEncoder = name;
}

function setLgplFilters(on) {
  state.lgplFilters = !!on;
}

function queueWrite(path, text) {
  state.pendingRemoves.delete(path);
  state.pendingWrites.set(path, String(text));
}

function queueRemove(path) {
  if (state.pendingWrites.delete(path)) return; // never reached the phone
  state.pendingRemoves.add(path);
}

async function flush() {
  const native = requireNative();
  if (state.pendingWrites.size) {
    const files = [...state.pendingWrites].map(([path, text]) => ({ path, text }));
    state.pendingWrites.clear();
    await native.writeTextFiles({ files });
  }
  if (state.pendingRemoves.size) {
    const paths = [...state.pendingRemoves];
    state.pendingRemoves.clear();
    // Leftover temp files are harmless; do not hold up the export for them.
    Promise.resolve(native.removeFiles({ paths })).catch(() => {});
  }
}

function requireNative() {
  if (!state.native) throw new Error('The phone video engine is not available.');
  return state.native;
}

async function ensureListening() {
  if (!state.listening) {
    state.listening = Promise.resolve(requireNative().addListener('ffmpegLog', (event) => {
      const cb = event && state.listeners.get(event.jobId);
      if (cb) cb(String(event.text || ''));
    }));
  }
  return state.listening;
}

// x264 settings from the desktop code -> Apple's hardware encoder. The
// desktop picks quality with -crf; the hardware encoder needs a bitrate.
function phoneVideoArgs(args) {
  if (state.videoEncoder !== 'videotoolbox') return args;
  const out = [];
  let crf = 20;
  let usesX264 = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '-c:v' && args[i + 1] === 'libx264') { usesX264 = true; i++; continue; }
    if (a === '-preset' || a === '-tune') { i++; continue; }
    if (a === '-crf') { crf = Number(args[i + 1]) || crf; i++; continue; }
    out.push(a);
  }
  if (!usesX264) return args;
  const bitrate = crf <= 16 ? '20M' : crf <= 18 ? '12M' : crf <= 20 ? '10M' : '6M';
  const at = out.length - 1; // keep the output path last
  out.splice(at, 0, '-c:v', 'h264_videotoolbox', '-allow_sw', '1', '-profile:v', 'high', '-b:v', bitrate, '-pix_fmt', 'yuv420p');
  return out;
}

// The iPhone FFmpeg is LGPL (App Store safe), which leaves out FFmpeg's two
// GPL filters the desktop export code uses. Swap each for an LGPL one that
// gives the same picture:
//   eq      -> lutyuv. eq (gamma 1) maps luma with v' = C*(v-0.5)+0.5+B and
//              each chroma plane with S*(c-0.5)+0.5 (vf_eq.c), which is
//              exactly a per-plane lookup table.
//   boxblur -> gblur with the same spread (p passes of a radius-r box blur
//              have variance p*r*(r+1)/3).
const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
function eqToLut(opts) {
  const o = {};
  for (const part of opts.split(':')) {
    const [k, v] = part.split('=');
    if (v !== undefined) o[k] = v;
  }
  const C = num(o.contrast, 1);
  const B = num(o.brightness, 0);
  const S = Math.max(0, Math.min(3, num(o.saturation, 1)));
  const lut = (gain, offset) => `'clip(floor(256*(${gain}*(val/255-0.5)+0.5+${offset})),0,255)'`;
  return `lutyuv=y=${lut(C, B)}:u=${lut(S, 0)}:v=${lut(S, 0)}`;
}
function boxblurToGblur(opts) {
  const [r0, p0] = opts.split(':');
  const r = Math.max(0, num(r0, 2));
  const p = Math.max(1, num(p0, 2));
  return `gblur=sigma=${Math.max(0.1, Math.sqrt((p * r * (r + 1)) / 3)).toFixed(2)}:steps=3`;
}
function lgplFilters(graph) {
  return graph
    .replace(/(^|[,;\]])eq=([^,;[]+)/g, (_m, lead, opts) => lead + eqToLut(opts))
    .replace(/(^|[,;\]])boxblur=([^,;[]+)/g, (_m, lead, opts) => lead + boxblurToGblur(opts));
}
function phoneFilterArgs(args) {
  if (!state.lgplFilters) return args;
  return args.map((a, i) => (['-filter_complex', '-vf', '-filter:v'].includes(args[i - 1]) ? lgplFilters(a) : a));
}

// Runs one ffmpeg command; streams its log text to onText.
async function runFfmpeg(args, onText) {
  const native = requireNative();
  await ensureListening();
  await flush();
  const jobId = `job-${Date.now()}-${state.nextJob++}`;
  state.listeners.set(jobId, onText);
  try {
    const result = await native.run({ jobId, args: phoneVideoArgs(phoneFilterArgs(args)) });
    return result && typeof result.returnCode === 'number' ? result.returnCode : 1;
  } finally {
    // Late log events can still arrive; give them a moment.
    setTimeout(() => state.listeners.delete(jobId), 1000);
  }
}

module.exports = { state, setNative, setVideoEncoder, setLgplFilters, queueWrite, queueRemove, flush, runFfmpeg, phoneVideoArgs, phoneFilterArgs, lgplFilters };
