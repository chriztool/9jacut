const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const url = require('url');
const fs = require('fs');
const { spawn } = require('child_process');
const { buildPresetList, getThemeByKey } = require('./promo-templates');
const { runPromoExport } = require('./promo-export');

// ffmpeg-static gives us a bundled ffmpeg binary so the user never has to
// install ffmpeg themselves. When packaged with electron-builder, the binary
// lives outside the asar archive (see "asarUnpack" in package.json).
function getFfmpegPath() {
  let ffmpegPath = require('ffmpeg-static');
  if (ffmpegPath.includes('app.asar')) {
    ffmpegPath = ffmpegPath.replace('app.asar', 'app.asar.unpacked');
  }
  return ffmpegPath;
}

// Any file that ffmpeg (an external process) needs to read directly must be
// resolved outside the asar archive - Electron's transparent asar reading
// only works for Electron's own patched fs/file:// access, not for files
// handed to a spawned child process. See "asarUnpack" in package.json.
function toUnpackedPath(p) {
  if (p.includes('app.asar') && !p.includes('app.asar.unpacked')) {
    return p.replace('app.asar', 'app.asar.unpacked');
  }
  return p;
}

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 880,
    minWidth: 1040,
    minHeight: 660,
    backgroundColor: '#1b120c',
    icon: path.join(__dirname, 'build', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ---------- File pickers ----------

ipcMain.handle('select-video', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose a video',
    properties: ['openFile'],
    filters: [
      { name: 'Video files', extensions: ['mp4', 'mov', 'mkv', 'avi', 'webm', 'm4v'] },
      { name: 'All files', extensions: ['*'] },
    ],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const filePath = result.filePaths[0];
  return {
    filePath,
    fileUrl: url.pathToFileURL(filePath).href,
    fileName: path.basename(filePath),
  };
});

ipcMain.handle('select-audio', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose an audio file',
    properties: ['openFile'],
    filters: [
      { name: 'Audio files', extensions: ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac'] },
      { name: 'All files', extensions: ['*'] },
    ],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const filePath = result.filePaths[0];
  return { filePath, fileName: path.basename(filePath) };
});

ipcMain.handle('select-export-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose a folder to save clips',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle('open-folder', async (_event, folderPath) => {
  shell.openPath(folderPath);
});

ipcMain.handle('to-file-url', async (_event, filePath) => {
  return url.pathToFileURL(filePath).href;
});

// ---------- Thumbnails ----------

ipcMain.handle('generate-thumbnail', async (_event, { sourcePath, time }) => {
  const tmpDir = path.join(app.getPath('temp'), '9jacut-thumbs');
  try {
    fs.mkdirSync(tmpDir, { recursive: true });
  } catch (e) { /* ignore */ }
  const outPath = path.join(tmpDir, `thumb-${Date.now()}-${Math.round(Math.random() * 1e6)}.jpg`);
  return new Promise((resolve) => {
    const args = [
      '-y',
      '-ss', String(Math.max(0, time || 0)),
      '-i', sourcePath,
      '-frames:v', '1',
      '-vf', 'scale=220:-2',
      outPath,
    ];
    const ff = spawn(getFfmpegPath(), args);
    ff.on('error', () => resolve(null));
    ff.on('close', (code) => {
      if (code === 0 && fs.existsSync(outPath)) {
        resolve(url.pathToFileURL(outPath).href);
      } else {
        resolve(null);
      }
    });
  });
});

// ---------- Save / load project ----------

ipcMain.handle('save-project', async (_event, projectData) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Save project',
    defaultPath: 'my-9jacut-project.json',
    filters: [{ name: '9jacut project', extensions: ['json'] }],
  });
  if (result.canceled || !result.filePath) return null;
  fs.writeFileSync(result.filePath, JSON.stringify(projectData, null, 2), 'utf8');
  return result.filePath;
});

