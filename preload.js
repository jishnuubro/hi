// preload.js — runs in an isolated context, exposes a safe, narrow API
// to the renderer (index.html/renderer.js) via window.api.

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  getJavaStatus: () => ipcRenderer.invoke("get-java-status"),
  loadConfig: () => ipcRenderer.invoke("load-config"),
  saveConfig: (data) => ipcRenderer.invoke("save-config", data),
  fetchVersions: () => ipcRenderer.invoke("fetch-versions"),
  installVersion: (versionEntry) => ipcRenderer.invoke("install-version", versionEntry),
  launchGame: (username) => ipcRenderer.invoke("launch-game", username),
  onInstallLog: (callback) => ipcRenderer.on("install-log", (_evt, msg) => callback(msg)),
  onInstallProgress: (callback) =>
    ipcRenderer.on("install-progress", (_evt, payload) => callback(payload)),
});
