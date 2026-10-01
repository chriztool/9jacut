// 9jaCut v2 workspace, part 3: the left tool tabs (Media, Audio, Text,
// Stickers, Effects, Transitions, Captions, Filters, Adjust, Templates).

const TEXT_PRESETS = [
  { name: 'Default', text: 'Your text here', style: 'plain', color: '#ffffff', size: 7, position: 'center' },
  { name: 'Bold outline', text: 'Bold outline', style: 'outline', color: '#ffffff', size: 8, position: 'bottom' },
  { name: 'Headline', text: 'BIG NEWS!', style: 'outline', color: '#ffd23f', size: 11, position: 'top' },
  { name: 'Boxed label', text: 'Boxed label', style: 'box', color: '#ffffff', size: 6, position: 'bottom' },
  { name: 'Naija green', text: '9ja to the world', style: 'box', color: '#3ddc84', size: 7, position: 'top' },
  { name: 'Sale', text: '50% OFF TODAY', style: 'outline', color: '#ff5a5f', size: 10, position: 'center' },
  { name: 'Subtitle', text: 'Small subtitle', style: 'box', color: '#ffffff', size: 4.5, position: 'bottom' },
  { name: 'Call to action', text: 'Follow for more!', style: 'box', color: '#ffd23f', size: 7, position: 'bottom' },
];

const EFFECT_MOTIONS = [
  ['none', 'No motion', '▢'], ['zoomin', 'Slow zoom in', '⤢'], ['zoomout', 'Slow zoom out', '⤡'], ['punchin', 'Fast zoom in', '✸'],
];
const EFFECT_FADES = [
  ['none', 'No fade', 0, 0], ['in', 'Fade in', 1, 0], ['out', 'Fade out', 0, 1], ['both', 'Fade in & out', 1, 1],
];
const EFFECT_SPEEDS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4];

const FORMAT_TEMPLATES = [
  { key: 'vertical', name: 'TikTok · Reels · Shorts', ratio: '9:16', w: 9, h: 16 },
  { key: 'landscape', name: 'YouTube · Facebook', ratio: '16:9', w: 16, h: 9 },
  { key: 'square', name: 'Instagram post', ratio: '1:1', w: 1, h: 1 },
  { key: 'portrait', name: 'Instagram portrait', ratio: '4:5', w: 4, h: 5 },
  { key: 'original', name: 'Keep original shape', ratio: 'Original', w: 16, h: 10 },
];

const CAPTION_STYLE_PRESETS = [
  { name: 'Clean box', style: { style: 'box', color: '#ffffff', size: 6, position: 'bottom', upper: false } },
  { name: 'Bold yellow', style: { style: 'outline', color: '#ffd23f', size: 7, position: 'bottom', upper: true } },
  { name: 'Big centre', style: { style: 'outline', color: '#ffffff', size: 9, position: 'center', upper: true } },
  { name: 'Top subtitle', style: { style: 'box', color: '#ffffff', size: 5, position: 'top', upper: false } },
];

function renderToolTabs() {
  for (const b of W.toolTabs.querySelectorAll('button')) b.classList.toggle('active', b.dataset.tab === ws.tab);
}

W.toolTabs.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-tab]');
  if (!b) return;
  ws.tab = b.dataset.tab;
  renderToolTabs();
  renderLeftPanel();
});

function panelHead(title, sub) {
  const head = el('div', 'lp-head');
  head.appendChild(el('h3', null, title));
  if (sub) head.appendChild(el('p', 'lp-sub', sub));
  return head;
}

function targetNote() {
  const c = targetClip();
  const note = el('div', 'lp-target');
  if (!state.clips.length) {
    note.textContent = 'Add a clip to the timeline first.';
  } else {
    const label = el('span', null, ws.applyAll ? `Applies to all ${state.clips.length} clips` : `Applies to: ${c ? c.name : '—'}`);
    note.appendChild(label);
    const sw = makeCheck('All clips', ws.applyAll, (on) => { ws.applyAll = on; renderLeftPanel(); });
    sw.classList.add('apply-all');
    note.appendChild(sw);
  }
  return note;
}

