const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const { autoUpdater } = require('electron-updater');
const log = require('electron-log');

log.transports.file.level = 'info';
autoUpdater.logger = log;

let mainWindow = null;
let serverInstance = null;
let serverPort = null;
let dbInstance = null;

// Multi-tenant profile management
function getProfileDir(profileName = 'default') {
  const sanitized = profileName.replace(/[^a-zA-Z0-9_-]/g, '_');
  const baseDir = path.join(app.getPath('userData'), 'profiles', sanitized);
  fs.mkdirSync(baseDir, { recursive: true });
  return baseDir;
}

// Start local embedded backend server on a dynamic or configured loopback port
async function startBackendServer(profileName = 'default') {
  const { openDb } = await import('../server/src/db.js');
  const { createApp } = await import('../server/src/app.js');

  return new Promise(async (resolve, reject) => {
    try {
      const profileDir = getProfileDir(profileName);
      const dbPath = path.join(profileDir, 'atbsoftware.db');
      log.info(`Initializing profile [${profileName}] at ${dbPath}`);

      process.env.DB_PATH = dbPath;
      process.env.TZ = process.env.TZ || 'Asia/Kolkata';

      dbInstance = await openDb(dbPath);
      const expressApp = createApp(dbInstance);

      serverInstance = http.createServer(expressApp);
      // Bind to localhost on ephemeral port (0)
      serverInstance.listen(0, '127.0.0.1', () => {
        serverPort = serverInstance.address().port;
        log.info(`Embedded POS Backend listening on http://127.0.0.1:${serverPort}`);
        resolve(serverPort);
      });

      serverInstance.on('error', (err) => {
        log.error('Backend server error:', err);
        reject(err);
      });
    } catch (err) {
      log.error('Failed to start backend server:', err);
      reject(err);
    }
  });
}

function createWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 850,
    minWidth: 1024,
    minHeight: 700,
    title: 'ATB Software POS - Desktop',
    icon: path.join(__dirname, '../build/icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      sandbox: false,
    },
    autoHideMenuBar: true,
  });

  const isDev = process.env.NODE_ENV === 'development';

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    // In production, serve the built Vite client
    const indexPath = path.join(__dirname, '../../client/dist/index.html');
    mainWindow.loadFile(indexPath);
  }

  // Handle external link clicks securely
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:') || url.startsWith('http:')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Auto-Updater setup
function setupAutoUpdater() {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    log.info('Checking for application updates...');
    mainWindow?.webContents.send('updater-status', { status: 'checking' });
  });

  autoUpdater.on('update-available', (info) => {
    log.info('Update available:', info.version);
    mainWindow?.webContents.send('updater-status', {
      status: 'available',
      version: info.version,
      releaseNotes: info.releaseNotes,
    });
  });

  autoUpdater.on('update-not-available', () => {
    log.info('Update not available. Application is up to date.');
    mainWindow?.webContents.send('updater-status', { status: 'not-available' });
  });

  autoUpdater.on('download-progress', (progress) => {
    mainWindow?.webContents.send('updater-status', {
      status: 'downloading',
      percent: Math.round(progress.percent),
      bytesPerSecond: progress.bytesPerSecond,
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    log.info('Update downloaded successfully');
    mainWindow?.webContents.send('updater-status', {
      status: 'downloaded',
      version: info.version,
    });
  });

  autoUpdater.on('error', (err) => {
    log.error('Auto-updater error:', err);
    mainWindow?.webContents.send('updater-status', {
      status: 'error',
      message: err.message,
    });
  });
}

// IPC Handlers
ipcMain.handle('get-backend-port', () => serverPort);

ipcMain.handle('check-for-updates', async () => {
  try {
    return await autoUpdater.checkForUpdates();
  } catch (err) {
    log.error('Manual check for updates error:', err);
    return { error: err.message };
  }
});

ipcMain.handle('download-update', async () => {
  try {
    return await autoUpdater.downloadUpdate();
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('install-update', () => {
  autoUpdater.quitAndInstall();
});

// Backup database IPC
ipcMain.handle('backup-database', async () => {
  if (!mainWindow) return;
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Backup ATB POS Database',
    defaultPath: `atbsoftware_backup_${new Date().toISOString().slice(0, 10)}.db`,
    filters: [{ name: 'SQLite Database', extensions: ['db', 'sqlite'] }],
  });

  if (!result.canceled && result.filePath) {
    try {
      const srcPath = process.env.DB_PATH;
      fs.copyFileSync(srcPath, result.filePath);
      return { success: true, path: result.filePath };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }
  return { canceled: true };
});

// App lifecycle
app.whenReady().then(async () => {
  try {
    const port = await startBackendServer();
    createWindow(port);
    setupAutoUpdater();

    // Check updates silently 10 seconds after launch
    if (process.env.NODE_ENV !== 'development') {
      setTimeout(() => {
        autoUpdater.checkForUpdates().catch((err) => log.warn('Initial update check error:', err));
      }, 10000);
    }
  } catch (err) {
    dialog.showErrorBox('Startup Error', `Failed to initialize application: ${err.message}`);
    app.quit();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(serverPort);
  });
});

app.on('window-all-closed', () => {
  if (serverInstance) {
    serverInstance.close();
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
