// 9jaCut v2 workspace, part 1: shared state, media library, playback.
//
// The timeline is the list of clips in state.clips, played one after
// another. "Timeline time" is time in the finished video (after each clip's
// speed change). The single <video> element shows whichever clip is under
// the playhead; music and voiceover play through two hidden audio players.

const ws = {
  tab: 'media',          // left tool tab
  propsTab: 'video',     // right Details tab for a selected clip
  focusClipId: null,     // clip selected on the timeline
  mode: 'timeline',      // 'timeline' | 'source' (previewing a library video)
  sourcePreviewPath: null,
  time: 0,               // playhead, in seconds of the finished video
  playing: false,
  advancing: false,
  seekToken: 0,
  pxPerSec: 60,
  applyAll: false,       // "apply to all clips" switch in the effect tabs
  audioLibrary: [],      // [{ path, url, name, duration }]
  filterThumb: { clipId: null, url: null },
};

const W = {
  leftBody: document.getElementById('leftBody'),
  toolTabs: document.getElementById('toolTabs'),
  propsBody: document.getElementById('propsBody'),
  propsTitle: document.getElementById('propsTitle'),
  propsTabs: document.getElementById('propsTabs'),
  playerTitle: document.getElementById('playerTitle'),
  btnBackToTimeline: document.getElementById('btnBackToTimeline'),
  sourceMarkRow: document.getElementById('sourceMarkRow'),
  btnAddWhole: document.getElementById('btnAddWhole'),
  btnFullscreen: document.getElementById('btnFullscreen'),
  btnRedo: document.getElementById('btnRedo'),
  btnMenu: document.getElementById('btnMenu'),
  menuDropdown: document.getElementById('menuDropdown'),
  btnNewProject: document.getElementById('btnNewProject'),
  btnMenuAbout: document.getElementById('btnMenuAbout'),
  projectName: document.getElementById('projectName'),
  btnExportOpen: document.getElementById('btnExportOpen'),
  tlScroll: document.getElementById('tlScroll'),
  tlContent: document.getElementById('tlContent'),
  tlRuler: document.getElementById('tlRuler'),
  laneOverlay: document.getElementById('laneOverlay'),
  laneCaptions: document.getElementById('laneCaptions'),
  laneMain: document.getElementById('laneMain'),
  laneAudio: document.getElementById('laneAudio'),
  tlEmpty: document.getElementById('tlEmpty'),
  tlPlayhead: document.getElementById('tlPlayhead'),
  tlInfo: document.getElementById('tlInfo'),
  tlSplit: document.getElementById('tlSplit'),
  tlDelete: document.getElementById('tlDelete'),
  tlDuplicate: document.getElementById('tlDuplicate'),
  tlReframe: document.getElementById('tlReframe'),
  tlZoom: document.getElementById('tlZoom'),
  tlZoomIn: document.getElementById('tlZoomIn'),
  tlZoomOut: document.getElementById('tlZoomOut'),
  tlFit: document.getElementById('tlFit'),
  exportDialog: document.getElementById('exportDialog'),
  btnExportClose: document.getElementById('btnExportClose'),
  btnExportCancel: document.getElementById('btnExportCancel'),
  setModeCombined: document.getElementById('setModeCombined'),
  setModeSeparate: document.getElementById('setModeSeparate'),
  exportSummary: document.getElementById('exportSummary'),
  exportProgressFill: document.querySelector('#exportProgressBar .progress-fill'),
  exportStatus: document.getElementById('exportStatus'),
};

// Hidden players for music / voiceover so the timeline preview sounds like
// the export.
const previewMusic = new Audio();
const previewVoice = new Audio();
const libraryPlayer = new Audio();

// ---------- Timeline maths ----------
function timelineEntries() {
  let t = 0;
  return state.clips.map((clip, index) => {
    const dur = clipOutputDuration(clip);
    const entry = { clip, index, start: t, end: t + dur, dur };
    t += dur;
    return entry;
  });
}

function timelineDuration() {
  return state.clips.reduce((sum, c) => sum + clipOutputDuration(c), 0);
}

function entryAt(time, entries = timelineEntries()) {
  if (!entries.length) return null;
  for (const e of entries) if (time >= e.start && time < e.end) return e;
  return entries[entries.length - 1];
}

function entryForClip(clipId, entries = timelineEntries()) {
  return entries.find((e) => e.clip.id === clipId) || null;
}

function focusedClip() {
  return state.clips.find((c) => c.id === ws.focusClipId) || null;
}

