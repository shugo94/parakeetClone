import { useCallback, useRef, useEffect } from 'react'
import { useAppStore } from '../store/appStore'

// Web Speech API types
declare global {
  interface Window {
    SpeechRecognition: typeof SpeechRecognition
    webkitSpeechRecognition: typeof SpeechRecognition
  }
}

export function useSpeech() {
  const recognitionRef = useRef<SpeechRecognition | null>(null)
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout>>()
  const finalTextRef = useRef('')

  const { appState, setAppState, setTranscript, clearStreaming } = useAppStore()

  const submitTranscript = useCallback(
    (text: string) => {
      if (!text.trim()) return
      clearStreaming()
      setAppState('thinking')
      window.api.sendQuery(text.trim())
    },
    [clearStreaming, setAppState]
  )

  const startListening = useCallback(() => {
    const SR =
      (window as Window).SpeechRecognition || (window as Window).webkitSpeechRecognition

    if (!SR) {
      useAppStore.getState().setError(
        'Speech recognition unavailable. Click the transcript bar to type your question.'
      )
      return
    }

    if (recognitionRef.current) {
      recognitionRef.current.stop()
    }

    const recognition = new SR()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = 'en-US'
    recognition.maxAlternatives = 1
    finalTextRef.current = ''

    recognition.onstart = () => {
      setAppState('listening')
    }

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interimText = ''
      let finalText = ''

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const chunk = event.results[i][0].transcript
        if (event.results[i].isFinal) {
          finalText += chunk
        } else {
          interimText += chunk
        }
      }

      if (finalText) {
        finalTextRef.current += finalText
      }

      const displayText = finalTextRef.current + interimText
      setTranscript(displayText)

      // Auto-submit: after a final result + 1.5s silence, send to AI
      clearTimeout(silenceTimerRef.current)
      if (finalText) {
        silenceTimerRef.current = setTimeout(() => {
          submitTranscript(finalTextRef.current)
        }, 1500)
      } else {
        // Fallback: submit interim after longer silence
        silenceTimerRef.current = setTimeout(() => {
          if (displayText.trim()) submitTranscript(displayText)
        }, 3500)
      }
    }

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      if (event.error === 'aborted' || event.error === 'no-speech') return
      if (event.error === 'not-allowed') {
        useAppStore.getState().setError(
          'Microphone permission denied. Grant mic access in System Settings → Privacy → Microphone.'
        )
        return
      }
      console.warn('[STT Error]', event.error)
    }

    recognition.onend = () => {
      // Auto-restart if still in listening state
      const currentState = useAppStore.getState().appState
      if (currentState === 'listening') {
        try {
          recognition.start()
        } catch {
          setAppState('idle')
        }
      }
    }

    recognitionRef.current = recognition
    try {
      recognition.start()
    } catch (err) {
      console.error('[STT Start]', err)
      setAppState('idle')
    }
  }, [setAppState, setTranscript, submitTranscript])

  const stopListening = useCallback(() => {
    clearTimeout(silenceTimerRef.current)
    recognitionRef.current?.stop()
    recognitionRef.current = null
    finalTextRef.current = ''
    setAppState('idle')
  }, [setAppState])

  const toggleListening = useCallback(() => {
    if (appState === 'listening') {
      stopListening()
    } else if (appState === 'idle' || appState === 'error') {
      startListening()
    }
  }, [appState, startListening, stopListening])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearTimeout(silenceTimerRef.current)
      recognitionRef.current?.stop()
    }
  }, [])

  return { startListening, stopListening, toggleListening }
}
