// ---------- Aspect ratio presets ----------
const ASPECT_PRESETS = {
  vertical: { w: 9, h: 16, label: 'Vertical 9:16' },
  square: { w: 1, h: 1, label: 'Square 1:1' },
  portrait: { w: 4, h: 5, label: 'Portrait 4:5' },
};
const ASPECT_OPTIONS = [
  ['original', 'Original'],
  ['vertical', ASPECT_PRESETS.vertical.label],
  ['square', ASPECT_PRESETS.square.label],
  ['portrait', ASPECT_PRESETS.portrait.label],
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
    combine: false,
    transition: 'fade',
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

function updateUndoButton() {
  btnUndo.disabled = undoStack.length === 0;
}

function pushUndo() {
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
    undoStack.push(state.pendingSnapshot);
    if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
    state.pendingSnapshot = null;
    updateUndoButton();
  }
}

function undo() {
  if (!undoStack.length) return;
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
const fileNameEl = document.getElementById('fileName');
const btnSaveProject = document.getElementById('btnSaveProject');
const btnLoadProject = document.getElementById('btnLoadProject');
const sourceRow = document.getElementById('sourceRow');
const sourcePills = document.getElementById('sourcePills');
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

const clipList = document.getElementById('clipList');
const textLayer = document.getElementById('textLayer');
const btnShortcuts = document.getElementById('btnShortcuts');
const setResolution = document.getElementById('setResolution');
const setQuality = document.getElementById('setQuality');
const setCombine = document.getElementById('setCombine');
const combineOptions = document.getElementById('combineOptions');
const setTransition = document.getElementById('setTransition');
const setTransitionDur = document.getElementById('setTransitionDur');
const setCombinedName = document.getElementById('setCombinedName');
const clipCount = document.getElementById('clipCount');
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

function defaultCropForRatio(rw, rh) {
  const vw = state.videoWidth || 1920;
  const vh = state.videoHeight || 1080;
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
  clip.crop = defaultCropForRatio(ratio.w, ratio.h);
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
      renderSourcePills();
      resolve();
      return;
    }
    state.activeSourcePath = sourcePath;
    fileNameEl.textContent = source.name;
    fileNameEl.title = source.path;
    dropHint.classList.add('hidden');
    const onLoaded = () => {
      video.removeEventListener('loadedmetadata', onLoaded);
      resolve();
    };
    video.addEventListener('loadedmetadata', onLoaded);
    video.src = source.url;
    renderSourcePills();
  });
}

function renderSourcePills() {
  sourcePills.innerHTML = '';
  sourceRow.classList.toggle('hidden', state.sources.length === 0);
  for (const src of state.sources) {
    const pill = document.createElement('button');
    pill.className = 'source-pill' + (src.path === state.activeSourcePath ? ' active' : '');
    pill.textContent = src.name;
    pill.title = src.path;
    pill.addEventListener('click', async () => {
      await switchActiveSource(src.path);
      resetMarks();
    });
    sourcePills.appendChild(pill);
  }
}

async function loadVideo(filePath, fileUrl, fileName) {
  await addSource(filePath, fileUrl, fileName);
  await switchActiveSource(filePath);
  resetMarks();
  setStatus(`Loaded ${fileName}`);
}

btnOpenVideo.addEventListener('click', async () => {
  const result = await window.nineJaCut.selectVideo();
  if (!result) return;
  await loadVideo(result.filePath, result.fileUrl, result.fileName);
});

// Drag-and-drop a video file straight onto the app window.
window.addEventListener('dragover', (e) => {
  e.preventDefault();
  videoStage.classList.add('drag-active');
});
window.addEventListener('dragleave', (e) => {
  if (e.target === document.documentElement || e.target === document.body) {
    videoStage.classList.remove('drag-active');
  }
});
window.addEventListener('drop', async (e) => {
  e.preventDefault();
  videoStage.classList.remove('drag-active');
  const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  if (!file || !file.path) return;
  const fileUrl = await window.nineJaCut.toFileUrl(file.path);
  await loadVideo(file.path, fileUrl, file.name);
});

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

// ---------- Transport ----------
btnPlayPause.addEventListener('click', () => {
  if (video.paused) video.play(); else video.pause();
});
video.addEventListener('play', () => { btnPlayPause.textContent = '⏸'; });
video.addEventListener('pause', () => { btnPlayPause.textContent = '▶'; });

