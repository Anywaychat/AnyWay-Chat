/**
 * Voice in and voice out, using the browser's built-in speech engines.
 * Nothing leaves the device except the final text, which is sent as a normal message.
 */
import { workerClient } from './workers/rpc'

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
  onstart?: (() => void) | null
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

/* ---------- Speaking ---------- */
// The phone's own voice by default: instant, clear, nothing to download, and it reads Hindi, Tamil and the other
// Indian languages. The natural voice (Kokoro, English only) is an opt-in for fast computers: it is a large download,
// it was blurry at half precision on the graphics chip, and it can't read other languages at all.
let rate = 1
export function setRate(r: number) {
  rate = r
}

const lower = (l: string) => l.replace('_', '-').toLowerCase()
const baseOf = (l: string) => lower(l).split('-')[0]

/** The language a text is written in, from its script. Latin script is read in English. */
const SCRIPTS: [RegExp, string[]][] = [
  [/[\u0900-\u097F]/, ['hi-IN', 'mr-IN']],
  [/[\u0B80-\u0BFF]/, ['ta-IN']],
  [/[\u0C00-\u0C7F]/, ['te-IN']],
  [/[\u0C80-\u0CFF]/, ['kn-IN']],
  [/[\u0D00-\u0D7F]/, ['ml-IN']],
  [/[\u0980-\u09FF]/, ['bn-IN']],
  [/[\u0A80-\u0AFF]/, ['gu-IN']],
  [/[\u0A00-\u0A7F]/, ['pa-IN']],
  [/[\u0600-\u06FF]/, ['ur-IN']],
]
let homeLang = 'en-IN'
/** The language the person reads in (set from their profile), used to pick between languages that share a script. */
export function setSpeechLang(l: string) {
  homeLang = l
}
export function langOfText(text: string): string {
  for (const [re, langs] of SCRIPTS) if (re.test(text)) return langs.find((l) => baseOf(l) === baseOf(homeLang)) ?? langs[0]
  return baseOf(homeLang) === 'en' ? homeLang : 'en-IN'
}

/* The clearest installed voice for each language (or the one the person picked). */
let voices: SpeechSynthesisVoice[] = []
const loadVoices = () => {
  voices = canSpeak ? window.speechSynthesis.getVoices() : []
}
if (canSpeak) {
  loadVoices()
  window.speechSynthesis.addEventListener?.('voiceschanged', loadVoices)
}
const GOOD = /google|natural|neural|premium|enhanced|wavenet|siri/i
let chosen: Record<string, string> = (() => {
  try {
    return JSON.parse(localStorage.getItem('anyway.voices') ?? '{}') as Record<string, string>
  } catch {
    return {}
  }
})()
/** Voices that can read a language, best first. */
export function voicesFor(lang: string): SpeechSynthesisVoice[] {
  if (!voices.length) loadVoices()
  const b = baseOf(lang)
  const score = (v: SpeechSynthesisVoice) => (GOOD.test(v.name) ? 3 : 0) + (lower(v.lang) === lower(lang) ? 2 : 0) + (v.localService ? 0 : 0.5)
  return voices.filter((v) => baseOf(v.lang) === b).sort((x, y) => score(y) - score(x))
}
export function voiceFor(lang: string): SpeechSynthesisVoice | undefined {
  const list = voicesFor(lang)
  return list.find((v) => v.name === chosen[baseOf(lang)]) ?? list[0]
}
/** Remembers the voice picked for a language ('' = automatic). */
export function chooseVoice(lang: string, name: string) {
  chosen = { ...chosen, [baseOf(lang)]: name }
  try {
    localStorage.setItem('anyway.voices', JSON.stringify(chosen))
  } catch {
    /* storage full */
  }
}
export const chosenVoice = (lang: string) => chosen[baseOf(lang)] ?? ''

