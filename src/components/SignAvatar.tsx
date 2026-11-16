import { useEffect, useRef } from 'react'

/**
 * Draws a sign as a moving figure: head, shoulders, arms and both hands with fingers.
 * Each word is a tiny file of body points (about 10 KB), no video.
 * File format (public/signs/<id>.json): { fps, frames: string } where frames is base64 of
 * bytes [x, y] per point per frame (0-255 across the drawing area), 255,255 = not seen.
 */
export interface SignAnim {
  fps: number
  points: number
  frames: Uint8Array
}

const cache = new Map<string, Promise<SignAnim | null>>()
export function loadAnim(id: string) {
  if (!cache.has(id))
    cache.set(
      id,
      fetch(`/signs/${id}.json`)
        .then((r) => (r.ok ? r.json() : null))
        .then((j: { fps: number; points: number; frames: string } | null) =>
          j ? { fps: j.fps, points: j.points, frames: Uint8Array.from(atob(j.frames), (c) => c.charCodeAt(0)) } : null,
        )
        .catch(() => null),
    )
  return cache.get(id)!
}

// Point numbers: 0-24 body (MediaPipe pose), 25-45 first hand, 46-66 second hand.
const BODY: [number, number][] = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24]]
const HAND: [number, number][] = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12], [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [0, 17], [17, 18], [18, 19], [19, 20]]

export default function SignAvatar({ ids, onDone, loop = false, speed = 1, className }: { ids: string[]; onDone?: () => void; loop?: boolean; speed?: number; className?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    let raf = 0
    let alive = true
    ;(async () => {
      const anims = (await Promise.all(ids.map(loadAnim))).filter((a): a is SignAnim => !!a)
      if (!alive || !anims.length || !canvas.current) return
      const c = canvas.current
      const ctx = c.getContext('2d')!
      const css = getComputedStyle(c)
      const ink = css.getPropertyValue('--sign-ink').trim() || '#22305E'
      const hand = css.getPropertyValue('--sign-hand').trim() || '#D7322A'
      let which = 0
      let start = performance.now()
      const draw = (now: number) => {
        if (!alive) return
        const a = anims[which]
        const n = a.frames.length / (a.points * 2)
        const f = Math.floor(((now - start) / 1000) * a.fps * speed)
        if (f >= n) {
          if (which < anims.length - 1 || loop) {
            which = (which + 1) % anims.length
            start = now
          } else {
            onDone?.()
            return
          }
        }
        const k = Math.min(f, n - 1)
        const W = c.width
        const H = c.height
        const pt = (p: number): [number, number] | null => {
          const x = a.frames[(k * a.points + p) * 2]
          const y = a.frames[(k * a.points + p) * 2 + 1]
          return x === 255 && y === 255 ? null : [(x / 254) * W, (y / 254) * H]
        }
        ctx.clearRect(0, 0, W, H)
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
        const line = (p: number, q: number, w: number, color: string) => {
          const A = pt(p)
          const B = pt(q)
          if (!A || !B) return
          ctx.strokeStyle = color
          ctx.lineWidth = w
          ctx.beginPath()
          ctx.moveTo(A[0], A[1])
          ctx.lineTo(B[0], B[1])
          ctx.stroke()
        }
        // Head: a circle around the nose, sized from the shoulders.
        const nose = pt(0)
        const ls = pt(11)
        const rs = pt(12)
        if (nose && ls && rs) {
          const r = Math.hypot(ls[0] - rs[0], ls[1] - rs[1]) * 0.32
          ctx.fillStyle = ink
          ctx.globalAlpha = 0.12
          ctx.beginPath()
          ctx.arc(nose[0], nose[1] - r * 0.15, r, 0, Math.PI * 2)
          ctx.fill()
          ctx.globalAlpha = 1
          ctx.strokeStyle = ink
          ctx.lineWidth = W * 0.012
          ctx.stroke()
        }
        BODY.forEach(([p, q]) => line(p, q, W * 0.035, ink))
        for (const base of [25, 46]) HAND.forEach(([p, q]) => line(base + p, base + q, W * 0.014, hand))
        raf = requestAnimationFrame(draw)
      }
      raf = requestAnimationFrame(draw)
    })()
    return () => {
      alive = false
      cancelAnimationFrame(raf)
    }
  }, [ids.join(','), loop, speed])

  return <canvas ref={canvas} width={300} height={300} className={className ?? 'sign-avatar'} aria-hidden="true" />
}
