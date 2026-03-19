const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('setupAPI', {
  saveConfig:     (cfg)  => ipcRenderer.invoke('setup:saveConfig', cfg),
  launch:         ()     => ipcRenderer.invoke('setup:launch'),
  getNetworkInfo: ()     => ipcRenderer.invoke('setup:getNetworkInfo'),
});