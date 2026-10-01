// 9jaCut v2 workspace, part 4: the Details panel, the Export window,
// projects, menu, keyboard shortcuts and start-up.

const PROPS_TABS = [['video', 'Video'], ['audio', 'Audio'], ['text', 'Text'], ['captions', 'Captions'], ['stickers', 'Stickers']];

function propsSection(title) {
  const sec = el('div', 'props-section');
  if (title) sec.appendChild(el('h4', 'props-title', title));
  return sec;
}

function renderProperties() {
  const body = W.propsBody;
  const keepScroll = body.scrollTop;
  body.innerHTML = '';
  const clip = focusedClip();
  if (!clip) {
    W.propsTitle.textContent = 'Details';
    W.propsTabs.classList.add('hidden');
    buildProjectDetails(body);
    return;
  }
  W.propsTitle.textContent = `Details · ${clip.name}`;
  W.propsTabs.classList.remove('hidden');
  W.propsTabs.innerHTML = '';
  for (const [key, label] of PROPS_TABS) {
    const b = el('button', `props-tab${ws.propsTab === key ? ' active' : ''}`, label);
    const count = key === 'text' ? clip.texts.length
      : key === 'stickers' ? clip.stickers.length
        : key === 'captions' ? (clip.captions && clip.captions.lines ? clip.captions.lines.length : 0) : 0;
    if (count) b.appendChild(el('span', 'tab-count', String(count)));
    b.addEventListener('click', () => { ws.propsTab = key; renderProperties(); });
    W.propsTabs.appendChild(b);
  }
  const changed = () => { updatePreviewFx(); renderTimeline(); };
  const builders = { video: buildVideoProps, audio: buildAudioProps, text: buildTextProps, captions: buildCaptionProps, stickers: buildStickerProps };
  (builders[ws.propsTab] || buildVideoProps)(body, clip, changed);
  body.scrollTop = keepScroll;
}

function detailRow(label, value) {
  const row = el('div', 'detail-row');
  row.appendChild(el('span', 'detail-label', label));
  const v = el('span', 'detail-value');
  if (value instanceof Node) v.appendChild(value); else v.textContent = value;
  row.appendChild(v);
  return row;
}

function buildProjectDetails(body) {
  const total = timelineDuration();
  const sec = propsSection();
  sec.appendChild(detailRow('Project', W.projectName.value || 'Untitled project'));
  sec.appendChild(detailRow('Clips', String(state.clips.length)));
  sec.appendChild(detailRow('Length', formatTime(total)));
  sec.appendChild(detailRow('Videos imported', String(state.sources.length)));
  const first = state.clips[0];
  const shape = first ? (first.aspect === 'original' ? 'Original' : (ASPECT_PRESETS[first.aspect] || { label: 'Custom' }).label) : '—';
  sec.appendChild(detailRow('Shape', shape));
  sec.appendChild(detailRow('Captions', `${state.clips.filter((c) => c.captions).length} of ${state.clips.length} clips`));
  sec.appendChild(detailRow('Export folder', state.exportFolder || 'Not chosen yet'));
  body.appendChild(sec);

  const help = propsSection('Getting started');
  const ol = el('ol', 'props-steps');
  for (const step of [
    'Import videos in Media (left).',
    'They appear on the timeline below. Drag clips to reorder, drag their edges to trim, press S to split.',
    'Click a clip to select it. Its settings show here.',
    'Use the tabs on the left for text, stickers, effects, transitions, captions and filters.',
    'Press Export (top right) to save your video.',
  ]) ol.appendChild(el('li', null, step));
  help.appendChild(ol);
  body.appendChild(help);
}