function needClip() {
  if (!targetClips().length) {
    setStatus('Select a clip on the timeline first (or add one).');
    return false;
  }
  return true;
}

function renderLeftPanel() {
  const body = W.leftBody;
  body.innerHTML = '';
  const builders = {
    media: buildMediaTab, audio: buildAudioTab, text: buildTextTab, stickers: buildStickersTab,
    effects: buildEffectsTab, transitions: buildTransitionsTab, captions: buildCaptionsTab,
    filters: buildFiltersTab, adjust: buildAdjustTab, templates: buildTemplatesTab,
  };
  (builders[ws.tab] || buildMediaTab)(body);
}

// ---------- Media ----------
function buildMediaTab(body) {
  body.appendChild(panelHead('Media', 'Your imported videos. Click one to preview it and pick a part, or press + to add the whole video to the timeline.'));
  const actions = el('div', 'lp-actions');
  actions.appendChild(button('＋ Import videos', 'btn primary', () => btnOpenVideo.click()));
  body.appendChild(actions);

  if (!state.sources.length) {
    const empty = el('div', 'lp-empty');
    empty.innerHTML = 'No videos yet.<br>Click <strong>Import videos</strong> or drag video files onto the window.';
    body.appendChild(empty);
    return;
  }
  const grid = el('div', 'media-grid');
  for (const src of state.sources) {
    const card = el('div', `media-card${src.path === ws.sourcePreviewPath ? ' active' : ''}`);
    card.draggable = true;
    card.title = `${src.name}\nClick to preview · drag onto the timeline`;
    const thumb = el('div', 'media-thumb');
    if (src.thumbUrl) thumb.style.backgroundImage = `url("${src.thumbUrl}")`;
    thumb.appendChild(el('span', 'media-dur', src.duration ? formatTime(src.duration) : '…'));
    const add = button('+', 'media-add', (e) => {
      e.stopPropagation();
      const clip = addWholeVideo(src);
      if (clip) { renderClipList(); afterClipAdded(clip); setStatus(`Added ${src.name} to the timeline`); }
    }, 'Add the whole video to the end of the timeline');
    thumb.appendChild(add);
    const used = state.clips.some((c) => c.sourcePath === src.path);
    if (used) thumb.appendChild(el('span', 'media-used', 'In use'));
    card.appendChild(thumb);
    card.appendChild(el('div', 'media-name', src.name));
    card.addEventListener('click', () => openSourcePreview(src.path));
    card.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/x-9jacut-source', src.path);
      e.dataTransfer.effectAllowed = 'copy';
    });
    grid.appendChild(card);
  }
  body.appendChild(grid);
  body.appendChild(el('p', 'lp-tip', 'Tip: in the preview, use Mark In (I) and Mark Out (O) to add just a part of a video.'));
}

