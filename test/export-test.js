// End-to-end export tests: renders real videos with ffmpeg and checks the
// results. Usage:  npm test
//   or: node test/export-test.js [media-dir] [ffmpegPath]
// With no media dir, small test videos are generated automatically.
const path = require('path');
const fs = require('fs');
const os = require('os');
const assert = require('assert');
const ex = require('../clip-export');

const { execFileSync } = require('child_process');

let ffmpegPath = process.argv[3];
if (!ffmpegPath) {
  try { ffmpegPath = require('ffmpeg-static'); } catch (e) { ffmpegPath = 'ffmpeg'; }
}

// With no media dir given, generate small test videos with ffmpeg itself.
let mediaDir = process.argv[2];
if (!mediaDir) {
  mediaDir = fs.mkdtempSync(path.join(os.tmpdir(), '9jacut-media-'));
  const gen = (args) => execFileSync(ffmpegPath, ['-v', 'error', '-y', ...args]);
  gen(['-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=30:duration=8', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=8',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', path.join(mediaDir, 'src.mp4')]);
  gen(['-f', 'lavfi', '-i', 'testsrc=size=1280x720:rate=25:duration=6', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(mediaDir, 'silent.mp4')]);
  gen(['-f', 'lavfi', '-i', 'sine=frequency=220:duration=2', path.join(mediaDir, 'music.mp3')]);
  gen(['-f', 'lavfi', '-i', 'sine=frequency=330:duration=3', '-c:a', 'libopus', path.join(mediaDir, 'voice.webm')]);
}
const src = path.join(mediaDir, 'src.mp4');
const silent = path.join(mediaDir, 'silent.mp4');
const music = path.join(mediaDir, 'music.mp3');
const voice = path.join(mediaDir, 'voice.webm');
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), '9jacut-test-'));
const stickerPath = path.join(__dirname, '..', 'assets', 'stickers', 'fire.png');

