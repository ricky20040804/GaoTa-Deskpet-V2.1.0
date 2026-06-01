const ACTIONS = ['idle', 'run', 'happy', 'rest'];
const SIZE_PRESETS = {
  large: { label: '大', pixels: 200 },
  medium: { label: '中', pixels: 150 },
  small: { label: '小', pixels: 100 }
};
const GREEN_KEY = {
  minG: 105,
  greenOverRed: 30,
  greenOverBlue: 30,
  softness: 34
};
const IDLE_DELAY_RANGE = [6000, 14000];
const SOON_DELAY_RANGE = [2000, 5000];

const video = document.getElementById('petVideo');
const canvas = document.getElementById('petCanvas');
const context = canvas.getContext('2d', { willReadFrequently: true });
const emptyState = document.getElementById('emptyState');
const emptyStateTitle = document.getElementById('emptyStateTitle');
const emptyStateMessage = document.getElementById('emptyStateMessage');
const appRoot = document.getElementById('app');
const chatPanel = document.getElementById('chatPanel');
const chatStatus = document.getElementById('chatStatus');
const chatMessages = document.getElementById('chatMessages');
const chatForm = document.getElementById('chatForm');
const chatInput = document.getElementById('chatInput');
const sendButton = document.getElementById('sendButton');
const settingsButton = document.getElementById('settingsButton');
const closeChatButton = document.getElementById('closeChatButton');
const settingsPanel = document.getElementById('settingsPanel');
const settingsForm = document.getElementById('settingsForm');
const closeSettingsButton = document.getElementById('closeSettingsButton');
const baseUrlInput = document.getElementById('baseUrlInput');
const apiKeyInput = document.getElementById('apiKeyInput');
const modelInput = document.getElementById('modelInput');
const systemPromptInput = document.getElementById('systemPromptInput');
const offscreen = document.createElement('canvas');
const offscreenContext = offscreen.getContext('2d', { willReadFrequently: true });
const tauri = window.__TAURI__;
if (!tauri?.core?.invoke) {
  showEmptyState(
    '运行器初始化失败',
    'Windows 运行器没有成功加载 Tauri 环境。请重新下载官网里的 Windows 运行器后再打开。'
  );
  throw new Error('Tauri runtime is unavailable.');
}
const invoke = tauri.core.invoke;
const convertFileSrc = tauri.core.convertFileSrc;

let videos = {};
let petLibrary = null;
let currentAction = 'idle';
let canvasSize = 320;
let animationFrame = 0;
let idleTimer = 0;
let reloadTimer = 0;
let dragging = false;
let dragMoved = false;
let runDirection = 1;
let runStartedAt = 0;
let runDuration = 3200;
let lastWalkProgress = 0;
let chatOpen = false;
let sendingChat = false;
let contextMenu = null;
let videoErrorCount = 0;
let directVideoMode = false;
let canvasFailureCount = 0;
let lastPaintedAt = 0;
let blankFrameWarningShown = false;

window.deskpet = {
  getVideos: () => invoke('get_videos'),
  returnBottom: () => invoke('return_bottom'),
  getSize: () => invoke('get_size'),
  setSize: (size) => invoke('set_size', { size }),
  getDoubaoConfig: () => invoke('get_doubao_config'),
  saveDoubaoConfig: (config) => invoke('save_doubao_config', { config }),
  sendChat: (message) => invoke('send_chat', { message }),
  moveBy: (deltaX, deltaY = 0) => invoke('move_by', { deltaX, deltaY }),
  setChatOpen: (open) => invoke('set_chat_open', { open }),
  setResourceVisible: (visible) => invoke('set_resource_visible', { visible }),
  dragStart: (screenX, screenY) => invoke('drag_start', { screenX, screenY }),
  dragMove: (screenX, screenY) => invoke('drag_move', { screenX, screenY }),
  dragEnd: () => invoke('drag_end'),
  openCurrentResourceDir: () => invoke('open_current_resource_dir'),
  openDownloadsDir: () => invoke('open_downloads_dir'),
  quitApp: () => invoke('quit_app'),
  onReload: () => {},
  onPlayAction: () => {},
  onOpenChat: () => {},
  onOpenSettings: () => {},
  onSizeChanged: () => {}
};

function showEmptyState(title, message) {
  emptyStateTitle.textContent = title;
  emptyStateMessage.textContent = message;
  emptyState.hidden = false;
}

function hideEmptyState() {
  emptyState.hidden = true;
}

function fileUrl(filePath) {
  return convertFileSrc ? convertFileSrc(filePath) : encodeURI(`file://${filePath.replace(/\\/g, '/')}`);
}

