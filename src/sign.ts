/**
 * Indian Sign Language reader, fully on the device.
 * Camera -> MediaPipe hand + body points -> sign model (ONNX) -> words.
 * Current model (v4, Nov 18): 1D-conv + transformer, 3 combined, trained on all 4,257 INCLUDE clips with laptop/phone
 * camera simulation (ml/train_v4.py). It takes the raw points and does all preparation inside the model file.
 * Held-out test: 97.8% laptop view, 97.9% phone view; real-browser test on 44 chat words: 84-89% laptop, 93-96% phone.
 * prepare() below is only for the older model format (AI4Bharat transformer).
 */
import type { HandLandmarker, PoseLandmarker } from '@mediapipe/tasks-vision'
import type { InferenceSession, Tensor } from 'onnxruntime-web'

const MAX_FRAMES = 200
const FPS = 25 // the sign videos the model learned from
const POINTS = 67 // 25 body + 21 + 21 hand points

export type Pt = [number, number]
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
  private minGap: number
  private onSegment?: (s: Segment) => void
  private onFrame?: (pts: Pt[], hands: number, pose: boolean) => void

  /** `maxFps` limits how often the camera is read: on a video call, reading every screen refresh took processing power
   *  the call needed (video dropped from 26 to 20 frames a second on a fast laptop, more on phones). */
  constructor(
    video: HTMLVideoElement,
    onSign: (guesses: Guess[]) => void,
    onState?: (s: { hands: boolean; recording: boolean }) => void,
    { maxFps = 60, onSegment, onFrame }: { maxFps?: number; onSegment?: (s: Segment) => void; onFrame?: (pts: Pt[], hands: number, pose: boolean) => void } = {},
  ) {
    this.onSegment = onSegment
    this.onFrame = onFrame
    this.video = video
    this.onSign = onSign
    this.onState = onState
    this.minGap = 1000 / maxFps - 2
  }

  async start() {
    const r = await loadSignReader()
    const tick = () => {
      if (this.stopped) return
      if (this.video.readyState >= 2) {
        const now = performance.now()
        if (now - this.lastT >= this.minGap) {
          this.lastT = now
          const hr = r.hands.detectForVideo(this.video, now)
          const pr = r.pose.detectForVideo(this.video, now)
          const pose = pr.landmarks[0] ? pr.landmarks[0].slice(0, 25).map((p) => [p.x, p.y] as Pt) : null
          const hands = hr.landmarks.map((h) => h.map((p) => [p.x, p.y] as Pt))
          const [h1, h2] = assign(hands, pose)
          const pts = [...(pose ?? Array(25).fill(NAN)), ...(h1 ?? Array(21).fill(NAN)), ...(h2 ?? Array(21).fill(NAN))] as Pt[]
          this.onFrame?.(pts, hands.length, !!pose)
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
      // Hands that stay in view but stop moving also end a sign (laptop cameras often keep resting hands in the
      // picture, which made every attempt run to the 6 s limit and mix signing with resting).
      const still = f.t - this.frames[0].t > 1200 && this.stillFor(f.t) > 900
      if (quiet || tooLong || still) {
        const sign = this.frames
        this.frames = []
        this.recording = false
        const long = sign[sign.length - 1].t - sign[0].t
        if (sign.length >= 10 && long >= 700) void this.read(sign)
        // Too short to be a sign: the Sign lab still wants to know it happened.
        else this.onSegment?.({ frames: sign, guesses: [], aspect: this.aspect(), skipped: `too short (${(long / 1000).toFixed(1)} s)` })
      }
    }
    this.onState?.({ hands: hasHands, recording: this.recording })
  }

  /** How long (ms) both wrists have stayed within a small distance, relative to the shoulder width. */
  private stillFor(now: number) {
    const fr = this.frames
    const last = fr[fr.length - 1].pts
    const l = last[11], r = last[12]
    const span = Number.isFinite(l[0]) && Number.isFinite(r[0]) ? Math.max(0.08, Math.abs(l[0] - r[0])) : 0.25
    for (let i = fr.length - 2; i >= 0; i--) {
      const moved = [H1, H2].some((h) => {
        const a = fr[i].pts[h], b = last[h]
        return Number.isFinite(a[0]) !== Number.isFinite(b[0]) || (Number.isFinite(a[0]) && Math.hypot(a[0] - b[0], a[1] - b[1]) > 0.12 * span)
      })
      if (moved) return now - fr[i + 1].t
    }
    return now - fr[0].t
  }

  private aspect() {
    return this.video.videoWidth && this.video.videoHeight ? this.video.videoWidth / this.video.videoHeight : 4 / 3
  }

  private async read(frames: Frame[]) {
    const aspect = this.video.videoWidth && this.video.videoHeight ? this.video.videoWidth / this.video.videoHeight : 4 / 3
    const guesses = await classify(frames, aspect)
    this.onSign(guesses)
    this.onSegment?.({ frames, guesses, aspect })
  }
}

/** A framing tip for signing from the body points, or '' when the picture is fine. */
export function framingHint(pts: Pt[], pose: boolean): string {
  if (!pose) return 'Make sure your head and shoulders are in the picture.'
  const [l, r] = [pts[11], pts[12]]
  if (Number.isFinite(l[0]) && Number.isFinite(r[0])) {
    const span = Math.abs(l[0] - r[0])
    const y = (l[1] + r[1]) / 2
    if (y > 0.62) return 'Tilt the screen back or sit up: your shoulders are near the bottom, so your hands leave the picture. Show your chest too.'
    if (span > 0.45) return 'Move back a little: your shoulders fill most of the picture, so your hands go out of view.'
    if (span < 0.15) return 'Come a bit closer: you look small in the picture.'
  }
  if (pts.slice(25).some(([x, y]) => Number.isFinite(x) && (x < 0.02 || x > 0.98 || y < 0.02 || y > 0.98))) return 'A hand is at the edge of the picture.'
  return ''
}

/**
 * Raw points for v4 models, which do all their own preparation inside the model file (ml/train_v4.py featurize),
 * so the app and training can't prepare points differently. Here: even 30 fps timing (nearest frame, "not seen"
 * stays NaN), drop hand-less frames at the start/end like trim_handless(), at most 192 frames like cap().
 */
const RAW_FPS = 30
const RAW_MAX = 192
const H1 = 25
const H2 = 46
export function rawPoints(frames: Frame[]): { data: Float32Array; n: number } {
  const t0 = frames[0].t
  let rows: Pt[][] = []
  const n0 = Math.max(1, Math.round(((frames[frames.length - 1].t - t0) / 1000) * RAW_FPS) + 1)
  for (let i = 0, j = 0; i < n0; i++) {
    const t = t0 + (i * 1000) / RAW_FPS
    while (j < frames.length - 1 && Math.abs(frames[j + 1].t - t) <= Math.abs(frames[j].t - t)) j++
    rows.push(frames[j].pts)
  }
  const seen = rows.map((r) => Number.isFinite(r[H1][0]) || Number.isFinite(r[H2][0]))
  const first = seen.indexOf(true)
  const last = seen.lastIndexOf(true)
  if (first >= 0) {
    const lo = Math.max(0, first - 2)
    const hi = Math.min(rows.length, last + 3)
    if (hi - lo >= 8) rows = rows.slice(lo, hi)
  }
  if (rows.length > RAW_MAX) rows = Array.from({ length: RAW_MAX }, (_, i) => rows[Math.round((i * (rows.length - 1)) / (RAW_MAX - 1))])
  const data = new Float32Array(rows.length * POINTS * 2)
  rows.forEach((r, i) => r.forEach(([x, y], p) => { data[(i * POINTS + p) * 2] = x; data[(i * POINTS + p) * 2 + 1] = y }))
  return { data, n: rows.length }
}

/** Word probabilities from either model generation, indexed like isl_labels.json. */
async function wordProbs(r: Awaited<ReturnType<typeof loadSignReader>>, frames: Frame[], aspect: number): Promise<Float32Array> {
  if (r.model.inputNames.includes('points')) {
    const { data, n } = rawPoints(frames)
    const out = await r.model.run({
      points: new r.ort.Tensor('float32', data, [1, n, POINTS, 2]) as Tensor,
      aspect: new r.ort.Tensor('float32', new Float32Array([aspect]), [1]) as Tensor,
    })
    return out.probs.data as Float32Array
  }
  const out = await r.model.run({ keypoints: new r.ort.Tensor('float32', prepare(frames, aspect), [1, MAX_FRAMES, 134]) as Tensor })
  const logits = out.logits.data as Float32Array
  const max = Math.max(...logits)
  const e = logits.map((v) => Math.exp(v - max))
  const sum = e.reduce((a, b) => a + b, 0)
  return e.map((v) => v / sum)
}

/** Best 3 guesses for one recorded sign. */
export async function classify(frames: Frame[], aspect: number): Promise<Guess[]> {
  const r = await loadSignReader()
  const probs = await wordProbs(r, frames, aspect)
  const ids = [...r.allowed]
  const exp = ids.map((i) => [i, probs[i]] as const)
  const sum = exp.reduce((s, [, e]) => s + e, 0) || 1
  // Weigh by how likely each word is in a chat (greetings far more than "orange"), then renormalise.
  const weighted = exp.map(([i, e]) => ({ word: r.labels[i], score: (e / sum) * prior(r.labels[i]) }))
  const total = weighted.reduce((t, w) => t + w.score, 0) || 1
  return weighted
    .map((w) => ({ ...w, score: w.score / total }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
}

/** How likely a word is in a chat: greetings far more than colours or animals. Plus a boost for words that fit this moment. */
// Mild on purpose: with the v4 model a strong boost turned "good" into "good afternoon" (browser test, Nov 18).
const CAT: Record<string, number> = { Greetings: 1.2, Pronouns: 1.15, 'Days and Time': 1.05, People: 1.05, Adjectives: 1, Society: 1, Home: 0.95, Places: 0.95, Jobs: 0.85, 'Means of Transportation': 0.85, Clothes: 0.75, Electronics: 0.75, Seasons: 0.75, Colours: 0.7, Animals: 0.7 }
let cats = new Map<string, string>()
void import('./signs').then(({ loadSigns }) => loadSigns()).then((ws) => { cats = new Map(ws.map((w) => [w.id, w.category])) }).catch(() => {})
let boost = new Set<string>()
// Off: with the v4 model this weighting made no measurable difference in the browser test (84-89% either way)
// and the jury may try any word, not only greetings. The in-conversation boost stays.
let catOn = false
const prior = (id: string) => (catOn ? CAT[cats.get(id) ?? ''] ?? 1 : 1) * (boost.has(id) ? 2 : 1)
/** Turn the chat-word weighting on or off (tests compare both). */
export function setCategoryWeights(on: boolean) { catOn = on }
export function setSignBoost(ids: string[]) { boost = new Set(ids) }

/** Turns signed words (ISL word order, no small words) into a readable sentence. */
export function glossToSentence(words: string[]) {
  const s = words.join(' ').replace(/\s+/g, ' ').trim()
  return s ? s.charAt(0).toUpperCase() + s.slice(1) + '.' : ''
}

/** Sure enough to use a sign without asking: at least 50% and twice the next guess.
 *  Browser test (Nov 18, 256 readings): 91% of signs used straight away, 1.3% of those wrong. */
export const isSure = (g: Guess[]) => !!g[0] && g[0].score >= 0.5 && (!g[1] || g[0].score >= g[1].score * 2)

/** One attempt the reader saw: its points, what it read, and why it was skipped (if it was). For the Sign lab. */
export type Segment = { frames: Frame[]; guesses: Guess[]; aspect: number; skipped?: string }

/** The model's own top guesses, before any chat weighting, for the Sign lab. */
export async function topWords(frames: Frame[], aspect: number, k = 10): Promise<Guess[]> {
  const r = await loadSignReader()
  const probs = await wordProbs(r, frames, aspect)
  const ids = [...r.allowed]
  const sum = ids.reduce((t, i) => t + probs[i], 0) || 1
  return ids
    .map((i) => ({ word: r.labels[i], score: probs[i] / sum }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
}
