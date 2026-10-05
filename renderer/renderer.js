// ---------- Aspect ratio presets ----------
const ASPECT_PRESETS = {
  vertical: { w: 9, h: 16, label: 'Vertical 9:16' },
  square: { w: 1, h: 1, label: 'Square 1:1' },
  portrait: { w: 4, h: 5, label: 'Portrait 4:5' },
  landscape: { w: 16, h: 9, label: 'Landscape 16:9' },
};
const ASPECT_OPTIONS = [
  ['original', 'Original'],
  ['vertical', ASPECT_PRESETS.vertical.label],
  ['square', ASPECT_PRESETS.square.label],
  ['portrait', ASPECT_PRESETS.portrait.label],
  ['landscape', ASPECT_PRESETS.landscape.label],
  ['custom', 'Custom'],
];

// ---------- Sticker presets (emoji shown in the picker; actual composited
// image comes from the bundled PNG main.js resolves for this key) ----------
const STICKERS_UI = [
  { key: 'happy', emoji: '😀' },
  { key: 'laughing', emoji: '😂' },
  { key: 'heart_eyes', emoji: '😍' },
  { key: 'cool', emoji: '😎' },
  { key: 'surprised', emoji: '😮' },
  { key: 'wink', emoji: '😉' },
  { key: 'crying_laughing', emoji: '🤣' },
  { key: 'sad', emoji: '😢' },
  { key: 'angry', emoji: '😠' },
  { key: 'heart', emoji: '❤️' },
  { key: 'fire', emoji: '🔥' },
  { key: 'star', emoji: '⭐' },
  { key: 'thumbs_up', emoji: '👍' },
  { key: 'hundred', emoji: '💯' },
];

// ---------- Effects presets ----------
const SPEED_OPTIONS = [
  ['0.25', '0.25x (slow-mo)'], ['0.5', '0.5x'], ['0.75', '0.75x'], ['1', '1x (normal)'],
  ['1.25', '1.25x'], ['1.5', '1.5x'], ['2', '2x'], ['3', '3x'], ['4', '4x'],
];
const FADE_OPTIONS = [['0', 'None'], ['0.5', '0.5s'], ['1', '1s'], ['2', '2s']];
const LOOK_OPTIONS = [
  ['none', 'No look'], ['vivid', 'Vivid'], ['warm', 'Warm'], ['cool', 'Cool'],
  ['gold', 'Naija Gold'], ['cinematic', 'Cinematic'], ['vintage', 'Vintage'],
  ['faded', 'Faded film'], ['bw', 'Black & white'],
];
// CSS approximation of each look, for the live preview only. The exported
// video uses the matching ffmpeg filters in clip-export.js.
const LOOK_PREVIEW = {
  none: '',
  vivid: 'saturate(1.35) contrast(1.08)',
  warm: 'sepia(0.18) saturate(1.12)',
  cool: 'hue-rotate(-12deg) saturate(0.95) brightness(1.02)',
  gold: 'sepia(0.28) saturate(1.3) contrast(1.05)',
  cinematic: 'contrast(1.15) saturate(0.85) brightness(0.95)',
  vintage: 'sepia(0.35) contrast(0.95) saturate(0.9)',
  faded: 'contrast(0.88) brightness(1.04) saturate(0.8)',
  bw: 'grayscale(1) contrast(1.1)',
};
const MOTION_OPTIONS = [['none', 'None'], ['zoomin', 'Slow zoom in'], ['zoomout', 'Slow zoom out'], ['punchin', 'Fast zoom in']];
const MOTION_PREVIEW = { zoomin: [0.15, 1], zoomout: [0.15, -1], punchin: [0.35, 1] };
const TEXT_POSITION_OPTIONS = [['top', 'Top'], ['center', 'Middle'], ['bottom', 'Bottom']];
const TEXT_STYLE_OPTIONS = [['outline', 'Outline'], ['box', 'Box'], ['plain', 'Plain']];

// ---------- State ----------
const state = {
  sources: [], // { path, url, name }
  activeSourcePath: null,
  videoWidth: 0,
  videoHeight: 0,
  inPoint: null,
  outPoint: null,
  clips: [],
  selectedClipId: null,
  editMode: null, // 'reframe' | 'stickers' | null
  exportFolder: null,
  scrubbing: false,
  dragging: false,
  dragAxis: 'none',
  dragStartX: 0,
  dragStartY: 0,
  dragStartCropX: 0,
  dragStartCropY: 0,
  draggingSticker: false,
  dragStickerId: null,
  dragStickerStartX: 0,
  dragStickerStartY: 0,
  dragStickerOrigX: 0,
  dragStickerOrigY: 0,
  pendingSnapshot: null,
  stickerAssets: {}, // key -> fileUrl
  previewClipId: null, // clip whose effects the preview should prefer
  exportSettings: {
    resolution: 'source',
    quality: 'high',
    combine: true,
    transition: 'none',
    transitionDuration: 0.5,
    combinedName: '',
  },
};

// Fills in defaults for fields added after v1.0 (old projects, new clips).
function normalizeClip(clip) {
  if (!Array.isArray(clip.stickers)) clip.stickers = [];
  if (!Array.isArray(clip.texts)) clip.texts = [];
  if (typeof clip.speed !== 'number' || !isFinite(clip.speed)) clip.speed = 1;
  clip.look = { preset: 'none', brightness: 0, contrast: 1, saturation: 1, ...(clip.look || {}) };
  clip.fade = { in: 0, out: 0, ...(clip.fade || {}) };
  if (typeof clip.origVolume !== 'number') clip.origVolume = 1;
  clip.denoise = !!clip.denoise;
  if (!MOTION_PREVIEW[clip.motion]) clip.motion = 'none';
  if (clip.captions === undefined) clip.captions = null;
  if (clip.voiceover === undefined) clip.voiceover = null;
  if (!clip.transitionOut || typeof clip.transitionOut !== 'object') clip.transitionOut = { type: 'none', duration: 0.5 };
  if (clip.audio && typeof clip.audio.loop !== 'boolean') clip.audio.loop = true;
  return clip;
}

// Length of the finished clip after any speed change.
function clipOutputDuration(clip) {
  return Math.max(0.1, clip.end - clip.start) / (clip.speed || 1);
}

// Clip data sent to export / saved in projects (everything but UI-only bits).
function serializeClip(c) {
  const copy = cloneClips([c])[0];
  delete copy.thumbUrl;
  return copy;
}

let textCounter = 0;

let clipCounter = 0;
let stickerCounter = 0;

// ---------- Undo history ----------
const undoStack = [];
const HISTORY_LIMIT = 40;

function cloneClips(clips) {
  return typeof structuredClone === 'function'
    ? structuredClone(clips)
    : JSON.parse(JSON.stringify(clips));
}

const redoStack = [];

function updateUndoButton() {
  btnUndo.disabled = undoStack.length === 0;
  const btnRedoEl = document.getElementById('btnRedo');
  if (btnRedoEl) btnRedoEl.disabled = redoStack.length === 0;
}

function pushUndo() {
  redoStack.length = 0;
  undoStack.push(cloneClips(state.clips));
  if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
  state.pendingSnapshot = null;
  updateUndoButton();
}

function armSnapshot() {
  state.pendingSnapshot = cloneClips(state.clips);
}

function commitSnapshotIfArmed() {
  if (state.pendingSnapshot) {
    redoStack.length = 0;
    undoStack.push(state.pendingSnapshot);
    if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
    state.pendingSnapshot = null;
    updateUndoButton();
  }
}

function undo() {
  if (!undoStack.length) return;
  redoStack.push(cloneClips(state.clips));
  state.clips = undoStack.pop();
  if (state.selectedClipId && !state.clips.find((c) => c.id === state.selectedClipId)) {
    exitEditModes();
  }
  renderClipList();
  if (state.editMode === 'reframe') positionCropOverlay();
  if (state.editMode === 'stickers') { renderStickerLayer(); positionStickerLayer(); }
  updatePreviewFx();
  updateUndoButton();
  setStatus('Undid last change');
}

function redo() {
  if (!redoStack.length) return;
  undoStack.push(cloneClips(state.clips));
  state.clips = redoStack.pop();
  renderClipList();
  updatePreviewFx();
  updateUndoButton();
  setStatus('Redid change');
}

// ---------- Element refs ----------
const video = document.getElementById('preview');
const videoStage = document.getElementById('videoStage');
const dropHint = document.getElementById('dropHint');
const cropOverlay = document.getElementById('cropOverlay');
const reframeBadge = document.getElementById('reframeBadge');
const reframeControls = document.getElementById('reframeControls');
const reframeClipName = document.getElementById('reframeClipName');
const stickerLayer = document.getElementById('stickerLayer');
const stickerBadge = document.getElementById('stickerBadge');
const stickerControls = document.getElementById('stickerControls');
const stickerClipName = document.getElementById('stickerClipName');
const stickerPicker = document.getElementById('stickerPicker');
const btnDoneStickers = document.getElementById('btnDoneStickers');

