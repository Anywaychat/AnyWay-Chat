/** Describes photos for blind users with the Florence-2 vision model, in a background thread so the page stays responsive. */
import { AutoProcessor, Florence2ForConditionalGeneration, RawImage } from '@huggingface/transformers'
import { serve } from './rpc'

type Florence = {
  model: { generate: (o: Record<string, unknown>) => Promise<unknown> }
  processor: {
    construct_prompts: (task: string) => string[]
    (image: unknown, prompts: string[]): Promise<Record<string, unknown>>
    batch_decode: (ids: unknown, o: { skip_special_tokens: boolean }) => string[]
    post_process_generation: (text: string, task: string, size: unknown) => Record<string, string>
  }
}

const ID = 'onnx-community/Florence-2-base-ft'
let loading: Promise<Florence> | null = null

async function loadOn(gpu: boolean): Promise<Florence> {
  const model = await Florence2ForConditionalGeneration.from_pretrained(ID, {
    dtype: gpu
      ? { embed_tokens: 'fp16', vision_encoder: 'fp16', encoder_model: 'q4', decoder_model_merged: 'q4' }
      : { embed_tokens: 'q8', vision_encoder: 'q8', encoder_model: 'q8', decoder_model_merged: 'q8' },
    device: gpu ? 'webgpu' : 'wasm',
  })
  const processor = await AutoProcessor.from_pretrained(ID)
  return { model, processor } as unknown as Florence
}

async function hasGpu() {
  try {
    const g = (navigator as unknown as { gpu?: { requestAdapter: () => Promise<unknown> } }).gpu
    return !!(g && (await g.requestAdapter()))
  } catch {
    return false
  }
}

function load() {
  // The graphics chip is much faster. Check it really exists first: a failed attempt on the graphics chip left the
  // processor fallback broken too ("no available backend"), so phones without one never got photos described.
  loading ??= hasGpu()
    .then((gpu) => (gpu ? loadOn(true).catch(() => loadOn(false)) : loadOn(false)))
    .catch((e) => {
      loading = null
      throw e
    })
  return loading
}

serve<{ image?: Blob }>(async ({ image }) => {
  const { model, processor } = await load()
  // No photo: the page only wanted the model loaded.
  if (!image) return
  const task = '<MORE_DETAILED_CAPTION>'
  const raw = await RawImage.fromBlob(image)
  const inputs = await processor(raw, processor.construct_prompts(task))
  const ids = await model.generate({ ...inputs, max_new_tokens: 120 })
  const text = processor.batch_decode(ids, { skip_special_tokens: false })[0]
  return { text: processor.post_process_generation(text, task, raw.size)[task] ?? '' }
})
