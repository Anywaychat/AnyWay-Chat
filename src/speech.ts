/**
 * Voice in and voice out, using the browser's built-in speech engines.
 * Nothing leaves the device except the final text, which is sent as a normal message.
 */

type Rec = {
  lang: string
  interimResults: boolean
  continuous: boolean
  start: () => void
  stop: () => void
  abort: () => void
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
}

const RecCtor = (window as unknown as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec }).SpeechRecognition
  ?? (window as unknown as { webkitSpeechRecognition?: new () => Rec }).webkitSpeechRecognition

export const canListen = !!RecCtor
export const canSpeak = typeof window !== 'undefined' && 'speechSynthesis' in window

const LANG = navigator.language?.startsWith('en') ? navigator.language : 'en-IN'

/* ---------- Beeps so a blind user knows when the mic opens and closes ---------- */
let audio: AudioContext | null = null
export function beep(kind: 'start' | 'stop' | 'error') {
  try {
    audio = audio ?? new AudioContext()
    const o = audio.createOscillator()
    const g = audio.createGain()
    o.frequency.value = kind === 'start' ? 880 : kind === 'stop' ? 520 : 220
    g.gain.value = 0.08
    o.connect(g).connect(audio.destination)
    o.start()
    o.stop(audio.currentTime + (kind === 'error' ? 0.3 : 0.12))
  } catch {
    /* audio not available */
  }
}

/* ---------- Speaking: Kokoro (natural voice, runs in the browser) with the built-in voice as a fallback ---------- */
let rate = 1
export function setRate(r: number) {
  rate = r
}

type Kokoro = { generate: (text: string, o: { voice: string; speed: number }) => Promise<{ toBlob: () => Blob }> }
let kokoro: Kokoro | null = null
let kokoroLoading: Promise<void> | null = null
export type VoiceState = 'basic' | 'loading' | 'natural'
let voiceState: VoiceState = 'basic'
const voiceListeners = new Set<(s: VoiceState) => void>()
export const onVoiceState = (l: (s: VoiceState) => void) => {
  voiceListeners.add(l)
  l(voiceState)
  return () => {
    voiceListeners.delete(l)
  }
}
const setVoiceState = (v: VoiceState) => {
  voiceState = v
  voiceListeners.forEach((l) => l(v))
}

/** Downloads the Kokoro voice once (cached by the browser afterwards). Until it's ready, the built-in voice is used. */
export function preloadNaturalVoice() {
  if (kokoro || kokoroLoading) return
  setVoiceState('loading')
  kokoroLoading = (async () => {
    try {
      const { KokoroTTS } = await import('kokoro-js')
      // The small (about 90 MB) version runs on every phone and laptop. The WebGPU version needs a 300 MB download,
      // which took minutes on mobile data, so people heard the robotic fallback voice the whole time.
      const load = () => KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', { dtype: 'q8', device: 'wasm' })
      kokoro = (await load().catch(() => load())) as unknown as Kokoro
      setVoiceState('natural')
    } catch (e) {
      console.warn('Natural voice could not load, using the built-in voice.', e)
      kokoro = null
      kokoroLoading = null
      setVoiceState('basic')
    }
  })()
}

/** Resolves once the natural voice has finished loading (or failed), so other big downloads can wait their turn. */
export const naturalVoiceSettled = () => kokoroLoading ?? Promise.resolve()

// One line at a time, so messages don't talk over each other.
const queue: string[] = []
let playing: HTMLAudioElement | null = null
let busy = false
let generation = 0

async function pump() {
  if (busy) return
  busy = true
  const myGen = generation
  while (queue.length && myGen === generation) {
    const text = queue.shift()!
    if (kokoro) {
      try {
        const audio = await kokoro.generate(text, { voice: 'af_heart', speed: rate })
        if (myGen !== generation) break
        const url = URL.createObjectURL(audio.toBlob())
        const played = await new Promise<boolean>((done) => {
          const el = new Audio(url)
          playing = el
          const finish = (ok: boolean) => {
            clearTimeout(guard)
            URL.revokeObjectURL(url)
            playing = null
            done(ok)
          }
          const guard = setTimeout(() => finish(true), 5000 + text.length * 150)
          el.onended = () => finish(true)
          el.onerror = () => finish(false)
          // If the browser blocks playback (no tap yet), say this line with the built-in voice instead of skipping it.
          void el.play().catch(() => finish(false))
        })
        if (played) continue
      } catch {
        /* fall back to the built-in voice for this line */
      }
    }
    if (canSpeak) {
      await new Promise<void>((done) => {
        const u = new SpeechSynthesisUtterance(text)
        u.lang = LANG
        u.rate = rate
        // Some browsers never fire "end" (for example when sound is blocked until the first tap),
        // which used to freeze the queue so no later message was ever read. Give up after a fair time.
        const guard = setTimeout(done, 3000 + text.length * 120)
        u.onend = u.onerror = () => {
          clearTimeout(guard)
          done()
        }
        window.speechSynthesis.speak(u)
      })
    }
  }
  busy = false
}

