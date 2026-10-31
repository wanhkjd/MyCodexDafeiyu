'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('riceBridge', {
  begin(grip) { ipcRenderer.send('rice:begin', grip); },
  end(drop) { ipcRenderer.send('rice:end', drop === true); },
  cancel() { ipcRenderer.send('rice:cancel'); },
  onState(cb) { ipcRenderer.on('rice:state', (_e, state) => cb(state)); },
});