// The clip effect tabs act on: the selected clip, else the one under the
// playhead.
function targetClip() {
  const f = focusedClip();
  if (f) return f;
  const e = entryAt(ws.time);
  return e ? e.clip : null;
}

function targetClips() {
  if (ws.applyAll) return state.clips.slice();
  const c = targetClip();
  return c ? [c] : [];
}

function sourceName(path) {
  const src = state.sources.find((s) => s.path === path);
  return src ? src.name : (path || '').split(/[\\/]/).pop();
}

function fmtShort(seconds) {
  if (!isFinite(seconds) || seconds < 0) seconds = 0;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds - m * 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function button(label, className, onClick, title) {
  const b = el('button', className || 'btn small', label);
  if (title) b.title = title;
  if (onClick) b.addEventListener('click', onClick);
  return b;
}

async function ensureFileUrl(obj) {
  if (!obj || !obj.path) return null;
  if (!obj.url) {
    try { obj.url = await window.nineJaCut.toFileUrl(obj.path); } catch (e) { return null; }
  }
  return obj.url;
}

// ---------- Playback engine ----------
function applyClipSound(clip) {
  const mute = !!(clip && clip.audio && clip.audio.muteOriginal) || (clip && clip.origVolume === 0);
  video.muted = !!(state.recording) || mute;
  video.volume = clip ? Math.min(1, Math.max(0, clip.origVolume == null ? 1 : clip.origVolume)) : 1;
}

async function syncAudioPlayer(player, item, local, enabled) {
  if (!enabled || !item || !item.path) {
    player.pause();
    return;
  }
  const url = await ensureFileUrl(item);
  if (!url) { player.pause(); return; }
  if (player.dataset.src !== url) {
    player.dataset.src = url;
    player.src = url;
    await new Promise((resolve) => {
      if (player.readyState >= 1) { resolve(); return; }
      const done = () => { player.removeEventListener('loadedmetadata', done); player.removeEventListener('error', done); resolve(); };
      player.addEventListener('loadedmetadata', done);
      player.addEventListener('error', done);
    });
  }
  let pos = Math.max(0, (item.offset || 0) + local);
  const len = player.duration;
  if (isFinite(len) && len > 0) {
    if (item.loop !== false) pos %= len;
    else if (pos >= len) { player.pause(); return; }
  }
  player.volume = Math.min(1, Math.max(0, item.volume == null ? 1 : item.volume));
  try { player.currentTime = pos; } catch (e) { /* not seekable yet */ }
  if (ws.playing) player.play().catch(() => {});
  else player.pause();
}

function syncPreviewAudio(entry, local) {
  const clip = entry ? entry.clip : null;
  const inTimeline = ws.mode === 'timeline' && !state.recording;
  syncAudioPlayer(previewMusic, clip && clip.audio, local, inTimeline && !!clip);
  syncAudioPlayer(previewVoice, clip && clip.voiceover, local, inTimeline && !!clip);
}

// Moves the playhead to `time` (seconds of the finished video).
async function seekTimeline(time) {
  const token = ++ws.seekToken;
  const entries = timelineEntries();
  const total = entries.length ? entries[entries.length - 1].end : 0;
  ws.time = Math.min(Math.max(0, time), total);
  renderPlayhead();
  updateTimeLabel();
  if (!entries.length) {
    state.previewClipId = null;
    updatePreviewFx();
    return;
  }
  const entry = entryAt(ws.time, entries);
  const clip = entry.clip;
  state.previewClipId = clip.id;
  if (clip.sourcePath && clip.sourcePath !== state.activeSourcePath) {
    await switchActiveSource(clip.sourcePath);
    if (token !== ws.seekToken) return;
  }
  const local = Math.min(ws.time - entry.start, entry.dur - 0.01);
  const target = clip.start + Math.max(0, local) * (clip.speed || 1);
  if (Math.abs(video.currentTime - target) > 0.01) video.currentTime = target;
  applyClipSound(clip);
  syncPreviewAudio(entry, Math.max(0, local));
  updatePreviewFx();
}

async function seekToClip(clip, local = 0) {
  if (ws.mode !== 'timeline') exitSourcePreview(false);
  const entry = entryForClip(clip.id);
  if (!entry) return;
  await seekTimeline(entry.start + Math.max(0, Math.min(local, entry.dur - 0.01)));
}

// After a jump (e.g. back to the start to replay), Safari/iPhone keeps
// video.ended true until the jump finishes, which made playback stop
// immediately the second time. Wait for the jump before playing.
function waitForSeek(timeoutMs = 1500) {
  if (!video.seeking) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => { clearTimeout(timer); video.removeEventListener('seeked', done); resolve(); };
    const timer = setTimeout(done, timeoutMs);
    video.addEventListener('seeked', done);
  });
}