// The natural voice runs in a background thread (on the page's own thread it froze every tap while it worked).
const kokoro = workerClient<{ text?: string; speed?: number; live?: boolean }, { blob?: Blob; fast?: boolean; slowness?: number }>(
  () => new Worker(new URL('./workers/voice.worker.ts', import.meta.url), { type: 'module' }),
)
let naturalWanted = false
let naturalLive = false // the natural voice is ready and fast enough to talk with
let slowLines = 0
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

/** Turns the natural (English) voice on or off. On: downloads it once if this computer is fast enough to talk with it. */
export function setNaturalVoice(on: boolean) {
  naturalWanted = on
  if (!on) {
    naturalLive = false
    setVoiceState('basic')
    return
  }
  preloadNaturalVoice()
}

/** Starts loading the natural voice, only if the person turned it on. Until it's ready the phone's own voice talks. */
export function preloadNaturalVoice() {
  if (!naturalWanted || naturalLive || kokoroLoading) return
  setVoiceState('loading')
  kokoroLoading = kokoro({ live: true }).then(
    ({ fast }) => {
      naturalLive = !!fast && naturalWanted
      setVoiceState(naturalLive ? 'natural' : 'basic')
    },
    (e) => {
      console.warn('Natural voice could not load, using the phone voice.', e)
      kokoroLoading = null
      setVoiceState('basic')
    },
  )
}

/** Resolves once the natural voice has finished loading (or failed), so other big downloads can wait their turn. */
export const naturalVoiceSettled = () => kokoroLoading ?? Promise.resolve()

// One line at a time, so messages don't talk over each other.
type Line = { text: string; lang: string }
const queue: Line[] = []
let playing: HTMLAudioElement | null = null
let endPlaying: (() => void) | null = null
let busy = false
let generation = 0

/** Plays one line in the natural voice; false if the browser wouldn't play it. */
function play(blob: Blob, text: string): Promise<boolean> {
  return new Promise<boolean>((done) => {
    const url = URL.createObjectURL(blob)
    const el = new Audio(url)
    playing = el
    const finish = (ok: boolean) => {
      clearTimeout(guard)
      URL.revokeObjectURL(url)
      if (playing === el) {
        playing = null
        endPlaying = null
      }
      done(ok)
    }
    endPlaying = () => finish(true)
    const guard = setTimeout(() => finish(true), 5000 + text.length * 150)
    el.onended = () => finish(true)
    el.onerror = () => finish(false)
    // If the browser blocks playback (no tap yet), say this line with the phone voice instead of skipping it.
    void el.play().catch(() => finish(false))
  })
}

/** Makes one line in the natural voice. Gives up (and goes back to the phone voice) if it's too slow, so the
 *  queue never stalls: a stuck graphics chip used to leave "Hey Chat" deaf until the page was reloaded. */
function makeVoice(text: string): Promise<Blob | null> {
  const made = kokoro({ text, speed: rate, live: true }).then(
    (r) => {
      slowLines = (r.slowness ?? 0) > 1 ? slowLines + 1 : 0
      return slowLines >= 2 ? null : (r.blob ?? null)
    },
    () => null,
  )
  const limit = new Promise<null>((r) => setTimeout(() => r(null), 4000 + text.length * 60))
  return Promise.race([made, limit]).then((blob) => {
    if (!blob && naturalLive) {
      naturalLive = false
      setVoiceState('basic')
    }
    return blob
  })
}

/** Says one line with the phone's own voice, in the line's language. */
function sayBuiltIn({ text, lang }: Line): Promise<void> {
  return new Promise<void>((done) => {
    const synth = window.speechSynthesis
    const u = new SpeechSynthesisUtterance(text)
    u.lang = lang
    const v = voiceFor(lang)
    if (v) u.voice = v
    u.rate = rate
    // Some browsers never fire "end" (for example when sound is blocked until the first tap),
    // which used to freeze the queue so no later message was ever read. Give up after a fair time.
    const guard = setTimeout(done, 3000 + (text.length * 120) / rate)
    u.onend = u.onerror = () => {
      clearTimeout(guard)
      done()
    }
    if (synth.paused) synth.resume()
    synth.speak(u)
  })
}