ipcMain.handle('load-project', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Open project',
    properties: ['openFile'],
    filters: [{ name: '9jacut project', extensions: ['json'] }],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  try {
    const raw = fs.readFileSync(result.filePaths[0], 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
});

// ---------- Stickers ----------

const STICKERS = [
  { key: 'happy', file: 'happy.png' },
  { key: 'laughing', file: 'laughing.png' },
  { key: 'heart_eyes', file: 'heart_eyes.png' },
  { key: 'cool', file: 'cool.png' },
  { key: 'surprised', file: 'surprised.png' },
  { key: 'wink', file: 'wink.png' },
  { key: 'crying_laughing', file: 'crying_laughing.png' },
  { key: 'sad', file: 'sad.png' },
  { key: 'angry', file: 'angry.png' },
  { key: 'heart', file: 'heart.png' },
  { key: 'fire', file: 'fire.png' },
  { key: 'star', file: 'star.png' },
  { key: 'thumbs_up', file: 'thumbs_up.png' },
  { key: 'hundred', file: 'hundred.png' },
];

function getStickerPath(key) {
  const found = STICKERS.find((s) => s.key === key);
  if (!found) return null;
  return toUnpackedPath(path.join(__dirname, 'assets', 'stickers', found.file));
}

ipcMain.handle('get-stickers', async () => {
  return STICKERS.map((s) => ({
    key: s.key,
    fileUrl: url.pathToFileURL(path.join(__dirname, 'assets', 'stickers', s.file)).href,
  }));
});

// ---------- Promo video templates ----------

function getFontPath(fileName) {
  return toUnpackedPath(path.join(__dirname, 'assets', 'fonts', fileName));
}

const PROMO_FONTS = {
  bold: getFontPath('Poppins-Bold.ttf'),
  medium: getFontPath('Poppins-Medium.ttf'),
  regular: getFontPath('Poppins-Regular.ttf'),
};

ipcMain.handle('get-promo-templates', async () => buildPresetList());

ipcMain.handle('select-promo-media', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose photos or videos for your promo',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Photos & Videos', extensions: ['jpg', 'jpeg', 'png', 'webp', 'mp4', 'mov', 'mkv', 'avi', 'webm', 'm4v'] },
      { name: 'All files', extensions: ['*'] },
    ],
  });
  if (result.canceled || result.filePaths.length === 0) return [];
  const videoExt = new Set(['mp4', 'mov', 'mkv', 'avi', 'webm', 'm4v']);
  return result.filePaths.map((filePath) => {
    const ext = path.extname(filePath).slice(1).toLowerCase();
    return {
      filePath,
      fileName: path.basename(filePath),
      type: videoExt.has(ext) ? 'video' : 'image',
      fileUrl: url.pathToFileURL(filePath).href,
    };
  });
});

ipcMain.handle('export-promo', async (event, { presetId, layout, themeKey, business, items, durationPerItem, exportFolder, fileName }) => {
  const theme = getThemeByKey(themeKey);
  const tmpDir = path.join(app.getPath('temp'), '9jacut-promo-text');
  const outName = `${safeFileName(fileName || 'promo')}.mp4`;
  const outPath = path.join(exportFolder, outName);
  const jobId = presetId || 'promo';

  event.sender.send('promo-export-progress', { id: jobId, status: 'start', percent: 0 });
  try {
    if (!items || items.length === 0) throw new Error('Add at least one photo or video first.');
    if (!exportFolder) throw new Error('Choose an export folder first.');
    await runPromoExport(
      {
        ffmpegPath: getFfmpegPath(),
        items,
        layout,
        theme,
        business: business || {},
        durationPerItem: durationPerItem || 3,
        fonts: PROMO_FONTS,
        tmpDir,
        outPath,
      },
      (percent) => event.sender.send('promo-export-progress', { id: jobId, status: 'running', percent })
    );
    event.sender.send('promo-export-progress', { id: jobId, status: 'done', percent: 100, outPath });
    return { ok: true, outPath };
  } catch (err) {
    event.sender.send('promo-export-progress', { id: jobId, status: 'error', message: err.message });
    return { ok: false, error: err.message };
  }
});

// ---------- Export ----------

const ASPECT_RATIOS = {
  vertical: { w: 9, h: 16 },
  square: { w: 1, h: 1 },
  portrait: { w: 4, h: 5 },
};

function safeFileName(name) {
  return name.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'clip';
}

function timeToSeconds(t) {
  return typeof t === 'number' ? t : 0;
}

function getOutputDims(rw, rh) {
  const base = 1080;
  let outW;
  let outH;
  if (rw <= rh) {
    outW = base;
    outH = Math.round((base * rh) / rw);
  } else {
    outH = base;
    outW = Math.round((base * rw) / rh);
  }
  outW = Math.round(outW / 2) * 2;
  outH = Math.round(outH / 2) * 2;
  return { outW, outH };
}

