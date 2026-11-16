/**
 * Indian Sign Language reader, fully on the device.
 * Camera -> MediaPipe hand + body points -> AI4Bharat INCLUDE sign model (ONNX) -> words.
 * The point preparation here must match prep() in ml/finetune.py exactly.
 */
import type { HandLandmarker, PoseLandmarker } from '@mediapipe/tasks-vision'
import type { InferenceSession, Tensor } from 'onnxruntime-web'

const MAX_FRAMES = 200
const FPS = 25 // the sign videos the model learned from
const POINTS = 67 // 25 body + 21 + 21 hand points

type Pt = [number, number]
export type Frame = { t: number; pts: Pt[] }
export type Guess = { word: string; score: number }

let ready: Promise<{ hands: HandLandmarker; pose: PoseLandmarker; model: InferenceSession; ort: typeof import('onnxruntime-web'); labels: string[]; allowed: Set<number> }> | null = null

/** Loads the trackers and the sign model once (about 30 MB, cached by the browser afterwards). */
export function loadSignReader() {
  ready ??= (async () => {
    const [{ FilesetResolver, HandLandmarker, PoseLandmarker }, ort] = await Promise.all([import('@mediapipe/tasks-vision'), import('onnxruntime-web')])
    ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0-dev.20250409-89f8206ba4/dist/'
    const fs = await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm')
    const [hands, pose, model, labels, vocab] = await Promise.all([
      HandLandmarker.createFromOptions(fs, { baseOptions: { modelAssetPath: '/models/hand_landmarker.task', delegate: 'GPU' }, runningMode: 'VIDEO', numHands: 2, minHandDetectionConfidence: 0.5, minTrackingConfidence: 0.5 }),
      PoseLandmarker.createFromOptions(fs, { baseOptions: { modelAssetPath: '/models/pose_landmarker_lite.task', delegate: 'GPU' }, runningMode: 'VIDEO' }),
      ort.InferenceSession.create('/models/isl_signs.onnx', { executionProviders: ['wasm'] }),
      fetch('/models/isl_labels.json').then((r) => r.json() as Promise<string[]>),
      fetch('/models/isl_vocab.json').then((r) => (r.ok ? (r.json() as Promise<string[]>) : null)).catch(() => null),
    ])
    // Only offer the signs the model was fine-tuned on, when we know them.
    const allowed = new Set(vocab ? vocab.map((w) => labels.indexOf(w)).filter((i) => i >= 0) : labels.map((_, i) => i))
    return { hands, pose, model, ort, labels, allowed }
  })()
  return ready
}

const NAN: Pt = [NaN, NaN]
const d2 = (a: Pt, b: Pt) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2

/** hand1 = the hand nearest body point 15, hand2 = nearest point 16 (same rule as training). */
function assign(hands: Pt[][], pose: Pt[] | null): [Pt[] | null, Pt[] | null] {
  if (!pose) return [hands[0] ?? null, hands[1] ?? null]
  let h1: Pt[] | null = null
  let h2: Pt[] | null = null
  for (const h of hands) {
    const nearLeft = d2(h[0], pose[15]) <= d2(h[0], pose[16])
    if (nearLeft && !h1) h1 = h
    else if (!h2) h2 = h
    else if (!h1) h1 = h
  }
  return [h1, h2]
}

/** Recorded frames -> the (1, 200, 134) input the model expects. */
// Where the signer stands in the training videos (measured from them, as fractions of a 1920x1080 frame).
const TRAIN = { cx: 0.484 * 1920, cy: 0.387 * 1080, shoulders: 0.133 * 1920 }

/** Recorded frames -> the (1, 200, 134) input the model expects. `aspect` = camera width / height.
 *  Moves and scales the person so their shoulders sit where the training signers' did:
 *  close to a webcam you look about 3x bigger than they did, which made the model guess nonsense. */