function shouldUseDirectVideo(filePath) {
  return /\.webm(?:$|[?#])/i.test(filePath || '');
}

function setDirectVideoMode(enabled) {
  directVideoMode = enabled;
  video.classList.toggle('direct-video', enabled);
  if (!enabled) {
    video.style.transform = '';
  }
}

function updateDirectVideoTransform() {
  if (!directVideoMode) return;
  video.style.transform = currentAction === 'run' && runDirection > 0 ? 'scaleX(-1)' : '';
}

function resizeCanvas(pixels) {
  canvasSize = pixels || window.innerWidth || 320;
  canvas.width = canvasSize;
  canvas.height = canvasSize;
  offscreen.width = canvasSize;
  offscreen.height = canvasSize;
  appRoot.style.setProperty('--pet-size', `${canvasSize}px`);
}

function chooseAction() {
  const available = ACTIONS.filter((action) => videos[action]);
  if (!available.length) return null;
  return available[Math.floor(Math.random() * available.length)];
}

function randomRange([min, max]) {
  return min + Math.random() * (max - min);
}

function actionLabel(action) {
  return {
    idle: '待机',
    run: '走动',
    happy: '开心',
    rest: '趴着'
  }[action] || action;
}

function scheduleNextIdleAction(soon = false) {
  window.clearTimeout(idleTimer);
  idleTimer = window.setTimeout(() => {
    playAction(chooseAction() || 'idle');
  }, randomRange(soon ? SOON_DELAY_RANGE : IDLE_DELAY_RANGE));
}

function easeInOut(progress) {
  const value = Math.max(0, Math.min(1, progress));
  return value < 0.5 ? 2 * value * value : 1 - Math.pow(-2 * value + 2, 2) / 2;
}

function playAction(action) {
  if (!videos[action]) {
    action = videos.idle ? 'idle' : chooseAction();
  }
  if (!action) return;

  currentAction = action;
  const sourcePath = videos[action];
  setDirectVideoMode(shouldUseDirectVideo(sourcePath));
  canvasFailureCount = 0;
  blankFrameWarningShown = false;
  video.src = fileUrl(sourcePath);
  video.currentTime = 0;
  video.play().catch(() => {
    showEmptyState('视频播放失败', '已找到 custompet，但 Windows 无法播放当前视频。请重新生成资源包或确认资源包里包含 idle/run/happy/rest 的 mp4 或 webm 文件。');
    window.deskpet.setResourceVisible(false).catch(() => {});
  });

  if (action === 'run') {
    runDirection = Math.random() > 0.5 ? 1 : -1;
    runStartedAt = performance.now();
    lastWalkProgress = 0;
    runDuration = Math.max(2400, Math.min(4200, (video.duration || 3.2) * 1000));
  }
  updateDirectVideoTransform();
}

function setChatStatus(text) {
  chatStatus.textContent = text;
}

function appendMessage(role, text) {
  const message = document.createElement('div');
  message.className = `message ${role}`;
  message.textContent = text;
  chatMessages.appendChild(message);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function setChatOpen(open) {
  chatOpen = open;
  chatPanel.hidden = !open;
  window.deskpet.setChatOpen(open);
  if (open) {
    loadDoubaoSettings();
    window.setTimeout(() => chatInput.focus(), 120);
  } else {
    closeSettings();
  }
}

function openChat() {
  setChatOpen(true);
}

function closeChat() {
  setChatOpen(false);
}

function openSettings() {
  settingsPanel.hidden = false;
  loadDoubaoSettings().then(() => baseUrlInput.focus());
}

function closeSettings() {
  settingsPanel.hidden = true;
}

async function loadDoubaoSettings() {
  const config = await window.deskpet.getDoubaoConfig();
  baseUrlInput.value = config.baseURL || '';
  apiKeyInput.value = config.apiKey || '';
  modelInput.value = config.modelID || '';
  systemPromptInput.value = config.systemPrompt || '';
  setChatStatus(config.isConfigured ? '豆包已配置' : '请先配置豆包 API');
  return config;
}

async function sendChatMessage(text) {
  if (sendingChat) return;
  const trimmed = text.trim();
  if (!trimmed) return;

  sendingChat = true;
  chatInput.value = '';
  sendButton.disabled = true;
  setChatStatus('豆包正在思考');
  appendMessage('user', trimmed);
  playAction(videos.idle ? 'idle' : chooseAction());

  const result = await window.deskpet.sendChat(trimmed);
  sendingChat = false;
  sendButton.disabled = false;

  if (result.ok) {
    appendMessage('assistant', result.text);
    setChatStatus('回复完成');
    if (videos.happy) {
      playAction('happy');
    }
  } else {
    appendMessage('error', result.error || '豆包请求失败。');
    setChatStatus('请求失败');
  }
  scheduleNextIdleAction(true);
}

function keyGreen(imageData) {
  const data = imageData.data;
  for (let index = 0; index < data.length; index += 4) {
    const red = data[index];
    const green = data[index + 1];
    const blue = data[index + 2];

    const greenScore = Math.min(green - red, green - blue);
    if (green >= GREEN_KEY.minG && greenScore >= GREEN_KEY.greenOverRed && greenScore >= GREEN_KEY.greenOverBlue) {
      const alpha = Math.max(0, Math.min(255, 255 - (greenScore - GREEN_KEY.greenOverRed) * GREEN_KEY.softness));
      data[index + 3] = alpha;
    }
  }
  return imageData;
}

function drawFrame() {
  context.clearRect(0, 0, canvasSize, canvasSize);

  if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
    if (directVideoMode) {
      lastPaintedAt = performance.now();
      hideEmptyState();
      if (currentAction === 'run') {
        const elapsed = performance.now() - runStartedAt;
        const progress = easeInOut(elapsed / runDuration);
        const delta = (progress - lastWalkProgress) * 220 * runDirection;
        if (Math.abs(delta) > 0.01) {
          window.deskpet.moveBy(delta, 0);
        }
        lastWalkProgress = progress;
        updateDirectVideoTransform();
      }
      animationFrame = window.requestAnimationFrame(drawFrame);
      return;
    }

    try {
      offscreenContext.clearRect(0, 0, canvasSize, canvasSize);
      offscreenContext.drawImage(video, 0, 0, canvasSize, canvasSize);

      const keyedFrame = keyGreen(offscreenContext.getImageData(0, 0, canvasSize, canvasSize));
      offscreenContext.putImageData(keyedFrame, 0, 0);
      lastPaintedAt = performance.now();
      hideEmptyState();
    } catch (error) {
      canvasFailureCount += 1;
      if (canvasFailureCount === 1) {
        console.error('Failed to key video frame on canvas:', error);
      }
      if (canvasFailureCount > 20) {
        setDirectVideoMode(true);
        hideEmptyState();
      }
      animationFrame = window.requestAnimationFrame(drawFrame);
      return;
    }

    if (currentAction === 'run') {
      const elapsed = performance.now() - runStartedAt;
      const progress = easeInOut(elapsed / runDuration);
      const delta = (progress - lastWalkProgress) * 220 * runDirection;
      if (Math.abs(delta) > 0.01) {
        window.deskpet.moveBy(delta, 0);
      }
      lastWalkProgress = progress;
    }

    context.save();
    if (currentAction === 'run' && runDirection > 0) {
      context.translate(canvasSize, 0);
      context.scale(-1, 1);
    }
    context.drawImage(offscreen, 0, 0, canvasSize, canvasSize);
    context.restore();
  }

  if (!directVideoMode && Object.keys(videos).length > 0 && !blankFrameWarningShown && performance.now() - lastPaintedAt > 3000) {
    blankFrameWarningShown = true;
    showEmptyState('视频没有画面', '运行器已启动，但 Windows 没有成功绘制宠物视频。请重新生成资源包，新的资源包会包含 Windows 专用透明 webm。');
    window.deskpet.setResourceVisible(false).catch(() => {});
  }

  animationFrame = window.requestAnimationFrame(drawFrame);
}

async function reloadPetVideos() {
  const result = await window.deskpet.getVideos();
  petLibrary = result;
  videos = result.videos || {};
  const hasVideos = Object.keys(videos).length > 0;
  videoErrorCount = 0;
  lastPaintedAt = performance.now();
  blankFrameWarningShown = false;
  await window.deskpet.setResourceVisible(hasVideos).catch(() => {});

  if (hasVideos) {
    hideEmptyState();
    playAction(videos.idle ? 'idle' : chooseAction());
    scheduleNextIdleAction(true);
  } else {
    showEmptyState('没有找到宠物资源', '请把 custompet 解压到“下载”文件夹，确认路径是 Downloads/custompet，然后右键选择重新读取。');
    window.clearTimeout(idleTimer);
    context.clearRect(0, 0, canvasSize, canvasSize);
    setDirectVideoMode(false);
    video.removeAttribute('src');
    video.load();
    window.clearTimeout(reloadTimer);
    reloadTimer = window.setTimeout(reloadPetVideos, 2500);
  }
}

video.addEventListener('ended', () => scheduleNextIdleAction());
video.addEventListener('error', () => {
  videoErrorCount += 1;
  if (videoErrorCount >= 1) {
    showEmptyState('视频无法播放', '已找到 custompet，但视频解码失败。请确认资源包里有 idle/run/happy/rest.mp4，或重新生成资源包。');
    window.deskpet.setResourceVisible(false).catch(() => {});
  }
  scheduleNextIdleAction(true);
});

canvas.addEventListener('contextmenu', (event) => {
  event.preventDefault();
  openContextMenu(event.clientX, event.clientY);
});

canvas.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;
  dragging = true;
  dragMoved = false;
  canvas.setPointerCapture(event.pointerId);
  window.deskpet.dragStart(event.screenX, event.screenY).catch(() => {});
});