const btnUndo = document.getElementById('btnUndo');
const btnThemeToggle = document.getElementById('btnThemeToggle');
const btnOpenVideo = document.getElementById('btnOpenVideo');
const btnSaveProject = document.getElementById('btnSaveProject');
const btnLoadProject = document.getElementById('btnLoadProject');
const btnExportFolder = document.getElementById('btnExportFolder');
const exportFolderLabel = document.getElementById('exportFolderLabel');
const btnExportAll = document.getElementById('btnExportAll');

const btnPlayPause = document.getElementById('btnPlayPause');
const seekBar = document.getElementById('seekBar');
const timeLabel = document.getElementById('timeLabel');

const btnMarkIn = document.getElementById('btnMarkIn');
const btnMarkOut = document.getElementById('btnMarkOut');
const inLabel = document.getElementById('inLabel');
const outLabel = document.getElementById('outLabel');
const durationLabel = document.getElementById('durationLabel');
const btnAddClip = document.getElementById('btnAddClip');

const btnResetCrop = document.getElementById('btnResetCrop');
const btnDoneReframe = document.getElementById('btnDoneReframe');

const textLayer = document.getElementById('textLayer');
const btnShortcuts = document.getElementById('btnShortcuts');
const setResolution = document.getElementById('setResolution');
const setQuality = document.getElementById('setQuality');
const setCombinedName = document.getElementById('setCombinedName');
const statusBar = document.getElementById('statusBar');

// ---------- Theme ----------
const THEME_KEY = '9jacut-theme';

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  btnThemeToggle.textContent = theme === 'dark' ? '🌙' : '☀️';
  try { localStorage.setItem(THEME_KEY, theme); } catch (e) { /* ignore */ }
}

function initTheme() {
  let saved = null;
  try { saved = localStorage.getItem(THEME_KEY); } catch (e) { /* ignore */ }
  applyTheme(saved === 'light' ? 'light' : 'dark');
}

btnThemeToggle.addEventListener('click', () => {
  const current = document.documentElement.getAttribute('data-theme');
  applyTheme(current === 'dark' ? 'light' : 'dark');
});

btnUndo.addEventListener('click', undo);

