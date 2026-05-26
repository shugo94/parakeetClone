import type { QAMessage } from './types'

export type HistoryMessage = { role: 'user' | 'assistant'; content: string }

/**
 * Converts the Zustand message store (newest-first) into chronological
 * user/assistant pairs suitable for the AI conversation messages array.
 * Capped at `limit` exchanges to avoid token overflow.
 */
export function buildHistory(messages: QAMessage[], limit = 6): HistoryMessage[] {
  return [...messages]
    .reverse()           // store is newest-first; AI needs oldest-first
    .slice(-limit)       // keep only the last N exchanges
    .flatMap((msg) => [
      { role: 'user' as const,      content: msg.transcript },
      { role: 'assistant' as const, content: msg.answer     }
    ])
}