// ---------- Video tab ----------
function buildVideoProps(body, clip, changed) {
  const basic = propsSection('Clip');
  const name = el('input', 'props-input');
  name.value = clip.name;
  name.addEventListener('change', () => { pushUndo(); clip.name = name.value.trim() || clip.name; renderTimeline(); W.propsTitle.textContent = `Details · ${clip.name}`; });
  basic.appendChild(makeLine('Name', name));
  basic.appendChild(detailRow('From', sourceName(clip.sourcePath)));

  const startT = el('input', 'clip-time');
  startT.value = formatTime(clip.start);
  startT.title = 'Where the clip starts in the original video';
  startT.addEventListener('change', () => {
    pushUndo();
    clip.start = Math.min(clip.end - 0.1, Math.max(0, parseTimeInput(startT.value, clip.start)));
    refreshThumbnail(clip);
    renderClipList();
  });
  const endT = el('input', 'clip-time');
  endT.value = formatTime(clip.end);
  endT.title = 'Where the clip ends in the original video';
  endT.addEventListener('change', () => {
    pushUndo();
    const srcLen = (state.sources.find((s) => s.path === clip.sourcePath) || {}).duration || Infinity;
    clip.end = Math.min(srcLen, Math.max(clip.start + 0.1, parseTimeInput(endT.value, clip.end)));
    renderClipList();
  });
  basic.appendChild(makeLine('In / Out', startT, el('span', null, '→'), endT));
  basic.appendChild(detailRow('Length', formatTime(clipOutputDuration(clip))));
  body.appendChild(basic);

  const frame = propsSection('Frame');
  const aspectSel = makeSelect(ASPECT_OPTIONS, clip.aspect, (v) => {
    pushUndo();
    clip.aspect = v;
    if (v === 'original') clip.crop = null; else ensureCropForClip(clip);
    renderClipList();
  });
  frame.appendChild(makeLine('Shape', aspectSel, button('Reframe', 'btn small', reframeFocusedClip, 'Choose what stays in shot')));
  if (clip.aspect === 'custom') {
    const w = el('input', 'num-input');
    w.type = 'number'; w.min = '1'; w.value = clip.customRatio.w;
    const h = el('input', 'num-input');
    h.type = 'number'; h.min = '1'; h.value = clip.customRatio.h;
    const commit = () => {
      pushUndo();
      clip.customRatio = { w: Math.max(1, parseFloat(w.value) || 16), h: Math.max(1, parseFloat(h.value) || 9) };
      ensureCropForClip(clip);
      renderClipList();
    };
    w.addEventListener('change', commit);
    h.addEventListener('change', commit);
    frame.appendChild(makeLine('Ratio', w, el('span', null, ':'), h));
  }
  body.appendChild(frame);

  const motion = propsSection('Speed & motion');
  motion.appendChild(makeLine('Speed', makeSelect(SPEED_OPTIONS, clip.speed, (v) => { pushUndo(); clip.speed = Number(v); renderClipList(); })));
  motion.appendChild(makeLine('Motion', makeSelect(MOTION_OPTIONS, clip.motion, (v) => { pushUndo(); clip.motion = v; changed(); })));
  motion.appendChild(makeLine('Fade in', makeSelect(FADE_OPTIONS, clip.fade.in, (v) => { pushUndo(); clip.fade.in = Number(v); changed(); }),
    el('span', null, 'out'), makeSelect(FADE_OPTIONS, clip.fade.out, (v) => { pushUndo(); clip.fade.out = Number(v); changed(); })));
  body.appendChild(motion);

  const look = propsSection('Look');
  look.appendChild(makeLine('Filter', makeSelect(LOOK_OPTIONS, clip.look.preset, (v) => { pushUndo(); clip.look.preset = v; changed(); renderLeftPanel(); })));
  look.appendChild(makeLine('Brightness', makeSlider(-0.3, 0.3, 0.01, clip.look.brightness, (v) => { clip.look.brightness = v; changed(); })));
  look.appendChild(makeLine('Contrast', makeSlider(0.5, 1.5, 0.01, clip.look.contrast, (v) => { clip.look.contrast = v; changed(); })));
  look.appendChild(makeLine('Saturation', makeSlider(0, 2, 0.01, clip.look.saturation, (v) => { clip.look.saturation = v; changed(); })));
  body.appendChild(look);

  const isLast = state.clips[state.clips.length - 1] === clip;
  const trans = propsSection('Transition to next clip');
  if (isLast) {
    trans.appendChild(el('p', 'props-note', 'This is the last clip — no transition after it.'));
  } else {
    const tr = clip.transitionOut || { type: 'none', duration: 0.5 };
    trans.appendChild(makeLine('Style', makeSelect(Object.entries(TRANSITION_NAMES), tr.type, (v) => {
      pushUndo(); clip.transitionOut = { ...tr, type: v }; renderClipList();
    })));
    trans.appendChild(makeLine('Length', makeSelect([['0.3', '0.3s'], ['0.5', '0.5s'], ['1', '1s'], ['1.5', '1.5s']], tr.duration, (v) => {
      pushUndo(); clip.transitionOut = { ...tr, duration: Number(v) }; renderClipList();
    })));
  }
  body.appendChild(trans);

  const actions = el('div', 'props-actions');
  actions.appendChild(button('Split at playhead', 'btn small', splitAtPlayhead));
  actions.appendChild(button('Duplicate', 'btn small', duplicateFocusedClip));
  actions.appendChild(button('Delete', 'btn small danger', deleteFocusedClip));
  body.appendChild(actions);
}

