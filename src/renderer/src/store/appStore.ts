import { create } from 'zustand'
import type { AppState, Config, QAMessage } from '../types'

interface AppStore {
  // State machine
  appState: AppState
  setAppState: (s: AppState) => void

  // Transcript (from mic or manual input)
  transcript: string
  setTranscript: (t: string) => void

  // Streaming answer
  streamingAnswer: string
  appendToken: (token: string) => void
  clearStreaming: () => void

  // Message history (last 20)
  messages: QAMessage[]
  finalizeAnswer: () => void

  // Pinned answer
  pinnedAnswer: string | null
  pinCurrentAnswer: () => void
  unpinAnswer: () => void

  // Error
  error: string | null
  setError: (e: string | null) => void

  // Config
  config: Config | null
  setConfig: (c: Config) => void
  contentProtection: boolean
  toggleContentProtection: () => void

  // Settings panel visibility
  showSettings: boolean
  setShowSettings: (v: boolean) => void

  // Convenience: clear everything
  clearAll: () => void
}

export const useAppStore = create<AppStore>((set, get) => ({
  appState: 'idle',
  setAppState: (appState) => set({ appState }),

  transcript: '',
  setTranscript: (transcript) => set({ transcript }),

  streamingAnswer: '',
  appendToken: (token) =>
    set((s) => ({
      streamingAnswer: s.streamingAnswer + token,
      appState: 'answering'
    })),
  clearStreaming: () => set({ streamingAnswer: '', error: null }),

  messages: [],
  finalizeAnswer: () => {
    const { transcript, streamingAnswer, messages } = get()
    if (!streamingAnswer.trim()) return
    const msg: QAMessage = {
      id: String(Date.now()),
      transcript,
      answer: streamingAnswer,
      pinned: false,
      timestamp: Date.now()
    }
    set({
      messages: [msg, ...messages].slice(0, 20),
      appState: 'idle'
    })
  },

  pinnedAnswer: null,
  pinCurrentAnswer: () => {
    const { streamingAnswer, messages } = get()
    const answer = streamingAnswer || messages[0]?.answer || null
    set({ pinnedAnswer: answer })
  },
  unpinAnswer: () => set({ pinnedAnswer: null }),

  error: null,
  setError: (error) => set({ error, appState: error ? 'error' : 'idle' }),

  config: null,
  setConfig: (config) => set({ config, contentProtection: config.contentProtection }),
  contentProtection: true,
  toggleContentProtection: () => {
    const val = !get().contentProtection
    set({ contentProtection: val })
    window.api.setContentProtection(val)
    // Also persist
    window.api.saveConfig({ contentProtection: val } as Record<string, unknown>)
  },

  showSettings: false,
  setShowSettings: (showSettings) => set({ showSettings }),

  clearAll: () =>
    set({
      streamingAnswer: '',
      transcript: '',
      error: null,
      appState: 'idle',
      pinnedAnswer: null
    })
}))
