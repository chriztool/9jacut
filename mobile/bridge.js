// 9jaCut phone bridge (iOS first).
//
// On desktop, window.nineJaCut comes from preload.js and is backed by
// main.js (Electron + a bundled ffmpeg). On iPhone there is no Node.js, so
// this file provides the same 25 functions using what the phone's web view
// and Capacitor plugins can do. The interface code in renderer/ calls
// window.nineJaCut exactly as before and does not know which one it got.
//
// In the iPhone app the NineJaCutNative plugin (mobile/plugins/native) does
// the native work: importing media into the app's own storage, running
// ffmpeg for export (through mobile/export/, which reuses the desktop's
// clip-export.js and promo-export.js) and saving to Photos.
//
// Status:
//   working  - import videos/music/photos, preview, thumbnails, media info,
//              stickers, promo templates, voiceover recording, save/open
//              project, export (iPhone app), about page, copy text
//   later    - auto-captions (needs a native sherpa-onnx plugin)
//
// It also runs in an ordinary desktop browser (without the native parts),
// which is how it is tested without an iPhone (test/mobile-bridge-test.js).

(function () {
  'use strict';

  const Cap = window.Capacitor;
  const isNative = !!(Cap && typeof Cap.isNativePlatform === 'function' && Cap.isNativePlatform());
  const plugins = (Cap && Cap.Plugins) || {};
  const platform = isNative ? Cap.getPlatform() : 'web';

  // The native layer and the export engine (both only in the iPhone app).
  const nativeKit = isNative ? plugins.NineJaCutNative : null;
  const engine = window.NineJaCutExport;
  if (nativeKit && engine) engine.setNative(nativeKit);
  let pathsPromise = null;
  const nativePaths = () => pathsPromise || (pathsPromise = nativeKit.getPaths());

  const EXPORT_NOT_READY = 'Exporting works in the 9jaCut iPhone app and on the PC, not in a web browser.';
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

  // A file the native layer stored in the app's Media folder.
  function registerNative(file) {
    const entry = { url: Cap.convertFileSrc(file.path), name: file.name, type: file.mime || '', native: true };
    files.set(file.path, entry);
    return { filePath: file.path, fileUrl: entry.url, fileName: file.name, mime: entry.type };
  }

  async function pickNative(kind, multiple) {
    const result = await nativeKit.pickMedia({ kind, multiple });
    return (result.files || []).map(registerNative);
  }

  function toBase64(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }

  // Saved projects hold full file paths. The app's folder moves when the app
  // is updated, so look each Media file up again when a project is opened.
  async function refreshPaths(project) {
    const found = new Set();
    const walk = (v) => {
      if (typeof v === 'string') { if (v.startsWith('/') && v.includes('/Media/')) found.add(v); return; }
      if (v && typeof v === 'object') for (const k of Object.keys(v)) walk(v[k]);
    };
    walk(project);
    if (!found.size) return project;
    const list = [...found];
    const { paths } = await nativeKit.resolveMedia({ paths: list });
    const map = new Map(list.map((p, i) => [p, paths[i] || p]));
    const fix = (v) => {
      if (typeof v === 'string') return map.get(v) || v;
      if (Array.isArray(v)) return v.map(fix);
      if (v && typeof v === 'object') { for (const k of Object.keys(v)) v[k] = fix(v[k]); }
      return v;
    };
    return fix(project);
  }

  // Exported videos go to Photos; the share sheet opens when the interface
  // asks to "open the folder".
  let lastExports = [];
  async function afterExport(outPaths) {
    lastExports = outPaths;
    if (!outPaths.length) return;
    try { await nativeKit.saveToPhotos({ paths: outPaths }); } catch (e) { console.warn('Could not save to Photos', e); }
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
      if (nativeKit) return (await pickNative('video', false))[0] || null;
      const [f] = await pickFiles({ accept: VIDEO_ACCEPT, multiple: false });
      return f ? register(f, f.name) : null;
    },
    selectAudio: async () => {
      if (nativeKit) return (await pickNative('audio', false))[0] || null;
      const [f] = await pickFiles({ accept: AUDIO_ACCEPT, multiple: false });
      return f ? register(f, f.name) : null;
    },
    selectVideos: async () => {
      if (nativeKit) return pickNative('video', true);
      return (await pickFiles({ accept: VIDEO_ACCEPT, multiple: true })).map((f) => register(f, f.name));
    },
    selectAudioFiles: async () => {
      if (nativeKit) return pickNative('audio', true);
      return (await pickFiles({ accept: AUDIO_ACCEPT, multiple: true })).map((f) => register(f, f.name));
    },
    selectPromoMedia: async () => {
      const isVideo = (name, mime) => (mime || '').startsWith('video/') || /\.(mp4|mov|m4v)$/i.test(name);
      if (nativeKit) return (await pickNative('visual', true)).map((r) => ({ ...r, type: isVideo(r.fileName, r.mime) ? 'video' : 'image' }));
      return (await pickFiles({ accept: 'image/*,video/*', multiple: true })).map((f) => ({ ...register(f, f.name), type: isVideo(f.name, f.type) ? 'video' : 'image' }));
    },

    // There are no folders to choose on a phone: finished videos will go to
    // Photos and the share sheet once exporting is added.
    selectExportFolder: async () => 'Photos (iPhone)',
    // After an export the interface "opens the folder": on iPhone that is
    // the share sheet, to post straight to TikTok, WhatsApp and so on.
    openFolder: async () => {
      if (!isNative || !plugins.Share || !lastExports.length) return;
      try { await plugins.Share.share({ files: lastExports.map((p) => `file://${p}`) }); } catch (e) { /* closed */ }
    },

    toFileUrl: async (filePath) => urlFor(filePath),
    probeMedia: async (filePath) => {
      try {
        return await probe(filePath);
      } catch (e) {
        // Formats the web view cannot open (e.g. .mkv) can still be read by ffmpeg.
        if (nativeKit && engine && filePath.startsWith('/')) return { ...(await engine.probeMedia(filePath)), exists: true };
        throw e;
      }
    },
    generateThumbnail: async ({ sourcePath, time }) => thumbnail(sourcePath, time),

    getStickers: async () => STICKERS.map((key) => ({ key, fileUrl: `assets/stickers/${key}.png` })),
    getPromoTemplates: async () => (window.NineJaCutPromoTemplates ? window.NineJaCutPromoTemplates.buildPresetList() : []),

    saveProject: async (projectData) => saveOut('my-9jacut-project.json', JSON.stringify(projectData, null, 2)),
    loadProject: async () => {
      const [f] = await pickFiles({ accept: 'application/json,.json', multiple: false });
      if (!f) return null;
      let project;
      try { project = JSON.parse(await f.text()); } catch (e) { return null; }
      return nativeKit ? refreshPaths(project) : project;
    },

    saveRecording: async ({ bytes, extension }) => {
      const ext = /^[a-z0-9]{2,5}$/i.test(extension || '') ? extension : 'm4a';
      const mime = ext === 'webm' ? 'audio/webm' : 'audio/mp4';
      if (nativeKit) {
        const name = `voiceover-${Date.now()}.${ext}`;
        const { path } = await nativeKit.writeBase64({ name, data: toBase64(bytes) });
        const r = registerNative({ path, name, mime });
        return { filePath: r.filePath, fileUrl: r.fileUrl };
      }
      const r = register(new Blob([bytes], { type: mime }), `voiceover-${Date.now()}.${ext}`);
      return { filePath: r.filePath, fileUrl: r.fileUrl };
    },

    exportClips: async ({ clips, settings = {} }) => {
      if (nativeKit && engine) {
        const results = await engine.exportClips({ clips, settings }, await nativePaths(), (d) => emit('export', d));
        await afterExport(results.filter((r) => r.ok).map((r) => r.outPath));
        return results;
      }
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

    exportPromo: async (job) => {
      if (nativeKit && engine) {
        const result = await engine.exportPromo(job, await nativePaths(), (d) => emit('promo', d));
        await afterExport(result.ok ? [result.outPath] : []);
        return result;
      }
      const { presetId } = job;
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

  // ---------- Export self-test (CI only) ----------
  // The iOS build launches the app on a simulated iPhone with
  // -NineJaCutSelfTest. It then makes a test video with ffmpeg, exports it
  // with text, a sticker and a look through the real plugin, checks the
  // result and prints one line the build looks for. Never runs otherwise.
  async function runSelfTest(paths) {
    const report = { ok: false, steps: [] };
    const step = (text) => { report.steps.push(text); selfTestSay(`9JACUT_STEP ${text}`); };
    const limit = (promise, what, ms = 90000) => Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error(`${what} took longer than ${ms / 1000}s`)), ms)),
    ]);
    try {
      const src = `${paths.tmp.replace(/\/$/, '')}/selftest-source.mov`;
      // Written with x264 settings and swapped to the phone's encoder, like every export.
      const gen = await limit(nativeKit.run({ jobId: 'selftest-gen', args: engine.phoneVideoArgs(['-y', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=3',
        '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22',
        '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', src]) }), 'making the test video');
      step(`make test video: ${gen.returnCode}`);
      if (gen.returnCode !== 0) throw new Error('could not make the test video');
      const info = await limit(engine.probeMedia(src), 'reading the test video');
      step(`probe: ${info.width}x${info.height} ${info.duration}s audio=${info.hasAudio}`);
      // One feature at a time, so a failure points at its cause.
      const variants = [
        ['plain', {}],
        ['look', { look: { preset: 'gold' } }],
        ['adjust', { look: { preset: 'cinematic', brightness: 0.05, contrast: 1.1, saturation: 1.2 } }],
        ['text', { texts: [{ text: "Self-test: 9ja's text", position: 'bottom', size: 7, style: 'box' }] }],
        ['sticker', { stickers: [{ key: 'fire', x: 100, y: 100, size: 120, start: 0, end: 2 }] }],
      ];
      let out = null;
      for (const [name, extra] of variants) {
        selfTestSay(`9JACUT_STEP export ${name}: starting`);
        const results = await limit(engine.exportClips({
          clips: [{ id: `selftest-${name}`, name: `selftest-${name}`, sourcePath: src, start: 0.5, end: 2.5, ...extra }],
          settings: { resolution: '720', quality: 'standard' },
        }, paths, () => {}), `exporting (${name})`, 120000);
        const r = results[0];
        step(`export ${name}: ${r.ok ? 'ok' : r.error}`);
        if (!r.ok) throw new Error(r.error);
        out = await limit(engine.probeMedia(r.outPath), 'reading the exported video');
        step(`result ${name}: ${out.width}x${out.height} ${out.duration}s audio=${out.hasAudio}`);
      }
      report.ok = out.width === 1280 && out.height === 720 && Math.abs(out.duration - 2) < 0.3 && out.hasAudio;
    } catch (e) {
      step(`error: ${e && e.message}`);
    }
    selfTestSay(`9JACUT_SELFTEST ${report.ok ? 'PASS' : 'FAIL'} ${JSON.stringify(report.steps)}`);
  }
  function selfTestSay(text) {
    console.log(text);
    if (nativeKit && nativeKit.selfTestReport) Promise.resolve(nativeKit.selfTestReport({ text })).catch(() => {});
  }
  if (isNative) {
    if (!nativeKit || !engine) {
      console.error(`9JACUT_NATIVE missing: plugin=${!!nativeKit} engine=${!!engine} plugins=${Object.keys(plugins).join(',')}`);
    } else {
      nativePaths().then((p) => {
        if (!p.selfTest) return;
        selfTestSay('9JACUT_SELFTEST_START');
        window.addEventListener('error', (e) => selfTestSay(`9JACUT_PAGE_ERROR ${e.message} @ ${e.filename}:${e.lineno}`));
        window.addEventListener('unhandledrejection', (e) => selfTestSay(`9JACUT_PAGE_ERROR ${e.reason && e.reason.message}`));
        setTimeout(() => runSelfTest(p).catch((e) => selfTestSay(`9JACUT_SELFTEST FAIL crashed: ${e && e.message}`)), 1500);
      }).catch((e) => console.error(`9JACUT_NATIVE getPaths failed: ${e && e.message}`));
    }
  }

  document.documentElement.classList.add('is-phone-app', `platform-${platform}`);
})();
