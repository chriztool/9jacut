// UI test for auto-captions, zoom, voiceover and the About page. Run:
//   FFMPEG_BIN=/usr/bin/ffmpeg xvfb-run -a npx electron --no-sandbox \
//     --use-fake-device-for-media-stream --use-fake-ui-for-media-stream \
//     test/ui-captions-harness.js <speech.mp4> <caption-models-dir> <out-dir>
// <caption-models-dir> must already hold the models (fast/, accurate/,
// silero_vad.onnx) so the test doesn't download ~300 MB.
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const url = require('url');

const [speechVideo, modelsDir, outDir] = process.argv.slice(-3);
fs.mkdirSync(outDir, { recursive: true });
const userData = path.join(outDir, 'userdata');
fs.mkdirSync(userData, { recursive: true });
try { fs.symlinkSync(modelsDir, path.join(userData, 'caption-models')); } catch (e) { /* exists */ }
app.setPath('userData', userData);

const log = (...a) => console.log('[ui]', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];

require('../main.js');

async function shot(win, name) {
  const img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(outDir, `${name}.png`), img.toPNG());
}

async function waitFor(js, cond, ms = 120000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await js(cond)) return true;
    await sleep(300);
  }
  return false;
}

async function run() {
  await sleep(1500);
  const win = BrowserWindow.getAllWindows()[0];
  win.webContents.on('console-message', (_e, level, message) => { if (level >= 2) errors.push(message); });
  const js = (code) => win.webContents.executeJavaScript(code);

  log('flag in top-left corner:', await js(`(() => { const r = document.querySelector('.topbar .ng-flag').getBoundingClientRect(); return r.left < 40 && r.top < 40 && r.width > 20; })()`));

  await js(`loadVideo(${JSON.stringify(speechVideo)}, ${JSON.stringify(url.pathToFileURL(speechVideo).href)}, 'speech.mp4')`);
  await sleep(800);
  await js(`video.currentTime = 0; btnMarkIn.click(); video.currentTime = 26; btnMarkOut.click(); btnAddClip.click();`);
  await sleep(300);
  await js(`document.querySelector('.fx-section > summary').click()`);
  await sleep(500);
  log('models seen by app:', await js(`JSON.stringify(captionUi.info.models)`));

  // Auto-caption with the Fast model.
  await js(`captionUi.prefs.model = 'fast'; captionUi.prefs.language = 'en';`);
  const t0 = Date.now();
  await js(`[...document.querySelectorAll('.fx-section button')].find(b => b.textContent.includes('Auto-caption')).click()`);
  await sleep(300);
  log('status while working:', await js(`(document.querySelector('.caption-status') || {}).textContent`));
  const done = await waitFor(js, `!captionUi.job && !!(state.clips[0].captions)`);
  log('captions done:', done, `in ${((Date.now() - t0) / 1000).toFixed(1)}s,`, 'lines:', await js('state.clips[0].captions ? state.clips[0].captions.lines.length : 0'));
  log('first lines:', await js(`JSON.stringify(state.clips[0].captions.lines.slice(0, 3).map(l => [l.start.toFixed(2), l.text]))`));
  log('caption rows in panel:', await js(`document.querySelectorAll('.caption-line').length`));

  // Edit a caption word, ALL CAPS, preview at 1s.
  await js(`(() => { const inp = document.querySelector('.caption-text'); inp.focus(); inp.value = inp.value.replace('yellow', 'golden'); inp.dispatchEvent(new Event('input')); inp.blur(); })()`);
  await js(`[...document.querySelectorAll('.fx-section label')].find(l => l.textContent.includes('ALL CAPS')).querySelector('input').click()`);
  await js('video.currentTime = 1.5');
  await sleep(700);
  log('caption preview text:', await js('textLayer.innerText'));
  await shot(win, '1-captions');

  // Motion preview.
  await js(`(() => { const sel = [...document.querySelectorAll('.fx-section select')][1]; sel.value = 'zoomin'; sel.dispatchEvent(new Event('change')); })()`);
  await js('video.currentTime = 20');
  await sleep(600);
  log('zoom transform at 20s:', await js('video.style.transform'));

  // Voiceover on a short second clip (fake microphone).
  await js(`video.currentTime = 27; btnMarkIn.click(); video.currentTime = 30; btnMarkOut.click(); btnAddClip.click();`);
  await sleep(300);
  await js(`openFxPanels.add(state.clips[1].id); renderClipList();`);
  await sleep(300);
  await js(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('Record voiceover') && b.closest('.clip-card') === document.querySelectorAll('.clip-card')[1]).click()`);
  await sleep(1200);
  log('recording state:', await js(`state.recording ? state.recording.recorder.state : 'none'`), '| note:', await js(`(document.querySelector('.rec-note') || {}).textContent`));
  const recorded = await waitFor(js, `!state.recording && !!state.clips[1].voiceover`, 20000);
  const vo = await js(`JSON.stringify(state.clips[1].voiceover)`);
  log('voiceover saved:', recorded, vo);
  if (recorded) {
    const p = JSON.parse(vo).path;
    log('voiceover file bytes:', fs.statSync(p).size, '| video muted after:', await js('video.muted'));
  }
  await shot(win, '2-voiceover');

  // Export both clips (captions + zoom + voiceover).
  const exportDir = path.join(outDir, 'exports');
  fs.mkdirSync(exportDir, { recursive: true });
  await js(`state.exportFolder = ${JSON.stringify(exportDir)}; setResolution.value = '720'; setResolution.dispatchEvent(new Event('change')); renderClipList();`);
  await js('btnExportAll.click()');
  await sleep(500);
  await waitFor(js, '!btnExportAll.disabled', 180000);
  log('export status:', await js('statusBar.textContent'));
  log('exports:', fs.readdirSync(exportDir).join(', '));

  // Project round trip keeps captions / motion / voiceover.
  const saved = await js('JSON.stringify(state.clips.map(serializeClip))');
  const back = JSON.parse(saved);
  log('saved fields:', back[0].captions.lines.length, back[0].motion, !!back[1].voiceover);

  // About page.
  await js('tabAbout.click()');
  await sleep(500);
  log('about visible:', await js(`!aboutView.classList.contains('hidden') && clipEditorView.classList.contains('hidden')`),
    '| version:', await js(`document.querySelector('.about-hero .app-version').textContent`),
    '| email link:', await js(`document.querySelector('.contact-link').textContent`));
  await js(`document.querySelector('.contact-link').click()`);
  await sleep(300);
  log('window did not navigate away:', await js(`location.href.endsWith('index.html')`));
  await js(`document.getElementById('btnCopyEmail').click()`);
  await sleep(300);
  log('copy button feedback:', await js(`document.getElementById('btnCopyEmail').textContent`));
  await shot(win, '3-about');
  await js(`document.querySelector('.about-layout').scrollTop = 99999`);
  await sleep(200);
  await shot(win, '4-about-bottom');
  await js('switchMode("promo")');
  await sleep(300);
  await shot(win, '5-promo');

  log('console errors:', errors.length ? errors.join(' | ') : 'none');
  app.quit();
}

app.whenReady().then(() => run().catch((e) => { console.error('[ui] HARNESS ERROR', e); app.exit(1); }));
