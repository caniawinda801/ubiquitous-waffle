// Preload - minimal, hanya expose platform info
const { contextBridge } = require('electron');
contextBridge.exposeInMainWorld('electronSEB', {
  platform: process.platform,
  version: '1.0.0',
  isSEB: true,
});
