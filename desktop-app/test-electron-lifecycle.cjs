const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');

let serverInstance = null;
let serverPort = null;
let dbInstance = null;

async function startBackendServer() {
  const { openDb } = await import('./server/src/db.js');
  const { createApp } = await import('./server/src/app.js');

  const testDbDir = path.join(app.getPath('userData'), 'test-profile');
  fs.mkdirSync(testDbDir, { recursive: true });
  const dbPath = path.join(testDbDir, 'test_atbsoftware.db');

  dbInstance = await openDb(dbPath);
  const expressApp = createApp(dbInstance);

  return new Promise((resolve, reject) => {
    serverInstance = http.createServer(expressApp);
    serverInstance.listen(0, '127.0.0.1', () => {
      serverPort = serverInstance.address().port;
      console.log(`[TEST] Embedded backend server listening on http://127.0.0.1:${serverPort}`);
      resolve(serverPort);
    });
    serverInstance.on('error', reject);
  });
}

ipcMain.handle('get-backend-port', () => serverPort);
ipcMain.handle('check-for-updates', async () => ({ status: 'mock-up-to-date' }));
ipcMain.handle('download-update', async () => ({ status: 'mock-downloaded' }));
ipcMain.handle('install-update', () => {});
ipcMain.handle('backup-database', async () => ({ success: true, path: 'mock_backup.db' }));

app.whenReady().then(async () => {
  console.log('[TEST] Electron app ready. Starting embedded server...');
  try {
    await startBackendServer();

    console.log('[TEST] Creating BrowserWindow (off-screen / headless)...');
    const win = new BrowserWindow({
      width: 1280,
      height: 800,
      show: false, // run headless during automated test
      webPreferences: {
        preload: path.join(__dirname, 'src/preload.cjs'),
        nodeIntegration: false,
        contextIsolation: true,
        webSecurity: true,
        sandbox: false,
      },
    });

    // Capture any console messages or errors from the renderer
    win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
      console.log(`[RENDERER CONSOLE lvl=${level}] ${message} (${sourceId}:${line})`);
    });

    win.webContents.on('render-process-gone', (_event, details) => {
      console.error('[TEST ERROR] Renderer process gone:', details);
      process.exit(1);
    });

    const indexPath = path.join(__dirname, 'dist/index.html');
    console.log(`[TEST] Loading production index.html: ${indexPath}`);
    if (!fs.existsSync(indexPath)) {
      throw new Error(`File does not exist: ${indexPath}`);
    }

    await win.loadFile(indexPath);
    console.log('[TEST] index.html loaded successfully. Waiting 1.5s for React DOM mounting...');

    await new Promise((r) => setTimeout(r, 1500));

    // Verify DOM and desktopAPI inside the renderer
    const testResult = await win.webContents.executeJavaScript(`
      (async () => {
        const root = document.getElementById('root');
        const hasRoot = !!root;
        const rootHtml = root ? root.innerHTML : '';
        const title = document.title;
        const hasDesktopAPI = !!window.desktopAPI;
        let portFromDesktopAPI = null;
        if (hasDesktopAPI && window.desktopAPI.getBackendPort) {
          portFromDesktopAPI = await window.desktopAPI.getBackendPort();
        }

        // Check if React rendered UI (e.g. login form or header)
        const hasFormOrNav = rootHtml.includes('input') || rootHtml.includes('button') || rootHtml.includes('ATB');

        return {
          hasRoot,
          rootHtmlLength: rootHtml.length,
          title,
          hasDesktopAPI,
          portFromDesktopAPI,
          hasFormOrNav,
          previewSnippet: rootHtml.slice(0, 300)
        };
      })()
    `);

    console.log('[TEST RESULT FROM RENDERER]:', JSON.stringify(testResult, null, 2));
    fs.writeFileSync(path.join(__dirname, 'test-result.json'), JSON.stringify({ success: true, serverPort, testResult }, null, 2));

    if (!testResult.hasRoot) {
      throw new Error('Root #root container not found in DOM!');
    }
    if (testResult.rootHtmlLength === 0) {
      throw new Error('Blank page detected! React did not render any markup into #root.');
    }
    if (!testResult.hasDesktopAPI) {
      throw new Error('window.desktopAPI bridge is NOT available in renderer!');
    }
    if (testResult.portFromDesktopAPI !== serverPort) {
      throw new Error(`Port mismatch: expected ${serverPort}, got ${testResult.portFromDesktopAPI}`);
    }
    if (!testResult.hasFormOrNav) {
      throw new Error('Expected form/button/ATB elements in UI, but none found.');
    }

    console.log('\n======================================================');
    console.log('✅ ELECTRON LIFECYCLE & RENDERER TEST PASSED COMPLETELY!');
    console.log('   - Backend server started on port ' + serverPort);
    console.log('   - Window loaded dist/index.html successfully');
    console.log('   - window.desktopAPI IPC communication verified');
    console.log('   - React DOM hydrated without black/blank screen');
    console.log('   - UI Title: ' + testResult.title);
    console.log('======================================================\n');

    win.destroy();
    if (serverInstance) serverInstance.close();
    app.quit();
    process.exit(0);
  } catch (err) {
    console.error('\n❌ ELECTRON LIFECYCLE TEST FAILED:', err);
    fs.writeFileSync(path.join(__dirname, 'test-error.log'), err.stack || String(err));
    if (serverInstance) serverInstance.close();
    app.quit();
    process.exit(1);
  }
});