function timelineTick() {
  if (!ws.playing) return;
  if (!ws.advancing) {
    const entries = timelineEntries();
    const entry = entryForClip(state.previewClipId, entries);
    if (!entry) { pauseTimeline(); return; }
    const clip = entry.clip;
    // While a jump is in progress, ended/currentTime still describe the old spot.
    const reachedEnd = !video.seeking && (video.ended || video.currentTime >= clip.end - 1 / 60);
    if (reachedEnd) {
      const next = entries[entry.index + 1];
      if (next) {
        ws.advancing = true;
        seekTimeline(next.start).then(waitForSeek).then(() => {
          ws.advancing = false;
          if (ws.playing) video.play().catch(() => {});
        });
      } else {
        ws.time = entry.end;
        pauseTimeline();
        renderPlayhead();
        updateTimeLabel();
        return;
      }
    } else {
      ws.time = entry.start + Math.max(0, video.currentTime - clip.start) / (clip.speed || 1);
      renderPlayhead();
      updateTimeLabel();
      followPlayhead();
    }
  }
  requestAnimationFrame(timelineTick);
}

async function playTimeline() {
  if (!state.clips.length) { setStatus('Add a clip to the timeline first.'); return; }
  const total = timelineDuration();
  if (ws.time >= total - 0.05) await seekTimeline(0);
  else await seekTimeline(ws.time);
  await waitForSeek();
  ws.playing = true;
  syncPreviewAudio(entryForClip(state.previewClipId), ws.time - (entryForClip(state.previewClipId) || { start: 0 }).start);
  video.play().catch(() => {});
  requestAnimationFrame(timelineTick);
}

function pauseTimeline() {
  ws.playing = false;
  video.pause();
  previewMusic.pause();
  previewVoice.pause();
}

function togglePlay() {
  if (state.recording) return;
  if (ws.mode === 'source') {
    if (video.paused) {
      // Replaying a finished preview: go back to the start first.
      if (video.ended || (video.duration && video.currentTime >= video.duration - 0.05)) video.currentTime = 0;
      waitForSeek().then(() => video.play().catch(() => {}));
    } else video.pause();
    return;
  }
  if (ws.playing) pauseTimeline(); else playTimeline();
}

function updateTimeLabel() {
  let now;
  let total;
  if (ws.mode === 'source') {
    now = video.currentTime || 0;
    total = video.duration || 0;
  } else {
    now = ws.time;
    total = timelineDuration();
  }
  timeLabel.innerHTML = `<span class="tc-now">${formatTime(now)}</span> / ${formatTime(total)}`;
  if (!state.scrubbing) seekBar.value = String(total ? Math.round((now / total) * 1000) : 0);
}

function seekBy(seconds) {
  if (ws.mode === 'source') {
    if (video.duration) video.currentTime = Math.min(video.duration, Math.max(0, video.currentTime + seconds));
  } else {
    if (ws.playing) pauseTimeline();
    seekTimeline(ws.time + seconds);
  }
}

btnPlayPause.addEventListener('click', togglePlay);
video.addEventListener('play', () => { btnPlayPause.textContent = '⏸'; });
video.addEventListener('pause', () => { if (!ws.playing || ws.mode === 'source') btnPlayPause.textContent = '▶'; });

seekBar.addEventListener('pointerdown', () => { state.scrubbing = true; });
seekBar.addEventListener('pointerup', () => { state.scrubbing = false; });
seekBar.addEventListener('input', () => {
  const f = Number(seekBar.value) / 1000;
  if (ws.mode === 'source') {
    if (video.duration) video.currentTime = f * video.duration;
  } else {
    if (ws.playing) pauseTimeline();
    seekTimeline(f * timelineDuration());
  }
});

video.addEventListener('timeupdate', () => {
  if (state.editMode === 'reframe') positionCropOverlay();
  if (state.editMode === 'stickers') positionStickerLayer();
  if (state.recording) {
    const recClip = state.clips.find((c) => c.id === state.recording.clipId);
    if (!recClip || video.currentTime >= recClip.end - 0.05) stopVoiceover();
    // Keep the playhead moving while recording a voiceover.
    const entry = recClip && entryForClip(recClip.id);
    if (entry) {
      ws.time = entry.start + Math.max(0, video.currentTime - recClip.start) / (recClip.speed || 1);
      renderPlayhead();
    }
  }
  if (!ws.playing) updateTimeLabel();
  updatePreviewFx();
});