canvas.addEventListener('pointermove', (event) => {
  if (!dragging) return;
  dragMoved = true;
  window.deskpet.dragMove(event.screenX, event.screenY).catch(() => {});
});

canvas.addEventListener('pointerup', (event) => {
  if (!dragging) return;
  dragging = false;
  canvas.releasePointerCapture(event.pointerId);
  window.deskpet.dragEnd().catch(() => {});

  if (!dragMoved) {
    openChat();
  } else if (dragMoved) {
    scheduleNextIdleAction(true);
  }
});

chatForm.addEventListener('submit', (event) => {
  event.preventDefault();
  sendChatMessage(chatInput.value);
});

chatInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    sendChatMessage(chatInput.value);
  }
});

settingsButton.addEventListener('click', openSettings);
closeChatButton.addEventListener('click', closeChat);
closeSettingsButton.addEventListener('click', closeSettings);

settingsPanel.addEventListener('click', (event) => {
  if (event.target === settingsPanel) {
    closeSettings();
  }
});

settingsForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const saved = await window.deskpet.saveDoubaoConfig({
    baseURL: baseUrlInput.value,
    apiKey: apiKeyInput.value,
    modelID: modelInput.value,
    systemPrompt: systemPromptInput.value
  });
  setChatStatus(saved.isConfigured ? '豆包设置已保存' : '设置已保存，请补全 API Key 和 Endpoint / Model');
  closeSettings();
});

