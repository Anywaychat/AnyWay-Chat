import { useState } from 'react'
import { FROM_DOTS, key, toBraille } from '../braille'

/** Six braille dot keys (laid out like a braille cell) that type letters into a text. */
export default function BrailleKeys({ onText }: { onText: (update: (t: string) => string) => void }) {
  const [dots, setDots] = useState<number[]>([])
  const toggle = (d: number) => setDots((s) => (s.includes(d) ? s.filter((x) => x !== d) : [...s, d]))
  const add = () => {
    const ch = FROM_DOTS[key(dots)]
    if (ch) onText((t) => t + ch)
    setDots([])
  }
  return (
    <div className="braille-pad">
      <div className="braille" role="group" aria-label="Braille keys">
        {[1, 4, 2, 5, 3, 6].map((d) => (
          <button key={d} type="button" aria-pressed={dots.includes(d)} aria-label={`Dot ${d}`} onClick={() => toggle(d)}>{d}</button>
        ))}
      </div>
      <div className="grid-3">
        <button type="button" className="btn" onClick={add} disabled={!dots.length}>Add letter {dots.length ? toBraille(FROM_DOTS[key(dots)] ?? '') : ''}</button>
        <button type="button" className="btn" onClick={() => onText((t) => t + ' ')}>Space</button>
        <button type="button" className="btn" onClick={() => onText((t) => t.slice(0, -1))}>Delete</button>
      </div>
    </div>
  )
}
