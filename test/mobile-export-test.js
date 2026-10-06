// Tests the phone export engine (www/mobile-export.js) end to end without an
// iPhone. It loads the same bundle the iPhone app loads and gives it a
// stand-in for the Swift plugin that runs this computer's ffmpeg instead of
// FFmpegKit. Everything else (the desktop export code, the phone shims, the
// queued text files, progress parsing) is exactly what runs on the phone.
//
// Run: npm run build:mobile && node test/mobile-export-test.js
// Needs ffmpeg with libx264 on PATH (Linux has no Apple video encoder, so the
// test keeps x264; the encoder swap itself is checked separately below).

const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const { spawn, execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const bundle = path.join(root, 'www', 'mobile-export.js');
if (!fs.existsSync(bundle)) throw new Error('Run `npm run build:mobile` first.');
const FFMPEG = process.env.FFMPEG_BIN || 'ffmpeg';

const sandbox = { console, setTimeout, clearTimeout, crypto: globalThis.crypto };
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(bundle, 'utf8'), sandbox);
const engine = sandbox.NineJaCutExport;

// ---------- Stand-in for the Swift plugin ----------
const calls = { writes: 0, runs: 0, argsSeen: [] };
const logListeners = [];
const fakeNative = {
  async writeTextFiles({ files }) {
    for (const f of files) {
      fs.mkdirSync(path.dirname(f.path), { recursive: true });
      fs.writeFileSync(f.path, f.text, 'utf8');
      calls.writes += 1;
    }
  },
  async removeFiles({ paths }) {
    for (const p of paths) { try { fs.unlinkSync(p); } catch (e) { /* gone */ } }
  },
  addListener(name, cb) {
    assert.strictEqual(name, 'ffmpegLog');
    logListeners.push(cb);
    return { remove() {} };
  },
  async cancel() {},
  run({ jobId, args }) {
    calls.runs += 1;
    calls.argsSeen.push(args);
    // FFmpegKit creates the output folder's parents? No: the plugin does.
    const out = args[args.length - 1];
    if (out && out.startsWith('/')) fs.mkdirSync(path.dirname(out), { recursive: true });
    return new Promise((resolve) => {
      const ff = spawn(FFMPEG, args);
      const send = (d) => { for (const cb of logListeners) cb({ jobId, text: d.toString() }); };
      ff.stdout.on('data', send);
      ff.stderr.on('data', send);
      ff.on('close', (returnCode) => setTimeout(() => resolve({ returnCode }), 20));
    });
  },
};
engine.setNative(fakeNative);
engine.setVideoEncoder('libx264');

