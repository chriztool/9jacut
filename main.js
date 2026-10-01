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

const clipExport = require('./clip-export');
const { safeFileName } = clipExport;

async function exportContext(warn) {
  const ffmpegPath = getFfmpegPath();
  const support = await clipExport.getFilterSupport(ffmpegPath);
  return {
    ffmpegPath,
    getStickerPath,
    fontPath: PROMO_FONTS.bold,
    tmpDir: path.join(app.getPath('temp'), '9jacut-export'),
    hasDrawtext: support.drawtext,
    warn,
  };
}

ipcMain.handle('export-clips', async (event, { exportFolder, clips, settings = {} }) => {
  const warnings = new Set();
  const ctx = await exportContext((msg) => warnings.add(msg));
  const infoCache = new Map();
  const sourceInfo = async (sourcePath) => {
    if (!infoCache.has(sourcePath)) {
      infoCache.set(sourcePath, await clipExport.probeMedia(ctx.ffmpegPath, sourcePath));
    }
    return infoCache.get(sourcePath);
  };
  const send = (data) => event.sender.send('export-progress', data);

  // One combined video made from every clip, in list order.
  if (settings.combine && clips.length > 0) {
    const outPath = path.join(exportFolder, `${safeFileName(settings.combinedName || '9jacut-video')}.mp4`);
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
      send({ id: 'combined', status: 'error', message: err.message });
      return [{ id: 'combined', ok: false, error: err.message }];
    }
  }

  const results = [];
  for (const clip of clips) {
    const suffix = clip.aspect && clip.aspect !== 'original' ? `_${clip.aspect}` : '_original';
    const outPath = path.join(exportFolder, `${safeFileName(clip.name)}${suffix}.mp4`);
    send({ id: clip.id, status: 'start', percent: 0 });
    try {
      if (!clip.sourcePath) throw new Error('This clip has no source video (try re-adding it).');
      const info = await sourceInfo(clip.sourcePath);
      await clipExport.exportClip(ctx, {
        sourcePath: clip.sourcePath, outPath, clip, hasSourceAudio: info.hasAudio, settings,
      }, (percent) => send({ id: clip.id, status: 'running', percent }));
      send({ id: clip.id, status: 'done', percent: 100, outPath });
      results.push({ id: clip.id, ok: true, outPath });
    } catch (err) {
      send({ id: clip.id, status: 'error', message: err.message });
      results.push({ id: clip.id, ok: false, error: err.message });
    }
  }
  if (warnings.size && results.length) results[0].warnings = [...warnings];
  return results;
});
