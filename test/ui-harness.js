// UI smoke test: launches the real app in Electron, drives it like a user
// and saves screenshots. Run with:
//   FFMPEG_BIN=/usr/bin/ffmpeg xvfb-run -a npx electron test/ui-harness.js <media-dir> <out-dir>
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const url = require('url');

const mediaDir = process.argv[process.argv.length - 2];
const outDir = process.argv[process.argv.length - 1];
fs.mkdirSync(outDir, { recursive: true });

const errors = [];
const log = (...a) => console.log('[ui]', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

require('../main.js');

async function shot(win, name) {
  const img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(outDir, `${name}.png`), img.toPNG());
}

async function key(win, keyCode, modifiers = []) {
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
  if (keyCode.length === 1 || keyCode === 'Space') {
    win.webContents.sendInputEvent({ type: 'char', keyCode: keyCode === 'Space' ? ' ' : keyCode, modifiers });
  }
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
  await sleep(150);
}

async function run() {
  await sleep(1500);
  const win = BrowserWindow.getAllWindows()[0];
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2) errors.push(message);
  });
  win.webContents.on('render-process-gone', (_e, d) => errors.push(`renderer gone: ${d.reason}`));
  const js = (code) => win.webContents.executeJavaScript(code);

  const src = path.join(mediaDir, 'src.mp4');
  await js(`loadVideo(${JSON.stringify(src)}, ${JSON.stringify(url.pathToFileURL(src).href)}, 'src.mp4')`);
  await sleep(800);
  log('video size', await js('`${state.videoWidth}x${state.videoHeight}`'));

  // Keyboard: focus page body, mark in at 1s, mark out at 5s, Enter adds clip.
  await js('document.activeElement && document.activeElement.blur(); video.currentTime = 1');
  await sleep(300);
  await key(win, 'I');
  await key(win, 'Right'); await key(win, 'Right'); await key(win, 'Right'); await key(win, 'Right');
  await sleep(300);
  await key(win, 'O');
  await key(win, 'Return');
  const clip1 = await js('JSON.stringify(state.clips.map(c => [c.start.toFixed(1), c.end.toFixed(1)]))');
  log('clips after shortcuts', clip1);

  // Second clip via buttons, reframed vertical.
  await js(`video.currentTime = 5; btnMarkIn.click(); video.currentTime = 7.5; btnMarkOut.click(); btnAddClip.click();`);
  await sleep(300);
  await js(`(() => { const sel = document.querySelectorAll('.aspect-select')[1]; sel.value = 'vertical'; sel.dispatchEvent(new Event('change')); })()`);

  // Effects on clip 1: open panel, 2x speed, Naija Gold look, fade, text.
  await js(`document.querySelector('.fx-section > summary').click()`);
  await sleep(300);
  await js(`(() => {
    const sec = document.querySelector('.fx-section');
    const sels = sec.querySelectorAll('select');
    sels[0].value = '2'; sels[0].dispatchEvent(new Event('change'));
  })()`);
  await sleep(200);
  await js(`(() => {
    const sec = document.querySelector('.fx-section');
    const sels = sec.querySelectorAll('select');
    sels[1].value = '0.5'; sels[1].dispatchEvent(new Event('change'));
    sels[3].value = 'gold'; sels[3].dispatchEvent(new Event('change'));
  })()`);
  await sleep(200);
  await js(`[...document.querySelector('.fx-section').querySelectorAll('button')].find(b => b.textContent.includes('Add Text')).click()`);
  await sleep(300);
  await js(`(() => {
    const ta = document.querySelector('.fx-section textarea');
    ta.value = "Mama Put Special\\n50% off today!"; ta.dispatchEvent(new Event('input'));
    const sels = document.querySelector('.text-item').querySelectorAll('select');
    sels[1].value = 'box'; sels[1].dispatchEvent(new Event('change'));
  })()`);
  await js('video.currentTime = 2');
  await sleep(600);
  const fx = await js(`JSON.stringify({ filter: video.style.filter, rate: video.playbackRate, texts: textLayer.innerText, summary: document.querySelector('.fx-section > summary').textContent, clip: (({speed, look, fade, texts}) => ({speed, look: look.preset, fade, texts: texts.length}))(state.clips[0]) })`);
  log('preview fx', fx);
  await shot(win, '1-effects-panel');
  log('layout fits window:', await js('document.documentElement.scrollHeight <= window.innerHeight'), await js('btnPlayPause.getBoundingClientRect().bottom <= window.innerHeight'));

  // Undo restores the text-less state, redo by re-adding is not needed.
  const beforeUndo = await js('state.clips[0].texts[0].style');
  await js('document.activeElement && document.activeElement.blur()');
  await key(win, 'Z', ['control']);
  log('text style before/after Ctrl+Z', beforeUndo, await js('state.clips[0].texts[0].style'));
  await key(win, 'Z', ['control']);
  log('text count after 2nd Ctrl+Z', await js('state.clips[0].texts.length'));
  // put the text back for the export
  await js(`state.clips[0].texts = [{ id: 't1', text: 'Mama Put Special', size: 8, color: '#ffd700', position: 'top', style: 'outline', start: 0, end: 2 }]; renderClipList(); updatePreviewFx();`);

  // Reframe mode on clip 2 hides look/text preview and shows crop box.
  await js(`enterReframeMode(state.clips[1].id)`);
  await sleep(400);
  await shot(win, '2-reframe');
  await key(win, 'Escape');
  log('edit mode after Esc', await js('String(state.editMode)'));

  // Export: separate clips, then one combined video.
  const exportDir = path.join(outDir, 'exports');
  fs.mkdirSync(exportDir, { recursive: true });
  await js(`state.exportFolder = ${JSON.stringify(exportDir)}; renderClipList();`);
  await js(`setResolution.value = '720'; setResolution.dispatchEvent(new Event('change'));`);
  await js(`btnExportAll.click()`);
  for (let i = 0; i < 120 && !(await js('!btnExportAll.disabled')); i++) await sleep(500);
  await sleep(500);
  log('status after clip export:', await js('statusBar.textContent'));

  await js(`setCombine.checked = true; setCombine.dispatchEvent(new Event('change'));
    setTransition.value = 'slideleft'; setTransition.dispatchEvent(new Event('change'));
    setCombinedName.value = 'my promo'; setCombinedName.dispatchEvent(new Event('change'));`);
  await shot(win, '3-export-settings');
  await js(`btnExportAll.click()`);
  await sleep(500);
  for (let i = 0; i < 240 && !(await js('!btnExportAll.disabled')); i++) await sleep(500);
  log('status after combined export:', await js('statusBar.textContent'));
  log('export files:', fs.readdirSync(exportDir).join(', '));

  // Save/load project round trip keeps the new fields.
  const saved = await js(`JSON.stringify({ clips: state.clips.map(serializeClip), exportSettings: state.exportSettings })`);
  fs.writeFileSync(path.join(outDir, 'project.json'), saved);

  // Old v1 project (no new fields) loads with defaults.
  await js(`state.clips = [normalizeClip({ id: 'old', name: 'Old', sourcePath: ${JSON.stringify(src)}, start: 0, end: 2, aspect: 'original', stickers: [] })]; renderClipList();`);
  log('old clip normalized:', await js(`JSON.stringify((({speed, look, fade, texts, origVolume}) => ({speed, look, fade, texts, origVolume}))(state.clips[0]))`));

  // Promo tab still works and shortcuts don't fire there.
  await js(`tabPromoVideo.click()`);
  await key(win, 'I');
  log('promo tab templates:', await js('promoState.templates.length'));
  await shot(win, '4-promo-tab');

  log('console errors:', errors.length ? errors.join(' | ') : 'none');
  app.quit();
}

app.whenReady().then(() => run().catch((e) => { console.error('[ui] HARNESS ERROR', e); app.exit(1); }));