// ---------- Audio ----------
function buildAudioTab(body) {
  body.appendChild(panelHead('Audio', 'Add music or sound effects from your computer, or record a voiceover.'));
  const actions = el('div', 'lp-actions');
  actions.appendChild(button('＋ Import music', 'btn primary', async () => {
    const files = await window.nineJaCut.selectAudioFiles();
    if (files.length) await importAudio(files);
  }));
  body.appendChild(actions);

  if (!ws.audioLibrary.length) {
    const empty = el('div', 'lp-empty');
    empty.innerHTML = 'No music yet. Import MP3, WAV, M4A or other audio files.<br><span class="lp-dim">Use music you have the rights to — streaming apps like Spotify don\'t allow downloading their tracks.</span>';
    body.appendChild(empty);
  }
  for (const item of ws.audioLibrary) {
    const row = el('div', 'audio-item');
    const play = button(libraryPlayer.dataset.src === item.url && !libraryPlayer.paused ? '⏸' : '▶', 'btn small icon-play', () => {
      if (libraryPlayer.dataset.src === item.url && !libraryPlayer.paused) {
        libraryPlayer.pause();
      } else {
        libraryPlayer.dataset.src = item.url;
        libraryPlayer.src = item.url;
        libraryPlayer.play().catch(() => setStatus('Could not play this file.'));
      }
      setTimeout(renderLeftPanel, 50);
    }, 'Listen');
    const info = el('div', 'audio-info');
    info.appendChild(el('div', 'audio-title', item.name));
    info.appendChild(el('div', 'lp-dim', item.duration ? formatTime(item.duration) : ''));
    const useClip = button('Use on clip', 'btn small', () => useMusicOnClip(item), 'Put this under the selected clip');
    const useAll = button('Whole video', 'btn small primary', () => useMusicOnWholeVideo(item), 'Play this song under the whole timeline, continuing from clip to clip');
    row.appendChild(play);
    row.appendChild(info);
    const btns = el('div', 'audio-btns');
    btns.appendChild(useClip);
    btns.appendChild(useAll);
    row.appendChild(btns);
    body.appendChild(row);
  }

  body.appendChild(el('h4', 'lp-sub-title', 'Voiceover'));
  const c = targetClip();
  const vo = el('div', 'lp-actions');
  vo.appendChild(button('🎙 Record voiceover', 'btn', () => {
    if (!c) { setStatus('Select a clip first.'); return; }
    ws.propsTab = 'audio';
    selectClip(c.id);
    startVoiceover(c);
  }, 'Talk while the selected clip plays'));
  body.appendChild(vo);
  body.appendChild(el('p', 'lp-tip', c ? `Records over “${c.name}”. Wear headphones so the mic only hears you.` : 'Select a clip to record over it.'));
}

function musicFrom(item, offset = 0) {
  return { path: item.path, url: item.url, name: item.name, volume: 0.8, muteOriginal: false, loop: true, offset };
}

function useMusicOnClip(item) {
  const c = targetClip();
  if (!c) { setStatus('Select a clip first.'); return; }
  pushUndo();
  c.audio = musicFrom(item, 0);
  ws.propsTab = 'audio';
  renderClipList();
  setStatus(`Music added under ${c.name}`);
}

function useMusicOnWholeVideo(item) {
  if (!state.clips.length) { setStatus('Add clips to the timeline first.'); return; }
  pushUndo();
  let offset = 0;
  for (const c of state.clips) {
    c.audio = musicFrom(item, offset);
    offset += clipOutputDuration(c);
  }
  ws.propsTab = 'audio';
  renderClipList();
  setStatus(`“${item.name}” now plays under the whole video`);
}

// ---------- Text ----------
function buildTextTab(body) {
  body.appendChild(panelHead('Text', 'Click a style to add text at the playhead. Edit the words in Details on the right.'));
  const grid = el('div', 'preset-grid');
  for (const p of TEXT_PRESETS) {
    const card = el('button', 'text-preset');
    const sample = el('div', `text-sample style-${p.style}`);
    const span = el('span', null, p.name === 'Default' ? 'Text' : p.text.split(' ').slice(0, 2).join(' '));
    span.style.color = p.color;
    sample.appendChild(span);
    card.appendChild(sample);
    card.appendChild(el('div', 'preset-name', p.name));
    card.addEventListener('click', () => addTextPreset(p));
    grid.appendChild(card);
  }
  body.appendChild(grid);
}