async function pump() {
  if (busy) return
  busy = true
  // Stop the "Hey Chat" listener while AnyWay talks, so it doesn't hear its own voice
  // (the chat greeting itself says "Hey Chat"). It starts fresh as soon as we're quiet.
  if (wakeLive) stopWakeRec()
  const myGen = generation
  // While one line plays, the next one is already being made, so there's no wait between sentences.
  let next: { text: string; blob: Promise<Blob | null> } | null = null
  while (queue.length && myGen === generation) {
    const line = queue.shift()!
    if (naturalLive && baseOf(line.lang) === 'en') {
      const blob = await (next?.text === line.text ? next.blob : makeVoice(line.text))
      next = null
      if (myGen !== generation) break
      if (blob) {
        const after = queue[0]
        if (after && baseOf(after.lang) === 'en' && naturalLive) next = { text: after.text, blob: makeVoice(after.text) }
        if (await play(blob, line.text)) continue
      }
      // No natural voice for this line: the phone voice says it instead.
    }
    if (canSpeak) await sayBuiltIn(line)
  }
  // Stopped part-way: stopSpeaking() already reset things, and a newer round may be talking now.
  if (myGen !== generation) return
  busy = false
  if (wakeOn && !wakePaused) scheduleWake(300)
}

/** Long text is said sentence by sentence, so the first words start quickly instead of after the whole text is made. */
function sentences(text: string): string[] {
  const parts = text.split(/(?<=[.!?।])\s+/).map((p) => p.trim()).filter(Boolean)
  const out: string[] = []
  // Very short bits ("Okay.", "ok") stay with their neighbour.
  for (const p of parts) {
    const last = out[out.length - 1]
    if (last !== undefined && (last.length < 30 || p.length < 12)) out[out.length - 1] = `${last} ${p}`
    else out.push(p)
  }
  return out.length ? out : [text]
}

/** Speaks text. `interrupt` stops whatever is being read first. `lang` defaults to the language the text is written in. */
export function speak(text: string, interrupt = false, lang?: string) {
  if (!text.trim()) return
  if (interrupt) stopSpeaking()
  // A line mixing English with another script ("Priya says, in Tamil: ...") is split so each part gets the right voice.
  for (const part of sentences(text)) {
    const own = lang ?? langOfText(part)
    const m = !lang && baseOf(own) !== 'en' ? part.match(/^([\t -~]*[:,]\s+)([^\t -~\s][\s\S]*)$/) : null
    if (m && /[a-z]/i.test(m[1])) {
      queue.push({ text: m[1].trim(), lang: 'en-IN' }, { text: m[2], lang: own })
    } else queue.push({ text: part, lang: own })
  }
  void pump()
}

