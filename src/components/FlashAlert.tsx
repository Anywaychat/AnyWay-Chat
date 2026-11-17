import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MessageCircle, X } from 'lucide-react'

type Flash = { title: string; body: string; url: string | null; key: number }

/** On-screen alert for new messages: the screen edge glows and a banner shows who wrote, for people who can't hear a tone. */
export default function FlashAlert() {
  const [f, setF] = useState<Flash | null>(null)
  const nav = useNavigate()
  useEffect(() => {
    let t = 0
    const on = (e: Event) => {
      const d = (e as CustomEvent).detail
      setF({ ...d, key: Date.now() })
      clearTimeout(t)
      t = window.setTimeout(() => setF(null), 6000)
    }
    window.addEventListener('anyway:flash', on)
    return () => { window.removeEventListener('anyway:flash', on); clearTimeout(t) }
  }, [])
  if (!f) return null
  return (
    <>
      <div key={`e${f.key}`} className="flash-edge" aria-hidden="true" />
      {f.url && (
        <div key={f.key} className="flash-banner" role="status">
          <button className="flash-open" onClick={() => { nav(f.url!); setF(null) }}>
            <MessageCircle size={20} aria-hidden="true" />
            <span><strong>{f.title}</strong><span>{f.body}</span></span>
          </button>
          <button className="icon-btn" aria-label="Dismiss" onClick={() => setF(null)}><X size={18} aria-hidden="true" /></button>
        </div>
      )}
    </>
  )
}