function updateTimeLabel() {
  timeLabel.textContent = `${formatTime(video.currentTime)} / ${formatTime(video.duration || 0)}`;
}

video.addEventListener('timeupdate', () => {
  if (!state.scrubbing && video.duration) {
    seekBar.value = String(Math.round((video.currentTime / video.duration) * 1000));
  }
  updateTimeLabel();
  if (state.editMode === 'reframe') positionCropOverlay();
  if (state.editMode === 'stickers') positionStickerLayer();
  updatePreviewFx();
});

seekBar.addEventListener('pointerdown', () => { state.scrubbing = true; });
seekBar.addEventListener('pointerup', () => { state.scrubbing = false; });
seekBar.addEventListener('input', () => {
  if (video.duration) {
    video.currentTime = (Number(seekBar.value) / 1000) * video.duration;
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
    const imgEl = document.getElementById(`thumb-${clip.id}`);
    if (imgEl) imgEl.src = fileUrl;
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
  setStatus(`Added ${clip.name}`);
});

// ---------- Clip list ----------
function renderClipList() {
  clipList.innerHTML = '';
  clipCount.textContent = `(${state.clips.length})`;
  btnExportAll.disabled = !(state.clips.length > 0 && state.exportFolder);

  for (const clip of state.clips) {
    normalizeClip(clip);
    const card = document.createElement('div');
    card.className = 'clip-card' + (state.selectedClipId === clip.id ? ' selected' : '');

    // Row 1: thumbnail + name + delete
    const row1 = document.createElement('div');
    row1.className = 'clip-row1';
    const thumbImg = document.createElement('img');
    thumbImg.className = 'clip-thumb';
    thumbImg.id = `thumb-${clip.id}`;
    if (clip.thumbUrl) thumbImg.src = clip.thumbUrl;
    thumbImg.alt = '';
    const nameInput = document.createElement('input');
    nameInput.className = 'clip-name';
    nameInput.value = clip.name;
    nameInput.addEventListener('change', () => {
      pushUndo();
      clip.name = nameInput.value || clip.name;
    });
    const delBtn = document.createElement('button');
    delBtn.className = 'btn small danger';
    delBtn.textContent = 'Delete';
    delBtn.addEventListener('click', () => {
      pushUndo();
      state.clips = state.clips.filter((c) => c.id !== clip.id);
      if (state.selectedClipId === clip.id) exitEditModes();
      renderClipList();
    });
    row1.appendChild(thumbImg);
    row1.appendChild(nameInput);
    row1.appendChild(delBtn);

    // Row 2: times + duration + aspect select (+ custom ratio)
    const row2 = document.createElement('div');
    row2.className = 'clip-row2';
    const startInput = document.createElement('input');
    startInput.className = 'clip-time';
    startInput.value = formatTime(clip.start);
    startInput.addEventListener('change', () => {
      pushUndo();
      clip.start = Math.max(0, parseTimeInput(startInput.value, clip.start));
      startInput.value = formatTime(clip.start);
      durInput.textContent = formatTime(clip.end - clip.start);
      refreshThumbnail(clip);
    });
    const toLabel = document.createElement('span');
    toLabel.textContent = '→';
    const endInput = document.createElement('input');
    endInput.className = 'clip-time';
    endInput.value = formatTime(clip.end);
    endInput.addEventListener('change', () => {
      pushUndo();
      clip.end = Math.max(clip.start + 0.1, parseTimeInput(endInput.value, clip.end));
      endInput.value = formatTime(clip.end);
      durInput.textContent = formatTime(clip.end - clip.start);
    });
    const durInput = document.createElement('span');
    durInput.className = 'clip-time';
    durInput.style.background = 'transparent';
    durInput.style.border = 'none';
    durInput.title = 'Clip duration';
    durInput.textContent = formatTime(clip.end - clip.start);

    const aspectSelect = document.createElement('select');
    aspectSelect.className = 'aspect-select';
    for (const [val, label] of ASPECT_OPTIONS) {
      const opt = document.createElement('option');
      opt.value = val;
      opt.textContent = label;
      if (clip.aspect === val) opt.selected = true;
      aspectSelect.appendChild(opt);
    }
    aspectSelect.addEventListener('change', () => {
      pushUndo();
      clip.aspect = aspectSelect.value;
      ensureCropForClip(clip);
      renderClipList();
      if (state.editMode === 'reframe' && state.selectedClipId === clip.id) positionCropOverlay();
    });

    row2.appendChild(startInput);
    row2.appendChild(toLabel);
    row2.appendChild(endInput);
    row2.appendChild(durInput);
    row2.appendChild(aspectSelect);

    if (clip.aspect === 'custom') {
      const ratioWrap = document.createElement('div');
      ratioWrap.className = 'custom-ratio';
      const wInput = document.createElement('input');
      wInput.type = 'number';
      wInput.min = '1';
      wInput.value = clip.customRatio.w;
      const xLabel = document.createElement('span');
      xLabel.textContent = ':';
      const hInput = document.createElement('input');
      hInput.type = 'number';
      hInput.min = '1';
      hInput.value = clip.customRatio.h;
      function commitRatio() {
        pushUndo();
        clip.customRatio = {
          w: Math.max(1, parseFloat(wInput.value) || 16),
          h: Math.max(1, parseFloat(hInput.value) || 9),
        };
        ensureCropForClip(clip);
        if (state.editMode === 'reframe' && state.selectedClipId === clip.id) positionCropOverlay();
      }
      wInput.addEventListener('change', commitRatio);
      hInput.addEventListener('change', commitRatio);
      ratioWrap.appendChild(wInput);
      ratioWrap.appendChild(xLabel);
      ratioWrap.appendChild(hInput);
      row2.appendChild(ratioWrap);
    }

    // Row 3: reframe / stickers / duplicate buttons
    const row3 = document.createElement('div');
    row3.className = 'clip-row3';
    const reframeBtn = document.createElement('button');
    reframeBtn.className = 'btn small';
    reframeBtn.textContent = 'Reframe';
    reframeBtn.disabled = clip.aspect === 'original';
    reframeBtn.addEventListener('click', () => enterReframeMode(clip.id));
    const stickerBtn = document.createElement('button');
    stickerBtn.className = 'btn small';
    stickerBtn.textContent = '😀 Stickers';
    stickerBtn.addEventListener('click', () => enterStickerMode(clip.id));
    const dupBtn = document.createElement('button');
    dupBtn.className = 'btn small';
    dupBtn.textContent = 'Duplicate';
    dupBtn.addEventListener('click', () => {
      pushUndo();
      clipCounter += 1;
      const copy = cloneClips([clip])[0];
      copy.id = `clip-${clipCounter}-${Date.now()}`;
      copy.name = `${clip.name} copy`;
      const idx = state.clips.findIndex((c) => c.id === clip.id);
      state.clips.splice(idx + 1, 0, copy);
      renderClipList();
    });
    row3.appendChild(reframeBtn);
    row3.appendChild(stickerBtn);
    row3.appendChild(dupBtn);

    // Audio row
    const audioRow = document.createElement('div');
    audioRow.className = 'audio-row';
    if (!clip.audio) {
      const addAudioBtn = document.createElement('button');
      addAudioBtn.className = 'btn small';
      addAudioBtn.textContent = '+ Add Audio';
      addAudioBtn.addEventListener('click', async () => {
        const result = await window.nineJaCut.selectAudio();
        if (!result) return;
        pushUndo();
        clip.audio = { path: result.filePath, name: result.fileName, volume: 1, muteOriginal: false };
        renderClipList();
      });
      audioRow.appendChild(addAudioBtn);
    } else {
      const line1 = document.createElement('div');
      line1.className = 'audio-line';
      const audioName = document.createElement('span');
      audioName.className = 'audio-name';
      audioName.textContent = `🎵 ${clip.audio.name}`;
      audioName.title = clip.audio.name;
      const removeBtn = document.createElement('button');
      removeBtn.className = 'btn small danger';
      removeBtn.textContent = '×';
      removeBtn.addEventListener('click', () => {
        pushUndo();
        clip.audio = null;
        renderClipList();
      });
      line1.appendChild(audioName);
      line1.appendChild(removeBtn);

      const line2 = document.createElement('div');
      line2.className = 'audio-line';
      const volLabel = document.createElement('span');
      volLabel.textContent = 'Vol';
      const volSlider = document.createElement('input');
      volSlider.type = 'range';
      volSlider.min = '0';
      volSlider.max = '200';
      volSlider.value = String(Math.round(clip.audio.volume * 100));
      volSlider.addEventListener('pointerdown', () => armSnapshot());
      volSlider.addEventListener('input', () => {
        clip.audio.volume = Number(volSlider.value) / 100;
        commitSnapshotIfArmed();
      });
      line2.appendChild(volLabel);
      line2.appendChild(volSlider);

      const muteLabel = document.createElement('label');
      muteLabel.className = 'mute-toggle';
      const muteCheckbox = document.createElement('input');
      muteCheckbox.type = 'checkbox';
      muteCheckbox.checked = !!clip.audio.muteOriginal;
      muteCheckbox.addEventListener('change', () => {
        pushUndo();
        clip.audio.muteOriginal = muteCheckbox.checked;
      });
      muteLabel.appendChild(muteCheckbox);
      muteLabel.appendChild(document.createTextNode('Replace original audio'));

      const loopLabel = document.createElement('label');
      loopLabel.className = 'mute-toggle';
      const loopCheckbox = document.createElement('input');
      loopCheckbox.type = 'checkbox';
      loopCheckbox.checked = clip.audio.loop !== false;
      loopCheckbox.addEventListener('change', () => {
        pushUndo();
        clip.audio.loop = loopCheckbox.checked;
      });
      loopLabel.appendChild(loopCheckbox);
      loopLabel.appendChild(document.createTextNode('Loop music to fill the clip'));

      const toggles = document.createElement('div');
      toggles.className = 'audio-line toggles';
      toggles.appendChild(muteLabel);
      toggles.appendChild(loopLabel);

      audioRow.appendChild(line1);
      audioRow.appendChild(line2);
      audioRow.appendChild(toggles);
    }

    // Sticker list row
    const stickerRow = document.createElement('div');
    stickerRow.className = 'sticker-row';
    for (const sticker of clip.stickers) {
      const ui = STICKERS_UI.find((s) => s.key === sticker.key);
      const line1 = document.createElement('div');
      line1.className = 'sticker-line';
      const emojiSpan = document.createElement('span');
      emojiSpan.className = 'sticker-emoji';
      emojiSpan.textContent = ui ? ui.emoji : '❓';
      const startT = document.createElement('input');
      startT.className = 'clip-time';
      startT.value = formatTime(sticker.start);
      startT.addEventListener('change', () => {
        pushUndo();
        sticker.start = Math.max(0, parseTimeInput(startT.value, sticker.start));
        startT.value = formatTime(sticker.start);
      });
      const arrowSpan = document.createElement('span');
      arrowSpan.textContent = '→';
      const endT = document.createElement('input');
      endT.className = 'clip-time';
      endT.value = formatTime(sticker.end);
      endT.addEventListener('change', () => {
        pushUndo();
        sticker.end = Math.max(sticker.start + 0.1, parseTimeInput(endT.value, sticker.end));
        endT.value = formatTime(sticker.end);
      });
      const removeBtn = document.createElement('button');
      removeBtn.className = 'btn small danger';
      removeBtn.textContent = '×';
      removeBtn.addEventListener('click', () => {
        pushUndo();
        clip.stickers = clip.stickers.filter((s) => s.id !== sticker.id);
        renderClipList();
        if (state.editMode === 'stickers' && state.selectedClipId === clip.id) renderStickerLayer();
      });
      line1.appendChild(emojiSpan);
      line1.appendChild(startT);
      line1.appendChild(arrowSpan);
      line1.appendChild(endT);
      line1.appendChild(removeBtn);

      const line2 = document.createElement('div');
      line2.className = 'sticker-line';
      const sizeLabel = document.createElement('span');
      sizeLabel.textContent = 'Size';
      const sizeSlider = document.createElement('input');
      sizeSlider.type = 'range';
      sizeSlider.min = '30';
      sizeSlider.max = String(Math.max(60, Math.round((state.videoWidth || 1920) * 0.6)));
      sizeSlider.value = String(Math.round(sticker.size));
      sizeSlider.addEventListener('pointerdown', () => armSnapshot());
      sizeSlider.addEventListener('input', () => {
        sticker.size = Number(sizeSlider.value);
        commitSnapshotIfArmed();
        if (state.editMode === 'stickers' && state.selectedClipId === clip.id) positionStickerLayer();
      });
      line2.appendChild(sizeLabel);
      line2.appendChild(sizeSlider);

      stickerRow.appendChild(line1);
      stickerRow.appendChild(line2);
    }

    const progressWrap = document.createElement('div');
    progressWrap.className = 'progress-bar';
    progressWrap.id = `progress-${clip.id}`;
    const progressFill = document.createElement('div');
    progressFill.className = 'progress-fill';
    progressWrap.appendChild(progressFill);

    const statusEl = document.createElement('div');
    statusEl.className = 'clip-status';
    statusEl.id = `status-${clip.id}`;

    card.appendChild(row1);
    card.appendChild(row2);
    card.appendChild(row3);
    card.appendChild(audioRow);
    card.appendChild(stickerRow);
    card.appendChild(buildFxSection(clip));
    card.appendChild(progressWrap);
    card.appendChild(statusEl);
    clipList.appendChild(card);
  }
  updatePreviewFx();
}

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
  if (clip.fade.in || clip.fade.out) bits.push('fades');
  if (clip.denoise) bits.push('clean audio');
  return `✨ Effects${bits.length ? ` · ${bits.join(' · ')}` : ': speed, look, text, fade'}`;
}