/** Speaks text. `interrupt` stops whatever is being read first. */
export function speak(text: string, interrupt = false) {
  if (!text.trim()) return
  if (interrupt) stopSpeaking()
  queue.push(text)
  void pump()
}

export function stopSpeaking() {
  generation++
  queue.length = 0
  busy = false
  playing?.pause()
  playing = null
  if (canSpeak) window.speechSynthesis.cancel()
}

/** True while AnyWay is talking, so the wake word ignores its own voice. */
export const isSpeaking = () => busy || !!playing || (canSpeak && window.speechSynthesis.speaking)

/* ---------- Listening ---------- */
export interface Listening {
  stop: () => void
  cancel: () => void
}

/**
 * Starts listening. `onText` gets the words so far as you speak; `onDone` gets the final text when you stop.
 * Returns null if the browser has no speech recognition.
 */
export function listen(onText: (sofar: string) => void, onDone: (finalText: string) => void, onError: (msg: string) => void): Listening | null {
  if (!RecCtor) return null
  stopSpeaking()
  const rec = new RecCtor()
  rec.lang = LANG
  rec.interimResults = true
  rec.continuous = true
  let finalText = ''
  let interim = ''
  let cancelled = false
  rec.onresult = (e) => {
    interim = ''
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i]
      if (r.isFinal) finalText += r[0].transcript
      else interim += r[0].transcript
    }
    onText((finalText + interim).trim())
  }
  rec.onerror = (e) => {
    if (e.error === 'aborted' || e.error === 'no-speech') return
    cancelled = true
    beep('error')
    onError(e.error === 'not-allowed' ? 'Allow the microphone for this site to talk to AnyWay.' : `Couldn't hear you (${e.error}). Try again.`)
  }
  rec.onend = () => {
    if (cancelled) return
    beep('stop')
    onDone((finalText + interim).trim())
  }
  beep('start')
  rec.start()
  return {
    stop: () => rec.stop(),
    cancel: () => {
      cancelled = true
      rec.abort()
    },
  }
}

/* ---------- One-shot: tap, speak, it stops by itself when you pause ---------- */
export function listenOnce(onText: (sofar: string) => void, onDone: (finalText: string) => void, onError: (msg: string) => void): Listening | null {
  if (!RecCtor) return null
  pauseWake()
  stopSpeaking()
  const rec = new RecCtor()
  rec.lang = LANG
  rec.interimResults = true
  rec.continuous = false
  let text = ''
  let cancelled = false
  rec.onresult = (e) => {
    text = Array.from({ length: e.results.length }, (_, i) => e.results[i][0].transcript).join('')
    onText(text.trim())
  }
  rec.onerror = (e) => {
    if (e.error === 'aborted' || e.error === 'no-speech') return
    cancelled = true
    beep('error')
    onError(e.error === 'not-allowed' ? 'Allow the microphone for this site to talk to AnyWay.' : `Couldn't hear you (${e.error}). Try again.`)
  }
  rec.onend = () => {
    resumeWake()
    if (cancelled) return
    beep('stop')
    onDone(text.trim())
  }
  beep('start')
  rec.start()
  return { stop: () => rec.stop(), cancel: () => { cancelled = true; rec.abort() } }
}

/* ---------- "Hey Chat" wake word ---------- */
// "Hey Chat", forgiving: speech engines often hear it as "hey chad", "a chat", "hey jack", "hey check" with different accents.
// Saying just "Chat, ..." at the start of a sentence also works.
const GREET = '(?:hey|hay|hi|hai|high|hello|ok|okay|o\\.?k\\.?|ay|eh|he|yo)'
const CHAT = '(?:chat|chats|chad|chap|chet|jack|jat|chaat|chart|check|chuck|shot|shat|cat|chatting)'
const WAKE = new RegExp(`(?:\\b${GREET}[\\s,.-]*${CHAT}\\b|^\\s*(?:a|uh|ah|um)?[\\s,]*${CHAT}\\b)[\\s,.]*`, 'i')

let wakeRec: Rec | null = null
let wakeOn = false
let wakePaused = false
let onWakeCommand: ((text: string) => void) | null = null
let onWakeState: ((s: 'off' | 'waiting' | 'awake') => void) | null = null

