/**
 * Describes photos for blind users, entirely on the device, with the Florence-2 vision model.
 * The model downloads once (then the browser caches it). Descriptions are remembered per photo.
 */

type Florence = {
  model: { generate: (o: Record<string, unknown>) => Promise<unknown> }
  processor: {
    construct_prompts: (task: string) => string[]
    (image: unknown, prompts: string[]): Promise<Record<string, unknown>>
    batch_decode: (ids: unknown, o: { skip_special_tokens: boolean }) => string[]
    post_process_generation: (text: string, task: string, size: unknown) => Record<string, string>
  }
  RawImage: { fromURL: (url: string) => Promise<{ size: unknown }> }
}

let loaded: Florence | null = null
let loading: Promise<Florence | null> | null = null
const cache = new Map<string, string>()

function load(): Promise<Florence | null> {
  if (loaded) return Promise.resolve(loaded)
  if (loading) return loading
  loading = (async () => {
    try {
      const t = await import('@huggingface/transformers')
      const id = 'onnx-community/Florence-2-base-ft'
      const gpu = 'gpu' in navigator
      const model = await t.Florence2ForConditionalGeneration.from_pretrained(id, {
        dtype: gpu
          ? { embed_tokens: 'fp16', vision_encoder: 'fp16', encoder_model: 'q4', decoder_model_merged: 'q4' }
          : { embed_tokens: 'q8', vision_encoder: 'q8', encoder_model: 'q8', decoder_model_merged: 'q8' },
        device: gpu ? 'webgpu' : 'wasm',
      })
      const processor = await t.AutoProcessor.from_pretrained(id)
      loaded = { model, processor, RawImage: t.RawImage } as unknown as Florence
      return loaded
    } catch (e) {
      console.warn('[anyway] vision model failed to load', e)
      loading = null
      return null
    }
  })()
  return loading
}

/** Start downloading the model early so the first photo is described quickly. */
export function preloadVision() {
  void load()
}

/** Returns a sentence describing the photo, or null if it couldn't be described. */
export async function describePhoto(url: string): Promise<string | null> {
  if (!url) return null
  const hit = cache.get(url)
  if (hit) return hit
  const f = await load()
  if (!f) return null
  try {
    const task = '<MORE_DETAILED_CAPTION>'
    const image = await f.RawImage.fromURL(url)
    const inputs = await f.processor(image, f.processor.construct_prompts(task))
    const ids = await f.model.generate({ ...inputs, max_new_tokens: 120 })
    const text = f.processor.batch_decode(ids, { skip_special_tokens: false })[0]
    const out = f.processor.post_process_generation(text, task, image.size)[task]?.trim()
    if (!out) return null
    // Keep the first sentences: the model is most accurate at the start and can drift later.
    const cleaned = out.replace(/^in (this|the) (image|picture|photo),? (we|i) can see\s*/i, '')
    const firstFew = (cleaned.match(/[^.!?]+[.!?]+/g) ?? [cleaned]).slice(0, 2).join(' ').replace(/\s+/g, ' ').trim()
    const sentence = firstFew.charAt(0).toUpperCase() + firstFew.slice(1)
    cache.set(url, sentence)
    return sentence
  } catch (e) {
    console.warn('[anyway] describing photo failed', e)
    return null
  }
}
