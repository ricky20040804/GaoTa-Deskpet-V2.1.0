const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('deskpet', {
  getVideos: () => ipcRenderer.invoke('pet:get-videos'),
  returnToBottom: () => ipcRenderer.invoke('pet:return-bottom'),
  showContextMenu: () => ipcRenderer.send('pet:context-menu'),
  dragStart: () => ipcRenderer.send('pet:drag-start'),
  dragMove: () => ipcRenderer.send('pet:drag-move'),
  dragEnd: () => ipcRenderer.send('pet:drag-end'),
  onReload: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('pet:reload', listener);
    return () => ipcRenderer.removeListener('pet:reload', listener);
  }
});
