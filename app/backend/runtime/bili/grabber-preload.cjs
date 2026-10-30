const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('grabber', {
  job: () => ipcRenderer.invoke('grabber:job'),
  done: result => ipcRenderer.send('grabber:done', result),
});
