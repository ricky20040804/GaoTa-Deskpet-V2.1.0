const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('deskpet', {
  getVideos: () => ipcRenderer.invoke('pet:get-videos'),
  returnToBottom: () => ipcRenderer.invoke('pet:return-bottom'),
  getSize: () => ipcRenderer.invoke('pet:get-size'),
  getDoubaoConfig: () => ipcRenderer.invoke('pet:get-doubao-config'),
  saveDoubaoConfig: (config) => ipcRenderer.invoke('pet:save-doubao-config', config),
  sendChat: (message) => ipcRenderer.invoke('pet:send-chat', message),
  showContextMenu: () => ipcRenderer.send('pet:context-menu'),
  moveBy: (deltaX, deltaY) => ipcRenderer.send('pet:move-by', deltaX, deltaY),
  setChatOpen: (open) => ipcRenderer.send('pet:set-chat-open', open),
  dragStart: () => ipcRenderer.send('pet:drag-start'),
  dragMove: () => ipcRenderer.send('pet:drag-move'),
  dragEnd: () => ipcRenderer.send('pet:drag-end'),
  onReload: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('pet:reload', listener);
    return () => ipcRenderer.removeListener('pet:reload', listener);
  },
  onPlayAction: (callback) => {
    const listener = (_event, action) => callback(action);
    ipcRenderer.on('pet:play-action', listener);
    return () => ipcRenderer.removeListener('pet:play-action', listener);
  },
  onOpenChat: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('pet:open-chat', listener);
    return () => ipcRenderer.removeListener('pet:open-chat', listener);
  },
  onOpenSettings: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('pet:open-settings', listener);
    return () => ipcRenderer.removeListener('pet:open-settings', listener);
  },
  onSizeChanged: (callback) => {
    const listener = (_event, pixels) => callback(pixels);
    ipcRenderer.on('pet:size-changed', listener);
    return () => ipcRenderer.removeListener('pet:size-changed', listener);
  }
});
