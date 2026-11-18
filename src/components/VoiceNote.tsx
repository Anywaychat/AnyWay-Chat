import { useEffect, useState } from 'react'
import { Captions } from 'lucide-react'
import { transcribe } from '../transcribe'

/** A voice message with its words written out, made on this device. Shown automatically for deaf users. */
export default function VoiceNote({ src, auto, label }: { src: string; auto: boolean; label?: string }) {
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'fail'>('idle')
  const [text, setText] = useState('')
  const run = () => {
    setState('busy')
    transcribe(src).then((t) => { setText(t || '(no words heard)'); setState('done') }).catch(() => setState('fail'))
  }
  useEffect(() => { if (auto && src) run() }, [auto, src]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="vnote">
      <audio className="voice" controls preload="metadata" src={src} aria-label={label ?? 'Voice message'} />
      {state === 'idle' && <button type="button" className="link-btn" onClick={run}><Captions size={14} aria-hidden="true" /> Show words</button>}
      {state === 'busy' && <p className="vnote-text muted" role="status">Writing out the words…</p>}
      {state === 'done' && <p className="vnote-text" dir="auto">“{text}”</p>}
      {state === 'fail' && <button type="button" className="link-btn" onClick={run}>Couldn't write it out. Try again</button>}
    </div>
  )
}