// ---------- Audio tab ----------
function buildAudioProps(body, clip) {
  const vsec = propsSection('Video sound');
  const volNote = el('span', 'fx-note', `${Math.round(clip.origVolume * 100)}%`);
  vsec.appendChild(makeLine('Volume', makeSlider(0, 2, 0.05, clip.origVolume, (v) => {
    clip.origVolume = v; volNote.textContent = `${Math.round(v * 100)}%`; applyClipSound(clip);
  }), volNote));
  vsec.appendChild(makeLine('', makeCheck('Reduce background noise', clip.denoise, (on) => { pushUndo(); clip.denoise = on; })));
  body.appendChild(vsec);

  const msec = propsSection('Music');
  if (!clip.audio) {
    msec.appendChild(el('p', 'props-note', 'No music on this clip.'));
    const row = el('div', 'props-actions');
    row.appendChild(button('Choose a file…', 'btn small', async () => {
      const files = await window.nineJaCut.selectAudioFiles();
      if (!files.length) return;
      await importAudio(files);
      ws.tab = 'audio';
      renderToolTabs();
      useMusicOnClip(ws.audioLibrary.find((a) => a.path === files[0].filePath));
    }));
    row.appendChild(button('Open Audio tab', 'btn small', () => { ws.tab = 'audio'; renderToolTabs(); renderLeftPanel(); }));
    msec.appendChild(row);
  } else {
    const a = clip.audio;
    msec.appendChild(detailRow('Track', a.name || 'Music'));
    const v = el('span', 'fx-note', `${Math.round((a.volume == null ? 1 : a.volume) * 100)}%`);
    msec.appendChild(makeLine('Volume', makeSlider(0, 2, 0.05, a.volume == null ? 1 : a.volume, (val) => {
      a.volume = val; v.textContent = `${Math.round(val * 100)}%`; previewMusic.volume = Math.min(1, val);
    }), v));
    msec.appendChild(makeLine('', makeCheck('Loop to fill the clip', a.loop !== false, (on) => { pushUndo(); a.loop = on; })));
    msec.appendChild(makeLine('', makeCheck('Replace the video sound', !!a.muteOriginal, (on) => { pushUndo(); a.muteOriginal = on; applyClipSound(clip); })));
    if (a.offset) msec.appendChild(detailRow('Starts at', `${formatTime(a.offset)} into the song`));
    msec.appendChild(el('div', 'props-actions')).appendChild(button('Remove music', 'btn small danger', () => { pushUndo(); clip.audio = null; renderClipList(); }));
  }
  body.appendChild(msec);

  const vo = propsSection('Voiceover');
  vo.appendChild(buildVoiceoverLine(clip));
  vo.appendChild(el('p', 'props-note', 'The clip plays muted while you talk, and stops at the end of the clip. Wear headphones for the cleanest sound.'));
  body.appendChild(vo);
}

// ---------- Text tab ----------
function buildTextProps(body, clip, changed) {
  const sec = propsSection('Text on this clip');
  const add = button('+ Add text', 'btn small primary', () => {
    ws.tab = 'text';
    renderToolTabs();
    renderLeftPanel();
    addTextPreset(TEXT_PRESETS[1]);
  });
  sec.appendChild(add);
  if (!clip.texts.length) sec.appendChild(el('p', 'props-note', 'No text yet. Pick a style in the Text tab on the left, or press + Add text.'));
  for (const t of clip.texts) sec.appendChild(buildTextEditor(clip, t, changed));
  body.appendChild(sec);
}

// ---------- Captions tab ----------
function buildCaptionProps(body, clip, changed) {
  const sec = propsSection();
  sec.appendChild(buildCaptionsSection(clip, () => { changed(); }));
  body.appendChild(sec);
}