video.addEventListener('seeked', () => { if (ws.mode === 'source') updateTimeLabel(); });

video.addEventListener('loadedmetadata', () => {
  const src = state.sources.find((s) => s.path === state.activeSourcePath);
  if (src) {
    if (!src.width) { src.width = video.videoWidth; src.height = video.videoHeight; }
    if (!src.duration && isFinite(video.duration)) src.duration = video.duration;
  }
});

W.btnFullscreen.addEventListener('click', () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else videoStage.requestFullscreen().catch(() => {});
});

// Only the clip under the timeline playhead gets its effects previewed.
function clipUnderPlayhead() {
  if (ws.mode !== 'timeline') return null;
  return state.clips.find((c) => c.id === state.previewClipId) || null;
}

// ---------- Source preview (looking at a library video) ----------
async function openSourcePreview(path) {
  pauseTimeline();
  previewMusic.pause();
  previewVoice.pause();
  ws.mode = 'source';
  ws.sourcePreviewPath = path;
  await switchActiveSource(path);
  video.currentTime = 0;
  applyClipSound(null);
  resetMarks();
  W.sourceMarkRow.classList.remove('hidden');
  W.btnBackToTimeline.classList.remove('hidden');
  W.playerTitle.textContent = `Player · ${sourceName(path)}`;
  document.body.classList.add('source-mode');
  updatePreviewFx();
  updateTimeLabel();
  renderLeftPanel();
}

function exitSourcePreview(seek = true) {
  if (ws.mode !== 'source') return;
  video.pause();
  ws.mode = 'timeline';
  ws.sourcePreviewPath = null;
  W.sourceMarkRow.classList.add('hidden');
  W.btnBackToTimeline.classList.add('hidden');
  W.playerTitle.textContent = 'Player · Timeline';
  document.body.classList.remove('source-mode');
  renderLeftPanel();
  if (seek) seekTimeline(ws.time);
}

W.btnBackToTimeline.addEventListener('click', () => exitSourcePreview(true));

// ---------- Media library ----------
async function importVideo(filePath, fileUrl, fileName) {
  const known = state.sources.find((s) => s.path === filePath);
  const source = known || await addSource(filePath, fileUrl, fileName);
  try {
    const info = await window.nineJaCut.probeMedia(filePath);
    source.duration = info.duration || source.duration;
    source.width = info.width || source.width;
    source.height = info.height || source.height;
    source.hasAudio = info.hasAudio;
  } catch (e) { /* preview still works */ }
  if (!source.thumbUrl) {
    window.nineJaCut.generateThumbnail({ sourcePath: filePath, time: Math.min(1, (source.duration || 2) / 2) })
      .then((thumb) => { source.thumbUrl = thumb; if (ws.tab === 'media') renderLeftPanel(); })
      .catch(() => {});
  }
  dropHint.classList.add('hidden');
  return source;
}

async function importVideos(files) {
  if (!files.length) return;
  const wasEmpty = state.clips.length === 0;
  const imported = [];
  for (const f of files) imported.push(await importVideo(f.filePath, f.fileUrl, f.fileName));
  // First import into an empty project goes straight onto the timeline.
  if (wasEmpty) {
    for (const src of imported) addWholeVideo(src, false);
    selectClip(state.clips[0] ? state.clips[0].id : null);
    await seekTimeline(0);
  }
  ws.tab = 'media';
  renderToolTabs();
  renderLeftPanel();
  renderClipList();
  setStatus(imported.length === 1 ? `Imported ${imported[0].name}` : `Imported ${imported.length} videos`);
}

function makeClipFromSource(src, start, end) {
  clipCounter += 1;
  return normalizeClip({
    id: `clip-${clipCounter}-${Date.now()}`,
    name: state.clips.length ? `${src.name.replace(/\.[^.]+$/, '')} ${clipCounter}` : src.name.replace(/\.[^.]+$/, ''),
    sourcePath: src.path,
    start,
    end,
    aspect: 'original',
    customRatio: { w: 16, h: 9 },
    crop: null,
    audio: null,
    stickers: [],
    thumbUrl: null,
  });
}

function addWholeVideo(src, withUndo = true, index = state.clips.length) {
  const duration = src.duration || (src.path === state.activeSourcePath ? video.duration : 0);
  if (!duration || !isFinite(duration)) {
    setStatus(`Could not read the length of ${src.name}.`);
    return null;
  }
  if (withUndo) pushUndo();
  const clip = makeClipFromSource(src, 0, duration);
  state.clips.splice(index, 0, clip);
  refreshThumbnail(clip);
  return clip;
}

