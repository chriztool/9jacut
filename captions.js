// Auto-captions: offline speech-to-text with OpenAI's Whisper model, run
// locally through sherpa-onnx (no account, no upload, no per-use cost).
// The model is downloaded once on first use and kept in the app's data
// folder; after that, captioning works fully offline.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const RELEASE_URL = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models';

const MODELS = {
  fast: {
    label: 'Fast',
    archive: 'sherpa-onnx-whisper-tiny.tar.bz2',
    downloadMB: 116,
    encoder: 'tiny-encoder.int8.onnx',
    decoder: 'tiny-decoder.int8.onnx',
    tokens: 'tiny-tokens.txt',
  },
  accurate: {
    label: 'Accurate',
    archive: 'sherpa-onnx-whisper-base.tar.bz2',
    downloadMB: 208,
    encoder: 'base-encoder.int8.onnx',
    decoder: 'base-decoder.int8.onnx',
    tokens: 'base-tokens.txt',
  },
};
const VAD_FILE = 'silero_vad.onnx';
const SAMPLE_RATE = 16000;

// Whisper language codes offered in the app. '' lets Whisper detect it.
const LANGUAGES = [
  ['', 'Auto-detect'],
  ['en', 'English / Pidgin'],
  ['yo', 'Yoruba'],
  ['ha', 'Hausa'],
  ['fr', 'French'],
  ['sw', 'Swahili'],
  ['ar', 'Arabic'],
  ['es', 'Spanish'],
  ['pt', 'Portuguese'],
];

function modelPaths(modelsDir, key) {
  const m = MODELS[key] || MODELS.accurate;
  const dir = path.join(modelsDir, key);
  return {
    dir,
    encoder: path.join(dir, m.encoder),
    decoder: path.join(dir, m.decoder),
    tokens: path.join(dir, m.tokens),
    vad: path.join(modelsDir, VAD_FILE),
  };
}

function isModelReady(modelsDir, key) {
  const p = modelPaths(modelsDir, key);
  return [p.encoder, p.decoder, p.tokens, p.vad].every((f) => {
    try { return fs.statSync(f).size > 0; } catch (e) { return false; }
  });
}