// ---------- Stickers tab ----------
function buildStickerProps(body, clip) {
  const sec = propsSection('Stickers on this clip');
  const row = el('div', 'props-actions');
  row.appendChild(button(state.editMode === 'stickers' && state.selectedClipId === clip.id ? 'Done placing' : 'Place / move stickers', 'btn small primary', () => {
    if (state.editMode === 'stickers' && state.selectedClipId === clip.id) exitStickerMode();
    else { if (ws.playing) pauseTimeline(); enterStickerMode(clip.id); }
  }));
  row.appendChild(button('Open Stickers tab', 'btn small', () => { ws.tab = 'stickers'; renderToolTabs(); renderLeftPanel(); }));
  sec.appendChild(row);
  if (!clip.stickers.length) sec.appendChild(el('p', 'props-note', 'No stickers yet.'));
  for (const sticker of clip.stickers) {
    const ui = STICKERS_UI.find((s) => s.key === sticker.key);
    const box = el('div', 'text-item');
    const startT = el('input', 'clip-time');
    startT.value = formatTime(sticker.start);
    startT.addEventListener('change', () => { pushUndo(); sticker.start = Math.max(0, parseTimeInput(startT.value, sticker.start)); renderClipList(); });
    const endT = el('input', 'clip-time');
    endT.value = formatTime(sticker.end);
    endT.addEventListener('change', () => { pushUndo(); sticker.end = Math.max(sticker.start + 0.1, parseTimeInput(endT.value, sticker.end)); renderClipList(); });
    const remove = button('×', 'btn small danger', () => {
      pushUndo();
      clip.stickers = clip.stickers.filter((s) => s.id !== sticker.id);
      renderClipList();
      if (state.editMode === 'stickers' && state.selectedClipId === clip.id) renderStickerLayer();
    }, 'Remove sticker');
    box.appendChild(makeLine(ui ? ui.emoji : '★', startT, el('span', null, '→'), endT, remove));
    box.appendChild(makeLine('Size', makeSlider(30, Math.max(60, Math.round(sourceDims(clip.sourcePath).w * 0.6)), 1, sticker.size, (v) => {
      sticker.size = v;
      if (state.editMode === 'stickers' && state.selectedClipId === clip.id) positionStickerLayer();
    })));
    sec.appendChild(box);
  }
  body.appendChild(sec);
}

// ---------- Export window ----------
function updateExportReady() {
  const ready = state.clips.length > 0 && !!state.exportFolder;
  btnExportAll.disabled = !ready || W.exportDialog.dataset.busy === '1';
  W.btnExportOpen.disabled = state.clips.length === 0;
}

function openExportDialog() {
  if (!state.clips.length) { setStatus('Add clips to the timeline first.'); return; }
  if (ws.playing) pauseTimeline();
  const st = state.exportSettings;
  setResolution.value = st.resolution;
  setQuality.value = st.quality;
  setCombinedName.value = st.combinedName || W.projectName.value || '9jacut-video';
  W.setModeCombined.checked = st.combine !== false;
  W.setModeSeparate.checked = st.combine === false;
  exportFolderLabel.textContent = state.exportFolder || 'No folder chosen';
  exportFolderLabel.title = state.exportFolder || '';
  if (W.exportDialog.dataset.busy !== '1') {
    W.exportProgressFill.style.width = '0%';
    W.exportStatus.textContent = '';
  }
  updateExportSummary();
  updateExportReady();
  W.exportDialog.classList.remove('hidden');
}

function closeExportDialog() {
  W.exportDialog.classList.add('hidden');
}

function updateExportSummary() {
  const combined = W.setModeCombined.checked;
  const res = setResolution.options[setResolution.selectedIndex].textContent;
  W.exportSummary.textContent = combined
    ? `One video · ${state.clips.length} clip${state.clips.length > 1 ? 's' : ''} · about ${formatTime(timelineDuration())} · ${res}`
    : `${state.clips.length} separate file${state.clips.length > 1 ? 's' : ''} · ${res}`;
}

