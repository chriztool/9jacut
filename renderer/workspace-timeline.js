// 9jaCut v2 workspace, part 2: the timeline (tracks, ruler, playhead,
// select, drag to reorder, drag edges to trim, split, delete, duplicate).

const TRANSITION_NAMES = {
  none: 'Cut', fade: 'Crossfade', fadeblack: 'Fade through black', dissolve: 'Dissolve',
  slideleft: 'Slide left', slideup: 'Slide up', wipeleft: 'Wipe', smoothleft: 'Smooth slide', circleopen: 'Circle open',
};

function renderPlayhead() {
  W.tlPlayhead.style.left = `${ws.time * ws.pxPerSec}px`;
}

// Keep the playhead in view while playing.
function followPlayhead() {
  const x = ws.time * ws.pxPerSec;
  const view = W.tlScroll;
  if (x < view.scrollLeft || x > view.scrollLeft + view.clientWidth - 40) {
    view.scrollLeft = Math.max(0, x - 80);
  }
}

function rulerStep() {
  const steps = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
  return steps.find((s) => s * ws.pxPerSec >= 70) || 600;
}

function renderTimeline() {
  const entries = timelineEntries();
  const total = entries.length ? entries[entries.length - 1].end : 0;
  const px = ws.pxPerSec;
  const width = Math.max(W.tlScroll.clientWidth, (total + 6) * px);
  W.tlContent.style.width = `${width}px`;

  // Ruler
  W.tlRuler.innerHTML = '';
  const step = rulerStep();
  for (let t = 0; t * px <= width; t += step) {
    const tick = el('div', 'tl-tick', fmtShort(t));
    tick.style.left = `${t * px}px`;
    W.tlRuler.appendChild(tick);
  }

  // Lanes
  for (const lane of [W.laneOverlay, W.laneCaptions, W.laneAudio]) lane.innerHTML = '';
  W.laneMain.querySelectorAll('.tl-clip, .tl-trans, .tl-drop').forEach((n) => n.remove());
  W.tlEmpty.classList.toggle('hidden', entries.length > 0);

  for (const entry of entries) {
    const { clip } = entry;
    W.laneMain.appendChild(buildClipBlock(entry));

    // Transition marker between this clip and the next.
    const next = entries[entry.index + 1];
    if (next && clip.transitionOut && clip.transitionOut.type !== 'none') {
      const mark = el('button', 'tl-trans', '⧓');
      mark.style.left = `${entry.end * px - 10}px`;
      mark.title = `${TRANSITION_NAMES[clip.transitionOut.type] || clip.transitionOut.type} into the next clip`;
      mark.addEventListener('click', (e) => {
        e.stopPropagation();
        selectClip(clip.id);
        ws.tab = 'transitions';
        renderToolTabs();
        renderLeftPanel();
      });
      W.laneMain.appendChild(mark);
    }

    // Text + stickers
    for (const t of clip.texts || []) {
      if (!String(t.text || '').trim()) continue;
      addLaneBlock(W.laneOverlay, entry, t.start, t.end, `T ${t.text.split('\n')[0]}`, 'blk-text', clip, 'text');
    }
    for (const s of clip.stickers || []) {
      const ui = STICKERS_UI.find((x) => x.key === s.key);
      addLaneBlock(W.laneOverlay, entry, s.start || 0, s.end != null ? s.end : entry.dur, ui ? ui.emoji : '★', 'blk-sticker', clip, 'stickers');
    }
    // Captions
    for (const c of captionPreviewItems(clip)) {
      addLaneBlock(W.laneCaptions, entry, c.start, c.end, c.text, 'blk-caption', clip, 'captions');
    }
    // Music + voiceover
    if (clip.audio && clip.audio.path) {
      addLaneBlock(W.laneAudio, entry, 0, entry.dur, `♪ ${clip.audio.name || 'Music'}`, 'blk-music', clip, 'audio');
    }
    if (clip.voiceover && clip.voiceover.path) {
      addLaneBlock(W.laneAudio, entry, 0, entry.dur, '🎙 Voiceover', 'blk-voice', clip, 'audio');
    }
  }
  renderPlayhead();

  const focus = focusedClip();
  W.tlInfo.textContent = entries.length
    ? `${entries.length} clip${entries.length > 1 ? 's' : ''} · ${formatTime(total)}${focus ? ` · selected: ${focus.name}` : ''}`
    : '';
  W.tlDelete.disabled = !focus;
  W.tlDuplicate.disabled = !focus;
  W.tlReframe.disabled = !focus;
  W.tlSplit.disabled = !entries.length;
}