// Move the playhead into a clip so its effects show in the preview.
async function previewClip(clip, outputTime = 0) {
  state.previewClipId = clip.id;
  if (clip.sourcePath && clip.sourcePath !== state.activeSourcePath) {
    await switchActiveSource(clip.sourcePath);
  }
  const t = clip.start + Math.min(Math.max(0, outputTime), clipOutputDuration(clip) - 0.05) * (clip.speed || 1);
  if (video.currentTime < clip.start || video.currentTime > clip.end) video.currentTime = t;
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

function updatePreviewFx() {
  const clip = state.editMode === 'reframe' ? null : clipUnderPlayhead();
  video.style.filter = clip ? lookCss(clip.look) : '';
  const rate = clip ? (clip.speed || 1) : 1;
  if (video.playbackRate !== rate) video.playbackRate = rate;
  renderTextPreview(clip);
}

function renderTextPreview(clip) {
  textLayer.innerHTML = '';
  if (!clip || !clip.texts || !clip.texts.length) return;
  const rect = getVideoDisplayRect();
  // The finished frame: the crop box for reframed clips, else the whole video.
  let frame = { x: rect.x, y: rect.y, w: rect.w, h: rect.h };
  if (clip.aspect !== 'original' && clip.crop) {
    frame = {
      x: rect.x + clip.crop.x * rect.scale,
      y: rect.y + clip.crop.y * rect.scale,
      w: clip.crop.w * rect.scale,
      h: clip.crop.h * rect.scale,
    };
  }
  const outTime = (video.currentTime - clip.start) / (clip.speed || 1);
  for (const t of clip.texts) {
    if (!String(t.text || '').trim() || outTime < t.start || outTime > t.end) continue;
    const el = document.createElement('div');
    el.className = `text-preview style-${t.style || 'outline'} pos-${t.position || 'bottom'}`;
    const span = document.createElement('span');
    span.textContent = t.text;
    el.appendChild(span);
    el.style.left = `${frame.x}px`;
    el.style.width = `${frame.w}px`;
    el.style.fontSize = `${Math.max(6, (frame.h * (t.size || 7)) / 100)}px`;
    el.style.color = t.color || '#ffffff';
    if (t.position === 'top') el.style.top = `${frame.y + frame.h * 0.08}px`;
    else if (t.position === 'center') { el.style.top = `${frame.y + frame.h / 2}px`; el.style.transform = 'translateY(-50%)'; }
    else { el.style.top = `${frame.y + frame.h * 0.86}px`; el.style.transform = 'translateY(-100%)'; }
    textLayer.appendChild(el);
  }
}

video.addEventListener('seeked', updatePreviewFx);
video.addEventListener('loadedmetadata', updatePreviewFx);

// ---------- Export settings ----------
function applyExportSettingsToUI() {
  const st = state.exportSettings;
  setResolution.value = st.resolution;
  setQuality.value = st.quality;
  setCombine.checked = !!st.combine;
  setTransition.value = st.transition;
  setTransitionDur.value = String(st.transitionDuration);
  setCombinedName.value = st.combinedName || '';
  combineOptions.classList.toggle('hidden', !st.combine);
  btnExportAll.textContent = st.combine ? 'Export Video' : 'Export All Clips';
}

setResolution.addEventListener('change', () => { state.exportSettings.resolution = setResolution.value; });
setQuality.addEventListener('change', () => { state.exportSettings.quality = setQuality.value; });
setCombine.addEventListener('change', () => {
  state.exportSettings.combine = setCombine.checked;
  applyExportSettingsToUI();
});
setTransition.addEventListener('change', () => { state.exportSettings.transition = setTransition.value; });
setTransitionDur.addEventListener('change', () => { state.exportSettings.transitionDuration = Number(setTransitionDur.value); });
setCombinedName.addEventListener('change', () => { state.exportSettings.combinedName = setCombinedName.value.trim(); });

// ---------- Keyboard shortcuts ----------
const SHORTCUTS_TEXT = 'Shortcuts: Space play/pause · I mark in · O mark out · Enter add clip · ←/→ 1s (Shift: 5s) · , / . one frame · Home/End start/end · Esc close editing · Ctrl+Z undo · Ctrl+S save project · Ctrl+O open video';

btnShortcuts.addEventListener('click', () => setStatus(SHORTCUTS_TEXT));

function seekBy(seconds) {
  if (!video.duration) return;
  video.currentTime = Math.min(video.duration, Math.max(0, video.currentTime + seconds));
}

window.addEventListener('keydown', (e) => {
  const tag = (e.target && e.target.tagName ? e.target.tagName : '').toLowerCase();
  const typing = tag === 'input' || tag === 'textarea' || tag === 'select' || (e.target && e.target.isContentEditable);
  const mod = e.ctrlKey || e.metaKey;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;

  if (mod && key === 's') { e.preventDefault(); btnSaveProject.click(); return; }
  if (mod && key === 'o') { e.preventDefault(); btnOpenVideo.click(); return; }
  if (mod && key === 'z' && !typing) { e.preventDefault(); undo(); return; }
  if (typing || mod || e.altKey) return;
  if (!promoView.classList.contains('hidden')) return;

  // Keep Space from also "clicking" whichever button has focus.
  if (tag === 'button' && (key === ' ' || key === 'Enter')) e.target.blur();

  switch (key) {
    case ' ':
      e.preventDefault();
      if (state.activeSourcePath) { if (video.paused) video.play(); else video.pause(); }
      break;
    case 'i': btnMarkIn.click(); break;
    case 'o': btnMarkOut.click(); break;
    case 'Enter':
      e.preventDefault();
      if (!btnAddClip.disabled) btnAddClip.click();
      break;
    case 'ArrowLeft': e.preventDefault(); seekBy(e.shiftKey ? -5 : -1); break;
    case 'ArrowRight': e.preventDefault(); seekBy(e.shiftKey ? 5 : 1); break;
    case ',': video.pause(); seekBy(-1 / 30); break;
    case '.': video.pause(); seekBy(1 / 30); break;
    case 'Home': video.currentTime = 0; break;
    case 'End': if (video.duration) video.currentTime = video.duration; break;
    case 'Escape': exitEditModes(); break;
    case '?': setStatus(SHORTCUTS_TEXT); break;
    default: break;
  }
});

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

// ---------- Save / load project ----------
btnSaveProject.addEventListener('click', async () => {
  const projectData = {
    version: 2,
    sources: state.sources.map((s) => ({ path: s.path, name: s.name })),
    activeSourcePath: state.activeSourcePath,
    exportFolder: state.exportFolder,
    exportSettings: { ...state.exportSettings },
    clips: state.clips.map(serializeClip),
  };
  const savedPath = await window.nineJaCut.saveProject(projectData);
  if (savedPath) setStatus(`Project saved to ${savedPath}`);
});

btnLoadProject.addEventListener('click', async () => {
  const data = await window.nineJaCut.loadProject();
  if (!data) return;

  state.sources = [];
  for (const s of (data.sources || [])) {
    try {
      const fileUrl = await window.nineJaCut.toFileUrl(s.path);
      state.sources.push({ path: s.path, url: fileUrl, name: s.name });
    } catch (e) { /* skip files that can no longer be found */ }
  }

  state.clips = (data.clips || []).map((c) => normalizeClip({
    thumbUrl: null,
    stickers: [],
    ...c,
  }));
  state.exportSettings = { ...state.exportSettings, ...(data.exportSettings || {}) };
  applyExportSettingsToUI();
  state.previewClipId = null;
  state.exportFolder = data.exportFolder || null;
  exportFolderLabel.textContent = state.exportFolder || 'No folder chosen';
  exportFolderLabel.title = state.exportFolder || '';

  exitEditModes();
  undoStack.length = 0;
  updateUndoButton();

  if (state.sources.length) {
    const target = (data.activeSourcePath && state.sources.find((s) => s.path === data.activeSourcePath))
      ? data.activeSourcePath
      : state.sources[0].path;
    await switchActiveSource(target);
  }
  resetMarks();
  renderSourcePills();
  renderClipList();
  btnExportAll.disabled = !(state.clips.length > 0 && state.exportFolder);
  for (const c of state.clips) refreshThumbnail(c);
  setStatus('Project loaded');
});

// ---------- Export ----------
btnExportFolder.addEventListener('click', async () => {
  const folder = await window.nineJaCut.selectExportFolder();
  if (!folder) return;
  state.exportFolder = folder;
  exportFolderLabel.textContent = folder;
  exportFolderLabel.title = folder;
  btnExportAll.disabled = !(state.clips.length > 0);
});

window.nineJaCut.onExportProgress(({ id, status, percent, message }) => {
  if (id === 'combined') {
    if (status === 'running') setStatus(`Joining clips into one video… ${percent}%`);
    if (status === 'error') setStatus(`Export failed: ${message}`);
    return;
  }
  const fill = document.querySelector(`#progress-${id} .progress-fill`);
  const statusEl = document.getElementById(`status-${id}`);
  if (fill && typeof percent === 'number') fill.style.width = `${percent}%`;
  if (statusEl) {
    if (status === 'start') { statusEl.textContent = 'Exporting…'; statusEl.className = 'clip-status'; }
    if (status === 'running') { statusEl.textContent = `Exporting… ${percent}%`; statusEl.className = 'clip-status'; }
    if (status === 'done') { statusEl.textContent = 'Done'; statusEl.className = 'clip-status done'; }
    if (status === 'error') { statusEl.textContent = `Error: ${message}`; statusEl.className = 'clip-status error'; }
  }
});

btnExportAll.addEventListener('click', async () => {
  if (!state.exportFolder || state.clips.length === 0) return;
  btnExportAll.disabled = true;
  const settings = { ...state.exportSettings };
  setStatus(settings.combine ? 'Rendering clips for your video…' : 'Exporting clips…');
  const payload = {
    exportFolder: state.exportFolder,
    clips: state.clips.map(serializeClip),
    settings,
  };
  const results = await window.nineJaCut.exportClips(payload);
  if (settings.combine) {
    const r = results[0];
    setStatus(r && r.ok ? `Video saved to ${r.outPath}` : `Export failed: ${r ? r.error : 'unknown error'}`);
  } else {
    const okCount = results.filter((r) => r.ok).length;
    setStatus(`Exported ${okCount}/${results.length} clip(s) to ${state.exportFolder}`);
  }
  const warnings = results.flatMap((r) => r.warnings || []);
  if (warnings.length) setStatus(`${statusBar.textContent} — Note: ${warnings.join(' ')}`);
  btnExportAll.disabled = false;
  window.nineJaCut.openFolder(state.exportFolder);
});

// ---------- Promo Video mode ----------
const tabClipEditor = document.getElementById('tabClipEditor');
const tabPromoVideo = document.getElementById('tabPromoVideo');
const clipEditorView = document.getElementById('clipEditorView');
const promoView = document.getElementById('promoView');

function switchMode(mode) {
  const isPromo = mode === 'promo';
  clipEditorView.classList.toggle('hidden', isPromo);
  promoView.classList.toggle('hidden', !isPromo);
  tabClipEditor.classList.toggle('active', !isPromo);
  tabPromoVideo.classList.toggle('active', isPromo);
  if (isPromo) video.pause();
}
tabClipEditor.addEventListener('click', () => switchMode('clip'));
tabPromoVideo.addEventListener('click', () => switchMode('promo'));

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

initTheme();
applyExportSettingsToUI();
initStickerPicker();
renderClipList();
renderSourcePills();
initPromo();
