import React, { useEffect, useRef } from 'react'
import { useAppStore } from '../store/appStore'

export function AnswerPanel() {
  const { streamingAnswer, pinnedAnswer, error, appState, messages } = useAppStore()
  const scrollRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom whenever new content arrives
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [streamingAnswer, messages.length, appState])

  const hasHistory = messages.length > 0
  const isStreaming = appState === 'answering'
  const isThinking = appState === 'thinking'
  const hasContent = hasHistory || streamingAnswer || pinnedAnswer

  // ── Error ──────────────────────────────────────────────────────────────────
  if (error && !hasContent) {
    return (
      <div className="answer-panel state-error">
        <span className="icon-err">⚠</span>
        <span>{error}</span>
      </div>
    )
  }

  // ── Empty / idle ───────────────────────────────────────────────────────────
  if (!hasContent && !isThinking) {
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

  // History is stored newest-first — reverse for display (oldest at top)
  const orderedMessages = [...messages].reverse()

  return (
    <div className="answer-panel" ref={scrollRef}>
      {/* Pinned answer at top if set */}
      {pinnedAnswer && (
        <div className="qa-block qa-pinned">
          <div className="pin-badge">📌 Pinned</div>
          <div
            className="answer-text"
            dangerouslySetInnerHTML={{ __html: formatAnswer(pinnedAnswer) }}
          />
          <div className="qa-divider" />
        </div>
      )}

      {/* History: all past Q&A pairs */}
      {orderedMessages.map((msg) => (
        <div key={msg.id} className="qa-block">
          <div className="qa-question">
            {msg.transcript.length > 80
              ? msg.transcript.slice(0, 77) + '…'
              : msg.transcript}
          </div>
          <div
            className="answer-text"
            dangerouslySetInnerHTML={{ __html: formatAnswer(msg.answer) }}
          />
          <div className="qa-divider" />
        </div>
      ))}

      {/* Currently streaming answer */}
      {(isStreaming || isThinking || streamingAnswer) && (
        <div className="qa-block qa-active">
          {isThinking && !streamingAnswer && (
            <div className="state-thinking-inline">
              <div className="dots"><span /><span /><span /></div>
              <p className="thinking-label">Thinking...</p>
            </div>
          )}
          {streamingAnswer && (
            <div
              className={`answer-text${isStreaming ? ' streaming' : ''}`}
              dangerouslySetInnerHTML={{ __html: formatAnswer(streamingAnswer) }}
            />
          )}
          {isStreaming && <span className="cursor" aria-hidden="true">▊</span>}
        </div>
      )}

      {/* Error inline (when there's already history) */}
      {error && hasContent && (
        <div className="qa-block state-error-inline">
          <span className="icon-err">⚠</span>
          <span>{error}</span>
        </div>
      )}

      {/* Scroll anchor */}
      <div ref={bottomRef} />
    </div>
  )
}

// ─── Lightweight markdown-ish formatter ──────────────────────────────────────

function formatAnswer(text: string): string {
  if (!text) return ''

  return (
    text
      // H2 headers ## Text
      .replace(/^## (.+)$/gm, '<p class="section-h2">$1</p>')
      // Fenced code blocks ```lang\ncode\n```
      .replace(
        /```[\w]*\n?([\s\S]*?)```/g,
        '<pre class="code-block"><code>$1</code></pre>'
      )
      // Bold **text**
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      // Inline code `code`
      .replace(/`([^`\n]+)`/g, '<code class="inline-code">$1</code>')
      // Horizontal rule ---
      .replace(/^---$/gm, '<hr class="qa-hr"/>')
      // Bullet lines starting with - or •
      .replace(/^[\-•]\s+(.+)$/gm, '<li>$1</li>')
      // Wrap consecutive <li>s
      .replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>')
      // Headers **Bold:** pattern
      .replace(/^\*\*(.+?):\*\*(.*)$/gm, '<p class="section-head">$1:$2</p>')
      // Line breaks outside code blocks
      .replace(/\n/g, '<br/>')
  )
}
