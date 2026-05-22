import React from 'react'
import { useAppStore } from '../store/appStore'

interface Props {
  onToggleListen: () => void
  onClear: () => void
  onPin: () => void
  onHide: () => void
}

export function HotkeyBar({ onToggleListen, onClear, onPin, onHide }: Props) {
  const {
    appState,
    pinnedAnswer,
    unpinAnswer,
    showSettings,
    setShowSettings,
    contentProtection,
    toggleContentProtection,
    alwaysOn,
    toggleAlwaysOn
  } = useAppStore()

  const isListening = appState === 'listening'
  const isThinking = appState === 'thinking' || appState === 'answering'

  return (
    <div className="hotkey-bar">
      {/* Always-on toggle */}
      <button
        className={`hk-btn${alwaysOn ? ' btn-always-on' : ''}`}
        onClick={toggleAlwaysOn}
        title={alwaysOn ? 'Always-on mic: ON — click to disable' : 'Always-on mic: OFF — auto-listens after each answer'}
      >
        {alwaysOn ? '🔴' : '⚪'}
        <span className="hk-label">{alwaysOn ? 'Auto' : 'Auto'}</span>
      </button>

      {/* Mic toggle */}
      <button
        className={`hk-btn${isListening ? ' btn-live' : ''}${isThinking || alwaysOn ? ' btn-disabled' : ''}`}
        onClick={onToggleListen}
        disabled={isThinking || alwaysOn}
        title={alwaysOn ? 'Disable Auto mode to use manual mic' : isListening ? 'Stop listening (⌘⇧Space)' : 'Start mic (⌘⇧Space)'}
      >
        {isListening ? '⏹' : '🎙'}
        <span className="hk-label">{isListening ? 'Stop' : 'Mic'}</span>
      </button>

      {/* Pin / unpin */}
      <button
        className={`hk-btn${pinnedAnswer ? ' btn-pinned' : ''}`}
        onClick={pinnedAnswer ? unpinAnswer : onPin}
        title={pinnedAnswer ? 'Unpin answer' : 'Pin answer (⌘⇧P)'}
      >
        📌
        <span className="hk-label">{pinnedAnswer ? 'Unpin' : 'Pin'}</span>
      </button>

      {/* Clear */}
      <button
        className="hk-btn"
        onClick={onClear}
        title="Clear (⌘⇧C)"
      >
        🗑
        <span className="hk-label">Clear</span>
      </button>

      <div className="hk-spacer" />

      {/* Screen protection toggle */}
      <button
        className={`hk-btn icon-only${contentProtection ? ' btn-protected' : ' btn-unprotected'}`}
        onClick={toggleContentProtection}
        title={contentProtection ? 'Screen protection ON (hidden from sharing)' : 'Screen protection OFF (visible in sharing)'}
      >
        {contentProtection ? '🛡' : '👁'}
      </button>

      {/* Settings */}
      <button
        className={`hk-btn icon-only${showSettings ? ' btn-active' : ''}`}
        onClick={() => setShowSettings(!showSettings)}
        title="Settings (API key, model)"
      >
        ⚙
      </button>

      {/* Hide overlay */}
      <button
        className="hk-btn icon-only btn-hide"
        onClick={onHide}
        title="Hide overlay (⌘⇧H)"
      >
        ✕
      </button>
    </div>
  )
}
