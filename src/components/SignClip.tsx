import { useEffect, useRef } from 'react'

/** A real Deaf signer showing one or more signs, one after another. Tiny silent clips (INCLUDE, CC BY 4.0). */
export default function SignClip({ ids, onDone, loop = false, slow = false, className }: { ids: string[]; onDone?: () => void; loop?: boolean; slow?: boolean; className?: string }) {
  const v = useRef<HTMLVideoElement>(null)
  const at = useRef(0)
  const key = ids.join(',')

  useEffect(() => {
    at.current = 0
    const el = v.current
    if (!el || !ids.length) return
    el.src = `/signs/${ids[0]}.mp4`
    el.playbackRate = slow ? 0.5 : 1
    void el.play().catch(() => {})
    // Fetch the next sign early so there's no gap between words.
    ids.slice(1).forEach((id) => {
      const l = document.createElement('link')
      l.rel = 'prefetch'
      l.href = `/signs/${id}.mp4`
      document.head.appendChild(l)
    })
  }, [key])

  useEffect(() => {
    if (v.current) v.current.playbackRate = slow ? 0.5 : 1
  }, [slow])

  const ended = () => {
    const el = v.current
    if (!el) return
    at.current++
    if (at.current >= ids.length) {
      if (!loop) return onDone?.()
      at.current = 0
    }
    el.src = `/signs/${ids[at.current]}.mp4`
    el.playbackRate = slow ? 0.5 : 1
    void el.play().catch(() => {})
  }

  return <video ref={v} className={className ?? 'sign-clip'} muted playsInline preload="auto" poster={ids[0] ? `/signs/${ids[0]}.jpg` : undefined} onEnded={ended} />
}
