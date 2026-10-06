// Tests the iPhone app's own code path (window.Capacitor + the NineJaCutNative
// plugin) without an iPhone: the real phone build (www/) runs in Chromium,
// and a stand-in for the Swift plugin answers over IPC using this computer's
// ffmpeg. Covers: importing through the native picker, exporting from the
// real Export window, saving to Photos, the share sheet, voiceover files,
// promo export, and reopening a project after the app's folder has moved.
//
// Run: npm run build:mobile
//      xvfb-run -a npx electron --no-sandbox test/mobile-native-test.js [out-dir]

const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const url = require('url');
const { spawn, execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const FFMPEG = process.env.FFMPEG_BIN || 'ffmpeg';
const argOut = process.argv[process.argv.length - 1];
const work = argOut.endsWith('.js') ? fs.mkdtempSync(path.join(os.tmpdir(), '9jacut-native-')) : argOut;
const media = path.join(work, 'Media');
const exportsDir = path.join(work, 'Exports');
fs.mkdirSync(media, { recursive: true });

let checks = 0;
let failures = 0;
const check = (name, ok, extra = '') => {
  checks += 1;
  if (!ok) failures += 1;
  console.log(`[native] ${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- Test media (an iPhone-style .mov and a photo) ----------
const sample = path.join(work, 'IMG_0001.mov');
execFileSync(FFMPEG, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=4',
  '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', sample]);
const samplePhoto = path.join(work, 'IMG_0002.jpg');
execFileSync(FFMPEG, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=1080x1350:duration=1', '-frames:v', '1', samplePhoto]);

// ---------- Stand-in for the Swift plugin ----------
const record = { photos: [], shares: [], picks: 0 };
let selfTestMode = false;
let webContents = null;
const keep = (src) => {
  const dest = path.join(media, path.basename(src));
  fs.copyFileSync(src, dest);
  return dest;
};
const native = {
  getPaths: () => ({ web: path.join(root, 'www'), tmp: path.join(work, 'tmp'), documents: work, media, exports: exportsDir, selfTest: selfTestMode }),
  pickMedia: ({ kind }) => {
    record.picks += 1;
    if (kind === 'audio') return { files: [] };
    const files = [{ path: keep(sample), name: 'IMG_0001.mov', mime: 'video/quicktime' }];
    if (kind === 'visual') files.push({ path: keep(samplePhoto), name: 'IMG_0002.jpg', mime: 'image/jpeg' });
    return { files };
  },
  writeTextFiles: ({ files }) => {
    for (const f of files) { fs.mkdirSync(path.dirname(f.path), { recursive: true }); fs.writeFileSync(f.path, f.text); }
    return {};
  },
  writeBase64: ({ name, data }) => {
    const p = path.join(media, name);
    fs.writeFileSync(p, Buffer.from(data, 'base64'));
    return { path: p };
  },
  removeFiles: ({ paths }) => { for (const p of paths) { try { fs.unlinkSync(p); } catch (e) { /* gone */ } } return {}; },
  resolveMedia: ({ paths }) => ({
    paths: paths.map((p) => (fs.existsSync(p) ? p : (fs.existsSync(path.join(media, path.basename(p))) ? path.join(media, path.basename(p)) : null))),
  }),
  run: ({ jobId, args }) => new Promise((resolve) => {
    const out = args[args.length - 1];
    if (out && out.startsWith('/')) fs.mkdirSync(path.dirname(out), { recursive: true });
    const ff = spawn(FFMPEG, args);
    const send = (d) => webContents && webContents.send('ffmpegLog', { jobId, text: d.toString() });
    ff.stdout.on('data', send);
    ff.stderr.on('data', send);
    ff.on('close', (returnCode) => setTimeout(() => resolve({ returnCode }), 30));
  }),
  cancel: () => ({}),
  saveToPhotos: ({ paths }) => { record.photos.push(...paths); return { saved: paths.length }; },
  selfTestReport: ({ text }) => { fs.appendFileSync(path.join(work, 'selftest-result.txt'), `${text}\n`); return {}; },
  share: ({ files }) => { record.shares.push(...files); return {}; },
};
ipcMain.handle('native', (_e, method, opts) => native[method](opts || {}));

function probe(file) {
  const j = JSON.parse(execFileSync(FFMPEG.replace(/ffmpeg$/, 'ffprobe'), ['-v', 'error', '-show_entries',
    'format=duration:stream=codec_type,width,height', '-of', 'json', file]).toString());
  const v = j.streams.find((s) => s.codec_type === 'video') || {};
  return { duration: Number(j.format.duration), width: v.width, height: v.height, hasAudio: j.streams.some((s) => s.codec_type === 'audio') };
}

async function run() {
  const win = new BrowserWindow({
    width: 393, height: 852, useContentSize: true, show: true,
    webPreferences: { contextIsolation: true, sandbox: false, preload: path.join(__dirname, 'fixtures', 'fake-capacitor-preload.js') },
  });
  webContents = win.webContents;
  const errors = [];
  win.webContents.on('console-message', (_e, level, message) => { if (level >= 3) errors.push(message); });
  await win.loadURL(`${url.pathToFileURL(path.join(root, 'www', 'index.html')).href}?phone=1`);
  await sleep(1200);
  const js = (code) => win.webContents.executeJavaScript(code, true);
  await js('NineJaCutExport.setVideoEncoder("libx264")'); // no Apple encoder on Linux

  check('app sees itself as the iPhone app', await js('window.nineJaCut.platform === "ios"'));
  check('phone export saves to Photos, no folder to pick', await js('state.exportFolder === "Photos" && getComputedStyle(document.getElementById("btnExportFolder")).display === "none"'));

  // Import through the native picker.
  await js('document.getElementById("btnOpenVideo").click()');
  let clip = null;
  for (let i = 0; i < 40 && !clip; i++) {
    await sleep(250);
    clip = await js('state.clips[0] ? { path: state.clips[0].sourcePath, d: state.sources[0].duration, thumb: !!state.sources[0].thumbUrl } : null');
  }
  check('import goes through the native picker into the app\'s Media folder', !!clip && clip.path.startsWith(media), clip && clip.path);
  check('imported .mov reads its length in the page', clip && Math.abs(clip.d - 4) < 0.3, clip && String(clip.d));

  // Style the clip like a user would (text + speed), then export from the real Export window.
  await js(`(() => {
    const c = state.clips[0];
    c.texts = [{ id: 't1', text: 'Made on iPhone', position: 'bottom', size: 7, style: 'box', color: '#ffffff', start: 0, end: 99 }];
    c.speed = 2;
    renderTimeline(); renderProperties();
  })()`);
  await js('document.getElementById("btnExportOpen").click()');
  await sleep(300);
  check('Export button is ready straight away', await js('!document.getElementById("btnExportAll").disabled'));
  await js('document.getElementById("setResolution").value = "720"; document.getElementById("btnExportAll").click()');
  for (let i = 0; i < 120 && !record.photos.length; i++) await sleep(250);
  const exported = record.photos[0];
  check('export finishes and the video is saved to Photos', !!exported && fs.existsSync(exported), exported);
  if (exported) {
    const info = probe(exported);
    check('exported video has the right length (2x speed)', Math.abs(info.duration - 2) < 0.25, `${info.duration}s`);
    check('exported video is 720p with sound', info.height === 720 && info.hasAudio, `${info.width}x${info.height}`);
  }
  await sleep(500);
  check('share sheet opens with the new video', record.shares.length === 1 && record.shares[0] === `file://${exported}`, record.shares.join(','));
  const statusText = await js('document.getElementById("exportStatus").textContent');
  check('Export window says it is saved to Photos', /Saved to Photos: Untitled project\.mp4/.test(statusText), statusText);

  // Voiceover recordings become real files.
  const rec = await js('window.nineJaCut.saveRecording({ bytes: new Uint8Array([0, 1, 2, 3, 250]), extension: "m4a" })');
  check('voiceover recording is saved as a file in Media', rec.filePath.startsWith(media) && fs.readFileSync(rec.filePath).length === 5);

  // Promo video from the native photo/video picker.
  const promoItems = await js('window.nineJaCut.selectPromoMedia()');
  check('promo picker returns a photo and a video', promoItems.length === 2 && promoItems[1].type === 'image');
  const promo = await js(`window.nineJaCut.exportPromo({ presetId: 'split__ocean', layout: 'split', themeKey: 'ocean',
    business: { name: 'Bola Hair Studio', tagline: 'Book now', hours: 'Tue-Sat', address: 'Yaba', contact: '0801 234 5678' },
    items: ${JSON.stringify(promoItems)}.map((m) => ({ filePath: m.filePath, type: m.type })), durationPerItem: 2, fileName: 'bola-promo' })`);
  check('promo video exports', promo.ok && fs.existsSync(promo.outPath), promo.error || promo.outPath);

  // Reopen a project saved before an app update moved the app's folder.
  const oldPath = `/var/mobile/Containers/Data/Application/OLD-UUID/Documents/Media/${path.basename(sample)}`;
  const project = { version: 2, sources: [{ path: oldPath, name: 'IMG_0001.mov', duration: 4 }], clips: [{ id: 'k', name: 'Old', sourcePath: oldPath, start: 0, end: 1 }] };
  const reopened = await js(`(() => {
    window.__projectText = ${JSON.stringify(JSON.stringify(project))};
    const realClick = HTMLInputElement.prototype.click;
    HTMLInputElement.prototype.click = function () {
      if (this.type !== 'file') return realClick.call(this);
      const dt = new DataTransfer();
      dt.items.add(new File([window.__projectText], 'p.json', { type: 'application/json' }));
      this.files = dt.files;
      setTimeout(() => this.dispatchEvent(new Event('change')), 0);
    };
    return window.nineJaCut.loadProject();
  })()`);
  check('reopened project finds its videos again after the app moved', reopened && reopened.clips[0].sourcePath === path.join(media, path.basename(sample)), reopened && reopened.clips[0].sourcePath);

  // The self-test the iOS build runs on the simulated iPhone, run here too.
  selfTestMode = true;
  const selfTestLines = [];
  win.webContents.on('console-message', (_e, _level, message) => { if (/^9JACUT_SELFTEST (PASS|FAIL)/.test(message)) selfTestLines.push(message); });
  await win.loadURL(`${url.pathToFileURL(path.join(root, 'www', 'index.html')).href}?phone=1`);
  await js('NineJaCutExport.setVideoEncoder("libx264")');
  for (let i = 0; i < 120 && !selfTestLines.length; i++) await sleep(250);
  check('the simulator self-test passes', /^9JACUT_SELFTEST PASS/.test(selfTestLines[0] || ''), selfTestLines[0] || 'no result');
  const resultFile = fs.existsSync(path.join(work, 'selftest-result.txt')) ? fs.readFileSync(path.join(work, 'selftest-result.txt'), 'utf8') : '';
  check('self-test writes its result through the native plugin', /9JACUT_SELFTEST_START/.test(resultFile) && /9JACUT_SELFTEST PASS/.test(resultFile), resultFile.trim().split('\n').pop());

  check('no errors in the page console', errors.filter((e) => !/Could not save to Photos/.test(e)).length === 0, errors.slice(0, 3).join(' | '));
  const shot = await win.webContents.capturePage();
  fs.writeFileSync(path.join(work, 'native-export.png'), shot.toPNG());
  console.log(`[native] screenshot: ${path.join(work, 'native-export.png')}`);
  console.log(`[native] ${checks - failures}/${checks} checks passed`);
}

app.on('window-all-closed', () => {});
app.whenReady().then(run).then(() => app.exit(failures ? 1 : 0)).catch((e) => { console.error('[native] ERROR', e); app.exit(1); });
