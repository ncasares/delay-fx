const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  getAudioDevices: () => ipcRenderer.invoke('audio:getDevices'),
  startAudio: (config) => ipcRenderer.invoke('audio:start', config),
  stopAudio: () => ipcRenderer.invoke('audio:stop'),
});
