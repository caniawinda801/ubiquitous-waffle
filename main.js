// ============================================================
// ELTSA SAFE EXAM BROWSER - SIMPLE KIOSK
// Buka website langsung, kunci komputer selama ujian
// ============================================================
const { app, BrowserWindow, globalShortcut, ipcMain, dialog, session, Menu } = require('electron');
const path = require('path');

const CONFIG = {
  URL: 'https://staracademy.unis.ac.id/Login',
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
  // Set custom User-Agent
  session.defaultSession.webRequest.onBeforeSendHeaders((details, cb) => {
    details.requestHeaders['User-Agent'] = details.requestHeaders['User-Agent'] + ' ELTSA-SEB/1.0';
    cb({ requestHeaders: details.requestHeaders });
  });

  createWindow();
});

app.on('window-all-closed', () => { if (!locked) app.quit(); });
app.on('before-quit', (e) => { if (locked) e.preventDefault(); });

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
  win.webContents.on('did-finish-load', () => {
    checkPage(win.webContents.getURL());
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
  win.on('minimize', (e) => { if (locked) { e.preventDefault(); win.restore(); } });
  win.on('close', (e) => { if (locked) e.preventDefault(); });

  // Block DevTools
  win.webContents.on('devtools-opened', () => win.webContents.closeDevTools());

  win.on('closed', () => { win = null; });
}

// ============================================================
//  DETEKSI HALAMAN - KAPAN LOCK & UNLOCK
// ============================================================
function checkPage(url) {
  const u = url.toLowerCase();

  // === LOCK: user masuk area ujian ===
  // Setelah login + isi biodata, user masuk ke /Testcat/option (pilih section)
  // Atau langsung ke /Testcat/prosestest (ngerjain soal)
  if (!locked && (
    u.includes('/testcat/option') ||
    u.includes('/testcat/prosestest') ||
    u.includes('/testcat/biodata')
  )) {
    lockDown();
  }

  // === UNLOCK: ujian selesai ===
  // /testcat/hasil = halaman hasil skor
  // /testcat/selesai = selesai ujian
  // /login/logout = logout
  // /Login = kembali ke login (session expired)
  if (locked && (
    u.includes('/testcat/hasil') ||
    u.includes('/testcat/selesai') ||
    u.endsWith('/login') ||
    u.endsWith('/login/') ||
    u.includes('/login/logout')
  )) {
    unlock();
  }

  // Inject anti-cheat JS di halaman ujian
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

  // Block keyboard shortcuts
  const shortcuts = [
    'Alt+Tab','Alt+F4','Alt+Escape','Alt+Space',
    'Ctrl+Escape','Ctrl+Shift+Escape',
    'Meta','Meta+D','Meta+E','Meta+R','Meta+L','Meta+Tab',
    'F11','F12','Ctrl+Shift+I','Ctrl+Shift+J',
    'Ctrl+W','Ctrl+T','Ctrl+N',
    'Ctrl+U','Ctrl+S','Ctrl+P',
    'PrintScreen','Alt+PrintScreen','Meta+Shift+S',
  ];
  shortcuts.forEach(s => { try { globalShortcut.register(s, () => {}); } catch(e) {} });
}

// ============================================================
//  UNLOCK - KELUAR KIOSK
// ============================================================
function unlock() {
  if (!locked) return;
  locked = false;
  console.log('[SEB] UNLOCKED - Exam mode OFF');

  globalShortcut.unregisterAll();

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
//  INJECT ANTI-CHEAT KE HALAMAN
// ============================================================
function injectAntiCheat() {
  win.webContents.executeJavaScript(`
    (function(){
      if(window.__SEB) return;
      window.__SEB = true;

      // Block right-click
      document.addEventListener('contextmenu', e => e.preventDefault());

      // Block copy/paste/print shortcuts
      document.addEventListener('keydown', function(e){
        if((e.ctrlKey && 'cvxasup'.includes(e.key.toLowerCase())) ||
           e.key==='F12'||e.key==='F5'||e.key==='F11'||
           (e.ctrlKey&&e.shiftKey&&'IJC'.includes(e.key)))
        { e.preventDefault(); }
      });

      // Block drag
      document.addEventListener('dragstart', e => e.preventDefault());

      // Block print
      var s=document.createElement('style');
      s.textContent='@media print{body{display:none!important}}';
      document.head.appendChild(s);

      // Badge
      if(!document.getElementById('seb-b')){
        var b=document.createElement('div');
        b.id='seb-b';
        b.style.cssText='position:fixed;top:0;left:0;right:0;background:#1e3a5f;color:#fff;text-align:center;padding:4px;font-size:11px;z-index:999999;font-family:Segoe UI,sans-serif;box-shadow:0 2px 6px rgba(0,0,0,.3)';
        b.textContent='\\u{1F6E1} ELTSA Safe Exam Browser - Mode Terkunci';
        document.body.prepend(b);
        document.body.style.paddingTop='28px';
      }
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
