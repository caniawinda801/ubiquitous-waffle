// ============================================================
// ELTSA SAFE EXAM BROWSER - SIMPLE KIOSK
// Buka website langsung, kunci komputer selama ujian
// + Toolbar Refresh SELALU tampil
// + Ctrl+P = Pause ujian (simpan jawaban + stop timer + tutup)
//   → Timer berhenti, section tidak selesai, bisa dilanjutkan
// + Auto-refresh saat kembali ke aplikasi
// ============================================================
const { app, BrowserWindow, globalShortcut, ipcMain, dialog, session, Menu } = require('electron');
const path = require('path');

const CONFIG = {
  URL: 'https://staracademy.unis.ac.id/Login',
  BASE_URL: 'https://staracademy.unis.ac.id/',
  ALLOWED: ['staracademy.unis.ac.id', 'unis.ac.id'],
  APP_NAME: 'ELTSA Safe Exam Browser',
};

let win = null;
let locked = false;

// Single instance
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
app.on('second-instance', () => { if (win) win.focus(); });

Menu.setApplicationMenu(null);

app.whenReady().then(() => {
  session.defaultSession.webRequest.onBeforeSendHeaders((details, cb) => {
    details.requestHeaders['User-Agent'] = details.requestHeaders['User-Agent'] + ' ELTSA-SEB/1.0';
    cb({ requestHeaders: details.requestHeaders });
  });

  createWindow();

  // === CTRL+P = KELUAR APLIKASI (selalu aktif, bukan cuma saat locked) ===
  try {
    globalShortcut.register('Ctrl+P', () => {
      console.log('[SEB] Ctrl+P pressed - Exit app');
      handleExitApp();
    });
  } catch(e) {
    console.error('[SEB] Gagal register Ctrl+P:', e);
  }
});

app.on('window-all-closed', () => { if (!locked) app.quit(); });
app.on('before-quit', (e) => { if (locked) e.preventDefault(); });

// ============================================================
//  IPC HANDLERS
// ============================================================
ipcMain.on('seb-refresh', () => {
  if (win) {
    console.log('[SEB] Refresh halaman...');
    win.webContents.reload();
  }
});

ipcMain.on('seb-exit', () => {
  handleExitApp();
});

// ============================================================
//  BUAT WINDOW
// ============================================================
function createWindow() {
  win = new BrowserWindow({
    width: 1200, height: 800,
    center: true,
    title: CONFIG.APP_NAME,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });

  win.loadURL(CONFIG.URL);

  // --- DETEKSI HALAMAN BERUBAH ---
  win.webContents.on('did-navigate', (e, url) => checkPage(url));
  win.webContents.on('did-navigate-in-page', (e, url) => checkPage(url));

  // === INJECT TOOLBAR DI SETIAP HALAMAN YANG SELESAI LOAD ===
  win.webContents.on('did-finish-load', () => {
    const url = win.webContents.getURL();
    checkPage(url);
    injectToolbar();  // Selalu inject toolbar
  });

  // Block navigasi ke domain luar
  win.webContents.on('will-navigate', (e, url) => {
    if (!isAllowed(url)) e.preventDefault();
  });

  // Block popup
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowed(url)) win.loadURL(url);
    return { action: 'deny' };
  });

  // --- LOCKDOWN EVENTS ---
  win.on('blur', () => {
    if (locked) setTimeout(() => { if (win && locked) { win.focus(); win.setAlwaysOnTop(true); } }, 50);
  });

  // === AUTO-REFRESH saat window mendapat fokus kembali ===
  win.on('focus', () => {
    if (locked && win) {
      console.log('[SEB] Window fokus kembali - auto refresh');
      win.webContents.reload();
    }
  });

  win.on('minimize', (e) => { if (locked) { e.preventDefault(); win.restore(); } });
  win.on('close', (e) => { if (locked) e.preventDefault(); });

  // Block DevTools
  win.webContents.on('devtools-opened', () => win.webContents.closeDevTools());

  win.on('closed', () => { win = null; });
}

