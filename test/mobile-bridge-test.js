// Tests the phone build (www/) with the phone bridge, without an iPhone.
//
// It opens www/index.html in a plain Chromium window with NO Electron
// preload and NO Node.js — the same situation as the iPhone's web view — so
// the only window.nineJaCut available is the one from mobile/bridge.js.
//
// Run (needs ffmpeg on PATH to make the test video):
//   npm run build:mobile
//   xvfb-run -a npx electron --no-sandbox test/mobile-bridge-test.js [out-dir]
//
// Note: this checks the logic in Chromium. The iPhone uses WebKit (Safari's
// engine), so the app still needs a run on the iOS simulator / a real phone.

const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const outDir = process.argv[process.argv.length - 1].endsWith('.js')
  ? fs.mkdtempSync(path.join(os.tmpdir(), '9jacut-mobile-'))
  : process.argv[process.argv.length - 1];
fs.mkdirSync(outDir, { recursive: true });

let checks = 0;
let failures = 0;
const check = (name, ok, extra = '') => {
  checks += 1;
  if (!ok) failures += 1;
  console.log(`[mobile] ${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The function names the desktop interface relies on, read from preload.js.
const preloadSrc = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');
const desktopApi = [...preloadSrc.matchAll(/^\s{2}([a-zA-Z]+):/gm)].map((m) => m[1]);

function makeTestVideo() {
  const file = path.join(outDir, 'phone-test.mp4');
  execFileSync(process.env.FFMPEG_BIN || 'ffmpeg', [
    '-y', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=30:duration=3',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', file,
  ]);
  return file;
}

async function run() {
  const indexPath = path.join(root, 'www', 'index.html');
  if (!fs.existsSync(indexPath)) throw new Error('www/ is missing: run `npm run build:mobile` first.');

  const win = new BrowserWindow({
    width: 1180, height: 820, show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  const pageErrors = [];
  win.webContents.on('console-message', (_e, level, message) => { if (level >= 3) pageErrors.push(message); });
  win.webContents.on('render-process-gone', (_e, d) => pageErrors.push(`renderer crashed: ${d.reason}`));
  await win.loadFile(indexPath);
  await sleep(800);
  const js = (code) => win.webContents.executeJavaScript(code, true);

  // 1. Bridge present and complete.
  const bridgeKeys = await js('Object.keys(window.nineJaCut || {})');
  const missing = desktopApi.filter((k) => !bridgeKeys.includes(k));
  check(`bridge has all ${desktopApi.length} desktop functions`, missing.length === 0, missing.join(', '));
  check('no Node.js in the page (like the iPhone)', await js('typeof require === "undefined" && typeof process === "undefined"'));

  // 2. Static data.
  const stickers = await js('window.nineJaCut.getStickers()');
  check('14 stickers listed', stickers.length === 14);
  const stickerOk = await js(`fetch(${JSON.stringify(stickers[0].fileUrl)}).then(r => r.ok).catch(() => false)`);
  check('sticker image loads from the phone bundle', stickerOk || fs.existsSync(path.join(root, 'www', stickers[0].fileUrl)));
  const presets = await js('window.nineJaCut.getPromoTemplates()');
  check('52 promo templates', presets.length === 52, String(presets.length));
  const info = await js('window.nineJaCut.getAppInfo()');
  check('app version shown', info.version === require('../package.json').version, info.version);

  // 3. Import a video through the real "Import videos…" button. The file
  //    picker is simulated: when the bridge opens it, the test file is chosen.
  const videoB64 = fs.readFileSync(makeTestVideo()).toString('base64');
  await js(`
    (() => {
      const bin = atob(${JSON.stringify(videoB64)});
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      window.__nextPick = [new File([bytes], 'phone-test.mp4', { type: 'video/mp4' })];
      const realClick = HTMLInputElement.prototype.click;
      HTMLInputElement.prototype.click = function () {
        if (this.type !== 'file') return realClick.call(this);
        const dt = new DataTransfer();
        for (const f of window.__nextPick || []) dt.items.add(f);
        this.files = dt.files;
        setTimeout(() => this.dispatchEvent(new Event('change')), 0);
      };
      document.getElementById('btnOpenVideo').click();
    })()
  `);
  let imported = null;
  for (let i = 0; i < 40 && !imported; i++) {
    await sleep(250);
    imported = await js('state.sources.length ? { n: state.sources.length, d: state.sources[0].duration, w: state.sources[0].width, h: state.sources[0].height, a: state.sources[0].hasAudio, clips: state.clips.length } : null');
  }
  check('video imports from the picker', !!imported, imported ? '' : 'no source after 10s');
  if (imported) {
    check('duration read without ffmpeg', Math.abs(imported.d - 3) < 0.3, `${imported.d}s`);
    check('size read without ffmpeg', imported.w === 640 && imported.h === 360, `${imported.w}x${imported.h}`);
    check('video lands on the timeline', imported.clips >= 1, `${imported.clips} clip(s)`);
  }
  let thumb = null;
  for (let i = 0; i < 40 && !thumb; i++) {
    await sleep(250);
    thumb = await js('(state.sources[0] && state.sources[0].thumbUrl) || null');
  }
  check('thumbnail made in the page', typeof thumb === 'string' && thumb.startsWith('data:image/jpeg'));

  // 4. Preview plays the imported file.
  const canPlay = await js(`new Promise((res) => {
    const v = document.createElement('video'); v.muted = true;
    v.oncanplay = () => res(true); v.onerror = () => res(false);
    v.src = state.sources[0].url; setTimeout(() => res(false), 5000);
  })`);
  check('imported video can play in the player', canPlay);

  // 5. Export reports a clear "not yet" message instead of failing silently.
  const exp = await js('window.nineJaCut.exportClips({ clips: state.clips.map(c => ({ id: c.id, name: c.name })), settings: { combine: true } })');
  check('export explains it is coming next', exp[0] && exp[0].ok === false && /next part/.test(exp[0].error));

  // 6. Save project downloads JSON (desktop browser path), and it opens again.
  let savedJson = null;
  win.webContents.session.once('will-download', (_e, item) => {
    const dest = path.join(outDir, item.getFilename());
    item.setSavePath(dest);
    item.once('done', () => { try { savedJson = fs.readFileSync(dest, 'utf8'); } catch (e) { /* ignore */ } });
  });
  await js('document.getElementById("btnSaveProject").click()');
  for (let i = 0; i < 20 && !savedJson; i++) await sleep(250);
  let project = null;
  try { project = JSON.parse(savedJson); } catch (e) { /* ignore */ }
  check('project saves as JSON', !!project && Array.isArray(project.clips) && project.clips.length >= 1);
  if (project) {
    const loaded = await js(`(() => {
      window.__nextPick = [new File([${JSON.stringify(savedJson)}], 'p.json', { type: 'application/json' })];
      return window.nineJaCut.loadProject().then(d => d && d.clips.length);
    })()`);
    check('saved project opens again', loaded === project.clips.length);
  }

  // 7. Recording save (bytes -> playable file).
  const rec = await js('window.nineJaCut.saveRecording({ bytes: new Uint8Array([1,2,3]), extension: "m4a" })');
  check('voiceover recording is kept', /^phone:\/\//.test(rec.filePath) && /^blob:/.test(rec.fileUrl));

  check('no errors in the page console', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));

  win.show();
  await sleep(300);
  const shot = await win.webContents.capturePage();
  fs.writeFileSync(path.join(outDir, 'phone-build.png'), shot.toPNG());
  console.log(`[mobile] screenshot: ${path.join(outDir, 'phone-build.png')}`);
  console.log(`[mobile] ${checks - failures}/${checks} checks passed`);
}

app.whenReady().then(run).then(() => app.exit(failures ? 1 : 0)).catch((e) => {
  console.error('[mobile] ERROR', e);
  app.exit(1);
});