function addLaneBlock(lane, entry, start, end, label, cls, clip, propsTab) {
  const a = Math.max(0, Math.min(entry.dur, start));
  const b = Math.max(a, Math.min(entry.dur, end));
  if (b - a < 0.01) return;
  const blk = el('div', `tl-blk ${cls}${clip.id === ws.focusClipId ? ' focus' : ''}`, label);
  blk.style.left = `${(entry.start + a) * ws.pxPerSec}px`;
  blk.style.width = `${Math.max(3, (b - a) * ws.pxPerSec - 1)}px`;
  blk.title = label;
  blk.addEventListener('pointerdown', (e) => e.stopPropagation());
  blk.addEventListener('click', (e) => {
    e.stopPropagation();
    ws.propsTab = propsTab;
    selectClip(clip.id);
    seekTimeline(entry.start + a + 0.01);
  });
  lane.appendChild(blk);
}

function buildClipBlock(entry) {
  const { clip } = entry;
  const px = ws.pxPerSec;
  const blk = el('div', `tl-clip${clip.id === ws.focusClipId ? ' selected' : ''}`);
  blk.dataset.clipId = clip.id;
  blk.style.left = `${entry.start * px}px`;
  blk.style.width = `${Math.max(6, entry.dur * px - 2)}px`;
  if (clip.thumbUrl) blk.style.backgroundImage = `url("${clip.thumbUrl}")`;

  const badges = [];
  if (clip.speed !== 1) badges.push(`${clip.speed}x`);
  if (clip.aspect !== 'original') badges.push(ASPECT_PRESETS[clip.aspect] ? ASPECT_PRESETS[clip.aspect].label.split(' ').pop() : 'custom');
  if (clip.look && clip.look.preset !== 'none') badges.push('🎨');
  if (clip.motion !== 'none') badges.push('🔍');
  const label = el('div', 'tl-clip-label');
  label.appendChild(el('span', 'tl-clip-name', clip.name));
  label.appendChild(el('span', 'tl-clip-dur', `${formatTime(entry.dur)}${badges.length ? ` · ${badges.join(' ')}` : ''}`));
  blk.appendChild(label);
  blk.title = `${clip.name} — ${sourceName(clip.sourcePath)} ${formatTime(clip.start)}–${formatTime(clip.end)}`;

  const hl = el('div', 'tl-trim l');
  hl.title = 'Drag to trim the start';
  const hr = el('div', 'tl-trim r');
  hr.title = 'Drag to trim the end';
  blk.appendChild(hl);
  blk.appendChild(hr);

  blk.addEventListener('pointerdown', (e) => onClipPointerDown(e, clip, blk, e.target === hl ? 'l' : (e.target === hr ? 'r' : 'move')));
  return blk;
}

// ---------- Drag: trim or reorder ----------
let tlDrag = null;

function onClipPointerDown(e, clip, blk, kind) {
  if (e.button !== 0) return;
  e.stopPropagation();
  e.preventDefault();
  if (ws.playing) pauseTimeline();
  tlDrag = {
    kind, clip, blk, x0: e.clientX, moved: false,
    start0: clip.start, end0: clip.end,
  };
  if (kind !== 'move') armSnapshot();
  // Listen on the window so the drag keeps working even if the pointer
  // leaves the block or the timeline is redrawn underneath it.
  window.addEventListener('pointermove', onClipPointerMove);
  window.addEventListener('pointerup', onClipPointerUp);
  window.addEventListener('pointercancel', onClipPointerUp);
}

function onClipPointerMove(e) {
  const d = tlDrag;
  if (!d) return;
  const dx = e.clientX - d.x0;
  if (!d.moved && Math.abs(dx) < 4) return;
  d.moved = true;
  const clip = d.clip;
  if (d.kind === 'l' || d.kind === 'r') {
    const srcDelta = (dx / ws.pxPerSec) * (clip.speed || 1);
    const srcLen = (state.sources.find((s) => s.path === clip.sourcePath) || {}).duration || Infinity;
    if (d.kind === 'l') clip.start = Math.min(d.end0 - 0.2, Math.max(0, d.start0 + srcDelta));
    else clip.end = Math.max(d.start0 + 0.2, Math.min(srcLen, d.end0 + srcDelta));
    commitSnapshotIfArmed();
    renderTimeline();
    setStatus(`${clip.name}: ${formatTime(clip.start)} → ${formatTime(clip.end)} (${formatTime(clipOutputDuration(clip))})`);
  } else {
    const live = W.laneMain.querySelector(`.tl-clip[data-clip-id="${clip.id}"]`) || d.blk;
    live.classList.add('dragging');
    live.style.transform = `translateX(${dx}px)`;
    showDropIndicator(dropIndexFor(e.clientX, clip.id));
  }
}

