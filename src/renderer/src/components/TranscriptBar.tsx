import React, { useState, useRef, KeyboardEvent } from 'react'
import { useAppStore } from '../store/appStore'

interface Props {
  onManualSubmit: (text: string) => void
}

export function TranscriptBar({ onManualSubmit }: Props) {
  const { transcript, appState } = useAppStore()
  const [isEditing, setIsEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const isListening = appState === 'listening'

  const openInput = () => {
    setIsEditing(true)
    setDraft('')
    setTimeout(() => inputRef.current?.focus(), 10)
  }

  const handleKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && draft.trim()) {
      onManualSubmit(draft.trim())
      setDraft('')
      setIsEditing(false)
    }
    if (e.key === 'Escape') {
      setIsEditing(false)
      setDraft('')
    }
  }

  if (isEditing) {
    return (
      <div className="transcript-bar editing">
        <span className="bar-icon">⌨</span>
        <input
          ref={inputRef}
          className="manual-input"
          placeholder="Type your question → Enter to submit"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKey}
          onBlur={() => {
            if (!draft) setIsEditing(false)
          }}
        />
        {draft && (
          <button
            className="submit-btn"
            onMouseDown={(e) => {
              e.preventDefault()
              onManualSubmit(draft.trim())
              setDraft('')
              setIsEditing(false)
            }}
          >
            ↵
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="transcript-bar" onClick={openInput} role="button" title="Click to type a question">
      {isListening && <span className="live-dot" aria-label="listening" />}
      <span className="transcript-text">
        {transcript ? (
          transcript.length > 85 ? '…' + transcript.slice(-82) : transcript
        ) : (
          <span className="placeholder">
            {isListening ? 'Listening… (speak your question)' : 'Click to type  ·  or press ⌘⇧Space for mic'}
          </span>
        )}
      </span>
    </div>
  )
}
