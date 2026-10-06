// Phone export engine. Bundled by scripts/build-mobile.js into
// www/mobile-export.js (window.NineJaCutExport), with the Node.js modules
// swapped for mobile/export/shims.js.
//
// It runs the desktop's own export code (clip-export.js, promo-export.js),
// so phone exports come out the same as on the PC. The functions below are
// the phone version of main.js's 'export-clips' and 'export-promo' handlers.

const native = require('./native');
const clipExport = require('../../clip-export');
const { runPromoExport } = require('../../promo-export');
const { getThemeByKey } = require('../../promo-templates');

const { safeFileName } = clipExport;
const join = (...p) => p.join('/').replace(/\/+/g, '/');

// paths: { web: folder holding the app's www files, tmp, exports }
function makeContext(paths, warn) {
  const fonts = {
    bold: join(paths.web, 'assets/fonts/Poppins-Bold.ttf'),
    medium: join(paths.web, 'assets/fonts/Poppins-Medium.ttf'),
    regular: join(paths.web, 'assets/fonts/Poppins-Regular.ttf'),
  };
  return {
    fonts,
    ctx: {
      ffmpegPath: 'ffmpeg',
      getStickerPath: (key) => (/^[a-z_]+$/.test(String(key)) ? join(paths.web, `assets/stickers/${key}.png`) : null),
      fontPath: fonts.bold,
      tmpDir: join(paths.tmp, '9jacut-export'),
      hasDrawtext: true,
      warn,
    },
  };
}

// Same arguments and results as window.nineJaCut.exportClips on desktop,
// except the files are written to paths.exports.
async function exportClips({ clips = [], settings = {} }, paths, send) {
  const warnings = new Set();
  const { ctx } = makeContext(paths, (msg) => warnings.add(msg));
  ctx.hasDrawtext = (await clipExport.getFilterSupport(ctx.ffmpegPath)).drawtext;
  const infoCache = new Map();
  const sourceInfo = async (sourcePath) => {
    if (!infoCache.has(sourcePath)) infoCache.set(sourcePath, await clipExport.probeMedia(ctx.ffmpegPath, sourcePath));
    return infoCache.get(sourcePath);
  };

  if (settings.combine && clips.length > 0) {
    const outPath = join(paths.exports, `${safeFileName(settings.combinedName || '9jacut-video')}.mp4`);
    for (const clip of clips) send({ id: clip.id, status: 'start', percent: 0 });
    send({ id: 'combined', status: 'start', percent: 0 });
    try {
      const missing = clips.find((c) => !c.sourcePath);
      if (missing) throw new Error(`"${missing.name}" has no source video (try re-adding it).`);
      await clipExport.exportCombined(ctx, { clips, settings, outPath, sourceInfo }, ({ id, percent, done }) => {
        send({ id, status: done ? 'done' : 'running', percent });
      });
      send({ id: 'combined', status: 'done', percent: 100, outPath });
      return [{ id: 'combined', ok: true, outPath, warnings: [...warnings] }];
    } catch (err) {
      send({ id: 'combined', status: 'error', message: friendly(err) });
      return [{ id: 'combined', ok: false, error: friendly(err) }];
    }
  }

  const results = [];
  for (const clip of clips) {
    const suffix = clip.aspect && clip.aspect !== 'original' ? `_${clip.aspect}` : '_original';
    const outPath = join(paths.exports, `${safeFileName(clip.name)}${suffix}.mp4`);
    send({ id: clip.id, status: 'start', percent: 0 });
    try {
      if (!clip.sourcePath) throw new Error('This clip has no source video (try re-adding it).');
      const info = await sourceInfo(clip.sourcePath);
      await clipExport.exportClip(ctx, {
        sourcePath: clip.sourcePath, outPath, clip, hasSourceAudio: info.hasAudio,
        sourceWidth: info.width, sourceHeight: info.height, settings,
      }, (percent) => send({ id: clip.id, status: 'running', percent }));
      send({ id: clip.id, status: 'done', percent: 100, outPath });
      results.push({ id: clip.id, ok: true, outPath });
    } catch (err) {
      send({ id: clip.id, status: 'error', message: friendly(err) });
      results.push({ id: clip.id, ok: false, error: friendly(err) });
    }
  }
  if (warnings.size && results.length) results[0].warnings = [...warnings];
  return results;
}

async function exportPromo({ presetId, layout, themeKey, business, items, durationPerItem, fileName }, paths, send) {
  const { ctx, fonts } = makeContext(paths, () => {});
  const outPath = join(paths.exports, `${safeFileName(fileName || 'promo')}.mp4`);
  const jobId = presetId || 'promo';
  send({ id: jobId, status: 'start', percent: 0 });
  try {
    if (!items || items.length === 0) throw new Error('Add at least one photo or video first.');
    await runPromoExport({
      ffmpegPath: ctx.ffmpegPath,
      items,
      layout,
      theme: getThemeByKey(themeKey),
      business: business || {},
      durationPerItem: durationPerItem || 3,
      fonts,
      tmpDir: join(paths.tmp, '9jacut-promo-text'),
      outPath,
    }, (percent) => send({ id: jobId, status: 'running', percent }));
    send({ id: jobId, status: 'done', percent: 100, outPath });
    return { ok: true, outPath };
  } catch (err) {
    send({ id: jobId, status: 'error', message: friendly(err) });
    return { ok: false, error: friendly(err) };
  }
}

// Media info through ffmpeg, for files the web view itself cannot read.
function probeMedia(filePath) {
  return clipExport.probeMedia('ffmpeg', filePath);
}

// ffmpeg's own error text ends with its last log lines; keep the first
// line for people, the rest is still in the developer console.
function friendly(err) {
  const msg = String((err && err.message) || err || 'Export failed');
  if (/^ffmpeg exited with code/.test(msg)) {
    console.error(msg);
    if (/No space left/i.test(msg)) return 'Your iPhone is out of space. Free some up and try again.';
    if (/Error while opening encoder|videotoolbox/i.test(msg)) return 'The iPhone video encoder could not start. Try a lower resolution.';
    return 'Export failed while making the video. Try again, or try a lower resolution.';
  }
  return msg;
}

module.exports = {
  setNative: native.setNative,
  setVideoEncoder: native.setVideoEncoder,
  phoneVideoArgs: native.phoneVideoArgs,
  phoneThreadArgs: native.phoneThreadArgs,
  exportClips,
  exportPromo,
  probeMedia,
};
