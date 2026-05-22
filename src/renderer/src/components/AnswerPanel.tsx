import React, { useEffect, useRef } from 'react'
import { useAppStore } from '../store/appStore'

export function AnswerPanel() {
  const { streamingAnswer, pinnedAnswer, error, appState, messages } = useAppStore()
  const scrollRef = useRef<HTMLDivElement>(null)

  // Auto-scroll as tokens arrive
  useEffect(() => {
    if (scrollRef.current && appState === 'answering') {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [streamingAnswer, appState])

  // ── Error ──────────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="answer-panel state-error">
        <span className="icon-err">⚠</span>
        <span>{error}</span>
      </div>
    )
  }

  // ── Thinking ───────────────────────────────────────────────────────────────
  if (appState === 'thinking') {
    return (
      <div className="answer-panel state-thinking">
        <div className="dots">
          <span /><span /><span />
        </div>
        <p className="thinking-label">Thinking...</p>
      </div>
    )
  }

  // ── Empty / idle ───────────────────────────────────────────────────────────
  const displayAnswer = streamingAnswer || messages[0]?.answer || ''

  if (!displayAnswer && appState === 'idle' && !pinnedAnswer) {
    return (
      <div className="answer-panel state-empty">
        <div className="mic-icon">🎙</div>
        <p className="hint-primary">Press <kbd>⌘⇧Space</kbd> to start mic</p>
        <p className="hint-secondary">or click the bar below to type</p>
        <div className="hotkey-hints">
          <span><kbd>⌘⇧H</kbd> hide</span>
          <span><kbd>⌘⇧C</kbd> clear</span>
          <span><kbd>⌘⇧P</kbd> pin</span>
        </div>
      </div>
    )
  }

  // ── Pinned (shown when no active stream) ───────────────────────────────────
  if (pinnedAnswer && !streamingAnswer) {
    return (
      <div className="answer-panel" ref={scrollRef}>
        <div className="pin-badge">📌 Pinned</div>
        <div
          className="answer-text"
          dangerouslySetInnerHTML={{ __html: formatAnswer(pinnedAnswer) }}
        />
      </div>
    )
  }

  // ── Active / streamed answer ───────────────────────────────────────────────
  return (
    <div className="answer-panel" ref={scrollRef}>
      <div
        className={`answer-text${appState === 'answering' ? ' streaming' : ''}`}
        dangerouslySetInnerHTML={{ __html: formatAnswer(displayAnswer) }}
      />
      {appState === 'answering' && <span className="cursor" aria-hidden="true">▊</span>}
    </div>
  )
}

// ─── Lightweight markdown-ish formatter ──────────────────────────────────────

function formatAnswer(text: string): string {
  if (!text) return ''

  return (
    text
      // Fenced code blocks ```lang\ncode\n```
      .replace(
        /```[\w]*\n?([\s\S]*?)```/g,
        '<pre class="code-block"><code>$1</code></pre>'
      )
      // Bold **text**
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      // Inline code `code`
      .replace(/`([^`\n]+)`/g, '<code class="inline-code">$1</code>')
      // Bullet lines starting with - or •
      .replace(/^[\-•]\s+(.+)$/gm, '<li>$1</li>')
      // Wrap consecutive <li>s
      .replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>')
      // Headers **Bold:** pattern (common in our prompts)
      .replace(/^\*\*(.+?):\*\*(.*)$/gm, '<p class="section-head">$1:$2</p>')
      // Line breaks outside code blocks
      .replace(/\n/g, '<br/>')
  )
}