// ---------- Helpers ----------
function formatTime(seconds) {
  if (!isFinite(seconds) || seconds < 0) seconds = 0;
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${String(m).padStart(2, '0')}:${s.toFixed(1).padStart(4, '0')}`;
}

function parseTimeInput(str, fallback) {
  str = String(str).trim();
  if (!str) return fallback;
  if (str.includes(':')) {
    const [mm, ss] = str.split(':');
    const m = parseFloat(mm) || 0;
    const s = parseFloat(ss) || 0;
    return m * 60 + s;
  }
  const n = parseFloat(str);
  return isNaN(n) ? fallback : n;
}

function setStatus(msg) {
  statusBar.textContent = msg;
}

function getRatioForClip(clip) {
  if (clip.aspect === 'custom') return clip.customRatio || { w: 16, h: 9 };
  return ASPECT_PRESETS[clip.aspect] || null;
}

function sourceDims(sourcePath) {
  const src = state.sources.find((s) => s.path === sourcePath);
  if (src && src.width && src.height) return { w: src.width, h: src.height };
  if (sourcePath === state.activeSourcePath && state.videoWidth) return { w: state.videoWidth, h: state.videoHeight };
  return { w: 1920, h: 1080 };
}

function defaultCropForRatio(rw, rh, dims) {
  const vw = (dims && dims.w) || state.videoWidth || 1920;
  const vh = (dims && dims.h) || state.videoHeight || 1080;
  const sourceAspect = vw / vh;
  const targetAspect = rw / rh;
  let w = vw;
  let h = vh;
  let x = 0;
  let y = 0;
  if (targetAspect < sourceAspect) {
    h = vh;
    w = Math.round(vh * targetAspect);
    x = Math.round((vw - w) / 2);
    y = 0;
  } else if (targetAspect > sourceAspect) {
    w = vw;
    h = Math.round(vw / targetAspect);
    x = 0;
    y = Math.round((vh - h) / 2);
  }
  return { x, y, w, h };
}

function ensureCropForClip(clip) {
  if (clip.aspect === 'original') return;
  if (clip.aspect === 'custom' && !clip.customRatio) clip.customRatio = { w: 16, h: 9 };
  const ratio = getRatioForClip(clip);
  clip.crop = defaultCropForRatio(ratio.w, ratio.h, sourceDims(clip.sourcePath));
}

function getCropAxis(clip) {
  if (!clip.crop) return 'none';
  const vw = state.videoWidth || 1920;
  const vh = state.videoHeight || 1080;
  if (clip.crop.w < vw - 1) return 'x';
  if (clip.crop.h < vh - 1) return 'y';
  return 'none';
}

function updateDurationLabel() {
  if (state.inPoint != null && state.outPoint != null && state.outPoint > state.inPoint) {
    durationLabel.textContent = `Duration: ${formatTime(state.outPoint - state.inPoint)}`;
  } else {
    durationLabel.textContent = 'Duration: --:--';
  }
}

function resetMarks() {
  state.inPoint = null;
  state.outPoint = null;
  inLabel.textContent = 'In: --:--';
  outLabel.textContent = 'Out: --:--';
  updateDurationLabel();
  btnAddClip.disabled = true;
}

// ---------- Multi-source video handling ----------
async function addSource(filePath, fileUrl, fileName) {
  let source = state.sources.find((s) => s.path === filePath);
  if (!source) {
    source = { path: filePath, url: fileUrl, name: fileName };
    state.sources.push(source);
  }
  return source;
}

function switchActiveSource(sourcePath) {
  return new Promise((resolve) => {
    const source = state.sources.find((s) => s.path === sourcePath);
    if (!source) { resolve(); return; }
    if (state.activeSourcePath === sourcePath && video.currentSrc) {
      resolve();
      return;
    }
    state.activeSourcePath = sourcePath;
    dropHint.classList.add('hidden');
    const onLoaded = () => {
      video.removeEventListener('loadedmetadata', onLoaded);
      resolve();
    };
    video.addEventListener('loadedmetadata', onLoaded);
    video.src = source.url;
  });
}

async function loadVideo(filePath, fileUrl, fileName) {
  await addSource(filePath, fileUrl, fileName);
  await switchActiveSource(filePath);
  resetMarks();
  setStatus(`Loaded ${fileName}`);
}

video.addEventListener('loadedmetadata', () => {
  state.videoWidth = video.videoWidth;
  state.videoHeight = video.videoHeight;
  updateTimeLabel();
});

video.addEventListener('error', () => {
  if (state.activeSourcePath) {
    setStatus('This format won’t preview inline (try converting to .mp4), but you can still export it once you set times manually.');
  }
});

// ---------- Mark in/out ----------
btnMarkIn.addEventListener('click', () => {
  if (!state.activeSourcePath) return;
  state.inPoint = video.currentTime;
  inLabel.textContent = `In: ${formatTime(state.inPoint)}`;
  updateDurationLabel();
  refreshAddClipEnabled();
});
btnMarkOut.addEventListener('click', () => {
  if (!state.activeSourcePath) return;
  state.outPoint = video.currentTime;
  outLabel.textContent = `Out: ${formatTime(state.outPoint)}`;
  updateDurationLabel();
  refreshAddClipEnabled();
});

function refreshAddClipEnabled() {
  btnAddClip.disabled = !(
    state.inPoint != null && state.outPoint != null && state.outPoint > state.inPoint
  );
}

function refreshThumbnail(clip) {
  if (!clip.sourcePath) return;
  window.nineJaCut.generateThumbnail({ sourcePath: clip.sourcePath, time: clip.start }).then((fileUrl) => {
    if (!fileUrl) return;
    clip.thumbUrl = fileUrl;
    if (typeof renderTimeline === 'function') renderTimeline();
  }).catch(() => {});
}

btnAddClip.addEventListener('click', () => {
  if (!state.activeSourcePath) return;
  pushUndo();
  clipCounter += 1;
  const clip = {
    id: `clip-${clipCounter}-${Date.now()}`,
    name: `Clip ${clipCounter}`,
    sourcePath: state.activeSourcePath,
    start: state.inPoint,
    end: state.outPoint,
    aspect: 'original',
    customRatio: { w: 16, h: 9 },
    crop: null,
    audio: null,
    stickers: [],
    thumbUrl: null,
  };
  normalizeClip(clip);
  state.clips.push(clip);
  resetMarks();
  renderClipList();
  refreshThumbnail(clip);
  afterClipAdded(clip);
  setStatus(`Added ${clip.name} to the timeline`);
});

// ---------- Effects panel (speed, look, fades, sound, text) ----------
const openFxPanels = new Set();

function makeSelect(options, value, onChange, className = 'aspect-select') {
  const sel = document.createElement('select');
  sel.className = className;
  for (const [val, label] of options) {
    const opt = document.createElement('option');
    opt.value = val;
    opt.textContent = label;
    if (String(value) === String(val)) opt.selected = true;
    sel.appendChild(opt);
  }
  sel.addEventListener('change', () => onChange(sel.value));
  return sel;
}

function makeLine(labelText, ...children) {
  const line = document.createElement('div');
  line.className = 'fx-line';
  if (labelText) {
    const label = document.createElement('span');
    label.className = 'fx-label';
    label.textContent = labelText;
    line.appendChild(label);
  }
  for (const child of children) line.appendChild(child);
  return line;
}

// A range slider that records one undo step per drag.
function makeSlider(min, max, step, value, onInput) {
  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = String(min);
  slider.max = String(max);
  slider.step = String(step);
  slider.value = String(value);
  slider.addEventListener('pointerdown', () => armSnapshot());
  slider.addEventListener('keydown', () => armSnapshot());
  slider.addEventListener('input', () => {
    commitSnapshotIfArmed();
    onInput(Number(slider.value));
  });
  return slider;
}

function makeCheck(labelText, checked, onChange) {
  const label = document.createElement('label');
  label.className = 'mute-toggle';
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.checked = checked;
  box.addEventListener('change', () => onChange(box.checked));
  label.appendChild(box);
  label.appendChild(document.createTextNode(labelText));
  return label;
}

function fxSummaryText(clip) {
  const bits = [];
  if (clip.speed !== 1) bits.push(`${clip.speed}x`);
  if (clip.look.preset !== 'none') {
    const found = LOOK_OPTIONS.find(([k]) => k === clip.look.preset);
    bits.push(found ? found[1] : clip.look.preset);
  }
  const textCount = clip.texts.filter((t) => String(t.text || '').trim()).length;
  if (textCount) bits.push(`${textCount} text${textCount > 1 ? 's' : ''}`);
  if (clip.motion !== 'none') bits.push('zoom');
  if (clip.captions && clip.captions.lines && clip.captions.lines.length) bits.push('captions');
  if (clip.voiceover) bits.push('voiceover');
  if (clip.fade.in || clip.fade.out) bits.push('fades');
  if (clip.denoise) bits.push('clean audio');
  return `✨ Effects${bits.length ? ` · ${bits.join(' · ')}` : ': captions, text, speed, look, zoom'}`;
}

// Move the playhead into a clip so its effects show in the preview.
async function previewClip(clip, outputTime = 0) {
  state.previewClipId = clip.id;
  const local = Math.min(Math.max(0, outputTime), clipOutputDuration(clip) - 0.05);
  const inside = clip.sourcePath === state.activeSourcePath && video.currentTime >= clip.start && video.currentTime <= clip.end;
  if (!inside) await seekToClip(clip, local);
  updatePreviewFx();
}

function buildFxSection(clip) {
  const details = document.createElement('details');
  details.className = 'fx-section';
  details.open = openFxPanels.has(clip.id);
  const summary = document.createElement('summary');
  summary.textContent = fxSummaryText(clip);
  details.appendChild(summary);
  details.addEventListener('toggle', () => {
    if (details.open) {
      openFxPanels.add(clip.id);
      previewClip(clip);
    } else {
      openFxPanels.delete(clip.id);
    }
  });
  const refreshSummary = () => { summary.textContent = fxSummaryText(clip); };
  const changed = () => { refreshSummary(); updatePreviewFx(); };

  // Speed
  const lengthNote = document.createElement('span');
  lengthNote.className = 'fx-note';
  const updateLengthNote = () => {
    lengthNote.textContent = clip.speed === 1 ? '' : `→ ${formatTime(clipOutputDuration(clip))} long`;
  };
  updateLengthNote();
  const speedSel = makeSelect(SPEED_OPTIONS, clip.speed, (v) => {
    pushUndo();
    clip.speed = Number(v);
    updateLengthNote();
    changed();
  });
  details.appendChild(makeLine('Speed', speedSel, lengthNote));

  // Motion (zoom)
  const motionSel = makeSelect(MOTION_OPTIONS, clip.motion, (v) => { pushUndo(); clip.motion = v; changed(); });
  motionSel.title = 'A smooth zoom across the whole clip';
  details.appendChild(makeLine('Motion', motionSel));

  // Fades
  const fadeIn = makeSelect(FADE_OPTIONS, clip.fade.in, (v) => { pushUndo(); clip.fade.in = Number(v); changed(); });
  const fadeOut = makeSelect(FADE_OPTIONS, clip.fade.out, (v) => { pushUndo(); clip.fade.out = Number(v); changed(); });
  details.appendChild(makeLine('Fade in', fadeIn, document.createTextNode('out'), fadeOut));

  // Look
  const lookSel = makeSelect(LOOK_OPTIONS, clip.look.preset, (v) => { pushUndo(); clip.look.preset = v; changed(); });
  const resetLook = document.createElement('button');
  resetLook.className = 'btn small';
  resetLook.textContent = 'Reset';
  resetLook.title = 'Clear the look and adjustments';
  resetLook.addEventListener('click', () => {
    pushUndo();
    clip.look = { preset: 'none', brightness: 0, contrast: 1, saturation: 1 };
    renderClipList();
    updatePreviewFx();
  });
  details.appendChild(makeLine('Look', lookSel, resetLook));
  details.appendChild(makeLine('Brightness', makeSlider(-0.3, 0.3, 0.01, clip.look.brightness, (v) => { clip.look.brightness = v; changed(); })));
  details.appendChild(makeLine('Contrast', makeSlider(0.5, 1.5, 0.01, clip.look.contrast, (v) => { clip.look.contrast = v; changed(); })));
  details.appendChild(makeLine('Saturation', makeSlider(0, 2, 0.01, clip.look.saturation, (v) => { clip.look.saturation = v; changed(); })));

  // Sound
  const volValue = document.createElement('span');
  volValue.className = 'fx-note';
  volValue.textContent = `${Math.round(clip.origVolume * 100)}%`;
  const volSlider = makeSlider(0, 2, 0.05, clip.origVolume, (v) => {
    clip.origVolume = v;
    volValue.textContent = `${Math.round(v * 100)}%`;
  });
  details.appendChild(makeLine('Video sound', volSlider, volValue));
  details.appendChild(makeLine('', makeCheck('Reduce background noise', clip.denoise, (on) => {
    pushUndo();
    clip.denoise = on;
    refreshSummary();
  })));
  details.appendChild(buildVoiceoverLine(clip));

  // Captions
  details.appendChild(buildCaptionsSection(clip, changed));

  // Text
  const textHeader = document.createElement('div');
  textHeader.className = 'fx-line fx-subhead';
  const textTitle = document.createElement('span');
  textTitle.className = 'fx-label';
  textTitle.textContent = 'Text';
  const addTextBtn = document.createElement('button');
  addTextBtn.className = 'btn small';
  addTextBtn.textContent = '+ Add Text';
  addTextBtn.addEventListener('click', () => {
    pushUndo();
    textCounter += 1;
    clip.texts.push({
      id: `text-${textCounter}-${Date.now()}`,
      text: 'Your text here',
      size: 7,
      color: '#ffffff',
      position: 'bottom',
      style: 'outline',
      start: 0,
      end: clipOutputDuration(clip),
    });
    renderClipList();
    previewClip(clip);
    const boxes = document.querySelectorAll(`[data-text-clip="${clip.id}"]`);
    if (boxes.length) { boxes[boxes.length - 1].focus(); boxes[boxes.length - 1].select(); }
  });
  textHeader.appendChild(textTitle);
  textHeader.appendChild(addTextBtn);
  details.appendChild(textHeader);

  for (const t of clip.texts) details.appendChild(buildTextEditor(clip, t, changed));
  return details;
}

function buildTextEditor(clip, t, changed) {
  const wrap = document.createElement('div');
  wrap.className = 'text-item';

  const area = document.createElement('textarea');
  area.rows = 2;
  area.value = t.text;
  area.dataset.textClip = clip.id;
  area.placeholder = 'Type your text (Enter for a new line)';
  area.addEventListener('focus', () => { armSnapshot(); previewClip(clip, t.start); });
  area.addEventListener('input', () => {
    commitSnapshotIfArmed();
    t.text = area.value;
    changed();
  });
  wrap.appendChild(area);

  const color = document.createElement('input');
  color.type = 'color';
  color.value = /^#[0-9a-f]{6}$/i.test(t.color) ? t.color : '#ffffff';
  color.title = 'Text color';
  color.addEventListener('pointerdown', () => armSnapshot());
  color.addEventListener('input', () => { commitSnapshotIfArmed(); t.color = color.value; changed(); });
  const posSel = makeSelect(TEXT_POSITION_OPTIONS, t.position, (v) => { pushUndo(); t.position = v; changed(); });
  const styleSel = makeSelect(TEXT_STYLE_OPTIONS, t.style, (v) => { pushUndo(); t.style = v; changed(); });
  wrap.appendChild(makeLine('', posSel, styleSel, color));

  wrap.appendChild(makeLine('Size', makeSlider(3, 20, 0.5, t.size, (v) => { t.size = v; changed(); })));

  const startT = document.createElement('input');
  startT.className = 'clip-time';
  startT.value = formatTime(t.start);
  startT.title = 'When the text appears (time in the finished clip)';
  startT.addEventListener('change', () => {
    pushUndo();
    t.start = Math.max(0, parseTimeInput(startT.value, t.start));
    startT.value = formatTime(t.start);
    changed();
  });
  const endT = document.createElement('input');
  endT.className = 'clip-time';
  endT.value = formatTime(t.end);
  endT.title = 'When the text disappears (time in the finished clip)';
  endT.addEventListener('change', () => {
    pushUndo();
    t.end = Math.max(t.start + 0.1, parseTimeInput(endT.value, t.end));
    endT.value = formatTime(t.end);
    changed();
  });
  const removeBtn = document.createElement('button');
  removeBtn.className = 'btn small danger';
  removeBtn.textContent = '×';
  removeBtn.title = 'Remove this text';
  removeBtn.addEventListener('click', () => {
    pushUndo();
    clip.texts = clip.texts.filter((x) => x.id !== t.id);
    renderClipList();
    updatePreviewFx();
  });
  const arrow = document.createElement('span');
  arrow.textContent = '→';
  wrap.appendChild(makeLine('Shows', startT, arrow, endT, removeBtn));
  return wrap;
}

// ---------- Auto-captions ----------
const CAPTION_PREFS_KEY = '9jacut-caption-prefs';
const captionUi = {
  info: { languages: [['', 'Auto-detect']], models: [] },
  prefs: { language: '', model: 'accurate', translate: false },
  job: null, // { clipId, text }
};

function loadCaptionPrefs() {
  try {
    const saved = JSON.parse(localStorage.getItem(CAPTION_PREFS_KEY) || 'null');
    if (saved) captionUi.prefs = { ...captionUi.prefs, ...saved };
  } catch (e) { /* ignore */ }
}

function saveCaptionPrefs() {
  try { localStorage.setItem(CAPTION_PREFS_KEY, JSON.stringify(captionUi.prefs)); } catch (e) { /* ignore */ }
}

async function refreshCaptionsInfo() {
  try { captionUi.info = await window.nineJaCut.getCaptionsInfo(); } catch (e) { /* keep defaults */ }
}

const DEFAULT_CAPTION_STYLE = { position: 'bottom', style: 'box', size: 5, color: '#ffffff', upper: false };

// Same conversion as clip-export.js: absolute source times -> finished clip.
function captionPreviewItems(clip) {
  const cap = clip.captions;
  if (!cap || cap.enabled === false || !Array.isArray(cap.lines)) return [];
  const style = { ...DEFAULT_CAPTION_STYLE, ...(cap.style || {}) };
  const speed = clip.speed || 1;
  return cap.lines
    .filter((l) => l.end > clip.start && l.start < clip.end && String(l.text || '').trim())
    .map((l) => ({
      text: style.upper ? String(l.text).toUpperCase() : l.text,
      size: style.size,
      color: style.color,
      position: style.position,
      style: style.style,
      start: (Math.max(l.start, clip.start) - clip.start) / speed,
      end: (Math.min(l.end, clip.end) - clip.start) / speed,
    }));
}

function captionStatusText(data) {
  const model = captionUi.info.models.find((m) => m.key === captionUi.prefs.model);
  if (data.stage === 'download') {
    return `Downloading the captions model… ${data.percent || 0}% (one time only${model ? `, about ${model.downloadMB} MB` : ''})`;
  }
  if (data.stage === 'unpack') return 'Preparing the captions model… (one time only, about a minute)';
  if (data.stage === 'listen') return `Listening to the clip… ${data.percent || 0}%`;
  if (data.stage === 'error') return `Captions failed: ${data.message}`;
  return '';
}

window.nineJaCut.onCaptionsProgress((data) => {
  if (!captionUi.job || captionUi.job.clipId !== data.clipId) return;
  captionUi.job.text = captionStatusText(data);
  const el = document.getElementById(`capstatus-${data.clipId}`);
  if (el) el.textContent = captionUi.job.text;
});

async function runAutoCaptions(clip) {
  if (captionUi.job) { setStatus('Captions are already being made for another clip — please wait.'); return; }
  if (!clip.sourcePath) return;
  captionUi.job = { clipId: clip.id, text: 'Starting…' };
  renderClipList();
  setStatus(`Making captions for ${clip.name}…`);
  const result = await window.nineJaCut.generateCaptions({
    clipId: clip.id,
    sourcePath: clip.sourcePath,
    start: clip.start,
    end: clip.end,
    modelKey: captionUi.prefs.model,
    language: captionUi.prefs.language,
    translate: !!captionUi.prefs.translate,
  });
  captionUi.job = null;
  await refreshCaptionsInfo();
  const live = state.clips.find((c) => c.id === clip.id);
  if (!live) { renderClipList(); return; }
  if (!result.ok) {
    renderClipList();
    const el = document.getElementById(`capstatus-${clip.id}`);
    if (el) el.textContent = `Captions failed: ${result.error}`;
    setStatus(`Captions failed: ${result.error}`);
    return;
  }
  pushUndo();
  live.captions = {
    enabled: true,
    style: { ...DEFAULT_CAPTION_STYLE, ...((live.captions && live.captions.style) || {}) },
    lines: result.lines.map((l, i) => ({ id: `cap-${Date.now()}-${i}`, ...l })),
  };
  openFxPanels.add(live.id);
  renderClipList();
  previewClip(live);
  setStatus(result.lines.length
    ? `Added ${result.lines.length} caption line${result.lines.length > 1 ? 's' : ''} to ${live.name}. Check the words and fix any mistakes.`
    : `No speech was found in ${live.name}.`);
}

function buildCaptionsSection(clip, changed) {
  const wrap = document.createElement('div');

  const head = document.createElement('div');
  head.className = 'fx-line fx-subhead';
  const title = document.createElement('span');
  title.className = 'fx-label';
  title.textContent = 'Captions';
  const busy = !!captionUi.job;
  const mine = busy && captionUi.job.clipId === clip.id;
  const runBtn = document.createElement('button');
  runBtn.className = 'btn small primary';
  runBtn.textContent = mine ? 'Working…' : (clip.captions ? '↻ Redo captions' : '💬 Auto-caption');
  runBtn.disabled = busy;
  runBtn.title = 'Turn the speech in this clip into on-screen captions (runs on your computer)';
  runBtn.addEventListener('click', () => runAutoCaptions(clip));
  head.appendChild(title);
  head.appendChild(runBtn);
  wrap.appendChild(head);

  const langSel = makeSelect(captionUi.info.languages, captionUi.prefs.language, (v) => {
    captionUi.prefs.language = v;
    saveCaptionPrefs();
  });
  langSel.title = 'Language spoken in the video';
  const modelOptions = captionUi.info.models.length
    ? captionUi.info.models.map((m) => [m.key, `${m.label}${m.ready ? ' ✓' : ` (${m.downloadMB} MB)`}`])
    : [['accurate', 'Accurate'], ['fast', 'Fast']];
  const modelSel = makeSelect(modelOptions, captionUi.prefs.model, (v) => {
    captionUi.prefs.model = v;
    saveCaptionPrefs();
  });
  modelSel.title = 'Accurate makes fewer mistakes; Fast is quicker and a smaller download. ✓ = already downloaded';
  wrap.appendChild(makeLine('Language', langSel, modelSel));
  wrap.appendChild(makeLine('', makeCheck('Translate to English', !!captionUi.prefs.translate, (on) => {
    captionUi.prefs.translate = on;
    saveCaptionPrefs();
  })));

  const status = document.createElement('div');
  status.className = 'fx-note caption-status';
  status.id = `capstatus-${clip.id}`;
  status.textContent = mine ? captionUi.job.text : '';
  wrap.appendChild(status);

  const cap = clip.captions;
  if (!cap) return wrap;
  cap.style = { ...DEFAULT_CAPTION_STYLE, ...(cap.style || {}) };
  const st = cap.style;

  const posSel = makeSelect(TEXT_POSITION_OPTIONS, st.position, (v) => { pushUndo(); st.position = v; changed(); });
  const styleSel = makeSelect(TEXT_STYLE_OPTIONS, st.style, (v) => { pushUndo(); st.style = v; changed(); });
  const color = document.createElement('input');
  color.type = 'color';
  color.value = st.color;
  color.title = 'Caption color';
  color.addEventListener('pointerdown', () => armSnapshot());
  color.addEventListener('input', () => { commitSnapshotIfArmed(); st.color = color.value; changed(); });
  wrap.appendChild(makeLine('Style', posSel, styleSel, color));
  wrap.appendChild(makeLine('Size', makeSlider(3, 14, 0.5, st.size, (v) => { st.size = v; changed(); })));
  wrap.appendChild(makeLine('',
    makeCheck('ALL CAPS', !!st.upper, (on) => { pushUndo(); st.upper = on; changed(); }),
    makeCheck('Show captions', cap.enabled !== false, (on) => { pushUndo(); cap.enabled = on; changed(); })));

  const list = document.createElement('div');
  list.className = 'caption-list';
  const speed = clip.speed || 1;
  const inClip = cap.lines.filter((l) => l.end > clip.start && l.start < clip.end);
  for (const line of inClip) {
    const row = document.createElement('div');
    row.className = 'caption-line';
    const time = document.createElement('button');
    time.className = 'caption-time';
    time.textContent = formatTime((Math.max(line.start, clip.start) - clip.start) / speed);
    time.title = 'Jump to this line';
    time.addEventListener('click', () => {
      state.previewClipId = clip.id;
      video.currentTime = Math.max(line.start, clip.start) + 0.01;
    });
    const input = document.createElement('input');
    input.className = 'caption-text';
    input.value = line.text;
    input.addEventListener('focus', () => armSnapshot());
    input.addEventListener('input', () => {
      commitSnapshotIfArmed();
      line.text = input.value;
      changed();
    });
    const del = document.createElement('button');
    del.className = 'btn small danger';
    del.textContent = '×';
    del.title = 'Delete this caption line';
    del.addEventListener('click', () => {
      pushUndo();
      cap.lines = cap.lines.filter((l) => l !== line);
      renderClipList();
    });
    row.appendChild(time);
    row.appendChild(input);
    row.appendChild(del);
    list.appendChild(row);
  }
  if (!inClip.length) {
    const empty = document.createElement('div');
    empty.className = 'fx-note';
    empty.textContent = 'No caption lines inside this clip.';
    list.appendChild(empty);
  }
  wrap.appendChild(list);

  const removeBtn = document.createElement('button');
  removeBtn.className = 'btn small danger';
  removeBtn.textContent = 'Remove captions';
  removeBtn.addEventListener('click', () => {
    pushUndo();
    clip.captions = null;
    renderClipList();
  });
  wrap.appendChild(makeLine('', removeBtn));
  return wrap;
}

// ---------- Voiceover recording ----------
state.recording = null; // { clipId, recorder, stream, wasMuted, timer, startedAt }

function stopVoiceover() {
  const rec = state.recording;
  if (rec && rec.recorder.state !== 'inactive') rec.recorder.stop();
}

async function startVoiceover(clip) {
  if (state.recording) return;
  if (!navigator.mediaDevices || !window.MediaRecorder) {
    setStatus('Voice recording is not available on this computer.');
    return;
  }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  } catch (e) {
    setStatus(`Could not use the microphone: ${e.message}. Check that a mic is plugged in and allowed in Windows privacy settings.`);
    return;
  }
  await previewClip(clip);
  video.pause();
  video.currentTime = clip.start;
  // Desktop (Chromium) records WebM/Opus; iPhone (WebKit) only records MP4/AAC.
  const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']
    .find((m) => MediaRecorder.isTypeSupported(m)) || '';
  const extension = mime.startsWith('audio/mp4') ? 'm4a' : 'webm';
  const recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
  const chunks = [];
  recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  state.recording = { clipId: clip.id, recorder, stream, wasMuted: video.muted, timer: null, startedAt: 0 };

  recorder.onstop = async () => {
    const rec = state.recording;
    state.recording = null;
    stream.getTracks().forEach((t) => t.stop());
    clearInterval(rec && rec.timer);
    video.pause();
    video.muted = rec ? rec.wasMuted : false;
    const live = state.clips.find((c) => c.id === clip.id);
    if (!chunks.length || !live) { renderClipList(); return; }
    const blob = new Blob(chunks, { type: mime || recorder.mimeType });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const saved = await window.nineJaCut.saveRecording({ bytes, extension });
    pushUndo();
    live.voiceover = { path: saved.filePath, url: saved.fileUrl, volume: 1 };
    renderClipList();
    setStatus(`Voiceover saved for ${live.name}`);
  };

  // The video plays muted (so the mic doesn't pick it up) while you talk.
  video.muted = true;
  const begin = () => {
    video.removeEventListener('playing', begin);
    if (!state.recording || recorder.state !== 'inactive') return;
    recorder.start(250);
    state.recording.startedAt = Date.now();
    state.recording.timer = setInterval(() => {
      const el = document.getElementById(`vostatus-${clip.id}`);
      if (el && state.recording) el.textContent = `● Recording… ${formatTime((Date.now() - state.recording.startedAt) / 1000)}`;
    }, 250);
  };
  video.addEventListener('playing', begin);
  renderClipList();
  try { await video.play(); } catch (e) { begin(); }
}

function buildVoiceoverLine(clip) {
  const wrap = document.createElement('div');
  const recordingThis = state.recording && state.recording.clipId === clip.id;
  if (recordingThis) {
    const stopBtn = document.createElement('button');
    stopBtn.className = 'btn small danger';
    stopBtn.textContent = '■ Stop';
    stopBtn.addEventListener('click', stopVoiceover);
    const note = document.createElement('span');
    note.className = 'fx-note rec-note';
    note.id = `vostatus-${clip.id}`;
    note.textContent = '● Recording…';
    wrap.appendChild(makeLine('Voiceover', stopBtn, note));
    return wrap;
  }
  if (!clip.voiceover) {
    const recBtn = document.createElement('button');
    recBtn.className = 'btn small';
    recBtn.textContent = '🎙 Record voiceover';
    recBtn.title = 'The clip plays (muted) while you talk. Stops at the end of the clip, or press Stop.';
    recBtn.disabled = !!state.recording;
    recBtn.addEventListener('click', () => startVoiceover(clip));
    wrap.appendChild(makeLine('Voiceover', recBtn));
    return wrap;
  }
  const playBtn = document.createElement('button');
  playBtn.className = 'btn small';
  playBtn.textContent = '▶ Listen';
  playBtn.addEventListener('click', () => {
    const audio = new Audio(clip.voiceover.url || '');
    audio.volume = Math.min(1, clip.voiceover.volume || 1);
    audio.play().catch(() => setStatus('Could not play the recording.'));
  });
  const redoBtn = document.createElement('button');
  redoBtn.className = 'btn small';
  redoBtn.textContent = 'Re-record';
  redoBtn.disabled = !!state.recording;
  redoBtn.addEventListener('click', () => startVoiceover(clip));
  const removeBtn = document.createElement('button');
  removeBtn.className = 'btn small danger';
  removeBtn.textContent = '×';
  removeBtn.title = 'Remove the voiceover';
  removeBtn.addEventListener('click', () => { pushUndo(); clip.voiceover = null; renderClipList(); });
  wrap.appendChild(makeLine('Voiceover', playBtn, redoBtn, removeBtn));
  const volNote = document.createElement('span');
  volNote.className = 'fx-note';
  volNote.textContent = `${Math.round((clip.voiceover.volume || 1) * 100)}%`;
  wrap.appendChild(makeLine('Voice vol', makeSlider(0, 2, 0.05, clip.voiceover.volume || 1, (v) => {
    clip.voiceover.volume = v;
    volNote.textContent = `${Math.round(v * 100)}%`;
  }), volNote));
  return wrap;
}

// ---------- Live effects preview ----------
// Applies the look / speed / text of the clip under the playhead to the
// preview player, so edits can be checked without exporting.
function clipUnderPlayhead() {
  if (!state.activeSourcePath) return null;
  const t = video.currentTime;
  const candidates = state.clips.filter((c) => c.sourcePath === state.activeSourcePath && t >= c.start && t <= c.end);
  if (!candidates.length) return null;
  return candidates.find((c) => c.id === state.previewClipId) || candidates[candidates.length - 1];
}

function lookCss(look) {
  if (!look) return '';
  const parts = [LOOK_PREVIEW[look.preset] || ''];
  if (look.brightness) parts.push(`brightness(${(1 + look.brightness).toFixed(3)})`);
  if (look.contrast !== 1) parts.push(`contrast(${Number(look.contrast).toFixed(3)})`);
  if (look.saturation !== 1) parts.push(`saturate(${Number(look.saturation).toFixed(3)})`);
  return parts.filter(Boolean).join(' ');
}

function frameRectFor(clip) {
  const rect = getVideoDisplayRect();
  if (clip && clip.aspect !== 'original' && clip.crop) {
    return {
      x: rect.x + clip.crop.x * rect.scale,
      y: rect.y + clip.crop.y * rect.scale,
      w: clip.crop.w * rect.scale,
      h: clip.crop.h * rect.scale,
    };
  }
  return { x: rect.x, y: rect.y, w: rect.w, h: rect.h };
}

function updatePreviewFx() {
  const clip = state.editMode === 'reframe' ? null : clipUnderPlayhead();
  video.style.filter = clip ? lookCss(clip.look) : '';
  const motion = clip && MOTION_PREVIEW[clip.motion];
  if (motion) {
    const progress = Math.min(1, Math.max(0, ((video.currentTime - clip.start) / (clip.speed || 1)) / clipOutputDuration(clip)));
    const zoom = 1 + motion[0] * (motion[1] > 0 ? progress : 1 - progress);
    const f = frameRectFor(clip);
    video.style.transformOrigin = `${f.x + f.w / 2}px ${f.y + f.h / 2}px`;
    video.style.transform = `scale(${zoom.toFixed(4)})`;
  } else {
    video.style.transform = '';
  }
  // Show only the part of the picture that will be exported.
  const mask = document.getElementById('frameMask');
  if (mask) {
    const framed = clip && clip.aspect !== 'original' && clip.crop && !state.editMode;
    mask.classList.toggle('hidden', !framed);
    if (framed) {
      const f = frameRectFor(clip);
      mask.style.left = `${f.x}px`;
      mask.style.top = `${f.y}px`;
      mask.style.width = `${f.w}px`;
      mask.style.height = `${f.h}px`;
    }
  }
  const rate = clip ? (clip.speed || 1) : 1;
  if (video.playbackRate !== rate) video.playbackRate = rate;
  renderTextPreview(clip);
}

// Same layout maths as clip-export.js (wrapForFrame / lineY), so the
// preview shows the text where - and how - the export will draw it.
const PREVIEW_LINE_GAP = 1.3;

function wrapForFrame(text, sizePct, aspect) {
  const out = [];
  for (const raw of String(text).split('\n')) {
    const upper = /[A-Z]/.test(raw) && raw === raw.toUpperCase();
    const charW = (upper ? 0.68 : 0.58) * (sizePct / 100);
    const maxChars = Math.max(6, Math.floor((0.9 * aspect) / charW));
    let line = '';
    for (const word of raw.split(/\s+/).filter(Boolean)) {
      if (!line) line = word;
      else if ((line + ' ' + word).length <= maxChars) line += ` ${word}`;
      else { out.push(line); line = word; }
    }
    out.push(line);
  }
  return out.filter((l, i, arr) => l || (i > 0 && i < arr.length - 1));
}

function renderTextPreview(clip) {
  textLayer.innerHTML = '';
  if (!clip) return;
  const items = [...(clip.texts || []), ...captionPreviewItems(clip)];
  if (!items.length) return;
  // The finished frame: the crop box for reframed clips, else the whole video.
  const frame = frameRectFor(clip);
  const outTime = (video.currentTime - clip.start) / (clip.speed || 1);
  for (const t of items) {
    if (!String(t.text || '').trim() || outTime < t.start || outTime > t.end) continue;
    const sizePct = Math.min(30, Math.max(2, t.size || 7));
    const fontPx = (frame.h * sizePct) / 100;
    const lh = fontPx * PREVIEW_LINE_GAP;
    const lines = wrapForFrame(String(t.text).trim(), sizePct, frame.w / frame.h);
    lines.forEach((line, i) => {
      if (!line) return;
      let top;
      if (t.position === 'top') top = frame.y + frame.h * 0.08 + i * lh;
      else if (t.position === 'center') top = frame.y + (frame.h - lines.length * lh) / 2 + i * lh;
      else top = frame.y + frame.h * 0.86 - (lines.length - i) * lh;
      const row = document.createElement('div');
      row.className = `text-preview style-${t.style || 'outline'}`;
      const span = document.createElement('span');
      span.textContent = line;
      row.appendChild(span);
      row.style.left = `${frame.x}px`;
      row.style.width = `${frame.w}px`;
      row.style.top = `${top}px`;
      row.style.fontSize = `${Math.max(5, fontPx)}px`;
      row.style.lineHeight = `${fontPx * 1.1}px`;
      row.style.color = t.color || '#ffffff';
      textLayer.appendChild(row);
    });
  }
}

video.addEventListener('seeked', updatePreviewFx);
video.addEventListener('loadedmetadata', updatePreviewFx);

// ---------- Shared display-rect helper ----------
function getVideoDisplayRect() {
  const cw = videoStage.clientWidth;
  const ch = videoStage.clientHeight;
  const vw = state.videoWidth || cw;
  const vh = state.videoHeight || ch;
  const scale = Math.min(cw / vw, ch / vh);
  const w = vw * scale;
  const h = vh * scale;
  const x = (cw - w) / 2;
  const y = (ch - h) / 2;
  return { x, y, w, h, scale };
}

function exitEditModes() {
  if (state.editMode === 'reframe') exitReframeMode();
  else if (state.editMode === 'stickers') exitStickerMode();
}

// ---------- Reframe mode ----------
function positionCropOverlay() {
  const clip = state.clips.find((c) => c.id === state.selectedClipId);
  if (!clip || !clip.crop) return;
  const rect = getVideoDisplayRect();
  const left = rect.x + clip.crop.x * rect.scale;
  const top = rect.y + clip.crop.y * rect.scale;
  const width = clip.crop.w * rect.scale;
  const height = clip.crop.h * rect.scale;
  cropOverlay.style.left = `${left}px`;
  cropOverlay.style.top = `${top}px`;
  cropOverlay.style.width = `${width}px`;
  cropOverlay.style.height = `${height}px`;
  const axis = getCropAxis(clip);
  cropOverlay.classList.toggle('axis-x', axis === 'x');
  cropOverlay.classList.toggle('axis-y', axis === 'y');
}

async function enterReframeMode(clipId) {
  if (state.editMode === 'stickers') exitStickerMode();
  const clip = state.clips.find((c) => c.id === clipId);
  if (!clip) return;
  if (clip.sourcePath && clip.sourcePath !== state.activeSourcePath) {
    await switchActiveSource(clip.sourcePath);
  }
  if (clip.aspect === 'original') {
    clip.aspect = 'vertical';
  }
  if (!clip.crop) ensureCropForClip(clip);
  state.selectedClipId = clipId;
  state.editMode = 'reframe';
  video.pause();
  video.currentTime = clip.start;
  cropOverlay.classList.remove('hidden');
  reframeBadge.classList.remove('hidden');
  reframeControls.classList.remove('hidden');
  reframeClipName.textContent = clip.name;
  positionCropOverlay();
  renderClipList();
  updatePreviewFx();
}

function exitReframeMode() {
  state.selectedClipId = null;
  state.editMode = null;
  cropOverlay.classList.add('hidden');
  reframeBadge.classList.add('hidden');
  reframeControls.classList.add('hidden');
  renderClipList();
  updatePreviewFx();
}

btnDoneReframe.addEventListener('click', exitReframeMode);

btnResetCrop.addEventListener('click', () => {
  const clip = state.clips.find((c) => c.id === state.selectedClipId);
  if (!clip) return;
  pushUndo();
  ensureCropForClip(clip);
  positionCropOverlay();
});

cropOverlay.addEventListener('pointerdown', (e) => {
  const clip = state.clips.find((c) => c.id === state.selectedClipId);
  if (!clip) return;
  armSnapshot();
  state.dragging = true;
  state.dragAxis = getCropAxis(clip);
  state.dragStartX = e.clientX;
  state.dragStartY = e.clientY;
  state.dragStartCropX = clip.crop.x;
  state.dragStartCropY = clip.crop.y;
  cropOverlay.setPointerCapture(e.pointerId);
});

cropOverlay.addEventListener('pointermove', (e) => {
  if (!state.dragging) return;
  const clip = state.clips.find((c) => c.id === state.selectedClipId);
  if (!clip) return;
  const rect = getVideoDisplayRect();
  if (state.dragAxis === 'x') {
    const deltaScreen = e.clientX - state.dragStartX;
    const deltaSource = deltaScreen / rect.scale;
    const maxX = Math.max(0, state.videoWidth - clip.crop.w);
    clip.crop.x = Math.min(maxX, Math.max(0, state.dragStartCropX + deltaSource));
  } else if (state.dragAxis === 'y') {
    const deltaScreen = e.clientY - state.dragStartY;
    const deltaSource = deltaScreen / rect.scale;
    const maxY = Math.max(0, state.videoHeight - clip.crop.h);
    clip.crop.y = Math.min(maxY, Math.max(0, state.dragStartCropY + deltaSource));
  } else {
    return;
  }
  commitSnapshotIfArmed();
  positionCropOverlay();
});

cropOverlay.addEventListener('pointerup', () => { state.dragging = false; });
cropOverlay.addEventListener('pointercancel', () => { state.dragging = false; });

// ---------- Sticker mode ----------
function defaultStickerSize() {
  const vw = state.videoWidth || 1920;
  return Math.round(vw * 0.18);
}

async function enterStickerMode(clipId) {
  if (state.editMode === 'reframe') exitReframeMode();
  const clip = state.clips.find((c) => c.id === clipId);
  if (!clip) return;
  if (clip.sourcePath && clip.sourcePath !== state.activeSourcePath) {
    await switchActiveSource(clip.sourcePath);
  }
  if (!Array.isArray(clip.stickers)) clip.stickers = [];
  state.selectedClipId = clipId;
  state.editMode = 'stickers';
  video.pause();
  video.currentTime = clip.start;
  stickerBadge.classList.remove('hidden');
  stickerControls.classList.remove('hidden');
  stickerClipName.textContent = clip.name;
  renderClipList();
  renderStickerLayer();
}

function exitStickerMode() {
  state.selectedClipId = null;
  state.editMode = null;
  stickerBadge.classList.add('hidden');
  stickerControls.classList.add('hidden');
  stickerLayer.innerHTML = '';
  renderClipList();
}

btnDoneStickers.addEventListener('click', exitStickerMode);

function renderStickerLayer() {
  stickerLayer.innerHTML = '';
  const clip = state.clips.find((c) => c.id === state.selectedClipId);
  if (!clip) return;
  for (const sticker of clip.stickers) {
    const el = document.createElement('div');
    el.className = 'sticker-item';
    el.dataset.stickerId = sticker.id;
    const img = document.createElement('img');
    img.src = state.stickerAssets[sticker.key] || '';
    img.draggable = false;
    const removeBtn = document.createElement('button');
    removeBtn.className = 'sticker-remove';
    removeBtn.textContent = '×';
    removeBtn.addEventListener('click', (evt) => {
      evt.stopPropagation();
      pushUndo();
      clip.stickers = clip.stickers.filter((s) => s.id !== sticker.id);
      renderClipList();
      renderStickerLayer();
    });
    el.appendChild(img);
    el.appendChild(removeBtn);

    el.addEventListener('pointerdown', (e) => {
      if (e.target === removeBtn) return;
      armSnapshot();
      state.draggingSticker = true;
      state.dragStickerId = sticker.id;
      state.dragStickerStartX = e.clientX;
      state.dragStickerStartY = e.clientY;
      state.dragStickerOrigX = sticker.x;
      state.dragStickerOrigY = sticker.y;
      el.setPointerCapture(e.pointerId);
      e.stopPropagation();
    });
    el.addEventListener('pointermove', (e) => {
      if (!state.draggingSticker || state.dragStickerId !== sticker.id) return;
      const rect = getVideoDisplayRect();
      const deltaX = (e.clientX - state.dragStickerStartX) / rect.scale;
      const deltaY = (e.clientY - state.dragStickerStartY) / rect.scale;
      const maxX = Math.max(0, (state.videoWidth || 1920) - sticker.size);
      const maxY = Math.max(0, (state.videoHeight || 1080) - sticker.size);
      sticker.x = Math.min(maxX, Math.max(0, state.dragStickerOrigX + deltaX));
      sticker.y = Math.min(maxY, Math.max(0, state.dragStickerOrigY + deltaY));
      commitSnapshotIfArmed();
      positionStickerLayer();
    });
    el.addEventListener('pointerup', () => { state.draggingSticker = false; });
    el.addEventListener('pointercancel', () => { state.draggingSticker = false; });

    stickerLayer.appendChild(el);
  }
  positionStickerLayer();
}

function positionStickerLayer() {
  const clip = state.clips.find((c) => c.id === state.selectedClipId);
  if (!clip) return;
  const rect = getVideoDisplayRect();
  for (const child of stickerLayer.children) {
    const id = child.dataset.stickerId;
    const sticker = clip.stickers.find((s) => s.id === id);
    if (!sticker) continue;
    const left = rect.x + sticker.x * rect.scale;
    const top = rect.y + sticker.y * rect.scale;
    const size = sticker.size * rect.scale;
    child.style.left = `${left}px`;
    child.style.top = `${top}px`;
    child.style.width = `${size}px`;
    child.style.height = `${size}px`;
  }
}

function addStickerToSelectedClip(key) {
  const clip = state.clips.find((c) => c.id === state.selectedClipId);
  if (!clip || state.editMode !== 'stickers') return;
  pushUndo();
  stickerCounter += 1;
  const size = defaultStickerSize();
  const vw = state.videoWidth || 1920;
  const vh = state.videoHeight || 1080;
  const clipDuration = clipOutputDuration(clip);
  const sticker = {
    id: `sticker-${stickerCounter}-${Date.now()}`,
    key,
    x: Math.max(0, (vw - size) / 2),
    y: Math.max(0, (vh - size) / 2),
    size,
    start: 0,
    end: clipDuration,
  };
  clip.stickers.push(sticker);
  renderClipList();
  renderStickerLayer();
}

async function initStickerPicker() {
  try {
    const list = await window.nineJaCut.getStickers();
    for (const item of list) {
      state.stickerAssets[item.key] = item.fileUrl;
    }
  } catch (e) { /* ignore, picker still works via emoji labels */ }

  stickerPicker.innerHTML = '';
  for (const s of STICKERS_UI) {
    const btn = document.createElement('button');
    btn.textContent = s.emoji;
    btn.title = s.key;
    btn.addEventListener('click', () => addStickerToSelectedClip(s.key));
    stickerPicker.appendChild(btn);
  }
}

window.addEventListener('resize', () => {
  if (state.editMode === 'reframe') positionCropOverlay();
  if (state.editMode === 'stickers') positionStickerLayer();
  updatePreviewFx();
});

// ---------- Promo Video mode ----------
const tabClipEditor = document.getElementById('tabClipEditor');
const tabPromoVideo = document.getElementById('tabPromoVideo');
const tabAbout = document.getElementById('tabAbout');
const clipEditorView = document.getElementById('clipEditorView');
const promoView = document.getElementById('promoView');
const aboutView = document.getElementById('aboutView');

function switchMode(mode) {
  clipEditorView.classList.toggle('hidden', mode !== 'clip');
  promoView.classList.toggle('hidden', mode !== 'promo');
  aboutView.classList.toggle('hidden', mode !== 'about');
  tabClipEditor.classList.toggle('active', mode === 'clip');
  tabPromoVideo.classList.toggle('active', mode === 'promo');
  tabAbout.classList.toggle('active', mode === 'about');
  document.body.dataset.mode = mode;
  if (mode !== 'clip') {
    if (state.recording) stopVoiceover();
    video.pause();
  }
}
tabClipEditor.addEventListener('click', () => switchMode('clip'));
tabPromoVideo.addEventListener('click', () => switchMode('promo'));
tabAbout.addEventListener('click', () => switchMode('about'));

// ---------- About page ----------
async function initAbout() {
  try {
    const info = await window.nineJaCut.getAppInfo();
    for (const el of document.querySelectorAll('.app-version')) el.textContent = `Version ${info.version}`;
  } catch (e) { /* ignore */ }
  for (const link of document.querySelectorAll('[data-external]')) {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      window.nineJaCut.openExternal(link.getAttribute('data-external'));
    });
  }
  const copyBtn = document.getElementById('btnCopyEmail');
  copyBtn.addEventListener('click', async () => {
    await window.nineJaCut.copyText(copyBtn.dataset.copy);
    copyBtn.textContent = 'Copied ✓';
    setTimeout(() => { copyBtn.textContent = 'Copy email'; }, 2000);
  });
}

const promoState = {
  templates: [],
  selectedPresetId: null,
  media: [],
  exportFolder: null,
};

const promoName = document.getElementById('promoName');
const promoTagline = document.getElementById('promoTagline');
const promoHours = document.getElementById('promoHours');
const promoAddress = document.getElementById('promoAddress');
const promoContact = document.getElementById('promoContact');
const promoMediaList = document.getElementById('promoMediaList');
const btnAddPromoFromClips = document.getElementById('btnAddPromoFromClips');
const btnAddPromoFiles = document.getElementById('btnAddPromoFiles');
const promoDuration = document.getElementById('promoDuration');
const promoDurationLabel = document.getElementById('promoDurationLabel');
const promoGallery = document.getElementById('promoGallery');
const promoTemplateCount = document.getElementById('promoTemplateCount');
const promoLayoutFilter = document.getElementById('promoLayoutFilter');
const btnPromoExportFolder = document.getElementById('btnPromoExportFolder');
const promoExportFolderLabel = document.getElementById('promoExportFolderLabel');
const promoFileName = document.getElementById('promoFileName');
const btnExportPromo = document.getElementById('btnExportPromo');
const promoProgressFill = document.querySelector('#promoProgressBar .progress-fill');
const promoStatusEl = document.getElementById('promoStatus');

promoDuration.addEventListener('input', () => {
  promoDurationLabel.textContent = `${Number(promoDuration.value).toFixed(1)}s`;
});

function refreshPromoExportEnabled() {
  btnExportPromo.disabled = !(promoState.media.length > 0 && promoState.selectedPresetId && promoState.exportFolder);
}

function renderPromoMediaList() {
  promoMediaList.innerHTML = '';
  promoState.media.forEach((item, idx) => {
    const row = document.createElement('div');
    row.className = 'promo-media-item';

    const thumb = document.createElement('img');
    thumb.className = 'promo-media-thumb';
    thumb.src = item.thumbUrl || (item.type === 'image' ? item.fileUrl : '');
    thumb.alt = '';

    const name = document.createElement('span');
    name.className = 'promo-media-name';
    name.textContent = item.fileName;
    name.title = item.filePath;

    const upBtn = document.createElement('button');
    upBtn.className = 'btn small';
    upBtn.textContent = '↑';
    upBtn.disabled = idx === 0;
    upBtn.addEventListener('click', () => {
      const tmp = promoState.media[idx - 1];
      promoState.media[idx - 1] = promoState.media[idx];
      promoState.media[idx] = tmp;
      renderPromoMediaList();
    });

    const downBtn = document.createElement('button');
    downBtn.className = 'btn small';
    downBtn.textContent = '↓';
    downBtn.disabled = idx === promoState.media.length - 1;
    downBtn.addEventListener('click', () => {
      const tmp = promoState.media[idx + 1];
      promoState.media[idx + 1] = promoState.media[idx];
      promoState.media[idx] = tmp;
      renderPromoMediaList();
    });

    const removeBtn = document.createElement('button');
    removeBtn.className = 'btn small danger';
    removeBtn.textContent = '×';
    removeBtn.addEventListener('click', () => {
      promoState.media.splice(idx, 1);
      renderPromoMediaList();
    });

    row.appendChild(thumb);
    row.appendChild(name);
    row.appendChild(upBtn);
    row.appendChild(downBtn);
    row.appendChild(removeBtn);
    promoMediaList.appendChild(row);
  });
  refreshPromoExportEnabled();
}

function addPromoMediaItem(filePath, fileUrl, fileName, type) {
  if (promoState.media.find((m) => m.filePath === filePath)) return;
  const item = { filePath, fileUrl, fileName, type, thumbUrl: null };
  promoState.media.push(item);
  renderPromoMediaList();
  if (type === 'video') {
    window.nineJaCut.generateThumbnail({ sourcePath: filePath, time: 0 }).then((thumbUrl) => {
      if (!thumbUrl) return;
      item.thumbUrl = thumbUrl;
      renderPromoMediaList();
    }).catch(() => {});
  }
}

btnAddPromoFiles.addEventListener('click', async () => {
  const results = await window.nineJaCut.selectPromoMedia();
  for (const r of results) {
    addPromoMediaItem(r.filePath, r.fileUrl, r.fileName, r.type);
  }
});

btnAddPromoFromClips.addEventListener('click', () => {
  if (!state.sources.length) {
    setStatus('No videos loaded in Clip Editor yet — open one there first.');
    return;
  }
  for (const src of state.sources) {
    addPromoMediaItem(src.path, src.url, src.name, 'video');
  }
});

function renderPromoGallery(filterLayout) {
  promoGallery.innerHTML = '';
  const list = filterLayout ? promoState.templates.filter((t) => t.layout === filterLayout) : promoState.templates;
  for (const preset of list) {
    const card = document.createElement('button');
    card.className = 'promo-preset-card' + (promoState.selectedPresetId === preset.id ? ' selected' : '');
    card.title = preset.layoutDescription;

    const swatch = document.createElement('div');
    swatch.className = 'promo-preset-swatch';
    swatch.style.background = `linear-gradient(135deg, ${preset.bg}, ${preset.swatch})`;

    const label = document.createElement('div');
    label.className = 'promo-preset-name';
    label.textContent = preset.name;

    card.appendChild(swatch);
    card.appendChild(label);
    card.addEventListener('click', () => {
      promoState.selectedPresetId = preset.id;
      renderPromoGallery(promoLayoutFilter.value);
      refreshPromoExportEnabled();
    });
    promoGallery.appendChild(card);
  }
}

promoLayoutFilter.addEventListener('change', () => renderPromoGallery(promoLayoutFilter.value));

btnPromoExportFolder.addEventListener('click', async () => {
  const folder = await window.nineJaCut.selectExportFolder();
  if (!folder) return;
  promoState.exportFolder = folder;
  promoExportFolderLabel.textContent = folder;
  promoExportFolderLabel.title = folder;
  refreshPromoExportEnabled();
});

window.nineJaCut.onPromoExportProgress(({ status, percent, message }) => {
  if (typeof percent === 'number') promoProgressFill.style.width = `${percent}%`;
  if (status === 'start') { promoStatusEl.textContent = 'Exporting…'; promoStatusEl.className = 'clip-status'; }
  if (status === 'running') { promoStatusEl.textContent = `Exporting… ${percent}%`; promoStatusEl.className = 'clip-status'; }
  if (status === 'done') { promoStatusEl.textContent = 'Done!'; promoStatusEl.className = 'clip-status done'; }
  if (status === 'error') { promoStatusEl.textContent = `Error: ${message}`; promoStatusEl.className = 'clip-status error'; }
});

btnExportPromo.addEventListener('click', async () => {
  const preset = promoState.templates.find((t) => t.id === promoState.selectedPresetId);
  if (!preset || !promoState.exportFolder || !promoState.media.length) return;
  btnExportPromo.disabled = true;
  promoProgressFill.style.width = '0%';

  const business = {
    name: promoName.value.trim(),
    tagline: promoTagline.value.trim(),
    hours: promoHours.value.trim(),
    address: promoAddress.value.trim(),
    contact: promoContact.value.trim(),
  };
  const items = promoState.media.map((m) => ({ filePath: m.filePath, type: m.type }));
  const rawName = promoFileName.value.trim() || `${business.name || 'promo'}-${preset.name}`;
  const fileName = rawName.replace(/\s+/g, '-').toLowerCase();

  const result = await window.nineJaCut.exportPromo({
    presetId: preset.id,
    layout: preset.layout,
    themeKey: preset.theme,
    business,
    items,
    durationPerItem: Number(promoDuration.value),
    exportFolder: promoState.exportFolder,
    fileName,
  });

  if (result.ok) {
    setStatus(`Promo video exported to ${result.outPath}`);
    window.nineJaCut.openFolder(promoState.exportFolder);
  } else {
    setStatus(`Promo export failed: ${result.error}`);
  }
  refreshPromoExportEnabled();
});

async function initPromo() {
  try {
    promoState.templates = await window.nineJaCut.getPromoTemplates();
  } catch (e) {
    promoState.templates = [];
  }
  promoTemplateCount.textContent = `(${promoState.templates.length})`;

  const layoutNames = {};
  const layoutOrder = [];
  for (const t of promoState.templates) {
    if (!(t.layout in layoutNames)) {
      layoutNames[t.layout] = t.layoutName;
      layoutOrder.push(t.layout);
    }
  }
  promoLayoutFilter.innerHTML = '<option value="">All layouts</option>';
  for (const key of layoutOrder) {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = layoutNames[key] || key;
    promoLayoutFilter.appendChild(opt);
  }
  renderPromoGallery('');
}

