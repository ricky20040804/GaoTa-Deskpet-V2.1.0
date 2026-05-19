const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('deskpet', {
  getVideos: () => ipcRenderer.invoke('pet:get-videos'),
  returnToBottom: () => ipcRenderer.invoke('pet:return-bottom'),
  getSize: () => ipcRenderer.invoke('pet:get-size'),
  showContextMenu: () => ipcRenderer.send('pet:context-menu'),
  moveBy: (deltaX, deltaY) => ipcRenderer.send('pet:move-by', deltaX, deltaY),
  dragStart: () => ipcRenderer.send('pet:drag-start'),
  dragMove: () => ipcRenderer.send('pet:drag-move'),
  dragEnd: () => ipcRenderer.send('pet:drag-end'),
  onReload: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('pet:reload', listener);
    return () => ipcRenderer.removeListener('pet:reload', listener);
  },
  onSizeChanged: (callback) => {
    const listener = (_event, pixels) => callback(pixels);
    ipcRenderer.on('pet:size-changed', listener);
    return () => ipcRenderer.removeListener('pet:size-changed', listener);
  }
});
