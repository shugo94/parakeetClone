/// <reference types="vite/client" />

// Type declaration for the API exposed by the Electron preload via contextBridge
declare global {
  interface Window {
    api: {
      // Config
      getConfig: () => Promise<Record<string, unknown>>
      saveConfig: (config: Record<string, unknown>) => Promise<Record<string, unknown>>
      // AI Streaming
      sendQuery: (transcript: string) => void
      abortQuery: () => void
      onAIToken: (cb: (token: string) => void) => () => void
      onAIDone: (cb: () => void) => () => void
      onAIError: (cb: (err: string) => void) => () => void
      // Hotkeys from main
      onHotkey: (cb: (action: string) => void) => () => void
      // Overlay controls
      hideOverlay: () => void
      showOverlay: () => void
      setContentProtection: (val: boolean) => void
    }
  }
}

export {}
