import { useEffect, useMemo, useState } from 'react'
import { Plus, Search, Turtle } from 'lucide-react'
import { loadSigns, type SignWord } from '../signs'
import SignAvatar from './SignAvatar'

/** Everyday ISL words by category: tap one to see its sign; with onPick, "Add" puts it in your message. */
export default function SignWordPicker({ onPick, compact = false }: { onPick?: (w: SignWord) => void; compact?: boolean }) {
  const [words, setWords] = useState<SignWord[]>([])
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('All')
  const [open, setOpen] = useState<SignWord | null>(null)
  const [slow, setSlow] = useState(false)

  useEffect(() => {
    void loadSigns().then((w) => setWords(w.filter((x) => x.clip)))
  }, [])

  const cats = useMemo(() => ['All', ...new Set(words.map((w) => w.category))], [words])
  const shown = words.filter((w) => (cat === 'All' || w.category === cat) && w.name.toLowerCase().includes(q.trim().toLowerCase()))

  return (
    <div className={`dict${compact ? ' compact' : ''}`}>
      <label className="search">
        <Search size={16} aria-hidden="true" />
        <input placeholder="Find a word, like “thank you”" aria-label="Find a word" value={q} onChange={(e) => setQ(e.target.value)} />
      </label>
      <div className="cats" role="group" aria-label="Categories">
        {cats.map((c) => (
          <button key={c} className="chip-btn" aria-pressed={c === cat} onClick={() => setCat(c)}>{c}</button>
        ))}
      </div>

      {open && (
        <div className="dict-player">
          <div className={`sign-stage ${compact ? '' : 'big'}`} role="img" aria-label={`Sign for ${open.name}`}><SignAvatar ids={[open.id]} loop speed={slow ? 0.5 : 1} /></div>
          <div className="dict-player-side">
            <strong>{open.name}</strong>
            <button className="chip-btn" aria-pressed={slow} onClick={() => setSlow(!slow)}><Turtle size={14} aria-hidden="true" /> Slow</button>
            {onPick && <button className="btn primary" style={{ height: 38 }} onClick={() => { onPick(open); setOpen(null) }}><Plus size={16} aria-hidden="true" />Add</button>}
          </div>
        </div>
      )}

      {words.length === 0 ? (
        <p className="muted">Signs are still being prepared.</p>
      ) : shown.length === 0 ? (
        <p className="muted">No sign for “{q}” yet.</p>
      ) : (
        <div className="dict-grid">
          {shown.map((w) => (
            <button key={w.id} className={`dict-word${open?.id === w.id ? ' on' : ''}`} onClick={() => setOpen(w)}>{w.name}</button>
          ))}
        </div>
      )}
    </div>
  )
}
