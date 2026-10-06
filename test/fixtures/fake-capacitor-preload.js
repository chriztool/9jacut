// Stand-in for Capacitor inside the iPhone app, for test/mobile-native-test.js.
// The page gets window.Capacitor like on iPhone; plugin calls go over IPC to
// the test's fake NineJaCutNative plugin (backed by this computer's ffmpeg).
const { contextBridge, ipcRenderer } = require('electron');

const listeners = [];
ipcRenderer.on('ffmpegLog', (_e, data) => { for (const cb of listeners) cb(data); });
const call = (method) => (opts) => ipcRenderer.invoke('native', method, opts);
const methods = ['getPaths', 'pickMedia', 'writeTextFiles', 'writeBase64', 'removeFiles', 'resolveMedia', 'run', 'cancel', 'saveToPhotos'];

contextBridge.exposeInMainWorld('Capacitor', {
  isNativePlatform: () => true,
  getPlatform: () => 'ios',
  convertFileSrc: (p) => `file://${p}`,
  Plugins: {
    NineJaCutNative: {
      ...Object.fromEntries(methods.map((m) => [m, call(m)])),
      addListener: (name, cb) => {
        if (name === 'ffmpegLog') listeners.push(cb);
        return { remove() {} };
      },
    },
    Share: { share: call('share') },
  },
});
