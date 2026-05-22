import { useCallback, useRef, useEffect } from 'react'
import { useAppStore } from '../store/appStore'

const SPEECH_THRESHOLD = 10  // avg frequency energy to count as speech
const SILENCE_THRESHOLD = 8  // below this = silence
const SILENCE_DURATION = 2000 // ms of silence before auto-submit

export function useSpeech() {
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const silenceCheckRef = useRef<ReturnType<typeof setInterval>>()
  const audioContextRef = useRef<AudioContext | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const isTranscribingRef = useRef(false)
  const restartTimerRef = useRef<ReturnType<typeof setTimeout>>()

  const { appState, setAppState, setTranscript, clearStreaming, alwaysOn } = useAppStore()

  const cleanup = useCallback(() => {
    clearInterval(silenceCheckRef.current)
    clearTimeout(restartTimerRef.current)
    if (audioContextRef.current) {
      audioContextRef.current.close()
      audioContextRef.current = null
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
  }, [])

  const doTranscribe = useCallback(async () => {
    if (isTranscribingRef.current) return
    isTranscribingRef.current = true
    clearInterval(silenceCheckRef.current)

    const recorder = mediaRecorderRef.current
    if (!recorder || recorder.state === 'inactive') {
      cleanup()
      setAppState('idle')
      isTranscribingRef.current = false
      return
    }

    await new Promise<void>((resolve) => {
      recorder.onstop = () => resolve()
      recorder.stop()
    })

    cleanup()

    const chunks = audioChunksRef.current.splice(0)
    mediaRecorderRef.current = null

    if (chunks.length === 0) {
      setAppState('idle')
      isTranscribingRef.current = false
      return
    }

    const audioBlob = new Blob(chunks, { type: chunks[0].type || 'audio/webm' })
    setAppState('thinking')

    try {
      const arrayBuffer = await audioBlob.arrayBuffer()
      const transcript = await window.api.transcribeAudio(arrayBuffer, audioBlob.type)
      if (transcript?.trim()) {
        setTranscript(transcript)
        clearStreaming()
        window.api.sendQuery(transcript.trim())
      } else {
        setAppState('idle')
      }
    } catch (err: unknown) {
      useAppStore.getState().setError((err as Error).message || 'Transcription failed.')
    } finally {
      isTranscribingRef.current = false
    }
  }, [cleanup, setAppState, setTranscript, clearStreaming])

  const doTranscribeRef = useRef(doTranscribe)
  useEffect(() => {
    doTranscribeRef.current = doTranscribe
  }, [doTranscribe])

  const startListening = useCallback(async () => {
    if (isTranscribingRef.current) return
    // Don't restart if already have a stream running
    if (streamRef.current) return

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
      streamRef.current = stream

      const audioContext = new AudioContext()
      audioContextRef.current = audioContext
      const analyser = audioContext.createAnalyser()
      analyser.fftSize = 512
      analyser.smoothingTimeConstant = 0.8
      audioContext.createMediaStreamSource(stream).connect(analyser)

      const mimeType =
        ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg'].find((t) =>
          MediaRecorder.isTypeSupported(t)
        ) ?? ''

      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      mediaRecorderRef.current = recorder
      audioChunksRef.current = []

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data)
      }
      recorder.start(100)
      setAppState('listening')

      const dataArray = new Uint8Array(analyser.frequencyBinCount)
      let silentMs = 0
      let hasSpeech = false // VAD: only submit if actual speech was captured

      silenceCheckRef.current = setInterval(() => {
        analyser.getByteFrequencyData(dataArray)
        const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length

        if (avg >= SPEECH_THRESHOLD) {
          hasSpeech = true
          silentMs = 0
        } else if (avg < SILENCE_THRESHOLD && hasSpeech) {
          silentMs += 200
          // Only auto-submit after real speech + enough audio chunks collected
          if (silentMs >= SILENCE_DURATION && audioChunksRef.current.length > 10) {
            doTranscribeRef.current()
          }
        }
      }, 200)
    } catch (err: unknown) {
      const error = err as { name?: string }
      if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
        useAppStore
          .getState()
          .setError(
            'Mic permission denied. Enable in System Settings → Privacy & Security → Microphone.'
          )
      } else {
        useAppStore.getState().setError('Could not access microphone. Try restarting the app.')
      }
      setAppState('idle')
    }
  }, [setAppState])

  const stopListening = useCallback(() => {
    clearTimeout(restartTimerRef.current)
    if (mediaRecorderRef.current?.state !== 'inactive') {
      doTranscribeRef.current()
    } else {
      cleanup()
      mediaRecorderRef.current = null
      setAppState('idle')
    }
  }, [cleanup, setAppState])

  const toggleListening = useCallback(() => {
    if (appState === 'listening') {
      stopListening()
    } else if (appState === 'idle' || appState === 'error') {
      startListening()
    }
  }, [appState, startListening, stopListening])

  // Always-on: when alwaysOn is enabled and app goes back to idle, restart mic
  const alwaysOnRef = useRef(alwaysOn)
  useEffect(() => {
    alwaysOnRef.current = alwaysOn
  }, [alwaysOn])

  useEffect(() => {
    if (!alwaysOn) return

    if (appState === 'idle' && !isTranscribingRef.current) {
      // Delay restart so user can read the answer (1.5s)
      restartTimerRef.current = setTimeout(() => {
        if (alwaysOnRef.current) startListening()
      }, 1500)
    }

    return () => clearTimeout(restartTimerRef.current)
  }, [alwaysOn, appState, startListening])

  // When alwaysOn is first toggled ON, start immediately if idle
  useEffect(() => {
    if (alwaysOn && appState === 'idle') {
      startListening()
    }
    if (!alwaysOn) {
      clearTimeout(restartTimerRef.current)
      // Stop mic if currently listening
      if (appState === 'listening') stopListening()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alwaysOn])

  useEffect(() => {
    return () => {
      clearInterval(silenceCheckRef.current)
      clearTimeout(restartTimerRef.current)
      mediaRecorderRef.current?.stop()
      audioContextRef.current?.close()
      streamRef.current?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  return { startListening, stopListening, toggleListening }
}