function addTextPreset(p) {
  const entries = timelineEntries();
  const entry = focusedClip() ? entryForClip(ws.focusClipId, entries) : entryAt(ws.time, entries);
  if (!entry) { setStatus('Add a clip to the timeline first.'); return; }
  const clip = entry.clip;
  let start = ws.time - entry.start;
  if (start < 0 || start >= entry.dur - 0.2) start = 0;
  pushUndo();
  textCounter += 1;
  clip.texts.push({
    id: `text-${textCounter}-${Date.now()}`,
    text: p.text, size: p.size, color: p.color, position: p.position, style: p.style,
    start, end: Math.min(entry.dur, start + 3),
  });
  ws.propsTab = 'text';
  ws.focusClipId = clip.id;
  renderClipList();
  seekTimeline(entry.start + start + 0.05);
  const boxes = document.querySelectorAll(`[data-text-clip="${clip.id}"]`);
  if (boxes.length) { boxes[boxes.length - 1].focus(); boxes[boxes.length - 1].select(); }
  setStatus(`Added “${p.name}” text to ${clip.name}`);
}

// ---------- Stickers ----------
function buildStickersTab(body) {
  body.appendChild(panelHead('Stickers', 'Click a sticker to put it on the selected clip, then drag it where you want it in the player.'));
  const grid = el('div', 'sticker-grid');
  for (const s of STICKERS_UI) {
    const b = el('button', 'sticker-cell');
    if (state.stickerAssets[s.key]) {
      const img = document.createElement('img');
      img.src = state.stickerAssets[s.key];
      img.alt = s.key;
      b.appendChild(img);
    } else {
      b.textContent = s.emoji;
    }
    b.title = s.key.replace(/_/g, ' ');
    b.addEventListener('click', async () => {
      const c = targetClip();
      if (!c) { setStatus('Select a clip first.'); return; }
      if (ws.playing) pauseTimeline();
      if (state.editMode !== 'stickers' || state.selectedClipId !== c.id) await enterStickerMode(c.id);
      addStickerToSelectedClip(s.key);
      ws.propsTab = 'stickers';
      renderProperties();
    });
    grid.appendChild(b);
  }
  body.appendChild(grid);
}

// ---------- Effects ----------
function buildEffectsTab(body) {
  body.appendChild(panelHead('Effects', 'Movement, fades and speed for your clips.'));
  body.appendChild(targetNote());
  const c = targetClip();

  body.appendChild(el('h4', 'lp-sub-title', 'Motion'));
  const g1 = el('div', 'fx-grid');
  for (const [key, name, icon] of EFFECT_MOTIONS) {
    g1.appendChild(fxCard(icon, name, c && c.motion === key, () => applyToTargets((cl) => { cl.motion = key; }, name)));
  }
  body.appendChild(g1);

  body.appendChild(el('h4', 'lp-sub-title', 'Fade'));
  const g2 = el('div', 'fx-grid');
  for (const [key, name, fi, fo] of EFFECT_FADES) {
    const on = c && ((key === 'none' && !c.fade.in && !c.fade.out) || (key !== 'none' && !!c.fade.in === !!fi && !!c.fade.out === !!fo));
    g2.appendChild(fxCard(key === 'none' ? '▢' : (key === 'in' ? '◐' : key === 'out' ? '◑' : '◎'), name, on, () => applyToTargets((cl) => { cl.fade = { in: fi, out: fo }; }, name)));
  }
  body.appendChild(g2);

  body.appendChild(el('h4', 'lp-sub-title', 'Speed'));
  const g3 = el('div', 'fx-grid speeds');
  for (const sp of EFFECT_SPEEDS) {
    g3.appendChild(fxCard(`${sp}x`, sp < 1 ? 'Slow-mo' : sp === 1 ? 'Normal' : 'Fast', c && c.speed === sp, () => applyToTargets((cl) => { cl.speed = sp; }, `${sp}x speed`)));
  }
  body.appendChild(g3);
}

function fxCard(icon, name, active, onClick) {
  const b = el('button', `fx-card${active ? ' active' : ''}`);
  b.appendChild(el('div', 'fx-icon', icon));
  b.appendChild(el('div', 'preset-name', name));
  b.addEventListener('click', onClick);
  return b;
}