function pauseWake() {
  wakePaused = true
  try {
    wakeRec?.abort()
  } catch {
    /* already stopped */
  }
}
function resumeWake() {
  wakePaused = false
  if (wakeOn) setTimeout(runWake, 300)
}

function runWake() {
  if (!RecCtor || !wakeOn || wakePaused || wakeRec) return
  const rec = new RecCtor()
  wakeRec = rec
  rec.lang = LANG
  rec.interimResults = true
  rec.continuous = true
  let awake = false
  let command = ''
  let silence: ReturnType<typeof setTimeout> | undefined
  const finish = () => {
    clearTimeout(silence)
    const text = command.trim()
    awake = false
    command = ''
    onWakeState?.('waiting')
    if (text) {
      beep('stop')
      onWakeCommand?.(text)
    }
  }
  rec.onresult = (e) => {
    // Ignore our own voice while a message is being read aloud.
    if (isSpeaking()) return
    let heard = ''
    for (let i = e.resultIndex; i < e.results.length; i++) heard += e.results[i][0].transcript
    const isFinal = e.results[e.results.length - 1].isFinal
    if (!awake) {
      const m = heard.match(WAKE)
      if (!m) return
      awake = true
      beep('start')
      onWakeState?.('awake')
      command = heard.slice((m.index ?? 0) + m[0].length)
    } else {
      command = heard.replace(WAKE, '')
    }
    clearTimeout(silence)
    // Send after a short pause, or straight away when the browser marks the phrase as finished.
    if (isFinal && command.trim()) finish()
    else silence = setTimeout(finish, command.trim() ? 1600 : 6000)
  }
  rec.onerror = (e) => {
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
      wakeOn = false
      onWakeState?.('off')
    }
  }
  rec.onend = () => {
    wakeRec = null
    // Browsers stop continuous listening every so often; quietly start again.
    if (wakeOn && !wakePaused) setTimeout(runWake, 400)
  }
  try {
    rec.start()
    onWakeState?.('waiting')
  } catch {
    wakeRec = null
  }
}

/** Turns the always-on "Hey Chat" listener on or off. */
export function setWakeWord(on: boolean, onCommand?: (text: string) => void, onState?: (s: 'off' | 'waiting' | 'awake') => void) {
  if (onCommand) onWakeCommand = onCommand
  if (onState) onWakeState = onState
  wakeOn = on && !!RecCtor
  if (wakeOn) runWake()
  else {
    pauseWake()
    wakePaused = false
    onWakeState?.('off')
  }
}

/** Resolves once AnyWay has finished talking. */
export function whenQuiet(): Promise<void> {
  return new Promise((done) => {
    const check = () => (isSpeaking() ? setTimeout(check, 150) : done())
    setTimeout(check, 150)
  })
}

/**
 * Asks a question out loud, then listens for the answer without needing the wake word.
 * Resolves with what was said, or '' if nothing was heard.
 */
export async function ask(question: string): Promise<string> {
  speak(question, true)
  await whenQuiet()
  return new Promise((done) => {
    const l = listenOnce(
      () => {},
      (text) => done(text),
      () => done(''),
    )
    if (!l) done('')
  })
}

/**
 * Records a voice note: starts on the beep and stops by itself when you stop talking (or after a minute).
 * Resolves with the audio, or null if nothing was recorded.
 */
export async function recordVoiceNote(): Promise<Blob | null> {
  pauseWake()
  stopSpeaking()
  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  } catch {
    resumeWake()
    return null
  }
  const mr = new MediaRecorder(stream)
  const chunks: Blob[] = []
  mr.ondataavailable = (e) => e.data.size && chunks.push(e.data)
  const done = new Promise<Blob | null>((resolve) => {
    mr.onstop = () => {
      stream.getTracks().forEach((t) => t.stop())
      resumeWake()
      resolve(chunks.length ? new Blob(chunks, { type: mr.mimeType }) : null)
    }
  })
  beep('start')
  mr.start()
  // Use speech detection only to notice when the person stops talking.
  const stop = () => mr.state === 'recording' && mr.stop()
  const limit = setTimeout(stop, 60000)
  if (RecCtor) {
    const rec = new RecCtor()
    rec.lang = LANG
    rec.continuous = false
    rec.interimResults = false
    rec.onresult = null
    rec.onerror = () => {}
    rec.onend = () => setTimeout(stop, 600)
    try {
      rec.start()
    } catch {
      /* fall back to the time limit */
    }
  }
  const blob = await done
  clearTimeout(limit)
  beep('stop')
  return blob
}
