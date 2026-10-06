// Phone stand-ins for the Node.js modules clip-export.js and promo-export.js
// use, so those files run on the phone unchanged. Only what they call is here.

const native = require('./native');

// ---------- fs ----------
const fs = {
  mkdirSync() {}, // the native side creates folders when it writes
  writeFileSync(filePath, text) { native.queueWrite(filePath, text); },
  unlinkSync(filePath) { native.queueRemove(filePath); },
  rmdirSync() {},
  existsSync() { return true; },
};

// ---------- path (POSIX; the phone has no Windows paths) ----------
function normalize(p) {
  const abs = p.startsWith('/');
  const parts = [];
  for (const seg of p.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') parts.pop(); else parts.push(seg);
  }
  return (abs ? '/' : '') + parts.join('/');
}
const path = {
  sep: '/',
  join: (...p) => normalize(p.filter((s) => s != null && s !== '').join('/')),
  basename(p, ext) {
    const b = String(p).replace(/\/+$/, '').split('/').pop();
    return ext && b.endsWith(ext) ? b.slice(0, -ext.length) : b;
  },
  dirname(p) {
    const s = String(p).replace(/\/+$/, '');
    const i = s.lastIndexOf('/');
    return i <= 0 ? (i === 0 ? '/' : '.') : s.slice(0, i);
  },
  extname(p) {
    const b = path.basename(p);
    const i = b.lastIndexOf('.');
    return i > 0 ? b.slice(i) : '';
  },
};
path.posix = path;

// ---------- crypto ----------
const crypto = {
  randomBytes(n) {
    const bytes = new Uint8Array(n);
    globalThis.crypto.getRandomValues(bytes);
    return {
      toString(enc) {
        if (enc !== 'hex') throw new Error('only hex is supported');
        return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
      },
    };
  },
};

// ---------- child_process ----------
// spawn(ffmpegPath, args) returns something that looks enough like a Node
// child process for the export code: .stdout/.stderr 'data' and 'close'.
// FFmpegKit sends ffmpeg's console output through one log stream, so it is
// given to both stdout and stderr listeners.
function makeEmitter() {
  const handlers = {};
  return {
    on(event, cb) { (handlers[event] = handlers[event] || []).push(cb); return this; },
    emit(event, ...a) { for (const cb of handlers[event] || []) cb(...a); },
  };
}

function spawn(_ffmpegPath, args) {
  const proc = makeEmitter();
  proc.stdout = makeEmitter();
  proc.stderr = makeEmitter();
  setTimeout(async () => {
    try {
      const code = await native.runFfmpeg(args, (text) => {
        proc.stderr.emit('data', text);
        proc.stdout.emit('data', text);
      });
      proc.emit('close', code);
    } catch (err) {
      proc.emit('error', err);
    }
  }, 0);
  return proc;
}

module.exports = { fs, path, crypto, child_process: { spawn } };
