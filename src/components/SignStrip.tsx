import { useEffect, useState } from 'react'
import { Play } from 'lucide-react'
import { loadSigns, toSigns, type Piece } from '../signs'
import SignClip from './SignClip'

/** Shows a message in Indian Sign Language: the sign clips play one after another, words without a sign stay as text. */
export default function SignStrip({ text, autoPlay = false }: { text: string; autoPlay?: boolean }) {
  const [pieces, setPieces] = useState<Piece[] | null>(null)
  const [at, setAt] = useState(-1)
  // Finished signing: the last sign stays on screen (paused) instead of closing, with "Sign again".
  const [done, setDone] = useState(false)
  // Same word tapped again (or "Sign again" on a one-sign message): remount the clip so it replays.
  const [round, setRound] = useState(0)

  useEffect(() => {
    let alive = true
    void loadSigns().then((w) => alive && setPieces(toSigns(text, w)))
    return () => {
      alive = false
    }
  }, [text])

  const signs = (pieces ?? []).flatMap((p, i) => (p.kind === 'sign' ? [i] : []))
  // The newest message signs itself as soon as it's seen; older ones wait for a tap.
  const first = signs[0] ?? -1
  useEffect(() => {
    if (autoPlay && first >= 0) {
      setDone(false)
      setAt(first)
    }
  }, [autoPlay, first, text])
  if (!pieces || !signs.length) return null
  const next = () => {
    const k = signs.indexOf(at)
    if (k >= 0 && k < signs.length - 1) setAt(signs[k + 1])
    else setDone(true)
  }
  const play = (i: number) => {
    setDone(false)
    setAt(i)
  }
  const replay = (i: number) => {
    play(i)
    setRound((r) => r + 1)
  }

  return (
    <div className="sign-strip">
      {at >= 0 && (
        <button className="sign-stage" onClick={() => replay(signs[0])} aria-label="Sign the message again">
          {pieces[at].kind === 'sign' && <SignClip key={`${at}-${round}`} ids={[pieces[at].word.id]} onDone={next} />}
        </button>
      )}
      {(at < 0 || done) && (
        <button className="sign-play" onClick={() => replay(signs[0])}><Play size={14} aria-hidden="true" />{at < 0 && !autoPlay ? 'Show in sign' : 'Sign again'}</button>
      )}
      <div className="sign-words">
        {pieces.map((p, i) =>
          p.kind === 'sign' ? (
            <button key={i} className={`sign-word${i === at ? ' on' : ''}`} onClick={() => replay(i)}>{p.said.trim()}</button>
          ) : p.text.trim() ? (
            <span key={i} className="sign-text">{p.text.trim()}</span>
          ) : null,
        )}
      </div>
    </div>
  )
}