function applyToTargets(fn, label) {
  if (!needClip()) return;
  const clips = targetClips();
  pushUndo();
  for (const c of clips) fn(c);
  renderClipList();
  renderLeftPanel();
  setStatus(`${label} → ${clips.length === 1 ? clips[0].name : `${clips.length} clips`}`);
}

// ---------- Transitions ----------
function buildTransitionsTab(body) {
  body.appendChild(panelHead('Transitions', 'How the selected clip changes into the next one. Exported when you export one video.'));
  body.appendChild(targetNote());
  const c = targetClip();
  const current = c && c.transitionOut ? c.transitionOut : { type: 'none', duration: 0.5 };
  const grid = el('div', 'fx-grid transitions');
  for (const [key, name] of Object.entries(TRANSITION_NAMES)) {
    const card = el('button', `trans-card${current.type === key ? ' active' : ''}`);
    const demo = el('div', `trans-demo t-${key}`);
    demo.appendChild(el('span', 'a'));
    demo.appendChild(el('span', 'b'));
    card.appendChild(demo);
    card.appendChild(el('div', 'preset-name', name));
    card.addEventListener('click', () => applyTransition(key));
    grid.appendChild(card);
  }
  body.appendChild(grid);
  const durSel = makeSelect([['0.3', '0.3 seconds'], ['0.5', '0.5 seconds'], ['1', '1 second'], ['1.5', '1.5 seconds']], current.duration, (v) => {
    applyToTargets((cl) => { cl.transitionOut = { ...(cl.transitionOut || { type: 'none' }), duration: Number(v) }; }, `Transition length ${v}s`);
  });
  body.appendChild(makeLine('Length', durSel));
}

function applyTransition(type) {
  const clips = targetClips();
  if (!clips.length) { setStatus('Select a clip first.'); return; }
  const last = state.clips[state.clips.length - 1];
  const usable = clips.filter((c) => c !== last);
  if (!usable.length) {
    setStatus('A transition goes between two clips — select a clip that has another clip after it.');
    return;
  }
  pushUndo();
  for (const c of usable) c.transitionOut = { type, duration: (c.transitionOut && c.transitionOut.duration) || 0.5 };
  renderClipList();
  renderLeftPanel();
  setStatus(`${TRANSITION_NAMES[type]} → ${usable.length === 1 ? `after ${usable[0].name}` : `${usable.length} clips`}`);
}

