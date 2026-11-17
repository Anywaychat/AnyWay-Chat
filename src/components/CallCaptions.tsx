import { useEffect, useRef, useState } from 'react'
import { Send } from 'lucide-react'
import { onCaption, sendCaption, type Caption } from '../nexconn'
import { listenForCaptions, speak } from '../speech'
import { contactById, useProfile } from '../state'

type Line = Caption & { mine: boolean; id: number }
const QUICK = ['Yes', 'No', 'Please wait', 'Say that again', 'Speak slowly', 'Thank you', 'Bye']

/**
 * Makes a call work for everyone:
 * - what you say is turned into captions and sent to the other person (so a deaf person can read it);
 * - you can type or tap a reply, which is shown as a caption and spoken aloud on the other side
 *   (so a deaf or non-speaking person can answer a hearing or blind person).
 */
export default function CallCaptions({ peer, micOn }: { peer: string; micOn: boolean }) {
  const { mode } = useProfile()
  const [lines, setLines] = useState<Line[]>([])
  const [partial, setPartial] = useState('')
  const [draft, setDraft] = useState('')
  const n = useRef(0)
  const box = useRef<HTMLDivElement>(null)
  const canSpeak = mode !== 'deaf' && mode !== 'deafblind' && mode !== 'speech'
  const canHear = mode !== 'deaf' && mode !== 'deafblind'
  const add = (c: Caption, mine: boolean) => setLines((l) => [...l.slice(-30), { ...c, mine, id: n.current++ }])

  // Incoming captions: show them; read typed/tapped ones aloud for people who can hear.
  useEffect(
    () =>
      onCaption((c) => {
        if (c.from !== peer) return
        add(c, false)
        if (canHear && c.how !== 'spoken') speak(c.text, false)
        if (!canHear) navigator.vibrate?.(80)
      }),
    [peer, canHear],
  )

  // My speech becomes captions for the other person (only when my mic is on).
  useEffect(() => {
    if (!canSpeak || !micOn) return
    const stop = listenForCaptions(
      (text) => {
        setPartial('')
        const c: Caption = { text, how: 'spoken', final: true }
        add(c, true)
        void sendCaption(peer, c)
      },
      setPartial,
    )
    return () => stop?.()
  }, [peer, canSpeak, micOn])

  useEffect(() => {
    box.current?.scrollTo({ top: box.current.scrollHeight })
  }, [lines.length, partial])

  const send = (text: string, how: Caption['how']) => {
    const t = text.trim()
    if (!t) return
    const c: Caption = { text: t, how, final: true }
    add(c, true)
    void sendCaption(peer, c)
  }

  const them = contactById(peer).name
  return (
    <div className="call-captions" aria-label="Live captions">
      <div className="cap-lines" ref={box} aria-live="polite">
        {lines.length === 0 && !partial && <p className="cap-empty">{canSpeak ? `Captions are on. What you and ${them} say appears here.` : `What ${them} says appears here. Type or tap to answer.`}</p>}
        {lines.map((l) => (
          <p key={l.id} className={`cap-line${l.mine ? ' mine' : ''}`}>
            <b>{l.mine ? 'You' : them}{l.how === 'spoken' ? '' : l.how === 'typed' ? ' (typed)' : ' (tapped)'}:</b> {l.text}
          </p>
        ))}
        {partial && <p className="cap-line mine partial"><b>You:</b> {partial}…</p>}
      </div>
      {!canSpeak && (
        <>
          <div className="cap-quick" role="group" aria-label="Quick replies">
            {QUICK.map((q) => <button key={q} type="button" onClick={() => send(q, 'tapped')}>{q}</button>)}
          </div>
          <form className="cap-reply" onSubmit={(e) => { e.preventDefault(); send(draft, 'typed'); setDraft('') }}>
            <input aria-label={`Type to ${them}`} placeholder={`Type, and ${them} will hear it`} value={draft} onChange={(e) => setDraft(e.target.value)} />
            <button aria-label="Send"><Send size={18} aria-hidden="true" /></button>
          </form>
        </>
      )}
    </div>
  )
}
