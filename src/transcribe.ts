/** On-device speech-to-text for voice messages (Whisper, runs in the browser; audio never leaves the phone). */
type ASR = (audio: Float32Array, opts?: object) => Promise<{ text: string } | { text: string }[]>
let asr: Promise<ASR> | null = null
const done = new Map<string, Promise<string>>()

function model() {
  asr ??= import('@huggingface/transformers').then(({ pipeline }) =>
    pipeline('automatic-speech-recognition', 'onnx-community/whisper-tiny', { dtype: 'q8', device: 'wasm' }) as unknown as Promise<ASR>,
  )
  return asr
}

async function decode(url: string): Promise<Float32Array> {
  const buf = await (await fetch(url)).arrayBuffer()
  const ctx = new AudioContext({ sampleRate: 16000 })
  try { return (await ctx.decodeAudioData(buf)).getChannelData(0) } finally { void ctx.close() }
}

export function transcribe(url: string): Promise<string> {
  let p = done.get(url)
  if (!p) {
    p = Promise.all([model(), decode(url)]).then(async ([run, audio]) => {
      const out = await run(audio, { chunk_length_s: 30, stride_length_s: 5, task: 'transcribe' })
      return (Array.isArray(out) ? out[0].text : out.text).trim()
    })
    p.catch(() => done.delete(url))
    done.set(url, p)
  }
  return p
}