// Downloads `url` to `dest` (via a .part file), reporting 0-100 progress.
async function download(url, dest, onProgress) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status}) for ${url}`);
  const total = Number(res.headers.get('content-length')) || 0;
  const part = `${dest}.part`;
  const out = fs.createWriteStream(part);
  let received = 0;
  let lastPct = -1;
  const reader = res.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.length;
      if (!out.write(Buffer.from(value))) await new Promise((r) => out.once('drain', r));
      if (total && onProgress) {
        const pct = Math.floor((received / total) * 100);
        if (pct !== lastPct) { lastPct = pct; onProgress(pct, received, total); }
      }
    }
  } finally {
    await new Promise((r) => out.end(r));
  }
  if (total && received !== total) throw new Error('Download was interrupted. Please try again.');
  fs.renameSync(part, dest);
}

// Pulls just the named files out of a .tar.bz2 archive (pure JavaScript,
// so it works on every Windows version).
function extractFiles(archivePath, wanted, destDir) {
  const bz2 = require('unbzip2-stream');
  const tar = require('tar-stream');
  fs.mkdirSync(destDir, { recursive: true });
  return new Promise((resolve, reject) => {
    const found = new Set();
    const extract = tar.extract();
    extract.on('entry', (header, stream, next) => {
      const base = header.name.split('/').pop();
      if (header.type === 'file' && wanted.includes(base)) {
        const tmp = path.join(destDir, `${base}.part`);
        const out = fs.createWriteStream(tmp);
        stream.pipe(out);
        out.on('finish', () => {
          fs.renameSync(tmp, path.join(destDir, base));
          found.add(base);
          next();
        });
        out.on('error', reject);
      } else {
        stream.on('end', next);
        stream.resume();
      }
    });
    extract.on('finish', () => {
      const missing = wanted.filter((w) => !found.has(w));
      if (missing.length) reject(new Error(`Model archive is missing ${missing.join(', ')}`));
      else resolve();
    });
    extract.on('error', reject);
    const input = fs.createReadStream(archivePath);
    input.on('error', reject);
    input.pipe(bz2()).on('error', reject).pipe(extract);
  });
}

// Makes sure the chosen model is on disk. onStatus({ stage, percent }).
async function ensureModel(modelsDir, key, onStatus = () => {}) {
  const m = MODELS[key] || MODELS.accurate;
  const p = modelPaths(modelsDir, key);
  fs.mkdirSync(modelsDir, { recursive: true });
  if (!fs.existsSync(p.vad)) {
    onStatus({ stage: 'download', percent: 0 });
    await download(`${RELEASE_URL}/${VAD_FILE}`, p.vad);
  }
  if (isModelReady(modelsDir, key)) return p;

  const archive = path.join(modelsDir, m.archive);
  if (!fs.existsSync(archive)) {
    await download(`${RELEASE_URL}/${m.archive}`, archive, (percent) => onStatus({ stage: 'download', percent }));
  }
  onStatus({ stage: 'unpack', percent: 0 });
  try {
    await extractFiles(archive, [m.encoder, m.decoder, m.tokens], p.dir);
  } catch (err) {
    try { fs.unlinkSync(archive); } catch (e) { /* re-download next time */ }
    throw err;
  }
  try { fs.unlinkSync(archive); } catch (e) { /* only frees disk space */ }
  return p;
}

// Decodes a section of a video's sound to 16 kHz mono float samples.
function extractAudio(ffmpegPath, sourcePath, start, end) {
  return new Promise((resolve, reject) => {
    const args = [
      '-v', 'error',
      '-ss', String(Math.max(0, start)),
      '-t', String(Math.max(0.1, end - start)),
      '-i', sourcePath,
      '-vn', '-ac', '1', '-ar', String(SAMPLE_RATE),
      '-f', 'f32le', 'pipe:1',
    ];
    const ff = spawn(ffmpegPath, args);
    const chunks = [];
    let err = '';
    ff.stdout.on('data', (d) => chunks.push(d));
    ff.stderr.on('data', (d) => { err += d.toString(); });
    ff.on('error', reject);
    ff.on('close', (code) => {
      if (code !== 0) { reject(new Error(`Could not read the audio: ${err.slice(-300)}`)); return; }
      const buf = Buffer.concat(chunks);
      const samples = new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 4));
      resolve(new Float32Array(samples)); // copy into its own aligned buffer
    });
  });
}

// Long speech segments become several short on-screen lines, timed in
// proportion to their length (social-media style captions).
function splitIntoLines(segments, maxWords = 7) {
  const lines = [];
  for (const seg of segments) {
    const words = seg.text.split(/\s+/).filter(Boolean);
    if (!words.length) continue;
    const groups = [];
    for (let i = 0; i < words.length; i += maxWords) groups.push(words.slice(i, i + maxWords));
    // Avoid a tiny orphan line at the end.
    if (groups.length > 1 && groups[groups.length - 1].length <= 2) {
      const tail = groups.pop();
      groups[groups.length - 1].push(...tail);
    }
    const totalChars = groups.reduce((n, g) => n + g.join(' ').length, 0) || 1;
    let t = seg.start;
    const span = Math.max(0.2, seg.end - seg.start);
    groups.forEach((g, i) => {
      const text = g.join(' ');
      const end = i === groups.length - 1 ? seg.end : t + (span * text.length) / totalChars;
      lines.push({ start: round2(t), end: round2(end), text });
      t = end;
    });
  }
  return lines;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

// Whisper sometimes "hears" these in silence or music; drop them.
const NOISE_LINES = /^(\[.*\]|\(.*\)|♪+|\.+|you|thank you\.?|thanks for watching!?)$/i;

function cleanText(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

let recognizerCache = { key: null, recognizer: null };

async function getRecognizer(paths, { language, task, modelKey, numThreads }) {
  const sherpa = require('sherpa-onnx-node');
  const cacheKey = `${modelKey}|${language}|${task}`;
  if (recognizerCache.key === cacheKey) return recognizerCache.recognizer;
  const config = {
    featConfig: { sampleRate: SAMPLE_RATE, featureDim: 80 },
    modelConfig: {
      whisper: {
        encoder: paths.encoder,
        decoder: paths.decoder,
        language: language || '',
        task: task || 'transcribe',
        tailPaddings: -1,
      },
      tokens: paths.tokens,
      numThreads: numThreads || 2,
      provider: 'cpu',
      debug: 0,
    },
  };
  const recognizer = sherpa.OfflineRecognizer.createAsync
    ? await sherpa.OfflineRecognizer.createAsync(config)
    : new sherpa.OfflineRecognizer(config);
  recognizerCache = { key: cacheKey, recognizer };
  return recognizer;
}

// Finds the speech in `samples` and transcribes each part.
// Returns lines [{ start, end, text }] in seconds from the start of samples.
async function transcribe(paths, samples, opts = {}, onProgress = () => {}) {
  const sherpa = require('sherpa-onnx-node');
  const recognizer = await getRecognizer(paths, opts);
  const windowSize = 512;
  const vad = new sherpa.Vad({
    sileroVad: {
      model: paths.vad,
      threshold: 0.5,
      minSpeechDuration: 0.25,
      minSilenceDuration: 0.4,
      maxSpeechDuration: 12,
      windowSize,
    },
    sampleRate: SAMPLE_RATE,
    numThreads: 1,
    provider: 'cpu',
    debug: false,
  }, 60);

  const speech = [];
  for (let i = 0; i < samples.length; i += windowSize) {
    vad.acceptWaveform(samples.subarray(i, Math.min(samples.length, i + windowSize)));
    while (!vad.isEmpty()) {
      const seg = vad.front(false);
      speech.push({ start: seg.start / SAMPLE_RATE, samples: new Float32Array(seg.samples) });
      vad.pop();
    }
  }
  vad.flush();
  while (!vad.isEmpty()) {
    const seg = vad.front(false);
    speech.push({ start: seg.start / SAMPLE_RATE, samples: new Float32Array(seg.samples) });
    vad.pop();
  }

  const segments = [];
  for (let i = 0; i < speech.length; i++) {
    const s = speech[i];
    const stream = recognizer.createStream();
    stream.acceptWaveform({ sampleRate: SAMPLE_RATE, samples: s.samples });
    if (recognizer.decodeAsync) await recognizer.decodeAsync(stream);
    else recognizer.decode(stream);
    const text = cleanText(recognizer.getResult(stream).text);
    if (text && !NOISE_LINES.test(text)) {
      segments.push({ start: s.start, end: s.start + s.samples.length / SAMPLE_RATE, text });
    }
    onProgress(Math.round(((i + 1) / speech.length) * 100));
  }
  return splitIntoLines(segments, opts.maxWords || 7);
}

module.exports = {
  MODELS,
  LANGUAGES,
  isModelReady,
  ensureModel,
  modelPaths,
  extractAudio,
  extractFiles,
  transcribe,
  splitIntoLines,
};