export function prepare(frames: Frame[], aspect = 16 / 9): Float32Array {
  // Resample to the training frame rate, whatever speed the camera ran at.
  const t0 = frames[0].t
  const n = Math.min(MAX_FRAMES, Math.max(1, Math.round(((frames[frames.length - 1].t - t0) / 1000) * FPS) + 1))
  const cols = POINTS * 2
  const m = new Float64Array(n * cols)
  for (let i = 0, j = 0; i < n; i++) {
    const t = t0 + (i * 1000) / FPS
    while (j < frames.length - 1 && Math.abs(frames[j + 1].t - t) <= Math.abs(frames[j].t - t)) j++
    frames[j].pts.forEach(([x, y], p) => {
      m[i * cols + p * 2] = x
      m[i * cols + p * 2 + 1] = y
    })
  }
  // Fill gaps (a hand not seen for a moment) with a straight line between known positions,
  // and hold the first/last known value at the ends, like pandas interpolate(limit_direction='both').
  for (let c = 0; c < cols; c++) {
    const at = (i: number) => m[i * cols + c]
    const known: number[] = []
    for (let i = 0; i < n; i++) if (!Number.isNaN(at(i))) known.push(i)
    if (!known.length) continue // never seen: stays NaN and becomes 0 below
    for (let i = 0; i < n; i++) {
      if (!Number.isNaN(at(i))) continue
      const after = known.find((k) => k > i)
      let before = -1
      for (const k of known) if (k < i) before = k
      m[i * cols + c] =
        before < 0 ? at(after!) : after === undefined ? at(before) : at(before) + ((at(after) - at(before)) * (i - before)) / (after - before)
    }
  }
  // Camera picture in pixels (height = 1080), then line the shoulders up with the training signers.
  const H = 1080
  const W = H * aspect
  const xs: number[] = []
  const ys: number[] = []
  const ws: number[] = []
  for (let i = 0; i < n; i++) {
    const lx = m[i * cols + 22], ly = m[i * cols + 23], rx = m[i * cols + 24], ry = m[i * cols + 25]
    if ([lx, ly, rx, ry].every(Number.isFinite)) {
      xs.push(((lx + rx) / 2) * W)
      ys.push(((ly + ry) / 2) * H)
      ws.push(Math.hypot((lx - rx) * W, (ly - ry) * H))
    }
  }
  const med = (a: number[]) => [...a].sort((p, q) => p - q)[Math.floor(a.length / 2)]
  const ok = ws.length > 0 && med(ws) > 1
  const cx = ok ? med(xs) : W / 2
  const cy = ok ? med(ys) : H / 2
  const k = ok ? TRAIN.shoulders / med(ws) : 1920 / W
  const out = new Float32Array(MAX_FRAMES * 134)
  for (let i = 0; i < n; i++)
    for (let c = 0; c < cols; c++) {
      const v = m[i * cols + c]
      if (Number.isNaN(v)) continue
      out[i * 134 + c] = c % 2 === 0 ? TRAIN.cx + (v * W - cx) * k : TRAIN.cy + (v * H - cy) * k
    }
  return out
}

/**
 * Watches the camera and turns each sign into word guesses.
 * A sign starts when hands come up and ends when they drop (or pause) for a moment.
 */
export class SignReader {
  private frames: Frame[] = []
  private recording = false
  private lastHands = 0
  private seen = 0
  private stopped = false
  private lastT = -1

  private video: HTMLVideoElement
  private onSign: (guesses: Guess[]) => void
  private onState?: (s: { hands: boolean; recording: boolean }) => void

  constructor(video: HTMLVideoElement, onSign: (guesses: Guess[]) => void, onState?: (s: { hands: boolean; recording: boolean }) => void) {
    this.video = video
    this.onSign = onSign
    this.onState = onState
  }

  async start() {
    const r = await loadSignReader()
    const tick = () => {
      if (this.stopped) return
      if (this.video.readyState >= 2) {
        const now = performance.now()
        if (now > this.lastT) {
          this.lastT = now
          const hr = r.hands.detectForVideo(this.video, now)
          const pr = r.pose.detectForVideo(this.video, now)
          const pose = pr.landmarks[0] ? pr.landmarks[0].slice(0, 25).map((p) => [p.x, p.y] as Pt) : null
          const hands = hr.landmarks.map((h) => h.map((p) => [p.x, p.y] as Pt))
          const [h1, h2] = assign(hands, pose)
          const pts = [...(pose ?? Array(25).fill(NAN)), ...(h1 ?? Array(21).fill(NAN)), ...(h2 ?? Array(21).fill(NAN))] as Pt[]
          this.step({ t: now, pts }, hands.length > 0)
        }
      }
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }

  stop() {
    this.stopped = true
  }

  private step(f: Frame, hasHands: boolean) {
    if (hasHands) {
      this.lastHands = f.t
      this.seen++
    } else this.seen = 0
    // Keep a short lead-in so the start of the sign isn't cut off.
    this.frames.push(f)
    if (!this.recording) {
      this.frames = this.frames.slice(-6)
      if (this.seen >= 5) this.recording = true
    } else {
      // A sign ends when the hands are down for a full second (short flickers no longer split one sign into many).
      const quiet = f.t - this.lastHands > 1000
      const tooLong = f.t - this.frames[0].t > 6000
      if (quiet || tooLong) {
        const sign = this.frames
        this.frames = []
        this.recording = false
        const long = sign[sign.length - 1].t - sign[0].t
        if (sign.length >= 10 && long >= 700) void this.read(sign)
      }
    }
    this.onState?.({ hands: hasHands, recording: this.recording })
  }

  private async read(frames: Frame[]) {
    const aspect = this.video.videoWidth && this.video.videoHeight ? this.video.videoWidth / this.video.videoHeight : 4 / 3
    this.onSign(await classify(frames, aspect))
  }
}

/** Best 3 guesses for one recorded sign. */
export async function classify(frames: Frame[], aspect: number): Promise<Guess[]> {
  const r = await loadSignReader()
  const input = new r.ort.Tensor('float32', prepare(frames, aspect), [1, MAX_FRAMES, 134]) as Tensor
  const out = await r.model.run({ keypoints: input })
  const logits = out.logits.data as Float32Array
  const ids = [...r.allowed]
  const max = Math.max(...ids.map((i) => logits[i]))
  const exp = ids.map((i) => [i, Math.exp(logits[i] - max)] as const)
  const sum = exp.reduce((s, [, e]) => s + e, 0)
  return exp
    .map(([i, e]) => ({ word: r.labels[i], score: e / sum }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
}

/** Turns signed words (ISL word order, no small words) into a readable sentence. */
export function glossToSentence(words: string[]) {
  const s = words.join(' ').replace(/\s+/g, ' ').trim()
  return s ? s.charAt(0).toUpperCase() + s.slice(1) + '.' : ''
}