function buildVideoChain(clip) {
  const start = timeToSeconds(clip.start);
  const end = timeToSeconds(clip.end);
  const trim = `trim=start=${start}:end=${end},setpts=PTS-STARTPTS`;
  if (clip.aspect && clip.aspect !== 'original' && clip.crop) {
    const { x, y, w, h } = clip.crop;
    const cropW = Math.max(2, Math.round(w / 2) * 2);
    const cropH = Math.max(2, Math.round(h / 2) * 2);
    const cropX = Math.max(0, Math.round(x));
    const cropY = Math.max(0, Math.round(y));
    const ratio = clip.aspect === 'custom' ? clip.customRatio : ASPECT_RATIOS[clip.aspect];
    const rw = (ratio && ratio.w) || 9;
    const rh = (ratio && ratio.h) || 16;
    const { outW, outH } = getOutputDims(rw, rh);
    return `[0:v]${trim},crop=${cropW}:${cropH}:${cropX}:${cropY},scale=${outW}:${outH},setsar=1[vout]`;
  }
  return `[0:v]${trim}[vout]`;
}

function probeHasAudio(sourcePath) {
  return new Promise((resolve) => {
    const ff = spawn(getFfmpegPath(), ['-i', sourcePath]);
    let out = '';
    ff.stderr.on('data', (d) => { out += d.toString(); });
    ff.on('error', () => resolve(false));
    ff.on('close', () => {
      resolve(/Stream #\d+:\d+[^\n]*Audio:/i.test(out));
    });
  });
}

function buildAudioChain(clip, hasSourceAudio) {
  const start = timeToSeconds(clip.start);
  const end = timeToSeconds(clip.end);
  const duration = Math.max(0.1, end - start);
  const hasImported = !!(clip.audio && clip.audio.path);

  if (!hasImported) {
    if (!hasSourceAudio) return { chains: [], outLabel: null };
    const origTrim = `[0:a]atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS[aorig]`;
    return { chains: [origTrim], outLabel: 'aorig' };
  }

  const vol = typeof clip.audio.volume === 'number' ? clip.audio.volume : 1;
  const importedTrim = `[1:a]atrim=start=0:end=${duration},asetpts=PTS-STARTPTS,volume=${vol}[aimp]`;

  if (clip.audio.muteOriginal || !hasSourceAudio) {
    return { chains: [importedTrim], outLabel: 'aimp' };
  }

  const origTrim = `[0:a]atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS[aorig]`;
  const mix = '[aorig][aimp]amix=inputs=2:duration=first:dropout_transition=0[amix]';
  return { chains: [origTrim, importedTrim, mix], outLabel: 'amix' };
}

function buildStickerChains(clip, videoLabel, stickerInputStartIndex) {
  const validStickers = (Array.isArray(clip.stickers) ? clip.stickers : []).filter((s) => getStickerPath(s.key));
  const chains = [];
  let label = videoLabel;
  const clipDuration = Math.max(0.1, timeToSeconds(clip.end) - timeToSeconds(clip.start));

  // Stickers are positioned by the user against the original source frame.
  // If the clip is also cropped/reframed, translate sticker position + size
  // into the cropped-and-scaled output's coordinate space.
  let transform = null;
  if (clip.aspect && clip.aspect !== 'original' && clip.crop) {
    const ratio = clip.aspect === 'custom' ? clip.customRatio : ASPECT_RATIOS[clip.aspect];
    const rw = (ratio && ratio.w) || 9;
    const rh = (ratio && ratio.h) || 16;
    const { outW, outH } = getOutputDims(rw, rh);
    transform = {
      scaleX: outW / clip.crop.w,
      scaleY: outH / clip.crop.h,
      offX: clip.crop.x,
      offY: clip.crop.y,
    };
  }

  validStickers.forEach((sticker, i) => {
    const inputIdx = stickerInputStartIndex + i;
    let x = sticker.x;
    let y = sticker.y;
    let size = sticker.size;
    if (transform) {
      x = (sticker.x - transform.offX) * transform.scaleX;
      y = (sticker.y - transform.offY) * transform.scaleY;
      size = sticker.size * transform.scaleX;
    }
    size = Math.max(2, Math.round(size));
    x = Math.round(x);
    y = Math.round(y);

    const stkLabel = `stk${i}`;
    chains.push(`[${inputIdx}:v]scale=${size}:${size}[${stkLabel}]`);

    const sStart = Math.max(0, sticker.start != null ? sticker.start : 0);
    const sEnd = Math.max(sStart + 0.1, sticker.end != null ? sticker.end : clipDuration);
    const newLabel = `vst${i}`;
    chains.push(`[${label}][${stkLabel}]overlay=${x}:${y}:enable='between(t,${sStart},${sEnd})'[${newLabel}]`);
    label = newLabel;
  });

  return { chains, outLabel: label };
}

function runFfmpegClip({ sourcePath, outPath, clip, hasSourceAudio }, onProgress) {
  return new Promise((resolve, reject) => {
    const start = timeToSeconds(clip.start);
    const end = timeToSeconds(clip.end);
    const duration = Math.max(0.1, end - start);

    const validStickers = (Array.isArray(clip.stickers) ? clip.stickers : []).filter((s) => getStickerPath(s.key));

    const inputs = ['-i', sourcePath];
    let stickerInputStartIndex = 1;
    if (clip.audio && clip.audio.path) {
      inputs.push('-i', clip.audio.path);
      stickerInputStartIndex = 2;
    }
    validStickers.forEach((s) => {
      inputs.push('-loop', '1', '-i', getStickerPath(s.key));
    });

    const videoChain = buildVideoChain(clip);
    const { chains: stickerChains, outLabel: videoOutLabel } = buildStickerChains(clip, 'vout', stickerInputStartIndex);
    const { chains: audioChains, outLabel: audioOutLabel } = buildAudioChain(clip, hasSourceAudio);
    const filterComplex = [videoChain, ...stickerChains, ...audioChains].join(';');

    const args = [
      '-y',
      ...inputs,
      '-filter_complex', filterComplex,
      '-map', `[${videoOutLabel}]`,
    ];
    if (audioOutLabel) {
      args.push('-map', `[${audioOutLabel}]`);
    }
    args.push(
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '18',
    );
    if (audioOutLabel) {
      args.push('-c:a', 'aac', '-b:a', '192k');
    }
    args.push(outPath);

    const ff = spawn(getFfmpegPath(), args);
    let stderrBuf = '';

    ff.stderr.on('data', (chunk) => {
      stderrBuf += chunk.toString();
      const match = stderrBuf.match(/time=(\d+):(\d+):(\d+\.\d+)/g);
      if (match) {
        const last = match[match.length - 1];
        const m = last.match(/time=(\d+):(\d+):(\d+\.\d+)/);
        if (m) {
          const elapsed = (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]);
          const percent = Math.min(100, Math.round((elapsed / duration) * 100));
          onProgress(percent);
        }
      }
    });

    ff.on('error', (err) => reject(err));
    ff.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}\n${stderrBuf.slice(-800)}`));
    });
  });
}

ipcMain.handle('export-clips', async (event, { exportFolder, clips }) => {
  const results = [];
  const audioCache = new Map();
  for (const clip of clips) {
    const sourcePath = clip.sourcePath;
    const suffix = clip.aspect && clip.aspect !== 'original' ? `_${clip.aspect}` : '_original';
    const outName = `${safeFileName(clip.name)}${suffix}.mp4`;
    const outPath = path.join(exportFolder, outName);

    event.sender.send('export-progress', { id: clip.id, status: 'start', percent: 0 });
    try {
      if (!sourcePath) throw new Error('This clip has no source video (try re-adding it).');
      if (!audioCache.has(sourcePath)) {
        audioCache.set(sourcePath, await probeHasAudio(sourcePath));
      }
      const hasSourceAudio = audioCache.get(sourcePath);
      await runFfmpegClip(
        { sourcePath, outPath, clip, hasSourceAudio },
        (percent) => event.sender.send('export-progress', { id: clip.id, status: 'running', percent })
      );
      event.sender.send('export-progress', { id: clip.id, status: 'done', percent: 100, outPath });
      results.push({ id: clip.id, ok: true, outPath });
    } catch (err) {
      event.sender.send('export-progress', { id: clip.id, status: 'error', message: err.message });
      results.push({ id: clip.id, ok: false, error: err.message });
    }
  }
  return results;
});