const ctx = {
  ffmpegPath,
  tmpDir: path.join(outDir, 'tmp'),
  fontPath: path.join(__dirname, '..', 'assets', 'fonts', 'Poppins-Bold.ttf'),
  getStickerPath: (key) => (key === 'fire' ? stickerPath : null),
};

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: got ${a}, expected ~${b}`);

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('plain clip keeps source size and duration', async () => {
  const out = path.join(outDir, 'plain.mp4');
  await ex.exportClip(ctx, { sourcePath: src, outPath: out, clip: { start: 1, end: 4 }, hasSourceAudio: true });
  const info = await ex.probeMedia(ffmpegPath, out);
  near(info.duration, 3, 0.15, 'duration');
  assert.strictEqual(info.width, 1920);
  assert.ok(info.hasAudio);
});

test('2x speed halves duration, keeps audio', async () => {
  const out = path.join(outDir, 'fast.mp4');
  await ex.exportClip(ctx, { sourcePath: src, outPath: out, clip: { start: 0, end: 6, speed: 2 }, hasSourceAudio: true });
  const info = await ex.probeMedia(ffmpegPath, out);
  near(info.duration, 3, 0.15, 'duration');
  assert.ok(info.hasAudio);
});

test('0.25x slow motion (chained atempo)', async () => {
  const out = path.join(outDir, 'slow.mp4');
  await ex.exportClip(ctx, { sourcePath: src, outPath: out, clip: { start: 0, end: 1, speed: 0.25 }, hasSourceAudio: true });
  const info = await ex.probeMedia(ffmpegPath, out);
  near(info.duration, 4, 0.2, 'duration');
});

test('every look preset + manual adjustments render', async () => {
  for (const preset of Object.keys(ex.LOOK_FILTERS)) {
    const out = path.join(outDir, `look-${preset}.mp4`);
    await ex.exportClip(ctx, {
      sourcePath: src, outPath: out, hasSourceAudio: true,
      clip: { start: 0, end: 1, look: { preset, brightness: 0.05, contrast: 1.1, saturation: 1.2 } },
    });
    assert.ok(fs.statSync(out).size > 1000, `${preset} output exists`);
  }
});

test('text overlays (all positions/styles, tricky characters) + fades', async () => {
  const out = path.join(outDir, 'text.mp4');
  await ex.exportClip(ctx, {
    sourcePath: src, outPath: out, hasSourceAudio: true,
    clip: {
      start: 0, end: 4,
      fade: { in: 0.5, out: 1 },
      texts: [
        { text: "Mama's Kitchen: 50% off, today!", position: 'top', style: 'outline', size: 8, color: '#ffd700', start: 0, end: 4 },
        { text: 'Line one\nLine two %{pts}', position: 'center', style: 'box', size: 6, color: '#ffffff', start: 1, end: 3 },
        { text: 'plain', position: 'bottom', style: 'plain', size: 5, color: 'bad', start: 0, end: 99 },
        { text: '   ', position: 'bottom' },
      ],
    },
  });
  const info = await ex.probeMedia(ffmpegPath, out);
  near(info.duration, 4, 0.15, 'duration');
});

test('vertical reframe at 720p + sticker + text', async () => {
  const out = path.join(outDir, 'vertical.mp4');
  await ex.exportClip(ctx, {
    sourcePath: src, outPath: out, hasSourceAudio: true, settings: { resolution: '720', quality: 'high' },
    clip: {
      start: 0, end: 2, aspect: 'vertical', crop: { x: 656, y: 0, w: 608, h: 1080 },
      stickers: [{ key: 'fire', x: 700, y: 100, size: 200, start: 0, end: 2 }],
      texts: [{ text: 'Vertical!', position: 'bottom', size: 7 }],
    },
  });
  const info = await ex.probeMedia(ffmpegPath, out);
  assert.strictEqual(info.width, 720);
  assert.strictEqual(info.height, 1280);
});

test('original aspect downscaled to 720p', async () => {
  const out = path.join(outDir, 'small.mp4');
  await ex.exportClip(ctx, { sourcePath: src, outPath: out, hasSourceAudio: true, settings: { resolution: '720' }, clip: { start: 0, end: 1 } });
  const info = await ex.probeMedia(ffmpegPath, out);
  assert.strictEqual(info.height, 720);
  assert.strictEqual(info.width, 1280);
});

test('short music loops to fill the clip, noise reduction + original volume', async () => {
  const out = path.join(outDir, 'music-loop.mp4');
  await ex.exportClip(ctx, {
    sourcePath: src, outPath: out, hasSourceAudio: true,
    clip: { start: 0, end: 5, origVolume: 0.5, denoise: true, audio: { path: music, volume: 0.8, loop: true } },
  });
  const info = await ex.probeMedia(ffmpegPath, out);
  near(info.duration, 5, 0.15, 'duration');
});

test('non-looping short music is padded, not cutting the clip', async () => {
  const out = path.join(outDir, 'music-noloop.mp4');
  await ex.exportClip(ctx, {
    sourcePath: silent, outPath: out, hasSourceAudio: false,
    clip: { start: 0, end: 5, audio: { path: music, volume: 1, loop: false } },
  });
  const info = await ex.probeMedia(ffmpegPath, out);
  near(info.duration, 5, 0.15, 'duration');
  assert.ok(info.hasAudio);
});

test('source without audio exports silently', async () => {
  const out = path.join(outDir, 'silent-out.mp4');
  await ex.exportClip(ctx, { sourcePath: silent, outPath: out, hasSourceAudio: false, clip: { start: 0, end: 2, fade: { in: 0.5, out: 0.5 } } });
  const info = await ex.probeMedia(ffmpegPath, out);
  assert.ok(!info.hasAudio);
});

test('captions are burned in and follow trims and speed', async () => {
  const clip = {
    start: 2, end: 6, speed: 2,
    captions: {
      style: { position: 'bottom', style: 'box', size: 6, upper: true },
      lines: [
        { start: 1, end: 3, text: 'starts before the clip' },
        { start: 3, end: 5, text: 'inside the clip' },
        { start: 7, end: 8, text: 'after the clip' },
      ],
    },
  };
  const texts = ex.captionTexts(clip);
  assert.strictEqual(texts.length, 2);
  assert.deepStrictEqual([texts[0].start, texts[0].end], [0, 0.5]);
  assert.deepStrictEqual([texts[1].start, texts[1].end], [0.5, 1.5]);
  assert.strictEqual(texts[1].text, 'INSIDE THE CLIP');
  const out = path.join(outDir, 'captions.mp4');
  await ex.exportClip(ctx, { sourcePath: src, outPath: out, hasSourceAudio: true, clip });
  const info = await ex.probeMedia(ffmpegPath, out);
  near(info.duration, 2, 0.15, 'duration');
});

for (const motion of Object.keys(ex.MOTION)) {
  test(`${motion} motion on original and vertical clips keeps the frame size`, async () => {
    const out1 = path.join(outDir, `motion-${motion}.mp4`);
    await ex.exportClip(ctx, { sourcePath: src, outPath: out1, hasSourceAudio: true, sourceWidth: 1920, sourceHeight: 1080, clip: { start: 0, end: 2, motion } });
    const a = await ex.probeMedia(ffmpegPath, out1);
    assert.deepStrictEqual([a.width, a.height], [1920, 1080]);
    const out2 = path.join(outDir, `motion-${motion}-v.mp4`);
    await ex.exportClip(ctx, {
      sourcePath: src, outPath: out2, hasSourceAudio: true, settings: { resolution: '720' },
      clip: { start: 0, end: 2, motion, aspect: 'vertical', crop: { x: 656, y: 0, w: 608, h: 1080 } },
    });
    const b = await ex.probeMedia(ffmpegPath, out2);
    assert.deepStrictEqual([b.width, b.height], [720, 1280]);
  });
}

test('voiceover mixes with the video sound and music', async () => {
  const out = path.join(outDir, 'voiceover.mp4');
  await ex.exportClip(ctx, {
    sourcePath: src, outPath: out, hasSourceAudio: true,
    clip: { start: 0, end: 4, audio: { path: music, volume: 0.5 }, voiceover: { path: voice, volume: 1.2 } },
  });
  const info = await ex.probeMedia(ffmpegPath, out);
  near(info.duration, 4, 0.15, 'duration');
  assert.ok(info.hasAudio);
});

test('voiceover alone on a silent video', async () => {
  const out = path.join(outDir, 'voiceover-silent.mp4');
  await ex.exportClip(ctx, { sourcePath: silent, outPath: out, hasSourceAudio: false, clip: { start: 0, end: 3, voiceover: { path: voice } } });
  const info = await ex.probeMedia(ffmpegPath, out);
  assert.ok(info.hasAudio);
  near(info.duration, 3, 0.15, 'duration');
});

test('music offset continues a song across a split', async () => {
  const out = path.join(outDir, 'music-offset.mp4');
  await ex.exportClip(ctx, {
    sourcePath: silent, outPath: out, hasSourceAudio: false,
    clip: { start: 0, end: 2, audio: { path: music, volume: 1, loop: true, offset: 1.5 }, voiceover: { path: voice, offset: 1 } },
  });
  const info = await ex.probeMedia(ffmpegPath, out);
  near(info.duration, 2, 0.15, 'duration');
  assert.ok(info.hasAudio);
});

test('per-clip transitions (slide, cut, circle) in one video', async () => {
  const out = path.join(outDir, 'per-clip-transitions.mp4');
  const clips = [
    { id: 'p1', sourcePath: src, start: 0, end: 2, transitionOut: { type: 'slideleft', duration: 0.5 } },
    { id: 'p2', sourcePath: src, start: 2, end: 4, transitionOut: { type: 'none' } },
    { id: 'p3', sourcePath: src, start: 4, end: 6, transitionOut: { type: 'circleopen', duration: 1 } },
    { id: 'p4', sourcePath: src, start: 6, end: 8 },
  ];
  await ex.exportCombined(ctx, { clips, settings: { resolution: '720' }, outPath: out, sourceInfo: (p) => ex.probeMedia(ffmpegPath, p) }, () => {});
  const info = await ex.probeMedia(ffmpegPath, out);
  near(info.duration, 8 - 0.5 - 0.034 - 1, 0.25, 'duration');
});

test('all-cut timeline uses a straight join', async () => {
  const out = path.join(outDir, 'all-cuts.mp4');
  const clips = [
    { id: 'c1', sourcePath: src, start: 0, end: 1.5, transitionOut: { type: 'none' } },
    { id: 'c2', sourcePath: silent, start: 0, end: 1.5 },
  ];
  await ex.exportCombined(ctx, { clips, settings: {}, outPath: out, sourceInfo: (p) => ex.probeMedia(ffmpegPath, p) }, () => {});
  const info = await ex.probeMedia(ffmpegPath, out);
  near(info.duration, 3, 0.2, 'duration');
});

// Windows paths contain "C:" and user folders can contain apostrophes,
// commas or brackets; none of that may break the filtergraph.
const weirdDir = path.join(outDir, "we:ird O'Brien, [dir]");
const weirdSupported = (() => {
  try { fs.mkdirSync(weirdDir, { recursive: true }); return true; } catch (e) { return false; }
})();
test('text works with colon/apostrophe/comma/bracket paths (Windows-style)', async () => {
  const dir = weirdSupported ? weirdDir : path.join(outDir, "O'Brien, [dir]");
  fs.mkdirSync(dir, { recursive: true });
  const font = path.join(dir, 'Poppins-Bold.ttf');
  fs.copyFileSync(ctx.fontPath, font);
  const out = path.join(outDir, 'weird-paths.mp4');
  await ex.exportClip({ ...ctx, tmpDir: path.join(dir, 'tmp'), fontPath: font }, {
    sourcePath: src, outPath: out, hasSourceAudio: true,
    clip: { start: 0, end: 1, texts: [{ text: 'Paths: OK', position: 'center' }] },
  });
  assert.ok(fs.statSync(out).size > 1000);
});

test('promo video text works with Windows-style paths', async () => {
  const { runPromoExport } = require('../promo-export');
  const { buildPresetList, getThemeByKey } = require('../promo-templates');
  const dir = weirdSupported ? weirdDir : path.join(outDir, "O'Brien, [dir]");
  const fontsDir = path.join(dir, 'fonts');
  fs.mkdirSync(fontsDir, { recursive: true });
  const fonts = {};
  for (const [k, f] of [['bold', 'Poppins-Bold.ttf'], ['medium', 'Poppins-Medium.ttf'], ['regular', 'Poppins-Regular.ttf']]) {
    fonts[k] = path.join(fontsDir, f);
    fs.copyFileSync(path.join(__dirname, '..', 'assets', 'fonts', f), fonts[k]);
  }
  const preset = buildPresetList()[0];
  const out = path.join(outDir, 'promo-weird.mp4');
  if (ctx.hasDrawtext === false) return; // this ffmpeg can't draw text at all
  await runPromoExport({
    ffmpegPath, items: [{ filePath: src, type: 'video' }], layout: preset.layout, theme: getThemeByKey(preset.theme),
    business: { name: "Mama's Kitchen: Ikeja", tagline: 'Open 7 days, 8am-10pm', hours: 'Mon-Sun', address: '12 Allen Ave, Ikeja', contact: 'IG: @mamas' },
    durationPerItem: 2, fonts, tmpDir: path.join(dir, 'promo-tmp'), outPath: out,
  }, () => {});
  assert.ok(fs.statSync(out).size > 1000);
});

const sourceInfo = (p) => ex.probeMedia(ffmpegPath, p);
const mixedClips = [
  { id: 'a', start: 0, end: 3, aspect: 'vertical', crop: { x: 656, y: 0, w: 608, h: 1080 }, texts: [{ text: 'Part 1' }] },
  { id: 'b', sourcePath: silent, start: 0, end: 2, speed: 2 },
  { id: 'c', start: 2, end: 5, look: { preset: 'gold' }, audio: { path: music, volume: 1 } },
].map((c) => ({ sourcePath: src, ...c }));

for (const transition of ['none', 'fade', 'slideleft', 'circleopen']) {
  test(`combine 3 mixed clips (transition: ${transition})`, async () => {
    const out = path.join(outDir, `combined-${transition}.mp4`);
    const seen = new Set();
    await ex.exportCombined(ctx, {
      clips: mixedClips, settings: { resolution: '720', transition, transitionDuration: 0.5 }, outPath: out, sourceInfo,
    }, (p) => seen.add(p.id));
    const info = await ex.probeMedia(ffmpegPath, out);
    const expected = transition === 'none' ? 3 + 1 + 3 : 3 + 1 + 3 - 2 * 0.5;
    near(info.duration, expected, 0.25, 'duration');
    assert.strictEqual(info.width, 720);
    assert.strictEqual(info.height, 1280);
    assert.ok(info.hasAudio);
    assert.ok(seen.has('combined') && seen.has('a') && seen.has('c'), 'progress reported');
  });
}

(async () => {
  ctx.hasDrawtext = (await ex.getFilterSupport(ffmpegPath)).drawtext;
  ctx.warn = (msg) => { if (!ctx.warned) console.log(`note: ${msg}`); ctx.warned = true; };
  console.log(`ffmpeg: ${ffmpegPath} (text support: ${ctx.hasDrawtext ? 'yes' : 'no'})`);
  let failed = 0;
  for (const t of tests) {
    const t0 = Date.now();
    try {
      await t.fn();
      console.log(`PASS  ${t.name} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    } catch (err) {
      failed += 1;
      console.log(`FAIL  ${t.name}\n      ${String(err.message).split('\n').slice(-6).join('\n      ')}`);
      if (process.env.GITHUB_ACTIONS) {
        // Show the failure as an annotation on the GitHub run.
        const msg = String(err.message).split('\n').slice(-8).join(' | ').replace(/%/g, '%25').replace(/\r/g, '').slice(0, 1500);
        console.log(`::error title=${t.name.replace(/[:,]/g, ' ')}::${msg}`);
      }
    }
  }
  console.log(`\n${tests.length - failed}/${tests.length} passed. Outputs in ${outDir}`);
  if (process.env.GITHUB_ACTIONS) console.log(`::notice title=Export tests::${tests.length - failed}/${tests.length} passed with ${ffmpegPath} (text: ${ctx.hasDrawtext})`);
  process.exit(failed ? 1 : 0);
})();
