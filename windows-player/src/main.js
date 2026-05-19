const { app, BrowserWindow, Menu, ipcMain, screen, shell } = require('electron');
const fs = require('fs');
const path = require('path');

const ACTIONS = ['idle', 'run', 'happy', 'rest'];
const WINDOW_SIZE = 420;
const BOTTOM_MARGIN = 16;

let mainWindow = null;
let isDragging = false;
let dragOffset = { x: 0, y: 0 };

function getCustomPetDir() {
  return path.join(app.getPath('downloads'), 'custompet');
}

function findActionVideo(customPetDir, action) {
  const candidates = [
    path.join(customPetDir, `${action}.mp4`),
    path.join(customPetDir, `${action}.mov`),
    path.join(customPetDir, 'hevc', `${action}.mov`)
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function loadPetVideos() {
  const customPetDir = getCustomPetDir();
  const videos = {};

  for (const action of ACTIONS) {
    const videoPath = findActionVideo(customPetDir, action);
    if (videoPath) {
      videos[action] = videoPath;
    }
  }

  return {
    customPetDir,
    videos,
    missingActions: ACTIONS.filter((action) => !videos[action])
  };
}

function clampWindowToDisplay(x, y, bounds) {
  return {
    x: Math.round(Math.min(Math.max(x, bounds.x), bounds.x + bounds.width - WINDOW_SIZE)),
    y: Math.round(Math.min(Math.max(y, bounds.y), bounds.y + bounds.height - WINDOW_SIZE))
  };
}

function moveToDesktopBottom() {
  if (!mainWindow) return;

  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const bounds = display.workArea;
  const target = clampWindowToDisplay(
    bounds.x + bounds.width - WINDOW_SIZE - 32,
    bounds.y + bounds.height - WINDOW_SIZE - BOTTOM_MARGIN,
    bounds
  );
  mainWindow.setPosition(target.x, target.y, true);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: WINDOW_SIZE,
    height: WINDOW_SIZE,
    frame: false,
    transparent: true,
    resizable: false,
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.setAlwaysOnTop(true, 'screen-saver');
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.once('ready-to-show', moveToDesktopBottom);
}

function showContextMenu() {
  const menu = Menu.buildFromTemplate([
    {
      label: '重新读取 custompet',
      click: () => mainWindow?.webContents.send('pet:reload')
    },
    {
      label: '回到桌面底部',
      click: moveToDesktopBottom
    },
    {
      label: '打开下载文件夹',
      click: () => shell.openPath(app.getPath('downloads'))
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => app.quit()
    }
  ]);
  menu.popup({ window: mainWindow });
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

ipcMain.handle('pet:get-videos', () => loadPetVideos());
ipcMain.handle('pet:return-bottom', () => moveToDesktopBottom());

ipcMain.on('pet:context-menu', showContextMenu);

ipcMain.on('pet:drag-start', () => {
  if (!mainWindow) return;

  const cursor = screen.getCursorScreenPoint();
  const [windowX, windowY] = mainWindow.getPosition();
  dragOffset = {
    x: cursor.x - windowX,
    y: cursor.y - windowY
  };
  isDragging = true;
});

ipcMain.on('pet:drag-move', () => {
  if (!mainWindow || !isDragging) return;

  const cursor = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursor);
  const target = clampWindowToDisplay(
    cursor.x - dragOffset.x,
    cursor.y - dragOffset.y,
    display.workArea
  );
  mainWindow.setPosition(target.x, target.y, false);
});

ipcMain.on('pet:drag-end', () => {
  isDragging = false;
});
