import React, { useEffect, useCallback } from 'react'
import { useAppStore } from './store/appStore'
import { useSpeech } from './hooks/useSpeech'
import { AnswerPanel } from './components/AnswerPanel'
import { TranscriptBar } from './components/TranscriptBar'
import { HotkeyBar } from './components/HotkeyBar'
import { SettingsModal } from './components/SettingsModal'

export default function App() {
  const {
    clearAll,
    pinCurrentAnswer,
    setConfig,
    setAppState,
    clearStreaming,
    appendToken,
    finalizeAnswer,
    setError,
    showSettings
  } = useAppStore()

  const { toggleListening } = useSpeech()

  // ── Load config on mount ────────────────────────────────────────────────────
  useEffect(() => {
    window.api.getConfig().then((cfg) => {
      setConfig(cfg as Parameters<typeof setConfig>[0])
    })
  }, [setConfig])

  // ── AI stream listeners ─────────────────────────────────────────────────────
  useEffect(() => {
    const offToken = window.api.onAIToken((token) => appendToken(token))
    const offDone = window.api.onAIDone(() => {
      finalizeAnswer()
      setAppState('idle')
    })
    const offError = window.api.onAIError((err) => setError(err))
    const offRetry = window.api.onAIRetry(() => {
      setError(null)
      setAppState('thinking')
    })

    return () => {
      offToken()
      offDone()
      offError()
      offRetry()
    }
  }, [appendToken, finalizeAnswer, setAppState, setError])

  // ── Global hotkey signals ──────────────────────────────────────────────────
  useEffect(() => {
    const off = window.api.onHotkey((action) => {
      switch (action) {
        case 'toggle-listen':
          toggleListening()
          break
        case 'clear':
          clearAll()
          break
        case 'pin':
          pinCurrentAnswer()
          break
      }
    })
    return off
  }, [toggleListening, clearAll, pinCurrentAnswer])

  // ── Manual text submit ─────────────────────────────────────────────────────
  const handleManualSubmit = useCallback(
    (text: string) => {
      if (!text.trim()) return
      useAppStore.getState().setTranscript(text)
      clearStreaming()
      setAppState('thinking')
      window.api.sendQuery(text.trim())
    },
    [clearStreaming, setAppState]
  )

  const handleHide = () => window.api.hideOverlay()

  return (
    <div className="app">
      <div className="drag-handle" />
      <AnswerPanel />
      <TranscriptBar onManualSubmit={handleManualSubmit} />
      <HotkeyBar
        onToggleListen={toggleListening}
        onClear={clearAll}
        onPin={pinCurrentAnswer}
        onHide={handleHide}
      />
      {showSettings && <SettingsModal />}
    </div>
  )
}