// ---------- Test media and folders ----------
const work = fs.mkdtempSync(path.join(os.tmpdir(), '9jacut-phone-export-'));
const paths = { web: path.join(root, 'www'), tmp: path.join(work, 'tmp'), exports: path.join(work, 'Exports') };
const gen = (args) => execFileSync(FFMPEG, ['-v', 'error', '-y', ...args]);
const src = path.join(work, 'src.mov'); // iPhone videos are .mov
gen(['-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=30:duration=6', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=6',
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', src]);
const music = path.join(work, 'music.m4a');
gen(['-f', 'lavfi', '-i', 'sine=frequency=220:duration=2', '-c:a', 'aac', music]);
const photo = path.join(work, 'photo.jpg');
gen(['-f', 'lavfi', '-i', 'testsrc=size=1080x1350:duration=1', '-frames:v', '1', photo]);

function probe(file) {
  const out = execFileSync(FFMPEG.replace(/ffmpeg$/, 'ffprobe'), ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height', '-of', 'json', file]).toString();
  const j = JSON.parse(out);
  const v = j.streams.find((s) => s.codec_type === 'video') || {};
  return { duration: Number(j.format.duration), width: v.width, height: v.height, hasAudio: j.streams.some((s) => s.codec_type === 'audio') };
}

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: got ${a}, expected ~${b}`);

test('encoder swap: x264 settings become Apple hardware encoder settings', async () => {
  engine.setVideoEncoder('videotoolbox');
  const args = engine.phoneVideoArgs(['-y', '-i', 'in.mov', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-c:a', 'aac', '/x/out.mp4']);
  engine.setVideoEncoder('libx264');
  assert.ok(!args.includes('libx264') && !args.includes('-crf') && !args.includes('-preset'), args.join(' '));
  assert.strictEqual(args[args.indexOf('-c:v') + 1], 'h264_videotoolbox');
  assert.strictEqual(args[args.length - 1], '/x/out.mp4');
  assert.ok(args.includes('-b:v'));
});

test('one clip: text, sticker, look, speed, music, vertical reframe', async () => {
  const progress = [];
  const results = await engine.exportClips({
    clips: [{
      id: 'c1', name: 'My clip', sourcePath: src, start: 1, end: 5, speed: 2,
      aspect: 'vertical', crop: { x: 656, y: 0, w: 608, h: 1080 },
      look: { preset: 'gold' }, audio: { path: music, volume: 0.8, loop: true },
      texts: [{ text: "Naija's best: 50% OFF", position: 'bottom', size: 7, style: 'box' }],
      stickers: [{ key: 'fire', x: 300, y: 200, size: 160, start: 0, end: 2 }],
    }],
    settings: { resolution: '720', quality: 'standard' },
  }, paths, (p) => progress.push(p));
  assert.ok(results[0].ok, results[0].error);
  const info = probe(results[0].outPath);
  near(info.duration, 2, 0.2, 'duration');
  assert.ok(info.height > info.width, `vertical: ${info.width}x${info.height}`);
  assert.ok(info.hasAudio);
  assert.ok(calls.writes >= 1, 'text went through the queued text files');
  assert.ok(progress.some((p) => p.status === 'running' && p.percent > 0), 'progress reported');
  assert.ok(results[0].outPath.startsWith(paths.exports));
});

test('captions are burned in on the phone too', async () => {
  const results = await engine.exportClips({
    clips: [{
      id: 'cap', name: 'Captions', sourcePath: src, start: 0, end: 3,
      captions: { style: { position: 'bottom', style: 'box', size: 6 }, lines: [{ start: 0.2, end: 2.5, text: 'How far, my people?' }] },
    }],
    settings: {},
  }, paths, () => {});
  assert.ok(results[0].ok, results[0].error);
  near(probe(results[0].outPath).duration, 3, 0.2, 'duration');
});

test('whole timeline as one video with a transition', async () => {
  const results = await engine.exportClips({
    clips: [
      { id: 'a', name: 'A', sourcePath: src, start: 0, end: 2, transitionOut: { type: 'fade', duration: 0.5 } },
      { id: 'b', name: 'B', sourcePath: src, start: 3, end: 5, texts: [{ text: 'Part 2' }] },
    ],
    settings: { combine: true, combinedName: 'Phone test video', resolution: '720' },
  }, paths, () => {});
  assert.ok(results[0].ok, results[0].error);
  assert.ok(results[0].outPath.endsWith('/Phone test video.mp4'));
  near(probe(results[0].outPath).duration, 3.5, 0.3, 'duration with a 0.5s crossfade');
});

test('promo video from a photo and a video, with business text', async () => {
  const r = await engine.exportPromo({
    presetId: 'hero__golden', layout: 'hero', themeKey: 'golden',
    business: { name: "Mama's Kitchen: Ikeja", tagline: 'Open 7 days', hours: 'Mon-Sun 8am-10pm', address: '12 Allen Ave', contact: 'IG: @mamas' },
    items: [{ filePath: photo, type: 'image' }, { filePath: src, type: 'video' }],
    durationPerItem: 2, fileName: 'mamas-promo',
  }, paths, () => {});
  assert.ok(r.ok, r.error);
  const info = probe(r.outPath);
  assert.strictEqual(info.width, 1080);
  assert.strictEqual(info.height, 1920);
});

test('media info through ffmpeg (for files the page cannot read)', async () => {
  const info = await engine.probeMedia(src);
  near(info.duration, 6, 0.1, 'duration');
  assert.strictEqual(info.width, 1920);
  assert.ok(info.hasAudio);
});

test('a broken source gives a plain-language error', async () => {
  const results = await engine.exportClips({ clips: [{ id: 'x', name: 'Bad', sourcePath: path.join(work, 'missing.mov'), start: 0, end: 1 }], settings: {} }, paths, () => {});
  assert.strictEqual(results[0].ok, false);
  assert.ok(!/ffmpeg exited/.test(results[0].error), results[0].error);
});

(async () => {
  let failed = 0;
  for (const t of tests) {
    const t0 = Date.now();
    try {
      await t.fn();
      console.log(`PASS  ${t.name} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    } catch (err) {
      failed += 1;
      console.log(`FAIL  ${t.name}\n      ${String(err.message).split('\n').slice(0, 4).join('\n      ')}`);
    }
  }
  console.log(`\n${tests.length - failed}/${tests.length} passed. Outputs in ${paths.exports}`);
  process.exit(failed ? 1 : 0);
})();
