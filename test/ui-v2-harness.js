// UI test for the v2 workspace (four panels + timeline). Run:
//   FFMPEG_BIN=/usr/bin/ffmpeg xvfb-run -a -s "-screen 0 1440x900x24" npx electron --no-sandbox \
//     test/ui-v2-harness.js <media-dir> <caption-models-dir> <out-dir>
// media-dir needs src.mp4, speech.mp4 and music.mp3.
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const url = require('url');

const [mediaDir, modelsDir, outDir] = process.argv.slice(-3);
fs.mkdirSync(outDir, { recursive: true });
const userData = path.join(outDir, 'userdata');
fs.mkdirSync(userData, { recursive: true });
try { fs.symlinkSync(modelsDir, path.join(userData, 'caption-models')); } catch (e) { /* exists */ }
app.setPath('userData', userData);

const log = (...a) => console.log('[ui]', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];
let checks = 0;
let failures = 0;
const check = (name, ok, extra = '') => {
  checks += 1;
  if (!ok) failures += 1;
  console.log(`[ui] ${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
};

require('../main.js');

async function run() {
  await sleep(1500);
  const win = BrowserWindow.getAllWindows()[0];
  win.setSize(1440, 880);
  await sleep(300);
  win.webContents.on('console-message', (_e, level, message) => { if (level >= 2) errors.push(message); });
  const js = (code) => win.webContents.executeJavaScript(code);
  const shot = async (name) => fs.writeFileSync(path.join(outDir, `${name}.png`), (await win.webContents.capturePage()).toPNG());
  const key = async (keyCode, modifiers = []) => {
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
    if (keyCode.length === 1 && !modifiers.length) win.webContents.sendInputEvent({ type: 'char', keyCode, modifiers });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
    await sleep(200);
  };
  const mouse = async (type, x, y) => {
    const modifiers = type === 'mouseMove' ? ['leftButtonDown'] : [];
    win.webContents.sendInputEvent({ type, x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1, modifiers });
    await sleep(40);
  };
  const waitFor = async (cond, ms = 60000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (await js(cond)) return true; await sleep(250); }
    return false;
  };
  const file = (n) => path.join(mediaDir, n);
  const f = (n) => JSON.stringify({ filePath: file(n), fileUrl: url.pathToFileURL(file(n)).href, fileName: n });

  // --- Layout ---
  const layout = await js(`(() => {
    const r = (s) => document.querySelector(s).getBoundingClientRect();
    const L = r('.left-panel'), P = r('.player-panel'), R = r('.right-panel'), T = r('.timeline-panel');
    return { leftOfPlayer: L.right <= P.left + 1, playerLeftOfRight: P.right <= R.left + 1, timelineBelow: T.top >= Math.max(L.bottom, P.bottom, R.bottom) - 1,
      fits: document.documentElement.scrollHeight <= innerHeight, tabs: document.querySelectorAll('#toolTabs button').length };
  })()`);
  check('four-panel layout: left | player | details, timeline below, fits window', layout.leftOfPlayer && layout.playerLeftOfRight && layout.timelineBelow && layout.fits, JSON.stringify(layout));
  check('10 tool tabs', layout.tabs === 10);
  await shot('0-empty');

  // --- Import: first import goes onto the timeline ---
  await js(`importVideos([${f('src.mp4')}, ${f('speech.mp4')}])`);
  await sleep(1500);
  const afterImport = await js(`({ sources: state.sources.length, clips: state.clips.length, blocks: document.querySelectorAll('.tl-clip').length, total: timelineDuration(), cards: document.querySelectorAll('.media-card').length })`);
  check('import adds media + puts videos on the timeline', afterImport.sources === 2 && afterImport.clips === 2 && afterImport.blocks === 2 && afterImport.cards === 2, JSON.stringify(afterImport));
  await js('fitTimeline()');
  await sleep(300);
  await shot('1-imported');

  // --- Timeline playback across a clip boundary ---
  await js('seekTimeline(7.0)');
  await sleep(500);
  await key('Space');
  await sleep(2200);
  const play = await js(`({ time: ws.time, playing: ws.playing, current: state.clips.findIndex(c => c.id === state.previewClipId), src: state.activeSourcePath.split(/[\\\\/]/).pop() })`);
  await key('Space');
  check('playback runs across clips (src.mp4 → speech.mp4)', play.time > 8.3 && play.current === 1 && play.src === 'speech.mp4', JSON.stringify(play));

  // --- Split with S ---
  await js('pauseTimeline(); seekTimeline(3)');
  await sleep(400);
  await js('document.activeElement && document.activeElement.blur()');
  await key('S');
  const split = await js(`state.clips.map(c => [c.name, +c.start.toFixed(2), +c.end.toFixed(2)])`);
  check('S splits the clip at the playhead', split.length === 3 && Math.abs(split[0][2] - 3) < 0.05 && Math.abs(split[1][1] - 3) < 0.05, JSON.stringify(split));

  // --- Delete / undo / redo ---
  await js(`selectClip(state.clips[1].id)`);
  await key('Delete');
  const afterDel = await js('state.clips.length');
  await key('Z', ['control']);
  const afterUndo = await js('state.clips.length');
  await key('Y', ['control']);
  const afterRedo = await js('state.clips.length');
  await key('Z', ['control']);
  check('Delete, Ctrl+Z, Ctrl+Y', afterDel === 2 && afterUndo === 3 && afterRedo === 2 && (await js('state.clips.length')) === 3, `${afterDel}/${afterUndo}/${afterRedo}`);

  // --- Trim by dragging the right edge of clip 1 ---
  const r1 = await js(`(() => { const b = document.querySelector('.tl-clip .tl-trim.r').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`);
  const px = await js('ws.pxPerSec');
  await mouse('mouseDown', r1.x, r1.y);
  for (let i = 1; i <= 6; i++) await mouse('mouseMove', r1.x - (px * 1.0 * i) / 6, r1.y);
  await mouse('mouseUp', r1.x - px, r1.y);
  await sleep(200);
  const trimmed = await js('+state.clips[0].end.toFixed(2)');
  check('dragging a clip edge trims it (~1s shorter)', Math.abs(trimmed - 2) < 0.15, `end ${trimmed}`);
  await key('Z', ['control']);

  // --- Reorder by dragging clip 1 to the end ---
  const names0 = await js('state.clips.map(c => c.name)');
  const b1 = await js(`(() => { const b = document.querySelectorAll('.tl-clip')[0].getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`);
  const endX = await js(`(() => { const b = document.querySelectorAll('.tl-clip')[2].getBoundingClientRect(); return b.right - 4; })()`);
  await mouse('mouseDown', b1.x, b1.y);
  for (let i = 1; i <= 10; i++) await mouse('mouseMove', b1.x + ((endX - b1.x) * i) / 10, b1.y);
  await mouse('mouseUp', endX, b1.y);
  await sleep(300);
  const names1 = await js('state.clips.map(c => c.name)');
  check('dragging a clip reorders the timeline', names1[2] === names0[0] && names1[0] === names0[1], `${names0.join(',')} → ${names1.join(',')}`);
  await key('Z', ['control']);

  // --- Left tabs ---
  await js(`selectClip(state.clips[0].id)`);
  for (const tab of ['audio', 'text', 'stickers', 'effects', 'transitions', 'captions', 'filters', 'adjust', 'templates', 'media']) {
    await js(`document.querySelector('#toolTabs [data-tab="${tab}"]').click()`);
    await sleep(120);
    const ok = await js(`ws.tab === '${tab}' && leftBody.children.length > 0`);
    if (!ok) check(`tab ${tab} renders`, false);
    if (tab === 'transitions' || tab === 'filters' || tab === 'text') { await sleep(500); await shot(`2-tab-${tab}`); }
  }
  check('all 10 tool tabs render', true);

  // Text preset
  await js(`document.querySelector('#toolTabs [data-tab="text"]').click()`);
  await js('seekTimeline(1)');
  await sleep(300);
  await js(`document.querySelectorAll('.text-preset')[2].click()`);
  await sleep(500);
  const txt = await js(`({ texts: state.clips[0].texts.length, lane: document.querySelectorAll('.lane-overlay .tl-blk').length, preview: textLayer.innerText, props: ws.propsTab })`);
  check('text preset adds text (timeline block + live preview + Details text tab)', txt.texts === 1 && txt.lane === 1 && /BIG NEWS/.test(txt.preview) && txt.props === 'text', JSON.stringify(txt));

  // Transition
  await js(`document.querySelector('#toolTabs [data-tab="transitions"]').click()`);
  await js(`[...document.querySelectorAll('.trans-card')].find(c => c.textContent.includes('Slide left')).click()`);
  await sleep(200);
  check('transition card sets the clip transition + timeline marker', (await js(`state.clips[0].transitionOut.type`)) === 'slideleft' && (await js(`document.querySelectorAll('.tl-trans').length`)) === 1);

  // Filters + effects
  await js(`document.querySelector('#toolTabs [data-tab="filters"]').click()`);
  await js(`[...document.querySelectorAll('.filter-card')].find(c => c.textContent.includes('Naija Gold')).click()`);
  await js(`document.querySelector('#toolTabs [data-tab="effects"]').click()`);
  await js(`[...document.querySelectorAll('.fx-card')].find(c => c.textContent.includes('Slow zoom in')).click()`);
  await sleep(300);
  const fx = await js(`({ look: state.clips[0].look.preset, motion: state.clips[0].motion, filter: video.style.filter, transform: video.style.transform })`);
  check('filter + zoom effect apply and show in the player', fx.look === 'gold' && fx.motion === 'zoomin' && /sepia/.test(fx.filter) && /scale/.test(fx.transform), JSON.stringify(fx));

  // Music under the whole video
  await js(`importAudio([${f('music.mp3')}])`);
  await sleep(500);
  await js(`[...document.querySelectorAll('.audio-item button')].find(b => b.textContent === 'Whole video').click()`);
  await sleep(300);
  const music = await js(`state.clips.map(c => c.audio && +c.audio.offset.toFixed(2))`);
  const expectedOffsets = await js(`(() => { let t = 0; return state.clips.map(c => { const o = +t.toFixed(2); t += clipOutputDuration(c); return o; }); })()`);
  check('“Whole video” music continues from clip to clip', JSON.stringify(music) === JSON.stringify(expectedOffsets) && (await js(`document.querySelectorAll('.lane-audio .blk-music').length`)) === 3, JSON.stringify(music));

  // Captions on the speech clip
  await js(`selectClip(state.clips[2].id); captionUi.prefs.model = 'fast'; captionUi.prefs.language = 'en';`);
  await js(`document.querySelector('#toolTabs [data-tab="captions"]').click()`);
  await sleep(200);
  await js(`document.querySelector('.left-body .btn.primary').click()`);
  const capDone = await waitFor(`!captionUi.job && !!state.clips[2].captions`, 120000);
  const caps = await js(`({ lines: state.clips[2].captions ? state.clips[2].captions.lines.length : 0, lane: document.querySelectorAll('.lane-captions .tl-blk').length, props: ws.propsTab })`);
  check('auto-captions from the Captions tab fill the captions track', capDone && caps.lines > 3 && caps.lane > 3 && caps.props === 'captions', JSON.stringify(caps));
  const capEntry = await js(`entryForClip(state.clips[2].id).start`);
  await js(`seekTimeline(${capEntry} + 1.2)`);
  await sleep(600);
  await shot('3-captions');

  // Source preview + Mark in/out + add part of a video
  await js(`document.querySelector('#toolTabs [data-tab="media"]').click()`);
  await js(`document.querySelectorAll('.media-card')[0].click()`);
  await sleep(800);
  const srcMode = await js(`({ mode: ws.mode, row: !sourceMarkRow.classList.contains('hidden'), title: playerTitle.textContent })`);
  await js(`video.currentTime = 4`);
  await sleep(300);
  await key('I');
  await js(`video.currentTime = 6`);
  await sleep(300);
  await key('O');
  await key('Return');
  const added = await js(`(() => { const c = state.clips[state.clips.length - 1]; return { n: state.clips.length, s: +c.start.toFixed(1), e: +c.end.toFixed(1), focus: ws.focusClipId === c.id }; })()`);
  check('source preview: Mark In/Out + Enter adds that part to the timeline', srcMode.mode === 'source' && srcMode.row && added.n === 4 && added.s === 4 && added.e === 6 && added.focus, `${JSON.stringify(srcMode)} ${JSON.stringify(added)}`);
  await key('Escape');
  check('Esc returns to the timeline player', (await js('ws.mode')) === 'timeline');

  // Templates: TikTok format for every clip
  await js(`document.querySelector('#toolTabs [data-tab="templates"]').click()`);
  await js(`document.querySelectorAll('.format-card')[0].click()`);
  await sleep(300);
  check('template sets every clip to 9:16', (await js(`state.clips.every(c => c.aspect === 'vertical' && c.crop && Math.abs(c.crop.w / c.crop.h - 9/16) < 0.02)`)));

  // Details panel tabs
  await js(`selectClip(state.clips[0].id)`);
  for (const t of ['video', 'audio', 'text', 'captions', 'stickers']) {
    await js(`[...document.querySelectorAll('.props-tab')].find(b => b.textContent.toLowerCase().startsWith('${t}')).click()`);
    await sleep(100);
    if (!(await js(`ws.propsTab === '${t}' && propsBody.children.length > 0`))) check(`details tab ${t}`, false);
  }
  check('Details panel tabs render', true);
  await js(`[...document.querySelectorAll('.props-tab')].find(b => b.textContent.startsWith('Video')).click()`);
  await js('seekTimeline(1.5)');
  await sleep(600);
  await shot('4-editing');

  // Export the whole timeline
  const exportDir = path.join(outDir, 'exports');
  fs.mkdirSync(exportDir, { recursive: true });
  await key('E', ['control']);
  await sleep(300);
  check('Ctrl+E opens the Export window', await js(`!exportDialog.classList.contains('hidden')`));
  await js(`state.exportFolder = ${JSON.stringify(exportDir)}; exportFolderLabel.textContent = state.exportFolder; setResolution.value = '720'; setResolution.dispatchEvent(new Event('change')); setCombinedName.value = 'timeline test'; updateExportReady(); updateExportSummary();`);
  await shot('5-export-dialog');
  const expected = await js(`(() => { const e = timelineEntries(); let t = e.length ? e[e.length - 1].end : 0; for (const x of e.slice(0, -1)) if (x.clip.transitionOut.type !== 'none') t -= Math.min(x.clip.transitionOut.duration, Math.min(x.dur, e[x.index + 1].dur) / 2 - 0.05); return t; })()`);
  await js('btnExportAll.click()');
  await sleep(500);
  await waitFor(`exportDialog.dataset.busy === '0'`, 240000);
  const status = await js('exportStatus.textContent');
  const outFile = path.join(exportDir, 'timeline test.mp4');
  check('export writes one video of the timeline', fs.existsSync(outFile) && /Done/.test(status), status);
  fs.writeFileSync(path.join(outDir, 'expected-duration.txt'), String(expected));
  await key('Escape');

  // Vertical captions preview, to compare with the exported frame.
  const capT = await js(`entryForClip(state.clips[2].id).start + 2.0`);
  await js(`seekTimeline(${capT})`);
  await sleep(700);
  await shot('6-vertical-captions-preview');
  fs.writeFileSync(path.join(outDir, 'caption-shot-time.txt'), String(capT));

  // Other pages still work
  await js('tabPromoVideo.click()');
  await sleep(300);
  check('Promo page', await js(`!promoView.classList.contains('hidden') && promoState.templates.length === 52`));
  await js('tabAbout.click()');
  await sleep(300);
  check('About page', await js(`!aboutView.classList.contains('hidden')`));
  await js('tabClipEditor.click()');
  await sleep(300);
  check('back to the editor', await js(`!clipEditorView.classList.contains('hidden')`));

  check('no console errors', errors.length === 0, errors.join(' | '));
  console.log(`[ui] ${checks - failures}/${checks} checks passed`);
  app.quit();
}

app.whenReady().then(() => run().catch((e) => { console.error('[ui] HARNESS ERROR', e); app.exit(1); }));
