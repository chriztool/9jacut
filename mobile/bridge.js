// 9jaCut phone bridge (iOS first).
//
// On desktop, window.nineJaCut comes from preload.js and is backed by
// main.js (Electron + a bundled ffmpeg). On iPhone there is no Node.js, so
// this file provides the same 23 functions using what the phone's web view
// and Capacitor plugins can do. The interface code in renderer/ calls
// window.nineJaCut exactly as before and does not know which one it got.
//
// Status:
//   working  - import videos/music/photos, preview, thumbnails, media info,
//              stickers, promo templates, voiceover recording, save/open
//              project, about page, copy text
//   next     - exporting (needs a native ffmpeg plugin, see mobile/README.md)
//   later    - auto-captions (needs a native sherpa-onnx plugin)
//
// It also runs in an ordinary desktop browser, which is how it is tested
// without an iPhone (see test/mobile-bridge-test.js).

(function () {
  'use strict';

  const Cap = window.Capacitor;
  const isNative = !!(Cap && typeof Cap.isNativePlatform === 'function' && Cap.isNativePlatform());
  const plugins = (Cap && Cap.Plugins) || {};
  const platform = isNative ? Cap.getPlatform() : 'web';

  const EXPORT_NOT_READY = 'Exporting on iPhone is the next part being built. It is not in this test version yet. '
    + 'Everything else (importing, editing, previewing, saving your project) works.';
  const CAPTIONS_NOT_READY = 'Auto-captions are not on iPhone yet. You can still type captions by hand in the Captions tab.';

  // ---------- Imported files ----------
  // A picked file lives in memory as a File/Blob. The interface refers to
  // files by a "path" string, so each one gets a stable made-up path.
  const files = new Map(); // path -> { blob, url, name, type }
  let nextId = 1;

  function register(blob, name) {
    const safeName = String(name || 'file').replace(/[\\/]/g, '_');
    const filePath = `phone://${nextId++}/${safeName}`;
    const entry = { blob, url: URL.createObjectURL(blob), name: safeName, type: blob.type || '' };
    files.set(filePath, entry);
    return { filePath, fileUrl: entry.url, fileName: safeName, mime: entry.type };
  }

  function urlFor(filePath) {
    const entry = files.get(filePath);
    if (entry) return entry.url;
    if (isNative && /^(file:\/\/|\/)/.test(String(filePath || ''))) return Cap.convertFileSrc(filePath);
    throw new Error(`File is not available on this phone any more: ${filePath}`);
  }

  // Opens the phone's picker (Photos / Files). Resolves with File objects,
  // or [] if the person cancels.
  function pickFiles({ accept, multiple }) {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = accept;
      input.multiple = !!multiple;
      input.style.display = 'none';
      let settled = false;
      const finish = (list) => {
        if (settled) return;
        settled = true;
        window.removeEventListener('focus', onFocus);
        input.remove();
        resolve(list);
      };
      // "cancel" fires in current WebKit/Chromium; the focus fallback covers older ones.
      const onFocus = () => setTimeout(() => { if (!input.files || !input.files.length) finish([]); }, 1500);
      input.addEventListener('change', () => finish(Array.from(input.files || [])));
      input.addEventListener('cancel', () => finish([]));
      window.addEventListener('focus', onFocus);
      document.body.appendChild(input);
      input.click();
    });
  }

  const VIDEO_ACCEPT = 'video/*,.mp4,.mov,.m4v';
  const AUDIO_ACCEPT = 'audio/*,.mp3,.m4a,.aac,.wav';

  // ---------- Media info and thumbnails (no ffmpeg needed) ----------
  function loadMediaElement(src, kind, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      const el = document.createElement(kind === 'audio' ? 'audio' : 'video');
      el.preload = 'auto';
      el.muted = true;
      el.playsInline = true;
      el.setAttribute('playsinline', '');
      el.crossOrigin = 'anonymous';
      const timer = setTimeout(() => { cleanup(); reject(new Error('Timed out reading the file')); }, timeoutMs);
      const cleanup = () => { clearTimeout(timer); el.onloadedmetadata = null; el.onerror = null; };
      el.onloadedmetadata = () => { cleanup(); resolve(el); };
      el.onerror = () => { cleanup(); reject(new Error('This file type cannot be read on this phone')); };
      el.src = src;
    });
  }

  function guessHasAudio(el) {
    if (el.audioTracks && typeof el.audioTracks.length === 'number') return el.audioTracks.length > 0; // Safari
    if (typeof el.mozHasAudio === 'boolean') return el.mozHasAudio;
    return true; // Unknown: assume yes, like most phone videos.
  }

  async function probe(filePath) {
    const entry = files.get(filePath);
    const isAudio = entry ? entry.type.startsWith('audio/') : /\.(mp3|m4a|aac|wav|ogg|flac|opus)$/i.test(filePath);
    const el = await loadMediaElement(urlFor(filePath), isAudio ? 'audio' : 'video');
    const info = {
      duration: Number.isFinite(el.duration) ? el.duration : 0,
      width: el.videoWidth || 0,
      height: el.videoHeight || 0,
      hasAudio: isAudio ? true : guessHasAudio(el),
      exists: true,
    };
    el.removeAttribute('src');
    el.load();
    return info;
  }

  function seek(el, time) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timed out seeking')), 8000);
      el.onseeked = () => { clearTimeout(timer); el.onseeked = null; resolve(); };
      el.currentTime = Math.max(0, Math.min(time || 0, Math.max(0, (el.duration || 0) - 0.05)));
    });
  }

  async function thumbnail(sourcePath, time) {
    try {
      const entry = files.get(sourcePath);
      const src = urlFor(sourcePath);
      if (entry && entry.type.startsWith('image/')) return src;
      const el = await loadMediaElement(src, 'video');
      await seek(el, time);
      const width = 220;
      const height = Math.max(2, Math.round((el.videoHeight / el.videoWidth) * width / 2) * 2) || 124;
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(el, 0, 0, width, height);
      el.removeAttribute('src');
      el.load();
      return canvas.toDataURL('image/jpeg', 0.8);
    } catch (e) {
      return null; // The interface shows a placeholder, same as on desktop.
    }
  }

  // ---------- Saving files out of the app ----------
  // On iPhone: written to the app's Documents folder (visible in the Files
  // app under "On My iPhone > 9jaCut") and offered in the share sheet.
  // In a desktop browser: downloaded.
  async function saveOut(fileName, text) {
    if (isNative && plugins.Filesystem) {
      const written = await plugins.Filesystem.writeFile({
        path: `Projects/${fileName}`,
        data: text,
        directory: 'DOCUMENTS',
        encoding: 'utf8',
        recursive: true,
      });
      if (plugins.Share) {
        try { await plugins.Share.share({ title: fileName, files: [written.uri] }); } catch (e) { /* closed the share sheet */ }
      }
      return `Files app > On My iPhone > 9jaCut > Projects > ${fileName}`;
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    return `your Downloads (${fileName})`;
  }

  // ---------- Progress events ----------
  const listeners = { export: new Set(), captions: new Set(), promo: new Set() };
  function subscribe(kind, callback) {
    listeners[kind].add(callback);
    return () => listeners[kind].delete(callback);
  }
  function emit(kind, data) {
    for (const cb of listeners[kind]) { try { cb(data); } catch (e) { /* ignore */ } }
  }

  // Same list and order as main.js.
  const STICKERS = ['happy', 'laughing', 'heart_eyes', 'cool', 'surprised', 'wink', 'crying_laughing',
    'sad', 'angry', 'heart', 'fire', 'star', 'thumbs_up', 'hundred'];

  // ---------- The bridge ----------
  window.nineJaCut = {
    platform,

    selectVideo: async () => {
      const [f] = await pickFiles({ accept: VIDEO_ACCEPT, multiple: false });
      return f ? register(f, f.name) : null;
    },
    selectAudio: async () => {
      const [f] = await pickFiles({ accept: AUDIO_ACCEPT, multiple: false });
      return f ? register(f, f.name) : null;
    },
    selectVideos: async () => (await pickFiles({ accept: VIDEO_ACCEPT, multiple: true })).map((f) => register(f, f.name)),
    selectAudioFiles: async () => (await pickFiles({ accept: AUDIO_ACCEPT, multiple: true })).map((f) => register(f, f.name)),
    selectPromoMedia: async () => (await pickFiles({ accept: 'image/*,video/*', multiple: true })).map((f) => {
      const r = register(f, f.name);
      return { ...r, type: (f.type || '').startsWith('video/') || /\.(mp4|mov|m4v)$/i.test(f.name) ? 'video' : 'image' };
    }),

    // There are no folders to choose on a phone: finished videos will go to
    // Photos and the share sheet once exporting is added.
    selectExportFolder: async () => 'Photos (iPhone)',
    openFolder: async () => {},

    toFileUrl: async (filePath) => urlFor(filePath),
    probeMedia: async (filePath) => probe(filePath),
    generateThumbnail: async ({ sourcePath, time }) => thumbnail(sourcePath, time),

    getStickers: async () => STICKERS.map((key) => ({ key, fileUrl: `assets/stickers/${key}.png` })),
    getPromoTemplates: async () => (window.NineJaCutPromoTemplates ? window.NineJaCutPromoTemplates.buildPresetList() : []),

    saveProject: async (projectData) => saveOut('my-9jacut-project.json', JSON.stringify(projectData, null, 2)),
    loadProject: async () => {
      const [f] = await pickFiles({ accept: 'application/json,.json', multiple: false });
      if (!f) return null;
      try { return JSON.parse(await f.text()); } catch (e) { return null; }
    },

    saveRecording: async ({ bytes, extension }) => {
      const ext = /^[a-z0-9]{2,5}$/i.test(extension || '') ? extension : 'm4a';
      const mime = ext === 'webm' ? 'audio/webm' : 'audio/mp4';
      const r = register(new Blob([bytes], { type: mime }), `voiceover-${Date.now()}.${ext}`);
      return { filePath: r.filePath, fileUrl: r.fileUrl };
    },

    exportClips: async ({ clips, settings = {} }) => {
      if (settings.combine) {
        emit('export', { id: 'combined', status: 'error', message: EXPORT_NOT_READY });
        return [{ id: 'combined', ok: false, error: EXPORT_NOT_READY }];
      }
      return (clips || []).map((clip) => {
        emit('export', { id: clip.id, status: 'error', message: EXPORT_NOT_READY });
        return { id: clip.id, ok: false, error: EXPORT_NOT_READY };
      });
    },
    onExportProgress: (cb) => subscribe('export', cb),

    exportPromo: async ({ presetId }) => {
      emit('promo', { id: presetId || 'promo', status: 'error', message: EXPORT_NOT_READY });
      return { ok: false, error: EXPORT_NOT_READY };
    },
    onPromoExportProgress: (cb) => subscribe('promo', cb),

    getCaptionsInfo: async () => { throw new Error(CAPTIONS_NOT_READY); }, // interface keeps its defaults
    generateCaptions: async ({ clipId }) => {
      emit('captions', { clipId, stage: 'error', message: CAPTIONS_NOT_READY });
      return { ok: false, error: CAPTIONS_NOT_READY };
    },
    onCaptionsProgress: (cb) => subscribe('captions', cb),

    getAppInfo: async () => ({ name: '9jaCut', version: window.NINEJACUT_VERSION || '', platform }),
    openExternal: async (target) => {
      if (!/^(mailto:|https:\/\/)/i.test(String(target || ''))) return;
      // In the iPhone app, leaving the app's own pages opens Safari / Mail.
      if (isNative) window.location.href = target;
      else window.open(target, '_blank', 'noopener');
    },
    copyText: async (text) => {
      try { await navigator.clipboard.writeText(String(text || '')); return true; } catch (e) {
        const ta = document.createElement('textarea');
        ta.value = String(text || '');
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        ta.remove();
        return ok;
      }
    },
  };

  document.documentElement.classList.add('is-phone-app', `platform-${platform}`);
})();
