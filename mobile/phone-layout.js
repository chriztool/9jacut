// 9jaCut phone layout.
//
// Rearranges the desktop workspace into a phone editor, reusing every
// existing panel and control (so every PC editing feature is still there):
//
//   +---------------------------------+
//   | menu  name        undo redo  ⤓  |
//   +---------------------------------+
//   |             player              |
//   | 00:04 / 00:17      ▶       ⛶    |
//   +============ handle =============+  <- drag to resize
//   |  split delete dup …             |
//   |  timeline                       |▏ <- swipe left from the edge:
//   |                                 |     the tool rail slides in
//   +---------------------------------+
//
// The tool rail stays out of the way until you swipe in from the right
// edge. Tapping a tool opens its panel over the timeline, "cut open" from
// the rail by a gold blade line (see mobile/mobile.css), and the rail
// slides away again. The handle under the player (and the panel's grip)
// resize the video against the editing area; sizes are remembered.
//
// Runs only on phones (or with ?phone=1 for testing); iPads keep the full
// desktop workspace.

(function () {
  'use strict';

  const params = new URLSearchParams(location.search);
  const forced = params.get('phone');
  const isPhone = forced ? forced !== '0' : Math.min(screen.width, screen.height) < 600;
  if (!isPhone) return;

  const $ = (id) => document.getElementById(id);
  const html = document.documentElement;
  html.classList.add('phone-layout');

  const workspace = $('clipEditorView');
  const leftPanel = document.querySelector('.left-panel');
  const rightPanel = document.querySelector('.right-panel');
  const playerPanel = document.querySelector('.player-panel');
  const timelinePanel = document.querySelector('.timeline-panel');
  const toolTabs = $('toolTabs');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  // ---------- Top bar: Editor / Promo / About and the theme go in the menu ----------
  const menu = $('menuDropdown');
  const modeTabs = document.querySelector('.mode-tabs');
  const themeBtn = $('btnThemeToggle');
  // (Keyboard shortcuts are hidden by mobile.css: no keyboard on a phone.)
  const modeGroup = document.createElement('div');
  modeGroup.className = 'phone-menu-modes';
  modeGroup.appendChild(modeTabs);
  menu.insertBefore(modeGroup, menu.firstChild);
  const themeRow = document.createElement('button');
  themeRow.id = 'btnPhoneTheme';
  themeRow.textContent = 'Light / dark';
  themeRow.addEventListener('click', () => themeBtn.click());
  menu.appendChild(themeRow);
  // Picking Editor / Promo / About closes the menu.
  modeTabs.addEventListener('click', () => menu.classList.add('hidden'));

  // ---------- The tool rail ----------
  const rail = document.createElement('nav');
  rail.className = 'phone-rail';
  rail.id = 'phoneRail';
  rail.setAttribute('aria-label', 'Editing tools');

  const editBtn = document.createElement('button');
  editBtn.className = 'rail-edit';
  editBtn.dataset.phone = 'details';
  editBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/></svg><span>Edit</span>';
  rail.appendChild(editBtn);

  rail.appendChild(toolTabs); // the same buttons and click handler as on desktop

  const indicator = document.createElement('i');
  indicator.className = 'rail-indicator';
  indicator.setAttribute('aria-hidden', 'true');
  rail.appendChild(indicator);
  workspace.appendChild(rail);

  // The rail is hidden until you swipe in from the right edge. A thin
  // sliver at the edge shows where it is (and can be tapped too).
  const edgeTab = document.createElement('button');
  edgeTab.className = 'rail-edge-tab';
  edgeTab.id = 'railEdgeTab';
  edgeTab.type = 'button';
  edgeTab.setAttribute('aria-label', 'Show editing tools');
  workspace.appendChild(edgeTab);

  let railOpen = false;
  function setRail(open) {
    railOpen = !!open;
    html.classList.toggle('rail-open', railOpen);
    rail.setAttribute('aria-hidden', railOpen ? 'false' : 'true');
    if (railOpen) requestAnimationFrame(() => markOpen());
  }
  const openRail = () => setRail(true);
  const closeRail = () => setRail(false);
  setRail(false);
  edgeTab.addEventListener('click', openRail);

  // Swipe left starting near the right edge -> rail in. Swipe right on the
  // rail -> rail out. Taps anywhere else close it.
  const EDGE = 28;
  let swipe = null;
  document.addEventListener('touchstart', (e) => {
    const t = e.touches[0];
    if (e.touches.length !== 1) { swipe = null; return; }
    const fromEdge = t.clientX >= window.innerWidth - EDGE;
    const onRail = railOpen && rail.contains(e.target);
    swipe = (fromEdge && !railOpen) || onRail ? { x: t.clientX, y: t.clientY, onRail } : null;
  }, { passive: true });
  document.addEventListener('touchend', (e) => {
    if (!swipe) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - swipe.x;
    const dy = Math.abs(t.clientY - swipe.y);
    if (!swipe.onRail && dx < -30 && dy < 80) openRail();
    if (swipe.onRail && dx > 40 && dy < 80) closeRail();
    swipe = null;
  }, { passive: true });
  document.addEventListener('pointerdown', (e) => {
    if (railOpen && !rail.contains(e.target) && e.target !== edgeTab) closeRail();
  }, true);

  // ---------- The sheet that tool panels open in ----------
  const sheet = document.createElement('section');
  sheet.className = 'phone-sheet';
  sheet.id = 'phoneSheet';
  sheet.hidden = true;
  sheet.innerHTML = '<div class="sheet-grip"><span class="grip-bar"></span>'
    + '<button class="sheet-close" type="button" aria-label="Close panel">'
    + '<svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg></button></div>'
    + '<div class="sheet-body"></div><span class="sheet-blade" aria-hidden="true"></span>';
  const sheetBody = sheet.querySelector('.sheet-body');
  sheetBody.appendChild(leftPanel);
  sheetBody.appendChild(rightPanel);
  workspace.appendChild(sheet);

  let openKey = null; // 'details' or a tool tab name, or null

  function railButtonFor(key) {
    return key === 'details' ? editBtn : toolTabs.querySelector(`button[data-tab="${key}"]`);
  }

  function placeSheet() {
    // The sheet covers everything below the player controls.
    const top = playerPanel.offsetTop + playerPanel.offsetHeight;
    workspace.style.setProperty('--sheet-top', `${top}px`);
  }

  function moveIndicator(btn) {
    if (!btn) { indicator.classList.remove('on'); return; }
    const railBox = rail.getBoundingClientRect();
    const b = btn.getBoundingClientRect();
    indicator.style.transform = `translateY(${b.top - railBox.top + rail.scrollTop}px)`;
    indicator.style.height = `${b.height}px`;
    indicator.classList.add('on');
  }

  function markOpen() {
    for (const b of rail.querySelectorAll('button')) b.classList.toggle('is-open', !!openKey && b === railButtonFor(openKey));
    moveIndicator(openKey ? railButtonFor(openKey) : null);
  }

  // The blade starts level with the rail button that was tapped.
  function bladeFrom(btn) {
    const sheetBox = sheet.getBoundingClientRect();
    const b = btn ? btn.getBoundingClientRect() : sheetBox;
    const y = Math.max(0, Math.min(sheetBox.height, b.top + b.height / 2 - sheetBox.top));
    sheet.style.setProperty('--blade-y', `${y}px`);
  }

  function openSheet(key) {
    const wasOpen = !!openKey;
    openKey = key;
    sheet.dataset.pane = key === 'details' ? 'details' : 'tool';
    sheet.dataset.tool = key;
    placeSheet();
    markOpen();
    if (key === 'details' && typeof renderProperties === 'function') renderProperties();
    if (wasOpen) {
      // Switching tools: a quick re-cut instead of closing and opening.
      if (!reduceMotion.matches) {
        sheet.classList.remove('recut');
        void sheet.offsetWidth;
        sheet.classList.add('recut');
      }
      return;
    }
    sheet.hidden = false;
    bladeFrom(railButtonFor(key));
    sheet.classList.remove('closing');
    if (!reduceMotion.matches) {
      sheet.classList.remove('opening');
      void sheet.offsetWidth;
      sheet.classList.add('opening');
    }
  }

  function closeSheet() {
    if (!openKey) return;
    const btn = railButtonFor(openKey);
    openKey = null;
    markOpen();
    if (reduceMotion.matches) { sheet.hidden = true; return; }
    bladeFrom(btn);
    sheet.classList.remove('opening', 'recut');
    sheet.classList.add('closing');
  }

  sheet.addEventListener('animationend', (e) => {
    if (e.animationName === 'sheet-close') {
      sheet.classList.remove('closing');
      if (!openKey) sheet.hidden = true;
    }
    if (e.animationName === 'sheet-open') sheet.classList.remove('opening');
    if (e.animationName === 'sheet-recut') sheet.classList.remove('recut');
  });

  // Tool buttons: the desktop handler switches the panel's content; this
  // one opens or closes the sheet. Tapping the open tool again closes it.
  toolTabs.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-tab]');
    if (!b) return;
    if (openKey === b.dataset.tab) closeSheet();
    else openSheet(b.dataset.tab);
    setTimeout(closeRail, 180); // let the blade start from the rail first
  });
  editBtn.addEventListener('click', () => {
    if (openKey === 'details') closeSheet();
    else openSheet('details');
    setTimeout(closeRail, 180);
  });
  sheet.querySelector('.sheet-close').addEventListener('click', closeSheet);

  // ---------- Resizing: video against the editing area ----------
  // The handle under the player and the panel's grip both move the same
  // boundary. Portrait: the video's height. Landscape: the video's width.
  const stage = $('videoStage');
  const handle = document.createElement('div');
  handle.className = 'phone-splitter';
  handle.id = 'phoneSplitter';
  handle.setAttribute('role', 'separator');
  handle.setAttribute('aria-label', 'Drag to resize the video and the editing area');
  handle.innerHTML = '<span class="splitter-bar"></span>';
  playerPanel.appendChild(handle);

  const SIZE_KEY = '9jacut.phone.size';
  const landscape = () => window.matchMedia('(orientation: landscape)').matches;
  let sizes = {};
  try { sizes = JSON.parse(localStorage.getItem(SIZE_KEY) || '{}') || {}; } catch (e) { sizes = {}; }
  const saveSizes = () => { try { localStorage.setItem(SIZE_KEY, JSON.stringify(sizes)); } catch (e) { /* private mode */ } };

  function limits() {
    if (landscape()) return { min: 200, max: Math.max(220, workspace.clientWidth - 240) };
    return { min: 110, max: Math.max(130, workspace.clientHeight - 230) };
  }
  function applySize() {
    const { min, max } = limits();
    if (landscape()) {
      const w = sizes.landscape ? Math.round(Math.min(max, Math.max(min, sizes.landscape))) : null;
      workspace.style.setProperty('--player-w', w ? `${w}px` : '');
      stage.style.removeProperty('--player-h');
      workspace.style.removeProperty('--player-h');
    } else {
      const h = sizes.portrait ? Math.round(Math.min(max, Math.max(min, sizes.portrait))) : null;
      if (h) workspace.style.setProperty('--player-h', `${h}px`); else workspace.style.removeProperty('--player-h');
      workspace.style.removeProperty('--player-w');
    }
    placeSheet();
  }
  function currentSize() {
    return landscape() ? playerPanel.getBoundingClientRect().width : stage.getBoundingClientRect().height;
  }
  function startResize(e, { closeIfTiny = false } = {}) {
    const start = { x: e.clientX, y: e.clientY, size: currentSize(), key: landscape() ? 'landscape' : 'portrait' };
    const before = sizes[start.key];
    handle.classList.add('dragging');
    const move = (ev) => {
      const delta = start.key === 'landscape' ? ev.clientX - start.x : ev.clientY - start.y;
      const { min, max } = limits();
      sizes[start.key] = Math.min(max + 60, Math.max(min, start.size + delta));
      applySize();
    };
    const up = (ev) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      handle.classList.remove('dragging');
      const { max } = limits();
      // Pulling the panel's grip far down closes it (and keeps the old size).
      if (closeIfTiny && openKey && start.key === 'portrait' && sizes.portrait > max + 30) {
        sizes.portrait = before;
        applySize();
        closeSheet();
        return;
      }
      sizes[start.key] = Math.min(max, sizes[start.key]);
      applySize();
      saveSizes();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }
  handle.addEventListener('pointerdown', (e) => { e.preventDefault(); startResize(e); });
  // Double-tap the handle: back to the standard sizes.
  let lastTap = 0;
  handle.addEventListener('pointerup', () => {
    const now = Date.now();
    if (now - lastTap < 320) { sizes = {}; saveSizes(); applySize(); }
    lastTap = now;
  });
  const grip = sheet.querySelector('.sheet-grip');
  grip.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.sheet-close')) return;
    e.preventDefault();
    startResize(e, { closeIfTiny: true });
  });
  applySize();

  // ---------- Timeline: pinch to zoom ----------
  const tlScroll = $('tlScroll');
  const zoom = $('tlZoom');
  let pinch = null;
  const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  tlScroll.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) pinch = { d: dist(e.touches), z: Number(zoom.value) };
  }, { passive: true });
  tlScroll.addEventListener('touchmove', (e) => {
    if (!pinch || e.touches.length !== 2) return;
    e.preventDefault();
    const next = Math.round(Math.max(Number(zoom.min), Math.min(Number(zoom.max), pinch.z * (dist(e.touches) / pinch.d))));
    if (next !== Number(zoom.value)) {
      zoom.value = String(next);
      zoom.dispatchEvent(new Event('input'));
    }
  }, { passive: false });
  tlScroll.addEventListener('touchend', (e) => { if (e.touches.length < 2) pinch = null; });

  // ---------- Split gets a small "cut" flash on the playhead ----------
  const playhead = $('tlPlayhead');
  $('tlSplit').addEventListener('click', () => {
    if (reduceMotion.matches) return;
    playhead.classList.remove('cut-flash');
    void playhead.offsetWidth;
    playhead.classList.add('cut-flash');
  });
  playhead.addEventListener('animationend', () => playhead.classList.remove('cut-flash'));

  // ---------- Words that only make sense on a computer ----------
  const dropHint = $('dropHint');
  if (dropHint) dropHint.innerHTML = '<span>Tap <strong>Media</strong>, then <strong>Import videos</strong> to start</span>';

  // The panels are written for a mouse and a wide screen. Swap the few
  // phrases that would be wrong on a phone, whenever a panel redraws.
  const PHRASES = [
    [/ or drag video files onto the window/g, ''],
    [/ or drag files onto the window/g, ''],
    [/\bdrag a video file here\b/g, 'tap Import'],
    [/\bClick\b/g, 'Tap'],
    [/\bclick\b/g, 'tap'],
    [/ in Details on the right/g, ' in Edit'],
    [/Details on the right/g, 'Edit'],
    [/ on the left/g, ''],
  ];
  function phoneWords(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      let t = n.nodeValue;
      for (const [re, to] of PHRASES) t = t.replace(re, to);
      if (t !== n.nodeValue) n.nodeValue = t;
    }
  }
  for (const id of ['leftBody', 'propsBody']) {
    const box = $(id);
    phoneWords(box);
    new MutationObserver(() => phoneWords(box)).observe(box, { childList: true, subtree: true, characterData: true });
  }

  // ---------- Auto-captions are not on iPhone yet: hide them ----------
  // (A control that only says "not available" is an App Review rejection.)
  if (!window.nineJaCut.captionsAvailable) {
    html.classList.add('no-auto-captions');
    const capTab = toolTabs.querySelector('button[data-tab="captions"]');
    if (capTab) capTab.remove();
    const i = PROPS_TABS.findIndex(([key]) => key === 'captions');
    if (i >= 0) PROPS_TABS.splice(i, 1);
    if (ws.propsTab === 'captions') ws.propsTab = 'video';
    const dropCaptionRows = (root) => {
      for (const row of root.querySelectorAll('.detail-row')) {
        const label = row.querySelector('.detail-label');
        if (label && label.textContent === 'Captions') row.remove();
      }
    };
    const props = $('propsBody');
    dropCaptionRows(props);
    new MutationObserver(() => dropCaptionRows(props)).observe(props, { childList: true, subtree: true });
    if (typeof renderProperties === 'function') renderProperties();
  }

  // ---------- About page: phone wording ----------
  (function phoneAbout() {
    const page = document.querySelector('#aboutView .about-page');
    if (!page) return;
    const sectionTitled = (title) => [...page.querySelectorAll('section')].find((s) => {
      const h = s.querySelector('h2');
      return h && h.textContent.trim() === title;
    });
    const what = sectionTitled('What 9jaCut does');
    if (what) {
      const ps = what.querySelectorAll('p');
      if (ps[1]) ps[1].innerHTML = 'Everything is <strong>free</strong>: no watermark, no subscription, no account, and no feature you start using suddenly gets locked behind a paywall. Your videos never leave your phone.';
    }
    for (const card of page.querySelectorAll('.about-card')) {
      const h = card.querySelector('h3');
      if (!h) continue;
      if (/Auto-captions/.test(h.textContent) && !window.nineJaCut.captionsAvailable) card.remove();
      if (/Projects/.test(h.textContent)) card.querySelector('p').textContent = 'Save and reopen projects, undo any change, and export from 720p up to 4K straight to your Photos.';
      if (/Sound/.test(h.textContent)) card.querySelector('p').textContent = 'Add your own music (it can loop to fill the clip), record a voiceover with your phone’s microphone, adjust volumes and reduce background noise.';
    }
    const steps = sectionTitled('How to make a video');
    if (steps) {
      steps.querySelector('ol').innerHTML = [
        'Tap <strong>Media</strong>, then <strong>Import videos</strong> and pick from your Photos or Files. Your first videos go straight onto the timeline.',
        'Trim: tap a clip, then drag its edges. Cut: move the playhead and tap the scissors, then delete the part you don\'t want. Drag clips to change their order.',
        'Pinch the timeline to zoom in and out.',
        'Swipe in from the right edge of the screen for the tools — Media, Audio, Text, Stickers, Effects, Transitions, Filters, Adjust and Templates.',
        'Tap <strong>Edit</strong> to see and change every setting of the selected clip. Drag the bar between the player and the tools to make either bigger.',
        'Tap play to watch the whole video, then tap <strong>Export</strong>. Your video is saved to Photos.',
      ].map((t) => `<li>${t}</li>`).join('');
    }
    const keys = sectionTitled('Keyboard shortcuts');
    if (keys) keys.remove();
    const privacy = sectionTitled('Your privacy');
    if (privacy) privacy.querySelector('p').textContent = '9jaCut works entirely on your phone. Your videos, photos, recordings and projects are never uploaded anywhere, and the app collects no data about you. It only reads the photos and videos you pick, and saves your exports to Photos.';
    const credits = sectionTitled('Credits');
    if (credits) credits.querySelector('p').textContent = '9jaCut for iPhone is built with Capacitor and FFmpeg (LGPL). Text uses the Poppins font (SIL Open Font Licence).';
  })();

  // ---------- Export saves to Photos: no folder to choose on a phone ----------
  const PHOTOS = 'Photos';
  state.exportFolder = PHOTOS;
  promoState.exportFolder = PHOTOS;
  for (const id of ['btnExportFolder', 'btnPromoExportFolder']) { const b = $(id); if (b) b.hidden = true; }
  for (const id of ['exportFolderLabel', 'promoExportFolderLabel']) { const l = $(id); if (l) l.textContent = 'Saves to your Photos'; }
  if (typeof refreshPromoExportEnabled === 'function') refreshPromoExportEnabled();
  // openExportDialog() writes the folder into the label; keep the phone wording.
  const exportLabel = $('exportFolderLabel');
  new MutationObserver(() => {
    if (exportLabel.textContent !== 'Saves to your Photos') exportLabel.textContent = 'Saves to your Photos';
  }).observe(exportLabel, { childList: true, characterData: true, subtree: true });

  // "Saved /var/mobile/.../Exports/My video.mp4" -> "Saved to Photos: My video.mp4"
  const tidyPaths = (el) => {
    const tidy = el.textContent.replace(/Saved (?:to )?(\/[^\n]*\/)([^/\n]+\.mp4)/g, 'Saved to Photos: $2');
    if (tidy !== el.textContent) el.textContent = tidy;
  };
  for (const id of ['exportStatus', 'statusBar', 'promoStatus']) {
    const el = $(id);
    if (el) new MutationObserver(() => tidyPaths(el)).observe(el, { childList: true, characterData: true, subtree: true });
  }

  // ---------- Keep things in place ----------
  const relayout = () => { applySize(); markOpen(); };
  window.addEventListener('resize', relayout);
  window.addEventListener('orientationchange', () => setTimeout(relayout, 250));
  new ResizeObserver(relayout).observe(playerPanel);

  // First launch with an empty timeline: open Media so Import is right there.
  window.addEventListener('load', () => {
    relayout();
    if (!state.clips.length) openSheet('media');
  });

  // For tests and for the native layer later.
  window.nineJaCutPhone = {
    openSheet, closeSheet, openRail, closeRail,
    get openKey() { return openKey; },
    get railOpen() { return railOpen; },
  };
})();