function afterClipAdded(clip) {
  selectClip(clip.id);
  const entry = entryForClip(clip.id);
  if (entry) {
    ws.time = entry.start;
    renderPlayhead();
  }
  renderTimeline();
}

W.btnAddWhole.addEventListener('click', () => {
  const src = state.sources.find((s) => s.path === state.activeSourcePath);
  if (!src) return;
  const clip = addWholeVideo(src);
  if (clip) {
    renderClipList();
    afterClipAdded(clip);
    setStatus(`Added all of ${src.name} to the timeline`);
  }
});

btnOpenVideo.addEventListener('click', async () => {
  closeMenu();
  const files = await window.nineJaCut.selectVideos();
  await importVideos(files);
});

// Drag files from Windows Explorer onto the window.
const VIDEO_FILE_RE = /\.(mp4|mov|mkv|avi|webm|m4v)$/i;
const AUDIO_FILE_RE = /\.(mp3|wav|m4a|aac|ogg|flac|opus)$/i;
window.addEventListener('dragover', (e) => {
  if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) {
    e.preventDefault();
    videoStage.classList.add('drag-active');
  }
});
window.addEventListener('dragleave', (e) => {
  if (e.target === document.documentElement || e.target === document.body) videoStage.classList.remove('drag-active');
});
window.addEventListener('drop', async (e) => {
  videoStage.classList.remove('drag-active');
  const files = e.dataTransfer && e.dataTransfer.files ? [...e.dataTransfer.files] : [];
  if (!files.length) return;
  e.preventDefault();
  const videos = [];
  const audios = [];
  for (const f of files) {
    if (!f.path) continue;
    const fileUrl = await window.nineJaCut.toFileUrl(f.path);
    if (VIDEO_FILE_RE.test(f.name)) videos.push({ filePath: f.path, fileUrl, fileName: f.name });
    else if (AUDIO_FILE_RE.test(f.name)) audios.push({ filePath: f.path, fileUrl, fileName: f.name });
  }
  if (videos.length) await importVideos(videos);
  if (audios.length) await importAudio(audios);
});

async function importAudio(files) {
  for (const f of files) {
    if (ws.audioLibrary.find((a) => a.path === f.filePath)) continue;
    const item = { path: f.filePath, url: f.fileUrl, name: f.fileName, duration: 0 };
    try { item.duration = (await window.nineJaCut.probeMedia(f.filePath)).duration; } catch (e) { /* ignore */ }
    ws.audioLibrary.push(item);
  }
  ws.tab = 'audio';
  renderToolTabs();
  renderLeftPanel();
  setStatus(`Added ${files.length} sound${files.length > 1 ? 's' : ''} to your library`);
}

// ---------- Selection ----------
function selectClip(clipId) {
  if (ws.focusClipId !== clipId) ws.propsTab = ws.propsTab || 'video';
  ws.focusClipId = clipId;
  renderTimeline();
  renderProperties();
  if (['filters', 'adjust', 'effects', 'transitions', 'captions'].includes(ws.tab)) renderLeftPanel();
}

// Everything that used to redraw the old clip list now redraws the
// workspace (the name is kept because the effect code calls it a lot).
function renderClipList() {
  if (ws.focusClipId && !state.clips.find((c) => c.id === ws.focusClipId)) ws.focusClipId = null;
  renderTimeline();
  renderProperties();
  if (ws.tab !== 'media' && ws.tab !== 'audio' && ws.tab !== 'templates' && ws.tab !== 'stickers' && ws.tab !== 'text') renderLeftPanel();
  updateExportReady();
  resyncPreview();
  updatePreviewFx();
}

// After edits (trim, split, reorder, undo) keep the picture in step with
// the playhead.
function resyncPreview() {
  if (ws.mode !== 'timeline' || ws.playing || state.editMode || state.recording) return;
  const entries = timelineEntries();
  const total = entries.length ? entries[entries.length - 1].end : 0;
  if (ws.time > total) ws.time = total;
  const entry = entries.length ? entryAt(ws.time, entries) : null;
  if (!entry) { state.previewClipId = null; renderPlayhead(); updateTimeLabel(); return; }
  const clip = entry.clip;
  const target = clip.start + Math.max(0, ws.time - entry.start) * (clip.speed || 1);
  if (state.previewClipId !== clip.id || clip.sourcePath !== state.activeSourcePath || Math.abs(video.currentTime - target) > 0.05) {
    seekTimeline(ws.time);
  } else {
    renderPlayhead();
    updateTimeLabel();
  }
}
