import { useEffect, useRef, useState } from 'react'
import SignAvatar from './SignAvatar'

/** A small still picture of a sign, drawn only once it scrolls into view. */
export default function SignThumb({ id }: { id: string }) {
  const box = useRef<HTMLSpanElement>(null)
  const [seen, setSeen] = useState(false)
  useEffect(() => {
    const el = box.current
    if (!el || seen) return
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && setSeen(true), { rootMargin: '120px' })
    io.observe(el)
    return () => io.disconnect()
  }, [seen])
  return <span ref={box} className="sign-thumb">{seen && <SignAvatar ids={[id]} still className="sign-thumb-canvas" />}</span>
}
