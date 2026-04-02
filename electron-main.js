const { app, BrowserWindow, protocol, net, session, ipcMain } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');

let mainWindow = null;

app.whenReady().then(() => {
  protocol.handle('app', (request) => {
    const url = new URL(request.url);
    let filePath = decodeURIComponent(url.pathname);
    if (!filePath || filePath === '/') filePath = '/index.html';
    const fullPath = path.join(__dirname, filePath);
    return net.fetch(pathToFileURL(fullPath).toString());
  });

  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    if (permission === 'media' || permission === 'midi' || permission === 'midiSysex') {
      callback(true);
    } else {
      callback(false);
    }
  });
  session.defaultSession.setDevicePermissionHandler(() => true);

  mainWindow = new BrowserWindow({
    width: 820,
    height: 950,
    minWidth: 700,
    minHeight: 800,
    backgroundColor: '#080808',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      contextIsolation: true,
      sandbox: false,
      preload: path.join(__dirname, 'electron-preload.js'),
    }
  });

  mainWindow.loadURL('app://delaystation/');

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.meta && input.alt && input.key === 'i') {
      mainWindow.webContents.toggleDevTools();
    }
  });
});

app.on('window-all-closed', () => app.quit());