function onClipPointerUp(e) {
  const d = tlDrag;
  tlDrag = null;
  window.removeEventListener('pointermove', onClipPointerMove);
  window.removeEventListener('pointerup', onClipPointerUp);
  window.removeEventListener('pointercancel', onClipPointerUp);
  if (!d) return;
  hideDropIndicator();
  const clip = d.clip;
  // On touch screens a swipe across a clip scrolls the timeline: the browser
  // takes over and cancels the pointer. That is not a tap, so do nothing.
  if (e.type === 'pointercancel' && !d.moved) {
    state.pendingSnapshot = null;
    return;
  }
  if (!d.moved) {
    state.pendingSnapshot = null;
    selectClip(clip.id);
    // Clicking a clip that isn't under the playhead jumps to the click.
    const entry = entryForClip(clip.id);
    const rect = W.tlContent.getBoundingClientRect();
    const t = (e.clientX - rect.left) / ws.pxPerSec;
    if (entry && (ws.time < entry.start || ws.time >= entry.end)) seekTimeline(Math.min(entry.end - 0.01, Math.max(entry.start, t)));
    return;
  }
  if (d.kind === 'move') {
    const target = dropIndexFor(e.clientX, clip.id);
    const from = state.clips.indexOf(clip);
    let to = target > from ? target - 1 : target;
    if (to !== from) {
      pushUndo();
      state.clips.splice(from, 1);
      state.clips.splice(to, 0, clip);
      setStatus(`Moved ${clip.name}`);
    }
    selectClip(clip.id);
    renderClipList();
    const entry = entryForClip(clip.id);
    if (entry) seekTimeline(entry.start);
  } else {
    if (clip.start !== d.start0) refreshThumbnail(clip);
    renderClipList();
  }
}

// Index (0..n) where a dragged clip would land.
function dropIndexFor(clientX, draggingId) {
  const rect = W.tlContent.getBoundingClientRect();
  const t = (clientX - rect.left) / ws.pxPerSec;
  const entries = timelineEntries();
  for (const e of entries) {
    if (e.clip.id === draggingId) continue;
    if (t < (e.start + e.end) / 2) return e.index;
  }
  return entries.length;
}

function showDropIndicator(index) {
  let ind = W.laneMain.querySelector('.tl-drop');
  if (!ind) { ind = el('div', 'tl-drop'); W.laneMain.appendChild(ind); }
  const entries = timelineEntries();
  const x = index >= entries.length ? (entries.length ? entries[entries.length - 1].end : 0) : entries[index].start;
  ind.style.left = `${x * ws.pxPerSec - 2}px`;
}

function hideDropIndicator() {
  const ind = W.laneMain.querySelector('.tl-drop');
  if (ind) ind.remove();
}

// Library videos can be dragged onto the video track.
W.laneMain.addEventListener('dragover', (e) => {
  if ([...e.dataTransfer.types].includes('text/x-9jacut-source')) {
    e.preventDefault();
    showDropIndicator(dropIndexFor(e.clientX, null));
  }
});
W.laneMain.addEventListener('dragleave', hideDropIndicator);
W.laneMain.addEventListener('drop', (e) => {
  const path = e.dataTransfer.getData('text/x-9jacut-source');
  hideDropIndicator();
  if (!path) return;
  e.preventDefault();
  e.stopPropagation();
  const src = state.sources.find((s) => s.path === path);
  if (!src) return;
  const clip = addWholeVideo(src, true, dropIndexFor(e.clientX, null));
  if (clip) { renderClipList(); afterClipAdded(clip); }
});

// ---------- Click / drag on the ruler or empty track = move playhead ----------
function timeFromEvent(e) {
  const rect = W.tlContent.getBoundingClientRect();
  return Math.max(0, (e.clientX - rect.left) / ws.pxPerSec);
}

W.tlContent.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || e.target.closest('.tl-clip, .tl-blk, .tl-trans')) return;
  if (ws.mode === 'source') exitSourcePreview(false);
  if (ws.playing) pauseTimeline();
  if (!e.target.closest('.tl-playhead')) {
    ws.focusClipId = null;
    renderTimeline();
    renderProperties();
  }
  seekTimeline(timeFromEvent(e));
  const move = (ev) => seekTimeline(timeFromEvent(ev));
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', up);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
});

// ---------- Zoom ----------
function setZoom(pxPerSec, keepTime = ws.time) {
  const view = W.tlScroll;
  const anchor = keepTime * ws.pxPerSec - view.scrollLeft;
  ws.pxPerSec = Math.min(300, Math.max(4, pxPerSec));
  W.tlZoom.value = String(Math.round(ws.pxPerSec));
  renderTimeline();
  view.scrollLeft = Math.max(0, keepTime * ws.pxPerSec - anchor);
}