export function stopSpeaking() {
  generation++
  queue.length = 0
  busy = false
  playing?.pause()
  endPlaying?.()
  if (canSpeak) window.speechSynthesis.cancel()
  if (wakeOn && !wakePaused) scheduleWake(300)
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
export function listenOnce(onText: (sofar: string) => void, onDone: (finalText: string) => void, onError: (msg: string) => void, lang = LANG): Listening | null {
  if (!RecCtor) return null
  pauseWake()
  stopSpeaking()
  const rec = new RecCtor()
  rec.lang = lang
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

/**
 * off: not running (signed out, or not started yet). waiting: listening for "Hey Chat". awake: taking a command.
 * blocked: the browser won't give us the microphone. nomic: no working microphone found.
 * unavailable: keeps failing for another reason (for example no connection to the speech service); still retrying.
 */
export type WakeState = 'off' | 'waiting' | 'awake' | 'blocked' | 'nomic' | 'unavailable'
let wakeRec: Rec | null = null
let wakeLive = false // really listening (not still waiting for the person to answer the microphone prompt)
let wakeOn = false
let wakePaused = false
let wakeFails = 0
let wakeStuck = false
let wakeTimer: ReturnType<typeof setTimeout> | undefined
const ownStops = new WeakSet<Rec>()
let onWakeCommand: ((text: string) => void) | null = null
let onWakeState: ((s: WakeState) => void) | null = null

function stopWakeRec() {
  if (!wakeRec) return
  ownStops.add(wakeRec)
  try {
    wakeRec.abort()
  } catch {
    /* already stopped */
  }
}
function scheduleWake(ms: number) {
  clearTimeout(wakeTimer)
  wakeTimer = setTimeout(runWake, ms)
}
function pauseWake() {
  wakePaused = true
  clearTimeout(wakeTimer)
  stopWakeRec()
}
function resumeWake() {
  wakePaused = false
  if (wakeOn) scheduleWake(300)
}

export async function micPermission(): Promise<PermissionState | 'unknown'> {
  try {
    return (await navigator.permissions.query({ name: 'microphone' as PermissionName })).state
  } catch {
    return 'unknown'
  }
}

/** Asks the browser for the microphone (shows its "Allow" prompt). True if allowed. */
export async function requestMic(): Promise<boolean> {
  try {
    const s = await navigator.mediaDevices.getUserMedia({ audio: true })
    s.getTracks().forEach((t) => t.stop())
    return true
  } catch {
    return false
  }
}

/**
 * Listening stopped with an error. Browsers do this for many reasons besides a blocked microphone: the tab was hidden,
 * another tab started listening, the network blinked, or the microphone prompt wasn't answered yet.
 * It used to switch "Hey Chat" off for good (until a reload) and say the microphone was blocked even when it wasn't.
 */
async function wakeTrouble(why: string) {
  wakeFails++
  const perm = await micPermission()
  if (!wakeOn || wakePaused || wakeRec) return
  const refused = why === 'not-allowed' || why === 'service-not-allowed'
  let problem: WakeState | null = null
  if (perm === 'denied' || (refused && perm !== 'granted' && wakeFails >= 2)) problem = 'blocked'
  else if (why === 'audio-capture' && wakeFails >= 3) problem = 'nomic'
  else if (wakeFails >= 5) problem = 'unavailable'
  if (problem) {
    wakeStuck = true
    onWakeState?.(problem)
  }
  // Blocked or no microphone: wait for the person to fix it (watchMic notices). A hidden tab starts again when shown.
  if (problem === 'blocked' || problem === 'nomic' || document.hidden) return
  scheduleWake(Math.min(30000, 1000 * 2 ** Math.min(wakeFails - 1, 5)))
}

// Starts "Hey Chat" again by itself once it can: microphone allowed in site settings, tab shown again, or a tap or key press.
let watching = false
function watchMic() {
  if (watching) return
  watching = true
  const retry = () => {
    if (!wakeOn || wakePaused || wakeRec || busy) return
    wakeFails = 0
    clearTimeout(wakeTimer)
    runWake()
  }
  void navigator.permissions
    ?.query({ name: 'microphone' as PermissionName })
    .then((p) => {
      p.onchange = () => p.state !== 'denied' && retry()
    })
    .catch(() => {})
  document.addEventListener('visibilitychange', () => !document.hidden && retry())
  navigator.mediaDevices?.addEventListener?.('devicechange', retry)
  // A tap or key press can bring back a microphone prompt that was closed without answering.
  const onInput = () => wakeStuck && void micPermission().then((p) => p !== 'denied' && retry())
  window.addEventListener('pointerdown', onInput, true)
  window.addEventListener('keydown', onInput, true)
}

function runWake() {
  if (!RecCtor || !wakeOn || wakePaused || wakeRec || busy) return
  const rec = new RecCtor()
  wakeRec = rec
  wakeLive = false
  rec.lang = LANG
  rec.interimResults = true
  rec.continuous = true
  let failed = ''
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
    live()
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
  // Only report "listening" once the browser really is (after the microphone prompt, if there was one).
  const live = () => {
    if (wakeLive || wakeRec !== rec) return
    wakeLive = true
    wakeFails = 0
    wakeStuck = false
    onWakeState?.('waiting')
  }
  rec.onstart = live
  rec.onerror = (e) => {
    // "no-speech" is normal (nobody talked for a while). Our own stops don't count either.
    if (e.error === 'no-speech' || ownStops.has(rec)) return
    // "aborted" that we didn't ask for: another tab or app took over listening.
    failed = e.error
  }
  rec.onend = () => {
    if (wakeRec === rec) {
      wakeRec = null
      wakeLive = false
    }
    if (!wakeOn || wakePaused) return
    // Browsers stop continuous listening every so often; quietly start again.
    if (!failed) return scheduleWake(400)
    void wakeTrouble(failed)
  }
  try {
    rec.start()
  } catch {
    wakeRec = null
    scheduleWake(1000)
  }
}

/** Turns the always-on "Hey Chat" listener on or off. */
export function setWakeWord(on: boolean, onCommand?: (text: string) => void, onState?: (s: WakeState) => void) {
  if (onCommand) onWakeCommand = onCommand
  if (onState) onWakeState = onState
  wakeOn = on && !!RecCtor
  wakePaused = false
  wakeFails = 0
  wakeStuck = false
  clearTimeout(wakeTimer)
  if (wakeOn) {
    watchMic()
    runWake()
  } else {
    stopWakeRec()
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

/**
 * Live captions for calls: keeps turning what you say into text until stopped.
 * "Hey Chat" is paused meanwhile (a browser can only listen with one recogniser at a time).
 */
export function listenForCaptions(onLine: (text: string) => void, onPartial: (text: string) => void, lang = LANG): (() => void) | null {
  if (!RecCtor) return null
  pauseWake()
  let stopped = false
  let rec: Rec | null = null
  let fails = 0
  const start = () => {
    if (stopped) return
    const r = new RecCtor()
    rec = r
    r.lang = lang
    r.interimResults = true
    r.continuous = true
    r.onresult = (e) => {
      let partial = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript.trim()
        if (!t) continue
        if (e.results[i].isFinal) {
          // "Hey Chat, hang up" during a call is a command for AnyWay, not words for the other person.
          const w = t.match(WAKE)
          if (w && wakeOn && onWakeCommand) { const cmd = t.slice((w.index ?? 0) + w[0].length).trim(); if (cmd) { beep('stop'); onWakeCommand(cmd) } }
          else onLine(t)
        }
        else partial += t + ' '
      }
      onPartial(partial.trim())
    }
    // Browsers end recognition after a pause: start again while the call lasts.
    // After an error (microphone blocked, network down) wait longer each time instead of retrying four times a second.
    let failed = false
    r.onstart = () => { fails = 0 }
    r.onerror = (e) => { if (e.error !== 'no-speech' && e.error !== 'aborted') failed = true }
    r.onend = () => {
      if (failed) fails++
      setTimeout(start, failed ? Math.min(10000, 500 * 2 ** fails) : 250)
    }
    try { r.start() } catch { setTimeout(start, 500) }
  }
  start()
  return () => {
    stopped = true
    try { rec?.abort() } catch { /* already stopped */ }
    resumeWake()
  }
}

let clipWarm = false
/** True once the voice for voice messages is loaded (the first one downloads about 90 MB). */
export const voiceClipReady = () => clipWarm
/** Starts loading the voice-message voice, for example when someone picks "Send as voice". */
export function preloadVoiceClip() {
  if (clipWarm) return
  void kokoro({}).then(() => { clipWarm = true }, () => {})
}
/** Turns typed words into a recorded voice (the natural Kokoro voice), to send as a voice message. */
export async function voiceClip(text: string): Promise<Blob | null> {
  // A message can wait a few seconds, so this uses the natural voice even where it's too slow for live speech.
  return kokoro({ text, speed: 1 }).then((r) => { clipWarm = true; return r.blob ?? null }, () => null)
}