// ============================================================
//  HANDLE EXIT APP (Ctrl+P = Simpan + Pause timer + Tutup)
//  1. Simpan jawaban soal saat ini (cekisi)
//  2. Panggil pausetest → hapus logwaktu (timer berhenti)
//  3. Tutup app (TANPA logout, TANPA savetest)
//  → Section tidak selesai, timer reset, bisa dilanjutkan
// ============================================================
function handleExitApp() {
  if (!win) return;
  console.log('[SEB] Ctrl+P → Pause ujian & tutup aplikasi...');

  // Unlock dulu agar bisa close
  const wasLocked = locked;
  if (wasLocked) {
    locked = false;
    win.setClosable(true);
    win.setKiosk(false);
    win.setFullScreen(false);
    win.setAlwaysOnTop(false);
    win.setMinimizable(true);
    win.setMovable(true);
    win.setSkipTaskbar(false);
  }

  // Step 1: Simpan jawaban soal saat ini
  // Step 2: Panggil pausetest untuk hentikan timer
  // Step 3: Tutup aplikasi
  win.webContents.executeJavaScript(`
    (function(){
      return new Promise(function(resolve){
        // Simpan jawaban soal yang sedang aktif
        try {
          if(typeof cekisi === 'function' && typeof mul !== 'undefined') {
            cekisi(mul);
          }
        } catch(e) {}

        // Panggil pausetest untuk hentikan timer (hapus logwaktu)
        try {
          var xhr = new XMLHttpRequest();
          xhr.open('GET', '${CONFIG.BASE_URL}index.php/Testcat/pausetest', true);
          xhr.timeout = 2000;
          xhr.onload = function(){ resolve('paused'); };
          xhr.onerror = function(){ resolve('error'); };
          xhr.ontimeout = function(){ resolve('timeout'); };
          xhr.send();
        } catch(e) {
          resolve('no-xhr');
        }

        // Fallback: resolve setelah 1.5 detik
        setTimeout(function(){ resolve('fallback'); }, 1500);
      });
    })();
  `).then((result) => {
    console.log('[SEB] Pause result:', result);
    console.log('[SEB] Timer dihentikan, tutup aplikasi...');
    setTimeout(() => forceExit(), 300);
  }).catch(() => {
    console.log('[SEB] Error, tetap tutup...');
    forceExit();
  });

  // Safety: force exit setelah 4 detik
  setTimeout(() => {
    console.log('[SEB] Timeout - force exit');
    forceExit();
  }, 4000);
}

function forceExit() {
  locked = false;
  globalShortcut.unregisterAll();
  if (win) {
    win.setClosable(true);
    win.setKiosk(false);
    win.setFullScreen(false);
    win.setAlwaysOnTop(false);
    win.setMinimizable(true);
    win.setMovable(true);
    win.setSkipTaskbar(false);
    win.close();
  }
  app.quit();
}

// ============================================================
//  DETEKSI HALAMAN - KAPAN LOCK & UNLOCK
// ============================================================
function checkPage(url) {
  const u = url.toLowerCase();

  if (!locked && (
    u.includes('/testcat/option') ||
    u.includes('/testcat/prosestest') ||
    u.includes('/testcat/biodata')
  )) {
    lockDown();
  }

  if (locked && (
    u.includes('/testcat/hasil') ||
    u.includes('/testcat/selesai') ||
    u.endsWith('/login') ||
    u.endsWith('/login/') ||
    u.includes('/login/logout')
  )) {
    unlock();
  }

  if (locked && win) {
    injectAntiCheat();
  }
}

// ============================================================
//  LOCK - MODE KIOSK
// ============================================================
function lockDown() {
  if (locked) return;
  locked = true;
  console.log('[SEB] LOCKED - Exam mode ON');

  win.setKiosk(true);
  win.setFullScreen(true);
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setMinimizable(false);
  win.setClosable(false);
  win.setMovable(false);
  win.setSkipTaskbar(true);

  const shortcuts = [
    'Alt+Tab','Alt+F4','Alt+Escape','Alt+Space',
    'Ctrl+Escape','Ctrl+Shift+Escape',
    'Meta','Meta+D','Meta+E','Meta+R','Meta+L','Meta+Tab',
    'F11','F12','Ctrl+Shift+I','Ctrl+Shift+J',
    'Ctrl+W','Ctrl+T','Ctrl+N',
    'Ctrl+U','Ctrl+S',
    'PrintScreen','Alt+PrintScreen','Meta+Shift+S',
  ];
  shortcuts.forEach(s => { try { globalShortcut.register(s, () => {}); } catch(e) {} });

  // Re-register Ctrl+P as exit (karena unregisterAll mungkin terjadi)
  try {
    globalShortcut.register('Ctrl+P', () => {
      console.log('[SEB] Ctrl+P pressed - Exit app');
      handleExitApp();
    });
  } catch(e) {}
}

