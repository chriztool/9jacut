// 9jaCut phone layout.
//
// Rearranges the desktop workspace into a phone editor, reusing every
// existing panel and control (so every PC editing feature is still there):
//
//   +---------------------------+------+
//   | menu  name    undo redo ⤓ |      |
//   +---------------------------+  T   |
//   |          player           |  O   |
//   +---------------------------+  O   |
//   | 00:04 / 00:17   ▶   ⛶     |  L   |
//   +---------------------------+      |
//   |  split delete dup …       |  R   |
//   |  timeline                 |  A   |
//   |                           |  I   |
//   +---------------------------+  L   |
//
// Tapping a tool on the rail opens its panel over the timeline. The panel is
// "cut open" from the rail by a gold blade line (see mobile/mobile.css).
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
  });
  editBtn.addEventListener('click', () => {
    if (openKey === 'details') closeSheet();
    else openSheet('details');
  });
  sheet.querySelector('.sheet-close').addEventListener('click', closeSheet);

  // Swipe the grip down to close.
  const grip = sheet.querySelector('.sheet-grip');
  let gripY = null;
  grip.addEventListener('touchstart', (e) => { gripY = e.touches[0].clientY; }, { passive: true });
  grip.addEventListener('touchmove', (e) => {
    if (gripY === null) return;
    const dy = Math.max(0, e.touches[0].clientY - gripY);
    sheet.style.translate = `0 ${dy}px`;
  }, { passive: true });
  grip.addEventListener('touchend', (e) => {
    const dy = gripY === null ? 0 : e.changedTouches[0].clientY - gripY;
    gripY = null;
    sheet.style.translate = '';
    if (dy > 70) closeSheet();
  });

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

  // ---------- Keep things in place ----------
  const relayout = () => { placeSheet(); markOpen(); };
  window.addEventListener('resize', relayout);
  window.addEventListener('orientationchange', () => setTimeout(relayout, 250));
  new ResizeObserver(relayout).observe(playerPanel);

  // First launch with an empty timeline: open Media so Import is right there.
  window.addEventListener('load', () => {
    relayout();
    if (!state.clips.length) openSheet('media');
  });

  // For tests and for the native layer later.
  window.nineJaCutPhone = { openSheet, closeSheet, get openKey() { return openKey; } };
})();
