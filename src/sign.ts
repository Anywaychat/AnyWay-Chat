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
export type Guess = { word: string; score: number; mine?: boolean }

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
    // The first reading of each kind builds its GPU programs, which holds up the page for about 0.3 s each.
    // Doing it here with a blank picture (on the chat list, before any camera) lets a chat's camera start smoothly.
    try {
      const blank = document.createElement('canvas')
      blank.width = 640
      blank.height = 480
      blank.getContext('2d')?.fillRect(0, 0, 640, 480)
      const t = performance.now()
      hands.detectForVideo(blank, t)
      await new Promise((ok) => setTimeout(ok, 60))
      pose.detectForVideo(blank, t + 1)
      await new Promise((ok) => setTimeout(ok, 60))
      if (model.inputNames.includes('points'))
        await model.run({ points: new ort.Tensor('float32', new Float32Array(16 * POINTS * 2).fill(0.5), [1, 16, POINTS, 2]), aspect: new ort.Tensor('float32', new Float32Array([4 / 3]), [1]) })
    } catch {
      /* a warm-up that fails changes nothing */
    }
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
      // Start only when the hands move: hands resting in view (common at a laptop) no longer start a reading.
      // Keep ~half a second before the movement so the start of the sign isn't cut off.
      this.frames = this.frames.slice(-15)
      if (this.seen >= 5 && this.moving()) this.recording = true
    } else {
      // A sign ends when the hands are down for a full second (short flickers no longer split one sign into many).
      // (Ending a sign when the hands merely go still was tried and removed, Nov 18: people hold a sign for a moment,
      // so it cut signs in half and read the hands going down as a second word; wrong reads doubled in a replay.)
      const quiet = f.t - this.lastHands > 1000
      const tooLong = f.t - this.frames[0].t > 6000
      if (quiet || tooLong) {
        const sign = this.frames
        this.frames = []
        this.recording = false
        const long = sign[sign.length - 1].t - sign[0].t
        if (sign.length >= 10 && long >= 700) void this.read(sign, tooLong)
        // Too short to be a sign: the Sign lab still wants to know it happened.
        else this.onSegment?.({ frames: sign, guesses: [], aspect: this.aspect(), skipped: `too short (${(long / 1000).toFixed(1)} s)` })
      }
    }
    this.onState?.({ hands: hasHands, recording: this.recording })
  }

  /** Did a hand move clearly (over a fifth of a shoulder width) in the last few frames, or just come into view? */
  private moving() {
    const fr = this.frames.slice(-8)
    const last = fr[fr.length - 1].pts
    const l = last[11], r = last[12]
    const span = Number.isFinite(l[0]) && Number.isFinite(r[0]) ? Math.max(0.08, Math.abs(l[0] - r[0])) : 0.25
    return fr.slice(0, -1).some((f) =>
      [H1, H1 + 8, H2, H2 + 8].some((k) => {
        const a = f.pts[k], b = last[k]
        if (!Number.isFinite(b[0])) return false
        if (!Number.isFinite(a[0])) return true
        return Math.hypot(a[0] - b[0], a[1] - b[1]) > 0.2 * span
      }),
    )
  }

  private aspect() {
    return this.video.videoWidth && this.video.videoHeight ? this.video.videoWidth / this.video.videoHeight : 4 / 3
  }

  private async read(frames: Frame[], capped = false) {
    const aspect = this.aspect()
    const r = await loadSignReader()
    const probs = await wordProbs(r, frames, aspect)
    const ids = [...r.allowed]
    const guesses = readGuesses(probs, r.labels, ids, mineFor(r.labels, ids))
    this.onSign(guesses)
    this.onSegment?.({ frames, guesses, aspect, vector: signVector(probs, ids), ...(capped ? { capped } : {}) })
  }
}

/** A framing tip for signing, or '' when the picture is fine. Distances are in shoulder widths, so a tall phone
 *  picture and a wide laptop one are judged the same way. Measured on Sign lab attempts (Nov 18): the recorded test
 *  signer (read right 95%) has 1.6 shoulder widths of picture under the shoulders; at a laptop, 0.3-0.9, and the
 *  hands left the bottom of the picture while signing. */
