import { useEffect, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { useAuth } from '../state'

type Tile = { text: string; icon: string }
// A picture symbol on every tile, like AAC boards, so phrases can be found without reading.
const BOARDS: Record<string, Tile[]> = {
  Everyday: [
    { text: 'Yes', icon: '👍' }, { text: 'No', icon: '👎' }, { text: 'Thank you', icon: '🙏' }, { text: 'Please wait', icon: '✋' },
    { text: 'I need help', icon: '🆘' }, { text: 'Please repeat', icon: '🔁' }, { text: 'I am coming', icon: '🚶' }, { text: 'See you soon', icon: '👋' },
  ],
  Feelings: [
    { text: 'I am happy', icon: '😊' }, { text: 'I am sad', icon: '😢' }, { text: 'I am tired', icon: '😴' }, { text: 'I am hungry', icon: '🍛' },
    { text: 'I am thirsty', icon: '🥤' }, { text: 'I am fine', icon: '🙂' }, { text: 'I love you', icon: '❤️' }, { text: 'I am angry', icon: '😠' },
  ],
  Health: [
    { text: 'I feel sick', icon: '🤒' }, { text: 'I have pain', icon: '🤕' }, { text: 'I need a doctor', icon: '🩺' }, { text: 'I need medicine', icon: '💊' },
    { text: 'Call my family', icon: '📞' }, { text: 'I need the toilet', icon: '🚻' }, { text: 'Emergency', icon: '🚨' }, { text: 'I am okay now', icon: '✅' },
  ],
  Shop: [
    { text: 'How much is this?', icon: '💰' }, { text: 'I want this', icon: '👉' }, { text: 'Too costly', icon: '💸' }, { text: 'Do you have change?', icon: '🪙' },
    { text: 'Can I pay by UPI?', icon: '📱' }, { text: 'One more please', icon: '➕' }, { text: 'Please pack it', icon: '🛍️' }, { text: 'Thank you, bye', icon: '👋' },
  ],
  Travel: [
    { text: 'Where is the bus stop?', icon: '🚌' }, { text: 'Take me here', icon: '📍' }, { text: 'Stop here please', icon: '🛑' }, { text: 'How far is it?', icon: '🧭' },
    { text: 'Which platform?', icon: '🚉' }, { text: 'I am lost', icon: '❓' }, { text: 'Call an auto', icon: '🛺' }, { text: 'I reached home', icon: '🏠' },
  ],
}
const ICONS = ['💬', '👍', '🙏', '❤️', '😊', '🍛', '🏠', '📞', '🚌', '💊', '🏫', '⏰', '👪', '🎉', '⚽', '📚']

/** Picture-based phrase board for people who can't speak: tap a tile and it's sent and said aloud. "Mine" holds saved phrases. */
export default function PhraseBoard({ onPick }: { onPick: (text: string) => void }) {
  const { api } = useAuth()
  const [cat, setCat] = useState('Everyday')
  const [mine, setMine] = useState<Tile[]>([])
  const [adding, setAdding] = useState(false)
  const [text, setText] = useState('')
  const [icon, setIcon] = useState('💬')
  const [err, setErr] = useState('')

  useEffect(() => {
    void api<{ phrases: Tile[] }>('/phrases').then((r) => setMine(r.phrases)).catch(() => {})
  }, [api])

  const save = async (list: Tile[]) => {
    setMine(list)
    try {
      const r = await api<{ phrases: Tile[] }>('/phrases', { method: 'POST', body: { phrases: list } })
      setMine(r.phrases)
      setErr('')
    } catch (e) {
      setErr((e as Error).message)
    }
  }

  const tiles = cat === 'Mine' ? mine : BOARDS[cat]
  return (
    <>
      <div className="mode-bar" role="tablist" aria-label="Phrase groups">
        {[...Object.keys(BOARDS), 'Mine'].map((k) => (
          <button key={k} role="tab" className="pill" aria-pressed={k === cat} onClick={() => { setCat(k); setAdding(false) }}>{k === 'Mine' ? `⭐ Mine${mine.length ? ` (${mine.length})` : ''}` : k}</button>
        ))}
      </div>
      <div className="phrases aac">
        {tiles.map((t, i) => (
          <div key={t.text + i} className="aac-cell">
            <button className={`tile${t.text === 'Emergency' ? ' alert' : ''}`} onClick={() => onPick(t.text)}>
              <span className="aac-icon" aria-hidden="true">{t.icon}</span>{t.text}
            </button>
            {cat === 'Mine' && <button className="aac-del" aria-label={`Remove ${t.text}`} onClick={() => void save(mine.filter((_, j) => j !== i))}><X size={14} aria-hidden="true" /></button>}
          </div>
        ))}
        {cat === 'Mine' && !adding && (
          <button className="tile aac-add" onClick={() => setAdding(true)}><Plus size={18} aria-hidden="true" />Add a phrase</button>
        )}
      </div>
      {cat === 'Mine' && mine.length === 0 && !adding && <p className="hint" style={{ margin: 0 }}>Save the things you say often, like your address or your family's names.</p>}
      {adding && (
        <form
          className="aac-form"
          onSubmit={(e) => {
            e.preventDefault()
            if (!text.trim()) return
            void save([...mine, { text: text.trim(), icon }])
            setText('')
            setIcon('💬')
            setAdding(false)
          }}
        >
          <div className="aac-icons" role="radiogroup" aria-label="Picture for this phrase">
            {ICONS.map((ic) => <button key={ic} type="button" role="radio" aria-checked={icon === ic} aria-label={`Picture ${ic}`} onClick={() => setIcon(ic)}>{ic}</button>)}
          </div>
          <div className="name-edit">
            <input className="input" autoFocus aria-label="New phrase" placeholder="For example: My name is Meera" value={text} onChange={(e) => setText(e.target.value)} maxLength={80} />
            <button className="btn primary" style={{ height: 40 }}>Save</button>
            <button type="button" className="btn" style={{ height: 40 }} onClick={() => setAdding(false)}>Cancel</button>
          </div>
        </form>
      )}
      {err && <p className="form-error" role="alert">{err}</p>}
    </>
  )
}