// ---------- Captions ----------
function buildCaptionsTab(body) {
  body.appendChild(panelHead('Captions', 'Turn speech into captions automatically. Runs on your computer — free, no upload.'));
  const c = targetClip();
  const langSel = makeSelect(captionUi.info.languages, captionUi.prefs.language, (v) => { captionUi.prefs.language = v; saveCaptionPrefs(); });
  const modelOptions = captionUi.info.models.length
    ? captionUi.info.models.map((m) => [m.key, `${m.label}${m.ready ? ' ✓' : ` (${m.downloadMB} MB)`}`])
    : [['accurate', 'Accurate'], ['fast', 'Fast']];
  const modelSel = makeSelect(modelOptions, captionUi.prefs.model, (v) => { captionUi.prefs.model = v; saveCaptionPrefs(); });
  body.appendChild(makeLine('Language', langSel));
  body.appendChild(makeLine('Quality', modelSel));
  body.appendChild(makeLine('', makeCheck('Translate to English', !!captionUi.prefs.translate, (on) => { captionUi.prefs.translate = on; saveCaptionPrefs(); })));

  const actions = el('div', 'lp-actions column');
  const busy = !!captionUi.job;
  const one = button(c ? `💬 Caption “${c.name}”` : '💬 Caption selected clip', 'btn primary', async () => {
    if (!c) { setStatus('Select a clip first.'); return; }
    ws.propsTab = 'captions';
    ws.focusClipId = c.id;
    renderProperties();
    await runAutoCaptions(c);
    renderLeftPanel();
  });
  one.disabled = busy || !c;
  const all = button('Caption all clips', 'btn', captionAllClips);
  all.disabled = busy || !state.clips.length;
  actions.appendChild(one);
  actions.appendChild(all);
  body.appendChild(actions);
  const status = el('div', 'lp-status');
  status.id = 'captionsTabStatus';
  status.textContent = busy ? captionUi.job.text : '';
  body.appendChild(status);
  body.appendChild(el('p', 'lp-tip', 'The first time, the speech model downloads once (Accurate ≈ 208 MB, Fast ≈ 116 MB). After that, captions work offline.'));

  body.appendChild(el('h4', 'lp-sub-title', 'Caption style'));
  const grid = el('div', 'preset-grid');
  for (const p of CAPTION_STYLE_PRESETS) {
    const card = el('button', 'text-preset');
    const sample = el('div', `text-sample style-${p.style.style}`);
    const span = el('span', null, p.style.upper ? 'HELLO NAIJA' : 'Hello Naija');
    span.style.color = p.style.color;
    sample.appendChild(span);
    card.appendChild(sample);
    card.appendChild(el('div', 'preset-name', p.name));
    card.addEventListener('click', () => {
      const clips = state.clips.filter((cl) => cl.captions);
      if (!clips.length) { setStatus('Make captions first, then pick a style.'); return; }
      pushUndo();
      for (const cl of clips) cl.captions.style = { ...cl.captions.style, ...p.style };
      renderClipList();
      setStatus(`Caption style “${p.name}” applied to ${clips.length} clip${clips.length > 1 ? 's' : ''}`);
    });
    grid.appendChild(card);
  }
  body.appendChild(grid);
}

async function captionAllClips() {
  const todo = state.clips.filter((c) => !c.captions);
  if (!todo.length) { setStatus('Every clip already has captions. Use “Redo captions” in Details to make them again.'); return; }
  for (let i = 0; i < todo.length; i++) {
    setStatus(`Captioning clip ${i + 1} of ${todo.length}…`);
    await runAutoCaptions(todo[i]);
  }
  renderLeftPanel();
  setStatus(`Finished captions for ${todo.length} clip${todo.length > 1 ? 's' : ''}. Check the words in Details.`);
}

window.nineJaCut.onCaptionsProgress((data) => {
  const elStatus = document.getElementById('captionsTabStatus');
  if (elStatus) elStatus.textContent = captionStatusText(data);
});

// ---------- Filters ----------
function buildFiltersTab(body) {
  body.appendChild(panelHead('Filters', 'Colour looks. The preview is close; the export is exact.'));
  body.appendChild(targetNote());
  const c = targetClip();
  if (c && ws.filterThumb.clipId !== c.id) {
    ws.filterThumb = { clipId: c.id, url: c.thumbUrl || null };
    window.nineJaCut.generateThumbnail({ sourcePath: c.sourcePath, time: c.start + Math.min(1, (c.end - c.start) / 2) })
      .then((url) => {
        if (ws.filterThumb.clipId === c.id && url) {
          ws.filterThumb.url = url;
          if (ws.tab === 'filters') renderLeftPanel();
        }
      }).catch(() => {});
  }
  const grid = el('div', 'filter-grid');
  for (const [key, name] of LOOK_OPTIONS) {
    const card = el('button', `filter-card${c && c.look.preset === key ? ' active' : ''}`);
    const img = el('div', 'filter-thumb');
    if (ws.filterThumb.url) img.style.backgroundImage = `url("${ws.filterThumb.url}")`;
    img.style.filter = LOOK_PREVIEW[key] || 'none';
    card.appendChild(img);
    card.appendChild(el('div', 'preset-name', name));
    card.addEventListener('click', () => applyToTargets((cl) => { cl.look = { ...cl.look, preset: key }; }, name));
    grid.appendChild(card);
  }
  body.appendChild(grid);
}