export function framingHint(pts: Pt[], pose: boolean, aspect: number): string {
  if (!pose) return 'Make sure your head and shoulders are in the picture.'
  const [l, r] = [pts[11], pts[12]]
  if (Number.isFinite(l[0]) && Number.isFinite(r[0])) {
    const w = Math.abs(l[0] - r[0]) * aspect // shoulder width, in picture heights
    const y = (l[1] + r[1]) / 2
    const nose = pts[0]
    if (w > 0.65) return 'Move back a little: you are very close, so your hands go out of the picture.'
    if ((1 - y) / w < 0.9) return 'Sit back a little, or tilt the screen toward you, so your chest is in the picture. Now your hands leave it when you sign.'
    if (Number.isFinite(nose[1]) && nose[1] / w < 0.35) return 'Tilt the screen back a little: your head is at the top edge.'
    if (w < 0.12) return 'Come a bit closer: you look small in the picture.'
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
  return readGuesses(probs, r.labels, ids, mineFor(r.labels, ids))
}

/** The model's word probabilities -> best 3 guesses: weighted by how likely each word is in this chat, then, when the
 *  model is unsure, matched against the signs this person taught (see "Your own signs" below). */
export function readGuesses(probs: ArrayLike<number>, labels: string[], ids: number[], mine: MineWords | null, pri: (id: string) => number = prior): Guess[] {
  const sum = ids.reduce((s, i) => s + probs[i], 0) || 1
  // Weigh by how likely each word is in a chat (greetings far more than "orange"), then renormalise.
  const weighted = ids.map((i) => ({ word: labels[i], score: (probs[i] / sum) * pri(labels[i]) }))
  const total = weighted.reduce((t, w) => t + w.score, 0) || 1
  let out: Guess[] = weighted.map((w) => ({ ...w, score: w.score / total })).sort((a, b) => b.score - a.score)
  if (mine && out[0].score < MINE_MODEL_UNSURE) {
    const m = matchMine(signVector(probs, ids), mine)
    if (m && m.sim >= MINE_MIN_SIM) {
      // Close to one of your own examples: that word goes first. Clearly closer than any other taught word = used
      // straight away; two taught words about as close (a person's "good" and "nice" can look alike) = "Did you sign…?"
      // with both.
      const sure = m.sim - m.next >= MINE_SURE_LEAD
      const first: Guess[] = [{ word: m.word, score: sure ? Math.min(0.9, 0.5 + (m.sim - MINE_MIN_SIM) * 1.5) : 0.4, mine: true }]
      if (!sure && m.second) first.push({ word: m.second, score: 0.25, mine: true })
      const taken = new Set(first.map((g) => g.word))
      const had = out.filter((g) => taken.has(g.word)).reduce((t, g) => t + g.score, 0)
      const left = 1 - first.reduce((t, g) => t + g.score, 0)
      out = [...first, ...out.filter((g) => !taken.has(g.word)).map((g) => ({ ...g, score: (g.score * left) / (1 - had || 1) }))]
    }
  }
  return out.slice(0, 3)
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
export type Segment = { frames: Frame[]; guesses: Guess[]; aspect: number; skipped?: string; vector?: number[]; capped?: boolean }

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

/* ---------- Your own signs ----------
 * People sign differently from the signers the model learned from: slower, with holds, regional variants, a laptop
 * camera. So the reader can learn your way: in the Sign lab, sign a word a few times; each attempt's word
 * probabilities (not the video) are kept on this device. When the model is unsure (under 50%), an attempt that
 * closely matches one of your examples is read as that word.
 * Replay of 34 saved attempts (Nov 18, examples from other attempts only): taught words read right 6/23 -> 11/23,
 * words not taught never changed; wrong words used without asking: see MINE_SURE_LEAD. The probabilities say which signs an attempt resembles, even when the top one is
 * wrong, so the same person's same sign gives a similar pattern. */
export type MineWords = Record<string, { id: string; v: number[] }[]>
const MINE_KEY = 'anyway.mysigns.v1'
const MINE_PER_WORD = 5
const MINE_MODEL_UNSURE = 0.5
const MINE_MIN_SIM = 0.7
// Replay: right matches led the next taught word by 0.28-0.56, wrong ones mostly by 0.05-0.17.
const MINE_SURE_LEAD = 0.2

/** An attempt's fingerprint: the log of each word's probability, centred. */
export function signVector(probs: ArrayLike<number>, ids: number[]): number[] {
  const sum = ids.reduce((t, i) => t + probs[i], 0) || 1
  const v = ids.map((i) => Math.log(probs[i] / sum + 1e-4))
  const mu = v.reduce((a, b) => a + b, 0) / v.length
  return v.map((x) => Math.round((x - mu) * 100) / 100)
}

function cosine(a: number[], b: number[]) {
  let d = 0, x = 0, y = 0
  for (let i = 0; i < a.length && i < b.length; i++) { d += a[i] * b[i]; x += a[i] * a[i]; y += b[i] * b[i] }
  return d / Math.sqrt(x * y + 1e-12)
}

/** The taught word whose closest example is closest to this attempt. */
export function matchMine(v: number[], mine: MineWords): { word: string; sim: number; second?: string; next: number } | null {
  const best = Object.entries(mine)
    .map(([word, ex]) => ({ word, sim: Math.max(-1, ...ex.map((e) => cosine(v, e.v))) }))
    .filter((b) => b.sim > -1)
    .sort((a, b) => b.sim - a.sim)
  return best[0] ? { word: best[0].word, sim: best[0].sim, second: best[1]?.word, next: best[1]?.sim ?? 0 } : null
}

type MineStore = { sig: string; words: MineWords }
const sigOf = (labels: string[], ids: number[]) => `${labels.length}:${ids.length}:${labels[0]}:${labels[labels.length - 1]}`
function loadMine(): MineStore | null {
  try {
    const raw = localStorage.getItem(MINE_KEY)
    return raw ? (JSON.parse(raw) as MineStore) : null
  } catch {
    return null
  }
}
function saveMine(m: MineStore) {
  try {
    localStorage.setItem(MINE_KEY, JSON.stringify(m))
  } catch {
    /* storage full or blocked: teaching just doesn't stick */
  }
  mineListeners.forEach((f) => f())
}
const mineListeners = new Set<() => void>()
export function onMySignsChange(f: () => void) {
  mineListeners.add(f)
  return () => void mineListeners.delete(f)
}
/** Examples made for this model (examples from an older model don't match a newer one, so they're ignored). */
function mineFor(labels: string[], ids: number[]): MineWords | null {
  const m = loadMine()
  return m && m.sig === sigOf(labels, ids) && Object.keys(m.words).length ? m.words : null
}

/** Keeps one attempt as an example of `word` (the newest 5 per word). Returns how many that word has now. */
export async function teachSign(word: string, id: string, vector: number[]): Promise<number> {
  const r = await loadSignReader()
  const sig = sigOf(r.labels, [...r.allowed])
  const m = loadMine()
  const store: MineStore = m && m.sig === sig ? m : { sig, words: {} }
  const list = [...(store.words[word] ?? []).filter((e) => e.id !== id), { id, v: vector }].slice(-MINE_PER_WORD)
  store.words[word] = list
  saveMine(store)
  return list.length
}

/** Removes one example (undo), or every example of a word, or (no arguments) all of them. */
export function forgetSign(word?: string, id?: string) {
  const m = loadMine()
  if (!m) return
  if (!word) m.words = {}
  else if (id) {
    m.words[word] = (m.words[word] ?? []).filter((e) => e.id !== id)
    if (!m.words[word].length) delete m.words[word]
  } else delete m.words[word]
  saveMine(m)
}

/** Taught words and how many examples each has. */
export function mySigns(): Record<string, number> {
  const m = loadMine()
  return m ? Object.fromEntries(Object.entries(m.words).map(([w, ex]) => [w, ex.length])) : {}
}
