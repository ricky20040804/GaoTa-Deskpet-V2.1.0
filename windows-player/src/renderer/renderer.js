const ACTIONS = ['idle', 'run', 'happy', 'rest'];
const CANVAS_SIZE = 420;
const GREEN_KEY = {
  minG: 120,
  greenOverRed: 35,
  greenOverBlue: 35,
  softness: 42
};

const video = document.getElementById('petVideo');
const canvas = document.getElementById('petCanvas');
const context = canvas.getContext('2d', { willReadFrequently: true });
const emptyState = document.getElementById('emptyState');
const offscreen = document.createElement('canvas');
offscreen.width = CANVAS_SIZE;
offscreen.height = CANVAS_SIZE;
const offscreenContext = offscreen.getContext('2d', { willReadFrequently: true });

let videos = {};
let currentAction = 'idle';
let animationFrame = 0;
let idleTimer = 0;
let dragging = false;
let dragMoved = false;
let runDirection = 1;
let runX = 0;

function fileUrl(filePath) {
  const normalized = filePath.replace(/\\/g, '/').replace(/^([A-Za-z]):/, '/$1:');
  return encodeURI(`file://${normalized}`);
}

function chooseAction() {
  const available = ACTIONS.filter((action) => videos[action]);
  if (!available.length) return null;
  return available[Math.floor(Math.random() * available.length)];
}

function scheduleNextIdleAction() {
  window.clearTimeout(idleTimer);
  idleTimer = window.setTimeout(() => {
    playAction(chooseAction() || 'idle');
  }, 600 + Math.random() * 900);
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
    runX = runDirection > 0 ? -34 : 34;
  } else {
    runX = 0;
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
  context.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

  if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
    offscreenContext.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    offscreenContext.drawImage(video, 0, 0, CANVAS_SIZE, CANVAS_SIZE);

    const keyedFrame = keyGreen(offscreenContext.getImageData(0, 0, CANVAS_SIZE, CANVAS_SIZE));
    offscreenContext.putImageData(keyedFrame, 0, 0);

    if (currentAction === 'run') {
      runX += runDirection * 1.3;
      if (Math.abs(runX) > 36) {
        runDirection *= -1;
      }
    }

    context.drawImage(offscreen, runX, 0, CANVAS_SIZE, CANVAS_SIZE);
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
  } else {
    window.clearTimeout(idleTimer);
    context.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    video.removeAttribute('src');
    video.load();
  }
}

video.addEventListener('ended', scheduleNextIdleAction);
video.addEventListener('error', scheduleNextIdleAction);

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
  }
});

window.deskpet.onReload(reloadPetVideos);
window.addEventListener('beforeunload', () => window.cancelAnimationFrame(animationFrame));

reloadPetVideos();
drawFrame();
