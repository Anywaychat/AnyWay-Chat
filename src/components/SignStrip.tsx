import { useEffect, useRef, useState } from 'react'
import { Play } from 'lucide-react'
import { clipUrl, loadSigns, toSigns, type Piece } from '../signs'

/** Shows a message in Indian Sign Language: the sign clips play one after another, words without a sign stay as text. */
export default function SignStrip({ text }: { text: string }) {
  const [pieces, setPieces] = useState<Piece[] | null>(null)
  const [at, setAt] = useState(-1)
  const video = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    let alive = true
    void loadSigns().then((w) => alive && setPieces(toSigns(text, w)))
    return () => {
      alive = false
    }
  }, [text])

  const signs = (pieces ?? []).flatMap((p, i) => (p.kind === 'sign' ? [i] : []))
  useEffect(() => {
    if (at < 0 || !video.current || pieces?.[at]?.kind !== 'sign') return
    const p = pieces[at]
    video.current.src = clipUrl(p.word.id)
    void video.current.play().catch(() => {})
  }, [at, pieces])

  if (!pieces || !signs.length) return null
  const next = () => {
    const k = signs.indexOf(at)
    setAt(k >= 0 && k < signs.length - 1 ? signs[k + 1] : -1)
  }

  return (
    <div className="sign-strip">
      {at >= 0 ? (
        <video ref={video} className="sign-clip-video" muted playsInline onEnded={next} onClick={() => setAt(-1)} aria-label={`Sign for ${pieces[at].kind === 'sign' ? pieces[at].word.name : ''}`} />
      ) : (
        <button className="sign-play" onClick={() => setAt(signs[0])}><Play size={14} aria-hidden="true" />Show in sign</button>
      )}
      <div className="sign-words">
        {pieces.map((p, i) =>
          p.kind === 'sign' ? (
            <button key={i} className={`sign-word${i === at ? ' on' : ''}`} onClick={() => setAt(i)}>{p.said.trim()}</button>
          ) : p.text.trim() ? (
            <span key={i} className="sign-text">{p.text.trim()}</span>
          ) : null,
        )}
      </div>
    </div>
  )
}
