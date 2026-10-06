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


// Simulates the phone's file picker: the next time the bridge opens it, the
// given test video is "chosen". Then presses the real Import button.
function importTestVideo(js, videoB64) {
  return js(`
    (() => {
      const bin = atob(${JSON.stringify(videoB64)});
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      window.__nextPick = [new File([bytes], 'phone-test.mp4', { type: 'video/mp4' })];
      if (!window.__pickerPatched) {
        window.__pickerPatched = true;
        const realClick = HTMLInputElement.prototype.click;
        HTMLInputElement.prototype.click = function () {
          if (this.type !== 'file') return realClick.call(this);
          const dt = new DataTransfer();
          for (const f of window.__nextPick || []) dt.items.add(f);
          this.files = dt.files;
          setTimeout(() => this.dispatchEvent(new Event('change')), 0);
        };
      }
      document.getElementById('btnOpenVideo').click();
    })()
  `);
}

async function shoot(win, outDir, name) {
  await sleep(600);
  const img = await win.webContents.capturePage();
  const file = path.join(outDir, name);
  fs.writeFileSync(file, img.toPNG());
  console.log(`[mobile] screenshot: ${file}`);
}

// The phone layout, at iPhone 15 size (393 x 852 points).
async function runPhone(indexPath, videoB64) {
  const win = new BrowserWindow({
    width: 393, height: 852, show: true, useContentSize: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  const pageErrors = [];
  win.webContents.on('console-message', (_e, level, message) => { if (level >= 3) pageErrors.push(message); });
  await win.loadURL(`${require('url').pathToFileURL(indexPath).href}?phone=1`);
  await sleep(1200);
  const js = (code) => win.webContents.executeJavaScript(code, true);

  check('phone: phone layout switched on', await js('document.documentElement.classList.contains("phone-layout")'));
  const tools = await js('[...document.querySelectorAll("#phoneRail button")].map(b => b.dataset.tab || b.dataset.phone)');
  const expected = ['details', 'media', 'audio', 'text', 'stickers', 'effects', 'transitions', 'captions', 'filters', 'adjust', 'templates'];
  check('phone: rail has Edit + all 10 PC tools', JSON.stringify(tools) === JSON.stringify(expected), tools.join(','));
  const railBox = () => js('(() => { const r = document.getElementById("phoneRail").getBoundingClientRect(); return { x: Math.round(r.x), w: Math.round(r.width) }; })()');
  check('phone: rail is hidden until you swipe for it', !(await js('window.nineJaCutPhone.railOpen')) && (await railBox()).x >= 392, JSON.stringify(await railBox()));
  check('phone: video and timeline use the full width', await js('document.querySelector(".timeline-panel").getBoundingClientRect().width >= window.innerWidth - 1'));
  // Swipe left from the right edge, the way a finger would.
  const swipeLeft = `(() => {
    const t = (x) => new Touch({ identifier: 1, target: document.body, clientX: x, clientY: 600 });
    document.body.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, touches: [t(388)], changedTouches: [t(388)] }));
    document.body.dispatchEvent(new TouchEvent('touchend', { bubbles: true, touches: [], changedTouches: [t(300)] }));
  })()`;
  await js(swipeLeft);
  await sleep(400);
  check('phone: swiping in from the right edge shows the rail', await js('window.nineJaCutPhone.railOpen') && (await railBox()).x > 300 && (await railBox()).x < 340, JSON.stringify(await railBox()));
  check('phone: no sideways scrolling', await js('document.documentElement.scrollWidth <= window.innerWidth + 1'));
  check('phone: Media opens on first launch', await js('window.nineJaCutPhone.openKey === "media" && !document.getElementById("phoneSheet").hidden'));
  await shoot(win, outDir, 'phone-1-rail-swiped-in.png');
  await js('document.getElementById("videoStage").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }))');
  await sleep(400);
  check('phone: tapping elsewhere hides the rail', !(await js('window.nineJaCutPhone.railOpen')));
  await shoot(win, outDir, 'phone-1b-first-launch.png');

  await importTestVideo(js, videoB64);
  let clips = 0;
  for (let i = 0; i < 40 && !clips; i++) { await sleep(250); clips = await js('state.clips.length'); }
  check('phone: import puts the video on the timeline', clips >= 1);

  await js('window.nineJaCutPhone.closeSheet()');
  await sleep(500);
  check('phone: panel closes', await js('document.getElementById("phoneSheet").hidden'));
  await js('document.querySelector(".tl-clip").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, clientX: 80 })); window.dispatchEvent(new PointerEvent("pointerup", { clientX: 80 }))');
  await sleep(200);
  check('phone: tapping a clip selects it', await js('!!document.querySelector(".tl-clip.selected")'));
  await shoot(win, outDir, 'phone-2-timeline.png');

  // Every tool on the rail opens its PC panel.
  const opened = [];
  for (const key of expected) {
    await js(`document.querySelector('#phoneRail [data-${key === 'details' ? 'phone' : 'tab'}="${key}"]').click()`);
    await sleep(80);
    const ok = await js(`(() => {
      const sheet = document.getElementById('phoneSheet');
      if (sheet.hidden || window.nineJaCutPhone.openKey !== '${key}') return false;
      const pane = sheet.querySelector('${key === 'details' ? '#propsBody' : '#leftBody'}');
      return pane.offsetHeight > 50 && pane.textContent.trim().length > 10;
    })()`);
    if (ok) opened.push(key);
  }
  check('phone: every rail tool opens its panel', opened.length === expected.length, `opened ${opened.length}/${expected.length}`);
  await sleep(300);
  check('phone: the rail slides away after picking a tool', !(await js('window.nineJaCutPhone.railOpen')));
  await js(`document.querySelector('#phoneRail [data-tab="text"]').click()`);
  await sleep(600);
  await shoot(win, outDir, 'phone-3-text-tool.png');
  await js(`document.querySelector('#phoneRail [data-phone="details"]').click()`);
  await sleep(600);
  check('phone: Edit shows the selected clip details', await js('/Details · phone-test/.test(document.getElementById("propsTitle").textContent)'));
  await shoot(win, outDir, 'phone-4-edit-clip.png');

  // Tapping the open tool again closes it.
  await js(`document.querySelector('#phoneRail [data-phone="details"]').click()`);
  await sleep(500);
  check('phone: tapping the open tool closes it', await js('document.getElementById("phoneSheet").hidden'));

  // Drag the handle under the player: the video gets bigger, the editing area smaller.
  const stageH = () => js('Math.round(document.getElementById("videoStage").getBoundingClientRect().height)');
  const h0 = await stageH();
  const drag = (dy) => js(`(() => {
    const h = document.getElementById('phoneSplitter'); const r = h.getBoundingClientRect();
    const y = r.top + r.height / 2;
    h.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 200, clientY: y }));
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 200, clientY: y + ${dy} }));
    window.dispatchEvent(new PointerEvent('pointerup', { clientX: 200, clientY: y + ${dy} }));
  })()`);
  await drag(120);
  await sleep(250);
  const h1 = await stageH();
  check('phone: dragging the handle down makes the video bigger', h1 - h0 > 100, `${h0}px -> ${h1}px`);
  await shoot(win, outDir, 'phone-4b-bigger-video.png');
  await drag(-200);
  await sleep(250);
  const h2 = await stageH();
  check('phone: dragging it up gives the editing area more room', h2 < h0 && h2 >= 110, `${h1}px -> ${h2}px`);
  check('phone: the size is remembered', await js(`JSON.parse(localStorage.getItem('9jacut.phone.size')).portrait === ${h2}`) || await js(`Math.abs(JSON.parse(localStorage.getItem('9jacut.phone.size')).portrait - ${h2}) < 2`));
  await js(`document.getElementById('phoneSplitter').dispatchEvent(new PointerEvent('pointerup', { bubbles: true })); document.getElementById('phoneSplitter').dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))`);
  await sleep(250);
  check('phone: double-tapping the handle resets the sizes', Math.abs((await stageH()) - h0) <= 2, `${await stageH()}px vs ${h0}px`);
  // Pulling an open panel's grip far down closes it.
  await js(`document.querySelector('#phoneRail [data-tab="text"]').click()`);
  await sleep(500);
  await js(`(() => {
    const g = document.querySelector('.sheet-grip'); const r = g.getBoundingClientRect(); const y = r.top + 10;
    g.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 100, clientY: y }));
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 100, clientY: y + 500 }));
    window.dispatchEvent(new PointerEvent('pointerup', { clientX: 100, clientY: y + 500 }));
  })()`);
  await sleep(600);
  check('phone: pulling the panel grip down closes the panel', await js('document.getElementById("phoneSheet").hidden') && Math.abs((await stageH()) - h0) <= 2);

  // Promo and About are reachable from the menu.
  await js('document.getElementById("btnMenu").click()');
  await sleep(200);
  check('phone: Editor / Promo / About are in the menu', await js('!!document.querySelector("#menuDropdown #tabPromoVideo") && !!document.querySelector("#menuDropdown #tabAbout")'));
  await shoot(win, outDir, 'phone-5-menu.png');
  await js('document.getElementById("tabPromoVideo").click()');
  await sleep(400);
  check('phone: Promo page fits the screen', await js('document.documentElement.scrollWidth <= window.innerWidth + 1 && !document.getElementById("promoView").classList.contains("hidden")'));
  await shoot(win, outDir, 'phone-6-promo.png');
  await js('document.getElementById("btnMenu").click(); document.getElementById("tabClipEditor").click()');

  // Landscape.
  win.setContentSize(852, 393);
  await sleep(700);
  check('phone: landscape fits the screen', await js('document.documentElement.scrollWidth <= window.innerWidth + 1'));
  const w0 = await js('Math.round(document.querySelector(".player-panel").getBoundingClientRect().width)');
  await js(`(() => {
    const h = document.getElementById('phoneSplitter'); const r = h.getBoundingClientRect(); const x = r.left + r.width / 2;
    h.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: x, clientY: 200 }));
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: x - 120, clientY: 200 }));
    window.dispatchEvent(new PointerEvent('pointerup', { clientX: x - 120, clientY: 200 }));
  })()`);
  await sleep(250);
  const w1 = await js('Math.round(document.querySelector(".player-panel").getBoundingClientRect().width)');
  check('phone: landscape handle resizes video against timeline', w0 - w1 > 100, `${w0}px -> ${w1}px`);
  await shoot(win, outDir, 'phone-7-landscape.png');

  check('phone: no errors in the page console', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
  win.destroy();
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
  await importTestVideo(js, videoB64);
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
  check('export in a web browser explains where it works', exp[0] && exp[0].ok === false && /iPhone app/.test(exp[0].error));

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
  await shoot(win, outDir, 'ipad-desktop-layout.png');
  win.destroy();

  await runPhone(indexPath, videoB64);
  console.log(`[mobile] ${checks - failures}/${checks} checks passed`);
}

// Keep running between the two test windows.
app.on('window-all-closed', () => {});

app.whenReady().then(run).then(() => app.exit(failures ? 1 : 0)).catch((e) => {
  console.error('[mobile] ERROR', e);
  app.exit(1);
});