W.btnExportOpen.addEventListener('click', openExportDialog);
W.btnExportClose.addEventListener('click', closeExportDialog);
W.btnExportCancel.addEventListener('click', closeExportDialog);
W.exportDialog.addEventListener('pointerdown', (e) => { if (e.target === W.exportDialog) closeExportDialog(); });
setResolution.addEventListener('change', () => { state.exportSettings.resolution = setResolution.value; updateExportSummary(); });
setQuality.addEventListener('change', () => { state.exportSettings.quality = setQuality.value; });
setCombinedName.addEventListener('change', () => { state.exportSettings.combinedName = setCombinedName.value.trim(); });
for (const r of [W.setModeCombined, W.setModeSeparate]) {
  r.addEventListener('change', () => { state.exportSettings.combine = W.setModeCombined.checked; updateExportSummary(); });
}

btnExportFolder.addEventListener('click', async () => {
  const folder = await window.nineJaCut.selectExportFolder();
  if (!folder) return;
  state.exportFolder = folder;
  exportFolderLabel.textContent = folder;
  exportFolderLabel.title = folder;
  updateExportReady();
});

const exportProgress = { done: new Set(), current: {}, total: 0, combined: false };

window.nineJaCut.onExportProgress(({ id, status, percent, message }) => {
  if (status === 'error') {
    W.exportStatus.textContent = `Export failed: ${message}`;
    W.exportStatus.className = 'modal-status error';
    return;
  }
  if (id === 'combined') {
    if (status === 'running') {
      W.exportProgressFill.style.width = `${80 + (percent || 0) * 0.2}%`;
      W.exportStatus.textContent = `Joining everything into one video… ${percent}%`;
    }
    return;
  }
  if (status === 'done') exportProgress.done.add(id);
  if (typeof percent === 'number') exportProgress.current[id] = percent;
  const n = Math.max(1, exportProgress.total);
  const finished = exportProgress.done.size;
  const partial = status === 'running' ? (percent || 0) / 100 : 0;
  const share = exportProgress.combined ? 80 : 100;
  W.exportProgressFill.style.width = `${Math.min(share, ((finished + partial) / n) * share)}%`;
  const idx = state.clips.findIndex((c) => c.id === id);
  if (status === 'running') W.exportStatus.textContent = `${exportProgress.combined ? 'Rendering' : 'Exporting'} clip ${idx + 1} of ${n}… ${percent}%`;
});

btnExportAll.addEventListener('click', async () => {
  if (!state.exportFolder || !state.clips.length) return;
  const settings = { ...state.exportSettings, combine: W.setModeCombined.checked, combinedName: setCombinedName.value.trim() || W.projectName.value || '9jacut-video' };
  W.exportDialog.dataset.busy = '1';
  updateExportReady();
  exportProgress.done = new Set();
  exportProgress.current = {};
  exportProgress.total = state.clips.length;
  exportProgress.combined = settings.combine;
  W.exportStatus.className = 'modal-status';
  W.exportStatus.textContent = 'Starting…';
  W.exportProgressFill.style.width = '0%';
  setStatus(settings.combine ? 'Exporting your video…' : 'Exporting clips…');
  const results = await window.nineJaCut.exportClips({ exportFolder: state.exportFolder, clips: state.clips.map(serializeClip), settings });
  W.exportDialog.dataset.busy = '0';
  updateExportReady();
  const ok = results.filter((r) => r.ok);
  let msg;
  if (settings.combine) {
    msg = ok.length ? `Done! Saved ${ok[0].outPath}` : `Export failed: ${results[0] ? results[0].error : 'unknown error'}`;
  } else {
    msg = `Done! Exported ${ok.length} of ${results.length} clip${results.length > 1 ? 's' : ''} to ${state.exportFolder}`;
  }
  const warnings = results.flatMap((r) => r.warnings || []);
  if (warnings.length) msg += ` — Note: ${warnings.join(' ')}`;
  W.exportStatus.textContent = msg;
  W.exportStatus.className = `modal-status ${ok.length ? 'done' : 'error'}`;
  if (ok.length) W.exportProgressFill.style.width = '100%';
  setStatus(msg);
  if (ok.length) window.nineJaCut.openFolder(state.exportFolder);
});

// ---------- Projects ----------
function projectData() {
  return {
    version: 3,
    name: W.projectName.value.trim() || 'Untitled project',
    sources: state.sources.map((s) => ({ path: s.path, name: s.name, duration: s.duration, width: s.width, height: s.height })),
    audioLibrary: ws.audioLibrary.map((a) => ({ path: a.path, name: a.name, duration: a.duration })),
    exportFolder: state.exportFolder,
    exportSettings: { ...state.exportSettings },
    clips: state.clips.map(serializeClip),
  };
}

