const ACTIONS = ['idle', 'run', 'happy', 'rest'];
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
const offscreen = document.createElement('canvas');
const offscreenContext = offscreen.getContext('2d', { willReadFrequently: true });

let videos = {};
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

function fileUrl(filePath) {
  const normalized = filePath.replace(/\\/g, '/').replace(/^([A-Za-z]):/, '/$1:');
  return encodeURI(`file://${normalized}`);
}

function resizeCanvas(pixels) {
  canvasSize = pixels || window.innerWidth || 320;
  canvas.width = canvasSize;
  canvas.height = canvasSize;
  offscreen.width = canvasSize;
  offscreen.height = canvasSize;
}

function chooseAction() {
  const available = ACTIONS.filter((action) => videos[action]);
  if (!available.length) return null;
  return available[Math.floor(Math.random() * available.length)];
}

function randomRange([min, max]) {
  return min + Math.random() * (max - min);
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
  video.src = fileUrl(videos[action]);
  video.currentTime = 0;
  video.play().catch(() => {});

  if (action === 'run') {
    runDirection = Math.random() > 0.5 ? 1 : -1;
    runStartedAt = performance.now();
    lastWalkProgress = 0;
    runDuration = Math.max(2400, Math.min(4200, (video.duration || 3.2) * 1000));
  }
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
    offscreenContext.clearRect(0, 0, canvasSize, canvasSize);
    offscreenContext.drawImage(video, 0, 0, canvasSize, canvasSize);

    const keyedFrame = keyGreen(offscreenContext.getImageData(0, 0, canvasSize, canvasSize));
    offscreenContext.putImageData(keyedFrame, 0, 0);

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

  animationFrame = window.requestAnimationFrame(drawFrame);
}

async function reloadPetVideos() {
  const result = await window.deskpet.getVideos();
  videos = result.videos || {};
  const hasVideos = Object.keys(videos).length > 0;
  emptyState.hidden = hasVideos;

  if (hasVideos) {
    playAction(videos.idle ? 'idle' : chooseAction());
    scheduleNextIdleAction(true);
  } else {
    window.clearTimeout(idleTimer);
    context.clearRect(0, 0, canvasSize, canvasSize);
    video.removeAttribute('src');
    video.load();
    window.clearTimeout(reloadTimer);
    reloadTimer = window.setTimeout(reloadPetVideos, 2500);
  }
}

video.addEventListener('ended', () => scheduleNextIdleAction());
video.addEventListener('error', () => scheduleNextIdleAction(true));

canvas.addEventListener('contextmenu', (event) => {
  event.preventDefault();
  window.deskpet.showContextMenu();
});

canvas.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;
  dragging = true;
  dragMoved = false;
  canvas.setPointerCapture(event.pointerId);
  window.deskpet.dragStart();
});

canvas.addEventListener('pointermove', () => {
  if (!dragging) return;
  dragMoved = true;
  window.deskpet.dragMove();
});

canvas.addEventListener('pointerup', (event) => {
  if (!dragging) return;
  dragging = false;
  canvas.releasePointerCapture(event.pointerId);
  window.deskpet.dragEnd();

  if (!dragMoved && videos.happy) {
    playAction('happy');
  } else if (dragMoved) {
    scheduleNextIdleAction(true);
  }
});

window.deskpet.onReload(reloadPetVideos);
window.deskpet.onPlayAction((action) => {
  if (ACTIONS.includes(action) && videos[action]) {
    playAction(action);
  }
});
window.deskpet.onSizeChanged((pixels) => resizeCanvas(pixels));
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
