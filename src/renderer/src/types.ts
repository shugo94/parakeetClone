export interface Config {
  apiKey: string
  provider: 'anthropic' | 'openai'
  model: string
  contentProtection: boolean
  overlayX?: number
  overlayY?: number
  overlayWidth?: number
  overlayHeight?: number
}

export interface QAMessage {
  id: string
  transcript: string
  answer: string
  pinned: boolean
  timestamp: number
}

export type AppState = 'idle' | 'listening' | 'thinking' | 'answering' | 'error'