function closeContextMenu() {
  if (contextMenu) {
    contextMenu.remove();
    contextMenu = null;
  }
}

function menuButton(label, handler, disabled = false) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.disabled = disabled;
  button.addEventListener('click', async () => {
    closeContextMenu();
    await handler();
  });
  return button;
}

function menuDivider() {
  const divider = document.createElement('div');
  divider.className = 'context-divider';
  return divider;
}

function openContextMenu(x, y) {
  closeContextMenu();
  const menu = document.createElement('section');
  menu.className = 'context-menu';
  const currentDir = petLibrary?.customPetDir || '未找到 custompet';
  const missing = (petLibrary?.missingActions || []).map(actionLabel).join('、') || '无';
  const info = document.createElement('p');
  info.textContent = `当前资源: ${currentDir}`;
  const missingInfo = document.createElement('p');
  missingInfo.textContent = `缺失动作: ${missing}`;
  menu.append(info, missingInfo, menuDivider());
  menu.append(menuButton('重新读取 custompet', reloadPetVideos));
  for (const action of ACTIONS) {
    menu.append(menuButton(`播放${actionLabel(action)}`, () => playAction(action), !videos[action]));
  }
  menu.append(menuDivider());
  menu.append(menuButton('打开聊天框', openChat));
  menu.append(menuButton('豆包 API 设置...', () => {
    openChat();
    openSettings();
  }));
  menu.append(menuButton('回到桌面底部', () => window.deskpet.returnBottom()));
  menu.append(menuDivider());
  for (const [size, preset] of Object.entries(SIZE_PRESETS)) {
    menu.append(menuButton(`大小: ${preset.label}`, async () => {
      const pixels = await window.deskpet.setSize(size);
      resizeCanvas(pixels);
    }));
  }
  menu.append(menuDivider());
  menu.append(menuButton('打开当前资源文件夹', () => window.deskpet.openCurrentResourceDir()));
  menu.append(menuButton('打开下载文件夹', () => window.deskpet.openDownloadsDir()));
  menu.append(menuButton('退出', () => window.deskpet.quitApp()));
  document.body.appendChild(menu);
  const rect = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(x, window.innerWidth - rect.width - 8)}px`;
  menu.style.top = `${Math.min(y, window.innerHeight - rect.height - 8)}px`;
  contextMenu = menu;
}

document.addEventListener('pointerdown', (event) => {
  if (contextMenu && !contextMenu.contains(event.target)) {
    closeContextMenu();
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    closeContextMenu();
  }
});

window.addEventListener('beforeunload', () => {
  window.clearTimeout(idleTimer);
  window.clearTimeout(reloadTimer);
  window.cancelAnimationFrame(animationFrame);
});

window.deskpet.getSize().then((pixels) => {
  resizeCanvas(pixels);
  reloadPetVideos();
  drawFrame();
});
