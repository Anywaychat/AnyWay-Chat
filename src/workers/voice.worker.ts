/**
 * The natural Kokoro voice (English only), in a background thread (on the page's own thread it froze every tap).
 *
 * Live speech: only when the person turns the natural voice on and the computer has a graphics chip (WebGPU) that makes
 * speech faster than it plays. It must run at full precision there: at half precision (fp16) the voice came out blurry.
 * Voice messages ("Send as voice") can wait a few seconds, so they use the small processor version (about 90 MB)
 * unless the graphics-chip voice is already loaded.
 */
import { KokoroTTS } from 'kokoro-js'
import { serve } from './rpc'

const ID = 'onnx-community/Kokoro-82M-v1.0-ONNX'
const VOICE = 'af_heart'

let gpu: Promise<KokoroTTS | null> | null = null
let gpuReady: KokoroTTS | null = null
let cpu: Promise<KokoroTTS> | null = null

async function hasGpu() {
  try {
    const g = (navigator as unknown as { gpu?: { requestAdapter: () => Promise<unknown> } }).gpu
    return !!(g && (await g.requestAdapter()))
  } catch {
    return false
  }
}

/** The fast voice on the graphics chip, or null if this device has none that works. */
function fastVoice() {
  gpu ??= (async () => {
    if (!(await hasGpu())) return null
    try {
      // Full precision: the recommended setting for the graphics chip (half precision sounded blurry).
      const tts = await KokoroTTS.from_pretrained(ID, { dtype: 'fp32', device: 'webgpu' })
      // The first sentence on a graphics chip takes a few extra seconds to set up; do it now, not on the first message.
      await tts.generate('Hello.', { voice: VOICE })
      gpuReady = tts
      return tts
    } catch {
      return null
    }
  })()
  return gpu
}

function smallVoice() {
  cpu ??= KokoroTTS.from_pretrained(ID, { dtype: 'q8', device: 'wasm' }).catch((e) => {
    cpu = null // let a later request try the download again
    throw e
  })
  return cpu
}

serve<{ text?: string; speed?: number; live?: boolean }>(async ({ text, speed, live }) => {
  // Live voice, no text: load the graphics-chip voice if this computer has one (nothing is downloaded otherwise).
  if (live && text === undefined) return { fast: !!(await fastVoice()) }
  const tts = live ? await fastVoice() : (gpuReady ?? (await smallVoice()))
  if (!tts) throw new Error('no fast voice on this device')
  if (text === undefined) return { fast: !!gpuReady }
  const t = performance.now()
  const audio = await tts.generate(text, { voice: VOICE, speed: speed ?? 1 })
  // How long making it took compared with how long it plays, so the page can switch voices on a slow graphics chip.
  const slowness = (performance.now() - t) / ((audio.audio.length / audio.sampling_rate) * 1000)
  return { blob: audio.toBlob(), fast: !!gpuReady, slowness }
})
