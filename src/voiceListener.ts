/**
 * Always-on listening for phones, without gaps.
 *
 * Phone browsers' speech recognition stops after every short phrase and has to be restarted; anything said during a
 * restart is lost, so "Hey Chat" kept missing words. Here the microphone stays open the whole time. A simple voice
 * detector cuts what you say into utterances (with a little audio from just before you started), and each utterance is
 * written out by Whisper on the device (see transcribe.ts). Nothing is uploaded.
 */

const RATE = 16000 // what the speech model expects; the browser resamples the microphone to it
const CHUNK = 1024 // 64 ms
const PRE_ROLL = 5 // chunks kept from before speech starts (~0.3 s), so the first word isn't clipped
const END_SILENCE = 0.8 // seconds of quiet that end an utterance
const MIN_SPEECH = 0.35 // shorter sounds (a cough, a tap) are ignored
const MAX_SPEECH = 10 // a very long utterance is cut here

/**
 * Starts listening. `onUtterance` gets each utterance as 16 kHz mono audio. `muted()` is checked all the time: while it
 * is true (the app is talking, or listening is paused) nothing is collected, so AnyWay never hears its own voice.
 * Resolves to a stop function, or throws if the microphone can't be used.
 */
export async function startAlwaysOn(onUtterance: (audio: Float32Array) => void, muted: () => boolean, onDead?: () => void): Promise<() => void> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  // The device's own rate (some phones give silence from a 16 kHz context); converted to 16 kHz below.
  const ctx = new Ctx()
  const ratio = ctx.sampleRate / RATE
  const src = ctx.createMediaStreamSource(stream)
  const node = ctx.createScriptProcessor(CHUNK, 1, 1)
  const silent = ctx.createGain()
  silent.gain.value = 0 // the processor must be connected to run; this keeps it inaudible

  let noise = 0.01
  let speech: Float32Array[] | null = null
  let quiet = 0
  const before: Float32Array[] = []
  let mutedUntil = 0
  const chunkSec = CHUNK / ctx.sampleRate
  /** Averages down to 16 kHz. */
  const down = (x: Float32Array) => {
    const n = Math.floor(x.length / ratio)
    const out = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      const a = Math.floor(i * ratio)
      const b = Math.min(x.length, Math.floor((i + 1) * ratio))
      let t = 0
      for (let j = a; j < b; j++) t += x[j]
      out[i] = t / Math.max(1, b - a)
    }
    return out
  }

  const flush = () => {
    const parts = speech
    speech = null
    quiet = 0
    if (!parts) return
    const n = parts.reduce((t, p) => t + p.length, 0)
    if (n / RATE < MIN_SPEECH + PRE_ROLL * chunkSec) return
    const out = new Float32Array(n)
    let o = 0
    for (const p of parts) {
      out.set(p, o)
      o += p.length
    }
    onUtterance(out)
  }

  // Some browsers hand this audio path nothing but silence: then say so, and the caller uses another way to listen.
  let alive = false
  const deadCheck = setTimeout(() => { if (!alive) onDead?.() }, 6000)
  node.onaudioprocess = (e) => {
    const data = e.inputBuffer.getChannelData(0)
    if (!alive) for (let i = 0; i < data.length; i += 8) if (Math.abs(data[i]) > 0.0005) { alive = true; break }
    // While AnyWay talks (and a moment after, for the echo), hear nothing.
    if (muted()) {
      mutedUntil = performance.now() + 600
      speech = null
      before.length = 0
      return
    }
    if (performance.now() < mutedUntil) return
    let sum = 0
    for (let i = 0; i < data.length; i++) sum += data[i] * data[i]
    const rms = Math.sqrt(sum / data.length)
    const copy = down(data)
    const loud = rms > Math.max(0.012, noise * 3)
    if (!speech) {
      if (loud) {
        speech = [...before, copy]
        before.length = 0
        quiet = 0
      } else {
        noise = noise * 0.95 + rms * 0.05 // learn the room's background level
        before.push(copy)
        if (before.length > PRE_ROLL) before.shift()
      }
      return
    }
    speech.push(copy)
    quiet = loud ? 0 : quiet + chunkSec
    const length = speech.length * chunkSec
    if (quiet >= END_SILENCE || length >= MAX_SPEECH) flush()
  }

  src.connect(node)
  node.connect(silent)
  silent.connect(ctx.destination)
  if (ctx.state === 'suspended') await ctx.resume().catch(() => {})

  return () => {
    clearTimeout(deadCheck)
    node.onaudioprocess = null
    try {
      src.disconnect()
      node.disconnect()
      silent.disconnect()
    } catch {
      /* already disconnected */
    }
    stream.getTracks().forEach((t) => t.stop())
    void ctx.close().catch(() => {})
  }
}
