import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Search, Turtle } from 'lucide-react'
import { clipUrl, loadSigns, type SignWord } from '../signs'

/** Common Indian Sign Language words, grouped, each with a real signer's video. */
export default function SignDictionary() {
  const nav = useNavigate()
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
    <div className="screen">
      <header className="topbar">
        <button className="icon-btn back-btn" style={{ display: 'grid' }} aria-label="Back" onClick={() => nav(-1)}><ArrowLeft size={20} aria-hidden="true" /></button>
        <div className="topbar-title"><strong>Sign dictionary</strong><span>Indian Sign Language · {words.length} words</span></div>
      </header>
      <div className="scroll">
        <div className="section dict">
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
              <video key={open.id + slow} src={clipUrl(open.id)} autoPlay loop muted playsInline ref={(v) => { if (v) v.playbackRate = slow ? 0.5 : 1 }} aria-label={`Sign for ${open.name}`} />
              <div className="row-between">
                <strong>{open.name}</strong>
                <button className="chip-btn" aria-pressed={slow} onClick={() => setSlow(!slow)}><Turtle size={14} aria-hidden="true" /> Slow</button>
              </div>
            </div>
          )}

          {words.length === 0 ? (
            <p className="muted">Sign videos are still being prepared.</p>
          ) : shown.length === 0 ? (
            <p className="muted">No sign for “{q}” yet.</p>
          ) : (
            <div className="dict-grid">
              {shown.map((w) => (
                <button key={w.id} className={`dict-word${open?.id === w.id ? ' on' : ''}`} onClick={() => setOpen(w)}>{w.name}</button>
              ))}
            </div>
          )}
          <p className="hint" style={{ textAlign: 'left' }}>Signs from the INCLUDE dataset by AI4Bharat (CC BY 4.0), signed by Deaf signers in Chennai.</p>
        </div>
      </div>
    </div>
  )
}
