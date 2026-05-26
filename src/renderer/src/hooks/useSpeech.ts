import { useCallback, useRef, useEffect } from 'react'
import { useAppStore } from '../store/appStore'
import { buildHistory } from '../utils'

const SPEECH_THRESHOLD = 20   // avg frequency energy to count as speech (higher = less noise false-triggers)
const SILENCE_THRESHOLD = 12  // below this = silence
const SILENCE_DURATION = 2500 // ms of silence before auto-submit
const MIN_CHUNKS = 15         // at least ~1.5 s of audio before submitting
const MIN_BLOB_BYTES = 8000   // skip blobs < 8 KB — too small for Whisper to process

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
      mediaRecorderRef.current = null
      setAppState('idle')
      isTranscribingRef.current = false
      return
    }

    // Stop recorder with a 3s timeout fallback in case onstop never fires
    await Promise.race([
      new Promise<void>((resolve) => {
        recorder.onstop = () => resolve()
        recorder.stop()
      }),
      new Promise<void>((resolve) => setTimeout(resolve, 3000))
    ])

    // Small pause to ensure the final ondataavailable chunk is flushed
    await new Promise<void>((resolve) => setTimeout(resolve, 150))

    cleanup()

    const chunks = audioChunksRef.current.splice(0)
    mediaRecorderRef.current = null

    if (chunks.length === 0) {
      setAppState('idle')
      isTranscribingRef.current = false
      return
    }

    const audioBlob = new Blob(chunks, { type: chunks[0].type || 'audio/webm' })

    // Skip blobs that are too small — likely silence or noise, not real speech
    if (audioBlob.size < MIN_BLOB_BYTES) {
      setAppState('idle')
      isTranscribingRef.current = false
      return
    }

    setAppState('thinking')

    try {
      const arrayBuffer = await audioBlob.arrayBuffer()
      const transcript = await window.api.transcribeAudio(arrayBuffer, audioBlob.type)
      if (transcript?.trim()) {
        const history = buildHistory(useAppStore.getState().messages)
        setTranscript(transcript)
        clearStreaming()
        window.api.sendQuery(transcript.trim(), history)
      } else {
        setAppState('idle')
      }
    } catch (err: unknown) {
      const message = (err as Error).message || 'Transcription failed.'
      // In always-on mode, skip showing errors for short/empty audio — just reset quietly
      if (useAppStore.getState().alwaysOn && message.includes('valid media')) {
        setAppState('idle')
      } else {
        useAppStore.getState().setError(message)
      }
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
    // Force-cleanup any stale stream from a previous session
    // (can happen if onstop didn't fire and streamRef was never cleared)
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
    if (audioContextRef.current) {
      audioContextRef.current.close()
      audioContextRef.current = null
    }
    mediaRecorderRef.current = null

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
      streamRef.current = stream

      const audioContext = new AudioContext()
      audioContextRef.current = audioContext
      const analyser = audioContext.createAnalyser()
      analyser.fftSize = 512
      analyser.smoothingTimeConstant = 0.8
      audioContext.createMediaStreamSource(stream).connect(analyser)

      // Prefer plain webm; mp4 as fallback for macOS compatibility
      const mimeType =
        ['audio/webm', 'audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/ogg'].find(
          (t) => MediaRecorder.isTypeSupported(t)
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
          if (silentMs >= SILENCE_DURATION && audioChunksRef.current.length >= MIN_CHUNKS) {
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

    if ((appState === 'idle' || appState === 'error') && !isTranscribingRef.current) {
      // After an answer: 1.5s delay so user can read it
      // After an error: 3s delay then clear error and restart
      const delay = appState === 'error' ? 3000 : 1500
      restartTimerRef.current = setTimeout(() => {
        if (!alwaysOnRef.current) return
        if (useAppStore.getState().appState === 'error') {
          useAppStore.getState().setError(null) // clears error → appState becomes 'idle' → this effect re-fires
        } else {
          startListening()
        }
      }, delay)
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
