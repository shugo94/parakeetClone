import { contextBridge, ipcRenderer } from 'electron'

// ─── Safe API exposed to renderer (contextBridge prevents direct Node access) ─

const api = {
  // ── Config ──────────────────────────────────────────────────────────────────
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveConfig: (config: Record<string, unknown>) => ipcRenderer.invoke('save-config', config),

  // ── AI Streaming ────────────────────────────────────────────────────────────
  sendQuery: (transcript: string) => ipcRenderer.send('ai-query', { transcript }),
  abortQuery: () => ipcRenderer.send('ai-abort'),

  onAIToken: (cb: (token: string) => void) => {
    const fn = (_: Electron.IpcRendererEvent, token: string) => cb(token)
    ipcRenderer.on('ai-token', fn)
    return () => ipcRenderer.removeListener('ai-token', fn)
  },
  onAIDone: (cb: () => void) => {
    const fn = () => cb()
    ipcRenderer.on('ai-done', fn)
    return () => ipcRenderer.removeListener('ai-done', fn)
  },
  onAIError: (cb: (err: string) => void) => {
    const fn = (_: Electron.IpcRendererEvent, err: string) => cb(err)
    ipcRenderer.on('ai-error', fn)
    return () => ipcRenderer.removeListener('ai-error', fn)
  },

  // ── Hotkeys from main process ────────────────────────────────────────────────
  onHotkey: (cb: (action: string) => void) => {
    const fn = (_: Electron.IpcRendererEvent, action: string) => cb(action)
    ipcRenderer.on('hotkey', fn)
    return () => ipcRenderer.removeListener('hotkey', fn)
  },

  // ── Overlay controls ─────────────────────────────────────────────────────────
  hideOverlay: () => ipcRenderer.send('overlay-hide'),
  showOverlay: () => ipcRenderer.send('overlay-show'),
  setContentProtection: (val: boolean) => ipcRenderer.send('set-content-protection', val)
}

contextBridge.exposeInMainWorld('api', api)

export type ElectronAPI = typeof api
