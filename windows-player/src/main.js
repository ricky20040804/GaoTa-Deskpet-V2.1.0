const { app, BrowserWindow, Menu, Tray, nativeImage, ipcMain, screen, shell } = require('electron');
const fs = require('fs');
const path = require('path');

const ACTIONS = ['idle', 'run', 'happy', 'rest'];
const BOTTOM_MARGIN = 16;
const SIZE_PRESETS = {
  large: { label: '大', pixels: 320 },
  medium: { label: '中', pixels: 240 },
  small: { label: '小', pixels: 180 }
};

let mainWindow = null;
let tray = null;
let isDragging = false;
let dragOffset = { x: 0, y: 0 };

function getSettingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function loadSettings() {
  try {
    const parsed = JSON.parse(fs.readFileSync(getSettingsPath(), 'utf8'));
    return {
      size: SIZE_PRESETS[parsed.size] ? parsed.size : 'large'
    };
  } catch {
    return { size: 'large' };
  }
}

function saveSettings(settings) {
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  fs.writeFileSync(getSettingsPath(), JSON.stringify(settings, null, 2));
}

function currentWindowSize() {
  return SIZE_PRESETS[loadSettings().size].pixels;
}

function getCandidatePetDirs() {
  return [
    path.join(app.getPath('downloads'), 'custompet'),
    path.join(app.getPath('downloads'), 'custom_pet'),
    path.join(process.cwd(), 'custompet', 'generated', 'current')
  ];
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
  const candidateDirs = getCandidatePetDirs();
  const existingDirs = candidateDirs.filter((candidate) => fs.existsSync(candidate));
  const customPetDir = existingDirs[0] || candidateDirs[0];
  const videos = {};

  for (const action of ACTIONS) {
    const videoPath = existingDirs.map((directory) => findActionVideo(directory, action)).find(Boolean);
    if (videoPath) {
      videos[action] = videoPath;
    }
  }

  return {
    customPetDir,
    candidateDirs,
    videos,
    missingActions: ACTIONS.filter((action) => !videos[action])
  };
}

function clampWindowToDisplay(x, y, bounds) {
  const [width, height] = mainWindow?.getSize() || [currentWindowSize(), currentWindowSize()];
  return {
    x: Math.round(Math.min(Math.max(x, bounds.x), bounds.x + bounds.width - width)),
    y: Math.round(Math.min(Math.max(y, bounds.y), bounds.y + bounds.height - height))
  };
}

function moveToDesktopBottom() {
  if (!mainWindow) return;

  const [width, height] = mainWindow.getSize();
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const bounds = display.workArea;
  const target = clampWindowToDisplay(
    bounds.x + bounds.width - width - 32,
    bounds.y + bounds.height - height - BOTTOM_MARGIN,
    bounds
  );
  mainWindow.setPosition(target.x, target.y, true);
}

function setPetSize(size) {
  if (!SIZE_PRESETS[size] || !mainWindow) return;

  const settings = loadSettings();
  settings.size = size;
  saveSettings(settings);

  const pixels = SIZE_PRESETS[size].pixels;
  mainWindow.setSize(pixels, pixels, true);
  mainWindow.webContents.send('pet:size-changed', pixels);
  moveToDesktopBottom();
}

function moveWindowBy(deltaX, deltaY) {
  if (!mainWindow) return;
  const [x, y] = mainWindow.getPosition();
  const display = screen.getDisplayNearestPoint({ x: x + deltaX, y: y + deltaY });
  const target = clampWindowToDisplay(x + deltaX, y + deltaY, display.workArea);
  mainWindow.setPosition(target.x, target.y, false);
}

function findTrayIcon() {
  const candidates = [
    path.join(__dirname, '..', '..', 'LilAgents', 'Assets.xcassets', 'MenuBarIcon.imageset', 'bubble-icon@3x.png'),
    path.join(__dirname, '..', '..', 'LilAgents', 'Assets.xcassets', 'AppIcon.appiconset', 'icon_32x32.png'),
    path.join(process.resourcesPath || '', 'icon.png')
  ];

  const iconPath = candidates.find((candidate) => candidate && fs.existsSync(candidate));
  if (!iconPath) return nativeImage.createEmpty();
  return nativeImage.createFromPath(iconPath);
}

function createTray() {
  tray = new Tray(findTrayIcon());
  tray.setToolTip('GaoTa Deskpet');
  tray.on('click', () => {
    if (mainWindow?.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow?.show();
    }
  });
  tray.on('right-click', showContextMenu);
}

function createWindow() {
  const pixels = currentWindowSize();
  mainWindow = new BrowserWindow({
    width: pixels,
    height: pixels,
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
  const settings = loadSettings();
  const menu = Menu.buildFromTemplate([
    {
      label: '重新读取 custompet',
      click: () => mainWindow?.webContents.send('pet:reload')
    },
    {
      label: mainWindow?.isVisible() ? '隐藏桌宠' : '显示桌宠',
      click: () => {
        if (mainWindow?.isVisible()) {
          mainWindow.hide();
        } else {
          mainWindow?.show();
        }
      }
    },
    {
      label: '回到桌面底部',
      click: moveToDesktopBottom
    },
    {
      label: '大小',
      submenu: Object.entries(SIZE_PRESETS).map(([size, preset]) => ({
        label: preset.label,
        type: 'radio',
        checked: settings.size === size,
        click: () => setPetSize(size)
      }))
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
  createTray();

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
ipcMain.handle('pet:get-size', () => currentWindowSize());

ipcMain.on('pet:context-menu', showContextMenu);
ipcMain.on('pet:move-by', (_event, deltaX, deltaY = 0) => moveWindowBy(deltaX, deltaY));

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
