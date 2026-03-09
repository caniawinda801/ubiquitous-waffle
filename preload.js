// Preload - expose platform info + refresh & exit ke renderer
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronSEB', {
  platform: process.platform,
  version: '1.0.0',
  isSEB: true,

  // Refresh halaman ujian
  refresh: () => {
    ipcRenderer.send('seb-refresh');
  },

  // Keluar aplikasi (Ctrl+P)
  exitApp: () => {
    ipcRenderer.send('seb-exit');
  },
});
