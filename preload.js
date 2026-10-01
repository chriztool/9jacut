const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('nineJaCut', {
  selectVideo: () => ipcRenderer.invoke('select-video'),
  selectAudio: () => ipcRenderer.invoke('select-audio'),
  selectExportFolder: () => ipcRenderer.invoke('select-export-folder'),
  openFolder: (folderPath) => ipcRenderer.invoke('open-folder', folderPath),
  toFileUrl: (filePath) => ipcRenderer.invoke('to-file-url', filePath),
  getStickers: () => ipcRenderer.invoke('get-stickers'),
  generateThumbnail: (payload) => ipcRenderer.invoke('generate-thumbnail', payload),
  saveProject: (payload) => ipcRenderer.invoke('save-project', payload),
  loadProject: () => ipcRenderer.invoke('load-project'),
  exportClips: (payload) => ipcRenderer.invoke('export-clips', payload),
  onExportProgress: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('export-progress', listener);
    return () => ipcRenderer.removeListener('export-progress', listener);
  },
  selectVideos: () => ipcRenderer.invoke('select-videos'),
  selectAudioFiles: () => ipcRenderer.invoke('select-audio-files'),
  probeMedia: (filePath) => ipcRenderer.invoke('probe-media', filePath),
  getAppInfo: () => ipcRenderer.invoke('get-app-info'),
  openExternal: (target) => ipcRenderer.invoke('open-external', target),
  copyText: (text) => ipcRenderer.invoke('copy-text', text),
  saveRecording: (payload) => ipcRenderer.invoke('save-recording', payload),
  getCaptionsInfo: () => ipcRenderer.invoke('captions-info'),
  generateCaptions: (payload) => ipcRenderer.invoke('generate-captions', payload),
  onCaptionsProgress: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('captions-progress', listener);
    return () => ipcRenderer.removeListener('captions-progress', listener);
  },
  getPromoTemplates: () => ipcRenderer.invoke('get-promo-templates'),
  selectPromoMedia: () => ipcRenderer.invoke('select-promo-media'),
  exportPromo: (payload) => ipcRenderer.invoke('export-promo', payload),
  onPromoExportProgress: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('promo-export-progress', listener);
    return () => ipcRenderer.removeListener('promo-export-progress', listener);
  },
});
