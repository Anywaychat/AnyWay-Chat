/**
 * Describes photos for blind users, entirely on the device, with the Florence-2 vision model.
 * The model downloads once (then the browser caches it). Descriptions are remembered per photo.
 */
import { workerClient } from './workers/rpc'

// The model runs in a background thread: loading and running it on the page's own thread froze the screen.
const vision = workerClient<{ image?: Blob }, { text?: string }>(
  () => new Worker(new URL('./workers/vision.worker.ts', import.meta.url), { type: 'module' }),
)
let ready: Promise<boolean> | null = null
let loaded = false
const cache = new Map<string, string>()
/** True once the photo model is loaded (the first one downloads it, which can take a minute). */
export const visionReady = () => loaded

function load(): Promise<boolean> {
  ready ??= vision({}).then(
    () => (loaded = true),
    (e) => {
      console.warn('[anyway] vision model failed to load', e)
      ready = null
      return false
    },
  )
  return ready
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
  if (!(await load())) return null
  try {
    const image = await (await fetch(url)).blob()
    const out = (await vision({ image })).text?.trim()
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