// ---------- Adjust ----------
function buildAdjustTab(body) {
  body.appendChild(panelHead('Adjust', 'Fine-tune the picture of the selected clip.'));
  const c = targetClip();
  if (!c) { body.appendChild(el('div', 'lp-empty', 'Select a clip on the timeline.')); return; }
  body.appendChild(el('div', 'lp-target', `Adjusting: ${c.name}`));
  const live = () => { updatePreviewFx(); };
  const row = (label, min, max, step, key) => {
    const val = el('span', 'fx-note', Number(c.look[key]).toFixed(2));
    const slider = makeSlider(min, max, step, c.look[key], (v) => { c.look[key] = v; val.textContent = v.toFixed(2); live(); });
    return makeLine(label, slider, val);
  };
  body.appendChild(row('Brightness', -0.3, 0.3, 0.01, 'brightness'));
  body.appendChild(row('Contrast', 0.5, 1.5, 0.01, 'contrast'));
  body.appendChild(row('Saturation', 0, 2, 0.01, 'saturation'));
  const vol = el('span', 'fx-note', `${Math.round(c.origVolume * 100)}%`);
  body.appendChild(makeLine('Video sound', makeSlider(0, 2, 0.05, c.origVolume, (v) => { c.origVolume = v; vol.textContent = `${Math.round(v * 100)}%`; applyClipSound(c); }), vol));
  const actions = el('div', 'lp-actions');
  actions.appendChild(button('Reset', 'btn small', () => {
    pushUndo();
    c.look = { ...c.look, brightness: 0, contrast: 1, saturation: 1 };
    renderClipList();
    renderLeftPanel();
  }));
  actions.appendChild(button('Copy to all clips', 'btn small', () => {
    pushUndo();
    for (const other of state.clips) {
      other.look = { ...other.look, brightness: c.look.brightness, contrast: c.look.contrast, saturation: c.look.saturation };
    }
    renderClipList();
    setStatus('Adjustments copied to every clip');
  }));
  body.appendChild(actions);
}

// ---------- Templates ----------
function buildTemplatesTab(body) {
  body.appendChild(panelHead('Templates', 'Set up your whole video for where you will post it.'));
  body.appendChild(el('h4', 'lp-sub-title', 'Video format (all clips)'));
  const grid = el('div', 'format-grid');
  for (const f of FORMAT_TEMPLATES) {
    const card = el('button', 'format-card');
    const shape = el('div', 'format-shape');
    const scale = 46 / Math.max(f.w, f.h);
    shape.style.width = `${Math.round(f.w * scale)}px`;
    shape.style.height = `${Math.round(f.h * scale)}px`;
    if (f.key === 'original') shape.classList.add('dashed');
    card.appendChild(shape);
    card.appendChild(el('div', 'preset-name', f.name));
    card.appendChild(el('div', 'lp-dim', f.ratio));
    card.addEventListener('click', () => applyFormat(f));
    grid.appendChild(card);
  }
  body.appendChild(grid);
  body.appendChild(el('p', 'lp-tip', 'Each clip is centred in the new shape. Select a clip and press Reframe (under the timeline) to choose what stays in shot.'));

  body.appendChild(el('h4', 'lp-sub-title', 'Business promo'));
  const promo = el('button', 'promo-template-card');
  promo.innerHTML = '<strong>🏪 Promo video maker</strong><span>52 ready-made styles for shops, salons, restaurants and services. Add your photos and details, export a vertical promo.</span>';
  promo.addEventListener('click', () => switchMode('promo'));
  body.appendChild(promo);
}

function applyFormat(f) {
  if (!state.clips.length) { setStatus('Add clips to the timeline first.'); return; }
  pushUndo();
  for (const c of state.clips) {
    c.aspect = f.key;
    if (f.key === 'original') c.crop = null;
    else ensureCropForClip(c);
  }
  renderClipList();
  setStatus(`All clips set to ${f.name} (${f.ratio})`);
}
