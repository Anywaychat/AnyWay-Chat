/** On-device speech-to-text for voice messages (Whisper, runs in the browser; audio never leaves the phone). */
import { workerClient } from './workers/rpc'

// The model runs in a background thread: on the page's own thread it froze the screen for seconds per voice message.
const asr = workerClient<{ audio: Float32Array }, { text: string }>(
  () => new Worker(new URL('./workers/asr.worker.ts', import.meta.url), { type: 'module' }),
)
const done = new Map<string, Promise<string>>()

async function decode(url: string): Promise<Float32Array> {
  const buf = await (await fetch(url)).arrayBuffer()
  const ctx = new AudioContext({ sampleRate: 16000 })
  // A copy, so it can be handed to the worker without touching the browser's own audio buffer.
  try { return (await ctx.decodeAudioData(buf)).getChannelData(0).slice() } finally { void ctx.close() }
}

export function transcribe(url: string): Promise<string> {
  let p = done.get(url)
  if (!p) {
    p = decode(url).then(async (audio) => {
      // Nothing but silence: the speech model invents words for silence (usually "you"), so say nothing was heard.
      let peak = 0
      for (let i = 0; i < audio.length; i += 4) peak = Math.max(peak, Math.abs(audio[i]))
      if (peak < 0.02) return ''
      const text = (await asr({ audio }, [audio.buffer])).text
      return /^\W*(you|thank you|thanks for watching)\W*$/i.test(text) && peak < 0.08 ? '' : text
    })
    p.catch(() => done.delete(url))
    done.set(url, p)
  }
  return p
}
