/** Speech-to-text for voice messages (Whisper), in a background thread so the page stays responsive. */
import { pipeline } from '@huggingface/transformers'
import { serve } from './rpc'

type ASR = (audio: Float32Array, opts?: object) => Promise<{ text: string } | { text: string }[]>
let asr: Promise<ASR> | null = null

serve<{ audio: Float32Array }>(async ({ audio }) => {
  asr ??= pipeline('automatic-speech-recognition', 'onnx-community/whisper-tiny', { dtype: 'q8', device: 'wasm' }) as unknown as Promise<ASR>
  const run = await asr.catch((e) => {
    asr = null // let a later voice message try the download again
    throw e
  })
  const out = await run(audio, { chunk_length_s: 30, stride_length_s: 5, task: 'transcribe' })
  return { text: (Array.isArray(out) ? out[0].text : out.text).trim() }
})
