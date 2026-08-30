'use client'

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Loader2, Mic, Send, Square } from 'lucide-react'

type MicState = 'idle' | 'recording' | 'transcribing'

type PromptBarProps = {
  /** Label of the step a run-level instruction will land on, or null when the run has nothing left to steer. */
  targetLabel: string | null
  paused: boolean
  submitting: boolean
  error: string | null
  onSubmit: (instruction: string) => void | Promise<void>
}

/**
 * Run-level prompt bar: type or dictate an instruction without hunting for the
 * right card. The viewer routes it to the step an operator would mean — the
 * open gate, or whatever is running — so "read the invoice that just arrived"
 * works mid-flight.
 */
export function PromptBar({ targetLabel, paused, submitting, error, onSubmit }: PromptBarProps) {
  const [value, setValue] = useState('')
  const [micState, setMicState] = useState<MicState>('idle')
  const [micError, setMicError] = useState<string | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])

  useEffect(() => () => {
    const recorder = recorderRef.current
    if (recorder && recorder.state !== 'inactive') recorder.stop()
  }, [])

  const submit = useCallback(async () => {
    const instruction = value.trim()
    if (!instruction || submitting) return
    await onSubmit(instruction)
    setValue('')
  }, [onSubmit, submitting, value])

  const onKeyDown = useCallback((event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey) return
    event.preventDefault()
    void submit()
  }, [submit])

  const startRecording = useCallback(async () => {
    setMicError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream)
      chunksRef.current = []
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data)
      }
      recorder.onstop = async () => {
        for (const track of stream.getTracks()) track.stop()
        setMicState('transcribing')
        try {
          const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' })
          const form = new FormData()
          form.append('audio', blob, 'instruction.webm')
          const response = await fetch('/api/transcribe', { method: 'POST', body: form })
          if (!response.ok) {
            const detail = await response.text().catch(() => '')
            throw new Error(detail || `Transcription failed with ${response.status}`)
          }
          const body = await response.json() as { text?: string }
          const text = body.text?.trim()
          if (text) setValue((current) => current ? `${current} ${text}` : text)
        } catch (transcribeError: unknown) {
          setMicError(transcribeError instanceof Error ? transcribeError.message : 'Transcription failed')
        } finally {
          setMicState('idle')
        }
      }
      recorder.start()
      recorderRef.current = recorder
      setMicState('recording')
    } catch {
      setMicError('Microphone unavailable')
    }
  }, [])

  const toggleMic = useCallback(() => {
    if (micState === 'transcribing') return
    if (micState === 'recording') {
      recorderRef.current?.stop()
      return
    }
    void startRecording()
  }, [micState, startRecording])

  const detail = micError ?? error
  return (
    <div className="prompt-bar" role="group" aria-label="Instruct the run">
      {(paused || targetLabel || detail) && (
        <div className="prompt-bar-status">
          {paused && <span className="prompt-bar-chip paused">Paused</span>}
          {targetLabel && <span className="prompt-bar-chip">Steering: {targetLabel}</span>}
          {detail && <span className="prompt-bar-chip error">{detail}</span>}
        </div>
      )}
      <div className="prompt-bar-row">
        <textarea
          aria-label="Instruction for the run"
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Tell Donald anything — redirect a step, add context, ask it to read what just arrived…"
          rows={1}
          value={value}
        />
        <button
          aria-label={micState === 'recording' ? 'Stop recording' : 'Dictate an instruction'}
          className={micState === 'recording' ? 'prompt-bar-mic recording' : 'prompt-bar-mic'}
          disabled={micState === 'transcribing'}
          onClick={toggleMic}
          title={micState === 'recording' ? 'Stop recording' : 'Dictate an instruction'}
          type="button"
        >
          {micState === 'recording' ? <Square size={18} aria-hidden="true" /> :
            micState === 'transcribing' ? <Loader2 size={18} aria-hidden="true" className="prompt-bar-spin" /> :
            <Mic size={18} aria-hidden="true" />}
        </button>
        <button
          aria-label="Send instruction"
          className="prompt-bar-send"
          disabled={submitting || !value.trim() || !targetLabel}
          onClick={() => void submit()}
          title={targetLabel ? 'Send instruction' : 'Nothing left to steer in this run'}
          type="button"
        >
          {submitting ? <Loader2 size={18} aria-hidden="true" className="prompt-bar-spin" /> : <Send size={18} aria-hidden="true" />}
        </button>
      </div>
    </div>
  )
}
