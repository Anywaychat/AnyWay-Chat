import { useEffect, useRef, useState } from 'react'
import { Languages, Send } from 'lucide-react'
import { onCaption, sendCaption, type Caption } from '../nexconn'
import { listenForCaptions, speak } from '../speech'
import { contactById, useAuth, useProfile } from '../state'
import { base, getLang, langName, sayIn, useLang } from '../lang'
import { REMOTE_VIDEO_ID } from '../calls'
import { LOCAL_VIDEO_ID } from '../calls'
import { SignReader } from '../sign'
import { loadSigns, toSigns, type SignWord } from '../signs'
import SignClip from './SignClip'

type Line = Caption & { mine: boolean; id: number; orig?: string }
const QUICK = ['Yes', 'No', 'Please wait', 'Say that again', 'Speak slowly', 'Thank you', 'Bye']

/**
 * Makes a call work for everyone:
 * - what you say is turned into captions and sent to the other person (so a deaf person can read it);
 * - you can type or tap a reply, which is shown as a caption and spoken aloud on the other side
 *   (so a deaf or non-speaking person can answer a hearing or blind person).
 */
export default function CallCaptions({ peer, micOn, video, camOn }: { peer: string; micOn: boolean; video: boolean; camOn: boolean }) {
  const { mode } = useProfile()
  const { api } = useAuth()
  const myLang = useLang()
  // Speech-to-speech: when they talk in another language, play the translation and turn their own voice down.
  const [voiceOn, setVoiceOn] = useState(true)
  const [theirLang, setTheirLang] = useState('')
  const [lines, setLines] = useState<Line[]>([])
  const [partial, setPartial] = useState('')
  const [draft, setDraft] = useState('')
  const n = useRef(0)
  const box = useRef<HTMLDivElement>(null)
  const canSpeak = mode !== 'deaf' && mode !== 'deafblind' && mode !== 'speech'
  const canHear = mode !== 'deaf' && mode !== 'deafblind'
  const add = (c: Caption, mine: boolean, orig?: string) => setLines((l) => [...l.slice(-30), { ...c, mine, orig, id: n.current++ }])
  const voiceOnRef = useRef(true)
  const deaf = mode === 'deaf'
  // The ISL words we have signs for, to show what's said as sign language.
  const [words, setWords] = useState<SignWord[]>([])
  useEffect(() => { if (deaf) void loadSigns().then(setWords) }, [deaf])
  const [interp, setInterp] = useState<{ ids: string[]; text: string; key: number } | null>(null)
  const [reading, setReading] = useState('')

  // Incoming captions: show them; read typed/tapped ones aloud for people who can hear.
  useEffect(
    () =>
      onCaption((c) => {
        if (c.from !== peer) return
        const mine = getLang()
        if (c.lang && base(c.lang) !== base(mine)) {
          setTheirLang(c.lang)
          void api<{ text: string }>('/translate', { method: 'POST', body: { text: c.text, from: c.lang, to: mine } })
            .then(({ text }) => {
              add({ ...c, text }, false, c.text)
              if (deaf) void loadSigns().then((ws) => { const ids = toSigns(text, ws).flatMap((p) => (p.kind === 'sign' ? [p.word.id] : [])); if (ids.length) setInterp({ ids, text, key: n.current++ }) })
              if (canHear && voiceOnRef.current) sayIn(text, mine)
            })
            .catch(() => add(c, false))
          if (!canHear) navigator.vibrate?.(80)
          return
        }
        add(c, false)
        if (canHear && c.how !== 'spoken') speak(c.text, false)
        if (!canHear) navigator.vibrate?.(80)
        // Deaf: play what they said as ISL signs in the interpreter window.
        if (deaf && c.how !== 'signed') {
          void loadSigns().then((ws) => {
            const ids = toSigns(c.text, ws).flatMap((p) => (p.kind === 'sign' ? [p.word.id] : []))
            if (ids.length) setInterp({ ids, text: c.text, key: n.current++ })
          })
        }
      }),
    [peer, canHear, deaf, api],
  )

  // My speech becomes captions for the other person (only when my mic is on).
  useEffect(() => {
    if (!canSpeak || !micOn) return
    const stop = listenForCaptions(
      (text) => {
        setPartial('')
        const c: Caption = { text, how: 'spoken', final: true, lang: myLang }
        add(c, true)
        void sendCaption(peer, c)
      },
      setPartial,
      myLang,
    )
    return () => stop?.()
  }, [peer, canSpeak, micOn, myLang])

  // Deaf, on a video call: read their signs from the call camera and send each word (spoken aloud on the other side).
  useEffect(() => {
    if (!deaf || !video || !camOn) return
    const el = document.getElementById(LOCAL_VIDEO_ID) as HTMLVideoElement | null
    if (!el) return
    let reader: SignReader | null = null
    let alive = true
    const name = (id: string) => words.find((w) => w.id === id)?.name ?? id
    void loadSigns().then(() => {
      if (!alive) return
      reader = new SignReader(
        el,
        (guesses) => {
          const g = guesses[0]
          if (!g || g.score < 0.3) return
          const c: Caption = { text: name(g.word), how: 'signed', final: true, lang: 'en-IN' }
          add(c, true)
          setReading('')
          void sendCaption(peer, c)
        },
        (st) => setReading(st.recording ? 'Reading your sign…' : st.hands ? 'Hands found' : ''),
      )
      void reader.start().catch(() => {})
    })
    return () => { alive = false; reader?.stop() }
  }, [deaf, video, camOn, peer, words])

  const translating = !!theirLang && base(theirLang) !== base(myLang)
  useEffect(() => {
    voiceOnRef.current = voiceOn
    const el = document.getElementById(REMOTE_VIDEO_ID) as HTMLMediaElement | null
    if (el) el.volume = translating && voiceOn && canHear ? 0.15 : 1
  }, [voiceOn, translating, canHear])

  useEffect(() => {
    box.current?.scrollTo({ top: box.current.scrollHeight })
  }, [lines.length, partial])

  const send = (text: string, how: Caption['how']) => {
    const t = text.trim()
    if (!t) return
    const c: Caption = { text: t, how, final: true, lang: myLang }
    add(c, true)
    void sendCaption(peer, c)
  }

  const them = contactById(peer).name
  return (
    <div className="call-captions" aria-label="Live captions">
      {deaf && interp && (
        <div className="interp" aria-label="In sign language">
          <SignClip key={interp.key} ids={interp.ids} onDone={() => {}} />
          <span>{interp.text}</span>
        </div>
      )}
      {deaf && video && reading && <p className="cap-reading">{reading}</p>}
      {translating && (
        <div className="cap-trans" role="status">
          <Languages size={15} aria-hidden="true" />
          <span>Translating {langName(theirLang)} → {langName(myLang)}</span>
          {canHear && <button type="button" className="chip-btn" aria-pressed={voiceOn} onClick={() => setVoiceOn((v) => !v)}>{voiceOn ? 'Translated voice on' : 'Original voice'}</button>}
        </div>
      )}
      <div className="cap-lines" ref={box} aria-live="polite">
        {lines.length === 0 && !partial && <p className="cap-empty">{canSpeak ? `Captions are on. What you and ${them} say appears here.` : `What ${them} says appears here. Type or tap to answer.`}</p>}
        {lines.map((l) => (
          <p key={l.id} className={`cap-line${l.mine ? ' mine' : ''}`}>
            <b>{l.mine ? 'You' : them}{l.how === 'spoken' ? '' : ` (${l.how})`}:</b> <span dir="auto">{l.text}</span>
            {l.orig && <small className="cap-orig" dir="auto">{langName(l.lang)}: {l.orig}</small>}
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