W.tlZoom.addEventListener('input', () => setZoom(Number(W.tlZoom.value)));
W.tlZoomIn.addEventListener('click', () => setZoom(ws.pxPerSec * 1.4));
W.tlZoomOut.addEventListener('click', () => setZoom(ws.pxPerSec / 1.4));
W.tlFit.addEventListener('click', fitTimeline);

function fitTimeline() {
  const total = timelineDuration();
  if (!total) return;
  setZoom((W.tlScroll.clientWidth - 60) / total, 0);
  W.tlScroll.scrollLeft = 0;
}

W.tlScroll.addEventListener('wheel', (e) => {
  if (e.ctrlKey) {
    e.preventDefault();
    setZoom(ws.pxPerSec * (e.deltaY < 0 ? 1.15 : 1 / 1.15));
  }
}, { passive: false });

window.addEventListener('resize', () => renderTimeline());

// ---------- Edit commands ----------
function splitAtPlayhead() {
  const entries = timelineEntries();
  const entry = entries.length ? entryAt(ws.time, entries) : null;
  if (!entry) return;
  const local = ws.time - entry.start;
  if (local < 0.1 || local > entry.dur - 0.1) {
    setStatus('Move the playhead inside a clip (not at its very start or end) to split it.');
    return;
  }
  if (ws.playing) pauseTimeline();
  pushUndo();
  const a = entry.clip;
  const b = cloneClips([a])[0];
  const speed = a.speed || 1;
  const cut = a.start + local * speed;
  clipCounter += 1;
  b.id = `clip-${clipCounter}-${Date.now()}`;
  b.name = `${a.name.replace(/ \(\d+\)$/, '')} (2)`;
  b.start = cut;
  a.end = cut;

  // Text and stickers follow the half they're in.
  const splitTimed = (items) => {
    const first = [];
    const second = [];
    for (const it of items || []) {
      const s = it.start || 0;
      const e = it.end != null ? it.end : entry.dur;
      if (s < local) first.push({ ...it, end: Math.min(e, local) });
      if (e > local) second.push({ ...it, id: `${it.id || 'x'}-b${Date.now()}`, start: Math.max(0, s - local), end: e - local });
    }
    return [first, second];
  };
  [a.texts, b.texts] = splitTimed(a.texts);
  [a.stickers, b.stickers] = splitTimed(a.stickers);
  // Music / voiceover carry on from where the first half stopped.
  if (b.audio) b.audio.offset = (a.audio.offset || 0) + local;
  if (b.voiceover) b.voiceover.offset = (a.voiceover.offset || 0) + local;
  // Fades only at the outer ends; the transition belongs to the second half.
  b.fade = { ...a.fade, in: 0 };
  a.fade = { ...a.fade, out: 0 };
  b.transitionOut = { ...a.transitionOut };
  a.transitionOut = { type: 'none', duration: a.transitionOut ? a.transitionOut.duration : 0.5 };

  state.clips.splice(entry.index + 1, 0, b);
  refreshThumbnail(b);
  ws.focusClipId = b.id;
  renderClipList();
  setStatus(`Split ${a.name} at ${formatTime(ws.time)}`);
}

function deleteFocusedClip() {
  const clip = focusedClip();
  if (!clip) return;
  pushUndo();
  const idx = state.clips.indexOf(clip);
  state.clips.splice(idx, 1);
  if (state.selectedClipId === clip.id) exitEditModes();
  ws.focusClipId = state.clips[Math.min(idx, state.clips.length - 1)] ? state.clips[Math.min(idx, state.clips.length - 1)].id : null;
  renderClipList();
  setStatus(`Deleted ${clip.name}`);
}

function duplicateFocusedClip() {
  const clip = focusedClip();
  if (!clip) return;
  pushUndo();
  clipCounter += 1;
  const copy = cloneClips([clip])[0];
  copy.id = `clip-${clipCounter}-${Date.now()}`;
  copy.name = `${clip.name} copy`;
  state.clips.splice(state.clips.indexOf(clip) + 1, 0, copy);
  ws.focusClipId = copy.id;
  renderClipList();
  setStatus(`Duplicated ${clip.name}`);
}

function reframeFocusedClip() {
  const clip = focusedClip();
  if (!clip) return;
  if (clip.aspect === 'original') {
    pushUndo();
    clip.aspect = 'vertical';
    ensureCropForClip(clip);
  }
  if (ws.playing) pauseTimeline();
  enterReframeMode(clip.id);
}

W.tlSplit.addEventListener('click', splitAtPlayhead);
W.tlDelete.addEventListener('click', deleteFocusedClip);
W.tlDuplicate.addEventListener('click', duplicateFocusedClip);
W.tlReframe.addEventListener('click', reframeFocusedClip);
