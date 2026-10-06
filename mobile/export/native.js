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
  nextJob: 1,
};

function setNative(native) {
  state.native = native;
  state.listening = null;
}

function setVideoEncoder(name) {
  state.videoEncoder = name;
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

// Runs one ffmpeg command; streams its log text to onText.
async function runFfmpeg(args, onText) {
  const native = requireNative();
  await ensureListening();
  await flush();
  const jobId = `job-${Date.now()}-${state.nextJob++}`;
  state.listeners.set(jobId, onText);
  try {
    const result = await native.run({ jobId, args: phoneVideoArgs(args) });
    return result && typeof result.returnCode === 'number' ? result.returnCode : 1;
  } finally {
    // Late log events can still arrive; give them a moment.
    setTimeout(() => state.listeners.delete(jobId), 1000);
  }
}

module.exports = { state, setNative, setVideoEncoder, queueWrite, queueRemove, flush, runFfmpeg, phoneVideoArgs };
