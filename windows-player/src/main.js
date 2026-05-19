const { app, BrowserWindow, Menu, Tray, nativeImage, ipcMain, screen, shell } = require('electron');
const fs = require('fs');
const path = require('path');

const ACTIONS = ['idle', 'run', 'happy', 'rest'];
const BOTTOM_MARGIN = 16;
const SIZE_PRESETS = {
  large: { label: '大', pixels: 200 },
  medium: { label: '中', pixels: 150 },
  small: { label: '小', pixels: 100 }
};
const CHAT_WINDOW = {
  width: 430,
  height: 640
};
const DEFAULT_DOUBAO = {
  baseURL: 'https://ark.cn-beijing.volces.com/api/v3',
  apiKey: '',
  modelID: '',
  systemPrompt: '你是豆包，是桌面宠物里的 AI 助手。请用自然、友好的中文与用户对话，并优先给出直接、有帮助的回答。'
};

let mainWindow = null;
let tray = null;
let isDragging = false;
let dragOffset = { x: 0, y: 0 };
let resourceWatchers = [];
let reloadDebounce = null;
let chatOpen = false;
let chatHistory = [];

function getSettingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function loadSettings() {
  try {
    const parsed = JSON.parse(fs.readFileSync(getSettingsPath(), 'utf8'));
    return {
      size: SIZE_PRESETS[parsed.size] ? parsed.size : 'large',
      doubao: {
        ...DEFAULT_DOUBAO,
        ...(parsed.doubao || {})
      }
    };
  } catch {
    return {
      size: 'large',
      doubao: { ...DEFAULT_DOUBAO }
    };
  }
}

function saveSettings(settings) {
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  fs.writeFileSync(getSettingsPath(), JSON.stringify(settings, null, 2));
}

function currentWindowSize() {
  return SIZE_PRESETS[loadSettings().size].pixels;
}

function loadDoubaoConfig() {
  const settings = loadSettings();
  const env = process.env;
  return {
    ...DEFAULT_DOUBAO,
    ...settings.doubao,
    baseURL: env.ARK_BASE_URL || env.DOUBAO_BASE_URL || settings.doubao.baseURL || DEFAULT_DOUBAO.baseURL,
    apiKey: env.ARK_API_KEY || env.DOUBAO_API_KEY || settings.doubao.apiKey || '',
    modelID: env.ARK_MODEL || env.DOUBAO_MODEL || settings.doubao.modelID || '',
    systemPrompt: env.DOUBAO_SYSTEM_PROMPT || settings.doubao.systemPrompt || DEFAULT_DOUBAO.systemPrompt
  };
}

function saveDoubaoConfig(config) {
  const settings = loadSettings();
  settings.doubao = {
    baseURL: String(config.baseURL || DEFAULT_DOUBAO.baseURL).trim() || DEFAULT_DOUBAO.baseURL,
    apiKey: String(config.apiKey || '').trim(),
    modelID: String(config.modelID || '').trim(),
    systemPrompt: String(config.systemPrompt || DEFAULT_DOUBAO.systemPrompt).trim() || DEFAULT_DOUBAO.systemPrompt
  };
  saveSettings(settings);
  return settings.doubao;
}

function isDoubaoConfigured(config = loadDoubaoConfig()) {
  return Boolean(config.apiKey.trim() && config.modelID.trim());
}