// ============================================================
//  UNLOCK - KELUAR KIOSK
// ============================================================
function unlock() {
  if (!locked) return;
  locked = false;
  console.log('[SEB] UNLOCKED - Exam mode OFF');

  globalShortcut.unregisterAll();

  // Re-register Ctrl+P agar tetap aktif setelah unlock
  try {
    globalShortcut.register('Ctrl+P', () => {
      console.log('[SEB] Ctrl+P pressed - Exit app');
      handleExitApp();
    });
  } catch(e) {}

  win.setClosable(true);
  win.setMinimizable(true);
  win.setAlwaysOnTop(false);
  win.setKiosk(false);
  win.setFullScreen(false);
  win.setMovable(true);
  win.setSkipTaskbar(false);

  dialog.showMessageBox(win, {
    type: 'info',
    title: 'Ujian Selesai',
    message: 'Ujian telah selesai.\nMode kiosk dinonaktifkan.\n\nAnda bisa menutup aplikasi.',
    buttons: ['OK'],
  });
}

// ============================================================
//  INJECT TOOLBAR (hanya tombol Refresh di pojok kanan atas)
// ============================================================
function injectToolbar() {
  if (!win) return;
  win.webContents.executeJavaScript(`
    (function(){
      var old = document.getElementById('seb-toolbar');
      if(old) old.remove();

      var btn = document.createElement('button');
      btn.id = 'seb-toolbar';
      btn.innerHTML = '\\u{1F504}';
      btn.title = 'Refresh halaman';
      btn.style.cssText = 'position:fixed;top:10px;right:10px;z-index:999999;background:#2563eb;color:#fff;border:none;width:36px;height:36px;border-radius:50%;font-size:18px;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;transition:background 0.2s;opacity:0.85;';
      btn.onmouseover = function(){ this.style.opacity='1'; this.style.background='#1d4ed8'; };
      btn.onmouseout = function(){ this.style.opacity='0.85'; this.style.background='#2563eb'; };
      btn.onclick = function(){
        if(window.electronSEB && window.electronSEB.refresh){
          window.electronSEB.refresh();
        } else {
          location.reload();
        }
      };
      document.body.appendChild(btn);
    })();
  `).catch((err) => { console.error('[SEB] Inject toolbar error:', err); });
}

// ============================================================
//  INJECT ANTI-CHEAT (hanya saat locked/ujian)
// ============================================================
function injectAntiCheat() {
  win.webContents.executeJavaScript(`
    (function(){
      if(window.__SEB_ANTICHEAT) return;
      window.__SEB_ANTICHEAT = true;

      document.addEventListener('contextmenu', e => e.preventDefault());

      document.addEventListener('keydown', function(e){
        if((e.ctrlKey && 'cvxasu'.includes(e.key.toLowerCase())) ||
           e.key==='F12'||e.key==='F5'||e.key==='F11'||
           (e.ctrlKey&&e.shiftKey&&'IJC'.includes(e.key)))
        { e.preventDefault(); }
      });

      document.addEventListener('dragstart', e => e.preventDefault());

      var s=document.createElement('style');
      s.textContent='@media print{body{display:none!important}}';
      document.head.appendChild(s);
    })();
  `).catch(()=>{});
}

// ============================================================
//  DOMAIN CHECK
// ============================================================
function isAllowed(url) {
  try {
    const h = new URL(url).hostname;
    return CONFIG.ALLOWED.some(d => h === d || h.endsWith('.' + d));
  } catch { return true; }
}

app.on('will-quit', () => globalShortcut.unregisterAll());