btnSaveProject.addEventListener('click', async () => {
  closeMenu();
  const savedPath = await window.nineJaCut.saveProject(projectData());
  if (savedPath) setStatus(`Project saved to ${savedPath}`);
});

btnLoadProject.addEventListener('click', async () => {
  closeMenu();
  const data = await window.nineJaCut.loadProject();
  if (!data) return;
  pauseTimeline();
  exitSourcePreview(false);
  exitEditModes();

  state.sources = [];
  for (const s of (data.sources || [])) {
    try {
      const fileUrl = await window.nineJaCut.toFileUrl(s.path);
      state.sources.push({ ...s, url: fileUrl });
    } catch (e) { /* skip files that can no longer be found */ }
  }
  ws.audioLibrary = [];
  for (const a of (data.audioLibrary || [])) {
    try { ws.audioLibrary.push({ ...a, url: await window.nineJaCut.toFileUrl(a.path) }); } catch (e) { /* skip */ }
  }
  const legacy = data.exportSettings || {};
  state.clips = (data.clips || []).map((c) => {
    const clip = { thumbUrl: null, stickers: [], ...c };
    // v1.x projects had one transition for the whole video.
    if (!clip.transitionOut && legacy.combine && legacy.transition && legacy.transition !== 'none') {
      clip.transitionOut = { type: legacy.transition, duration: legacy.transitionDuration || 0.5 };
    }
    return normalizeClip(clip);
  });
  if (state.clips.length) state.clips[state.clips.length - 1].transitionOut.type = state.clips[state.clips.length - 1].transitionOut.type || 'none';
  state.exportSettings = { ...state.exportSettings, ...legacy };
  if (data.version < 3) state.exportSettings.combine = true;
  state.exportFolder = data.exportFolder || null;
  W.projectName.value = data.name || 'Untitled project';
  undoStack.length = 0;
  redoStack.length = 0;
  updateUndoButton();
  state.previewClipId = null;
  ws.focusClipId = null;
  ws.time = 0;
  for (const src of state.sources) {
    if (!src.duration) importVideo(src.path, src.url, src.name);
    else if (!src.thumbUrl) {
      window.nineJaCut.generateThumbnail({ sourcePath: src.path, time: Math.min(1, src.duration / 2) })
        .then((t) => { src.thumbUrl = t; if (ws.tab === 'media') renderLeftPanel(); }).catch(() => {});
    }
  }
  for (const c of state.clips) refreshThumbnail(c);
  if (state.sources.length) dropHint.classList.add('hidden');
  renderClipList();
  renderLeftPanel();
  fitTimeline();
  await seekTimeline(0);
  setStatus(`Opened “${W.projectName.value}”`);
});

W.btnNewProject.addEventListener('click', () => {
  closeMenu();
  if (state.clips.length && !window.confirm('Start a new project? Unsaved changes in this one will be lost.')) return;
  pauseTimeline();
  exitSourcePreview(false);
  exitEditModes();
  state.sources = [];
  state.clips = [];
  state.activeSourcePath = null;
  state.previewClipId = null;
  ws.audioLibrary = [];
  ws.focusClipId = null;
  ws.time = 0;
  undoStack.length = 0;
  redoStack.length = 0;
  updateUndoButton();
  video.removeAttribute('src');
  video.load();
  dropHint.classList.remove('hidden');
  W.projectName.value = 'Untitled project';
  renderClipList();
  renderLeftPanel();
  setStatus('New project');
});

W.projectName.addEventListener('change', () => { if (!focusedClip()) renderProperties(); });

// ---------- Menu ----------
function closeMenu() { W.menuDropdown.classList.add('hidden'); }
W.btnMenu.addEventListener('click', (e) => { e.stopPropagation(); W.menuDropdown.classList.toggle('hidden'); });
document.addEventListener('pointerdown', (e) => { if (!e.target.closest('.menu-wrap')) closeMenu(); });
W.btnMenuAbout.addEventListener('click', () => { closeMenu(); switchMode('about'); });
W.btnRedo.addEventListener('click', redo);