function normalizedRequestURL(baseURL) {
  const trimmed = String(baseURL || '').trim();
  if (!trimmed) return null;
  if (trimmed.endsWith('/chat/completions')) return trimmed;
  return `${trimmed.replace(/\/+$/, '')}/chat/completions`;
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

function actionLabel(action) {
  return {
    idle: '待机',
    run: '走动',
    happy: '开心',
    rest: '趴着'
  }[action] || action;
}

function sendReloadToRenderer() {
  mainWindow?.webContents.send('pet:reload');
}

function scheduleResourceReload() {
  clearTimeout(reloadDebounce);
  reloadDebounce = setTimeout(() => {
    watchResourceLocations();
    sendReloadToRenderer();
  }, 350);
}

function closeResourceWatchers() {
  for (const watcher of resourceWatchers) {
    watcher.close();
  }
  resourceWatchers = [];
}

function watchResourceLocations() {
  closeResourceWatchers();

  const watched = new Set();
  const addWatcher = (directory) => {
    if (!directory || watched.has(directory) || !fs.existsSync(directory)) return;
    watched.add(directory);
    try {
      resourceWatchers.push(fs.watch(directory, scheduleResourceReload));
    } catch {
      // Some synced/download folders can reject file watchers. Manual reload still works.
    }
  };

  addWatcher(app.getPath('downloads'));
  for (const directory of getCandidatePetDirs()) {
    addWatcher(directory);
  }
}

function clampWindowToDisplay(x, y, bounds, size) {
  const [width, height] = size || mainWindow?.getSize() || [currentWindowSize(), currentWindowSize()];
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
  applyWindowMode(chatOpen);
  mainWindow.webContents.send('pet:size-changed', pixels);
}

function applyWindowMode(open = chatOpen) {
  if (!mainWindow) return;

  chatOpen = open;
  const pixels = currentWindowSize();
  const [x, y] = mainWindow.getPosition();
  const [oldWidth, oldHeight] = mainWindow.getSize();
  const nextWidth = open ? Math.max(CHAT_WINDOW.width, pixels) : pixels;
  const nextHeight = open ? CHAT_WINDOW.height : pixels;
  const display = screen.getDisplayNearestPoint({ x: x + oldWidth / 2, y: y + oldHeight / 2 });
  const target = clampWindowToDisplay(
    x + oldWidth - nextWidth,
    y + oldHeight - nextHeight,
    display.workArea,
    [nextWidth, nextHeight]
  );

  mainWindow.setSize(nextWidth, nextHeight, true);
  mainWindow.setPosition(target.x, target.y, true);
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
  const petLibrary = loadPetVideos();
  const missingLabel = petLibrary.missingActions.map(actionLabel).join('、') || '无';
  const menu = Menu.buildFromTemplate([
    {
      label: `当前资源: ${petLibrary.customPetDir}`,
      enabled: false
    },
    {
      label: `缺失动作: ${missingLabel}`,
      enabled: false
    },
    { type: 'separator' },
    {
      label: '重新读取 custompet',
      click: () => {
        watchResourceLocations();
        sendReloadToRenderer();
      }
    },
    {
      label: '播放动作',
      submenu: ACTIONS.map((action) => ({
        label: actionLabel(action),
        enabled: Boolean(petLibrary.videos[action]),
        click: () => mainWindow?.webContents.send('pet:play-action', action)
      }))
    },
    {
      label: '打开聊天框',
      click: () => mainWindow?.webContents.send('pet:open-chat')
    },
    {
      label: '豆包 API 设置…',
      click: () => mainWindow?.webContents.send('pet:open-settings')
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
      label: '打开当前资源文件夹',
      enabled: fs.existsSync(petLibrary.customPetDir),
      click: () => shell.openPath(petLibrary.customPetDir)
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
  watchResourceLocations();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  closeResourceWatchers();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', closeResourceWatchers);

ipcMain.handle('pet:get-videos', () => loadPetVideos());
ipcMain.handle('pet:return-bottom', () => moveToDesktopBottom());
ipcMain.handle('pet:get-size', () => currentWindowSize());
ipcMain.handle('pet:get-doubao-config', () => {
  const config = loadDoubaoConfig();
  return {
    ...config,
    isConfigured: isDoubaoConfigured(config)
  };
});
ipcMain.handle('pet:save-doubao-config', (_event, config) => {
  chatHistory = [];
  const saved = saveDoubaoConfig(config || {});
  return {
    ...saved,
    isConfigured: isDoubaoConfigured(saved)
  };
});
ipcMain.handle('pet:send-chat', async (_event, message) => sendDoubaoMessage(message));

ipcMain.on('pet:context-menu', showContextMenu);
ipcMain.on('pet:move-by', (_event, deltaX, deltaY = 0) => moveWindowBy(deltaX, deltaY));
ipcMain.on('pet:set-chat-open', (_event, open) => applyWindowMode(Boolean(open)));

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

async function sendDoubaoMessage(message) {
  const text = String(message || '').trim();
  if (!text) {
    return { ok: false, error: '请输入要发送的内容。' };
  }

  const config = loadDoubaoConfig();
  if (!isDoubaoConfigured(config)) {
    return {
      ok: false,
      error: '豆包还没有配置完成。请在右键菜单打开“豆包 API 设置…”，至少填写 API Key 和 Endpoint / Model。'
    };
  }

  const requestURL = normalizedRequestURL(config.baseURL);
  if (!requestURL) {
    return { ok: false, error: `Doubao Base URL 无效：${config.baseURL}` };
  }

  chatHistory.push({ role: 'user', content: text });
  const messages = [];
  const prompt = String(config.systemPrompt || '').trim();
  if (prompt) {
    messages.push({ role: 'system', content: prompt });
  }
  messages.push(...chatHistory.slice(-16));

  try {
    const response = await fetch(requestURL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`
      },
      body: JSON.stringify({
        model: config.modelID,
        messages,
        stream: false
      })
    });

    const raw = await response.text();
    if (!response.ok) {
      return {
        ok: false,
        error: userFriendlyDoubaoError(response.status, raw, config.modelID)
      };
    }

    const decoded = JSON.parse(raw);
    const reply = extractDoubaoText(decoded).trim();
    if (!reply) {
      return { ok: false, error: '豆包返回成功，但回复内容为空。' };
    }

    chatHistory.push({ role: 'assistant', content: reply });
    return { ok: true, text: reply };
  } catch (error) {
    return { ok: false, error: `豆包请求失败：${error.message}` };
  }
}

function extractDoubaoText(decoded) {
  const content = decoded?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((part) => !part.type || part.type === 'text')
      .map((part) => part.text || '')
      .join('');
  }
  return '';
}

function userFriendlyDoubaoError(statusCode, body, modelID) {
  if (statusCode === 404 && body.includes('InvalidEndpointOrModel.NotFound')) {
    return [
      '豆包返回了错误：当前的 Endpoint / Model 不存在，或者你的账号没有访问权限。',
      '',
      `现在填写的是：${modelID}`,
      '',
      '请去火山方舟控制台确认这个推理接入点 ID 是否真实存在，并确认 API Key 有访问权限。',
      '',
      `原始返回：HTTP 404\n${body}`
    ].join('\n');
  }

  return `豆包返回了错误：\n${body || `HTTP ${statusCode}`}`;
}