// ---------- Keyboard shortcuts ----------
const SHORTCUTS_TEXT = 'Shortcuts: Space play/pause · S or Ctrl+B split · Delete remove clip · Ctrl+D duplicate · ←/→ 1s (Shift: 5s) · , / . one frame · Home/End · +/− zoom timeline · I/O mark in/out (in preview) · Enter add to timeline · Ctrl+Z undo · Ctrl+Y redo · Ctrl+S save · Ctrl+O import · Ctrl+E export · Esc close';

btnShortcuts.addEventListener('click', () => { closeMenu(); setStatus(SHORTCUTS_TEXT); });

window.addEventListener('keydown', (e) => {
  const tag = (e.target && e.target.tagName ? e.target.tagName : '').toLowerCase();
  const typing = tag === 'input' || tag === 'textarea' || tag === 'select' || (e.target && e.target.isContentEditable);
  const mod = e.ctrlKey || e.metaKey;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;

  if (key === 'Escape') {
    if (!W.exportDialog.classList.contains('hidden')) { closeExportDialog(); return; }
    closeMenu();
    if (state.editMode) { exitEditModes(); return; }
    if (!typing && ws.mode === 'source') { exitSourcePreview(true); return; }
  }
  if (mod && key === 's') { e.preventDefault(); btnSaveProject.click(); return; }
  if (mod && key === 'o') { e.preventDefault(); btnOpenVideo.click(); return; }
  if (mod && key === 'e') { e.preventDefault(); openExportDialog(); return; }
  if (typing || e.altKey) return;
  if (mod && key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return; }
  if (mod && (key === 'y' || (key === 'z' && e.shiftKey))) { e.preventDefault(); redo(); return; }
  if (mod && key === 'd') { e.preventDefault(); duplicateFocusedClip(); return; }
  if (mod && key === 'b') { e.preventDefault(); splitAtPlayhead(); return; }
  if (mod) return;
  if (clipEditorView.classList.contains('hidden') || !W.exportDialog.classList.contains('hidden')) return;

  // Keep Space from also "clicking" whichever button has focus.
  if (tag === 'button' && (key === ' ' || key === 'Enter')) e.target.blur();

  switch (key) {
    case ' ': e.preventDefault(); togglePlay(); break;
    case 's': splitAtPlayhead(); break;
    case 'Delete':
    case 'Backspace': e.preventDefault(); deleteFocusedClip(); break;
    case 'i': if (ws.mode === 'source') btnMarkIn.click(); break;
    case 'o': if (ws.mode === 'source') btnMarkOut.click(); break;
    case 'Enter':
      e.preventDefault();
      if (ws.mode === 'source' && !btnAddClip.disabled) btnAddClip.click();
      break;
    case 'ArrowLeft': e.preventDefault(); seekBy(e.shiftKey ? -5 : -1); break;
    case 'ArrowRight': e.preventDefault(); seekBy(e.shiftKey ? 5 : 1); break;
    case ',': if (ws.playing) pauseTimeline(); video.pause(); seekBy(-1 / 30); break;
    case '.': if (ws.playing) pauseTimeline(); video.pause(); seekBy(1 / 30); break;
    case 'Home': if (ws.mode === 'source') video.currentTime = 0; else { pauseTimeline(); seekTimeline(0); } break;
    case 'End': if (ws.mode === 'source') { if (video.duration) video.currentTime = video.duration; } else { pauseTimeline(); seekTimeline(timelineDuration()); } break;
    case '+':
    case '=': setZoom(ws.pxPerSec * 1.25); break;
    case '-': setZoom(ws.pxPerSec / 1.25); break;
    case '?': setStatus(SHORTCUTS_TEXT); break;
    default: break;
  }
});

// Leaving the editor stops playback.
for (const tab of [tabPromoVideo, tabAbout]) tab.addEventListener('click', () => { pauseTimeline(); });

// ---------- Start-up ----------
initTheme();
loadCaptionPrefs();
refreshCaptionsInfo().then(() => { renderProperties(); if (ws.tab === 'captions') renderLeftPanel(); });
initAbout();
switchMode('clip');
initStickerPicker().then(() => { if (ws.tab === 'stickers') renderLeftPanel(); });
initPromo();
renderToolTabs();
renderLeftPanel();
renderClipList();
updateTimeLabel();
updateUndoButton();
