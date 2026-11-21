import { useEffect, useRef, useState } from 'react'
import { Languages, Send } from 'lucide-react'
import { onCaption, sendCaption, type Caption } from '../nexconn'
import { listenForCaptions, speak } from '../speech'

import { contactById, useAuth, useProfile } from '../state'
import { base, getLang, langName, needsTranslation, sayIn, useLang, useUnderstood } from '../lang'
import { REMOTE_VIDEO_ID } from '../calls'
import { LOCAL_VIDEO_ID } from '../calls'
import { isSure, SignReader } from '../sign'
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
  const [theirLang, setTheirLang] = useState('')
  const [lines, setLines] = useState<Line[]>([])
  const [partial, setPartial] = useState('')
  const [draft, setDraft] = useState('')
  const n = useRef(0)
  const box = useRef<HTMLDivElement>(null)
  const canSpeak = mode !== 'deaf' && mode !== 'speech'
  // Spoken translation (a moment after each sentence) only for blind people; everyone else reads it, with no delay.
  const voiceOn = mode === 'blind'
  const canHear = mode !== 'deaf'
  const add = (c: Caption, mine: boolean, orig?: string) => setLines((l) => [...l.slice(-30), { ...c, mine, orig, id: n.current++ }])
  const voiceOnRef = useRef(true)
  // Captions are on for people who need them (deaf, can't speak); hearing users turn them on with CC so the face stays clear.
  const [showCaps, setShowCaps] = useState(mode === 'deaf' || mode === 'speech')
  const showCapsRef = useRef(showCaps)
  showCapsRef.current = showCaps
  const helloBack = useRef(false)
  const deaf = mode === 'deaf'
  // The ISL words we have signs for, to show what's said as sign language.
  const [words, setWords] = useState<SignWord[]>([])
  useEffect(() => { if (deaf) void loadSigns().then(setWords) }, [deaf])
  const [interp, setInterp] = useState<{ ids: string[]; text: string; key: number } | null>(null)
  const [reading, setReading] = useState('')
  const [hint, setHint] = useState('')

  // Incoming captions: show them; read typed/tapped ones aloud for people who can hear.
  useEffect(
    () =>
      onCaption((c) => {
        if (c.from !== peer) return
        if (!c.text) {
          // A hello: they told us their language and whether they want captions. Reply once so they learn ours too.
          if (c.lang) { setPeerLang(c.lang); if (needsTranslation(c.lang)) setTheirLang(c.lang) }
          setPeerWants((w) => (c.want === undefined ? w : !!c.want || w))
          if (c.final === false && !helloBack.current) { helloBack.current = true; void sendCaption(peer, { text: '', how: 'spoken', final: true, lang: getLang(), want: showCapsRef.current }) }
          return
        }
        const mine = getLang()
        if (c.lang && needsTranslation(c.lang)) {
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

  // Tell the other phone my language and whether I need captions; it only turns speech into text when someone needs it.
  // (Speech-to-text running beside the call competes for the mic and processor, which made calls lag.)
  const peerMode = contactById(peer).mode
  const [peerWants, setPeerWants] = useState(peerMode === 'deaf')
  const [peerLang, setPeerLang] = useState('')
  useEffect(() => {
    void sendCaption(peer, { text: '', how: 'spoken', final: false, lang: myLang, want: showCaps })
  }, [peer, myLang, showCaps])
  const needMyCaptions = peerWants || (!!peerLang && base(peerLang) !== base(myLang))

  // My speech becomes captions for the other person (only when my mic is on and they need them).
  useEffect(() => {
    if (!canSpeak || !micOn || !needMyCaptions) return
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
  }, [peer, canSpeak, micOn, myLang, needMyCaptions])

  // Deaf: read their signs and send each word (spoken aloud on the other side). On a video call from the call camera;
  // on a voice call from a camera only they see (nothing is sent but the words).
  const selfCam = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    if (!deaf || (video && !camOn)) return
    let reader: SignReader | null = null
    let alive = true
    let own: MediaStream | null = null
    const getEl = async (): Promise<HTMLVideoElement | null> => {
      if (video) return document.getElementById(LOCAL_VIDEO_ID) as HTMLVideoElement | null
      const el = selfCam.current
      if (!el) return null
      own = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 640, height: 480 }, audio: false }).catch(() => null)
      if (!own || !alive) { own?.getTracks().forEach((t) => t.stop()); return null }
      el.srcObject = own
      await el.play().catch(() => {})
      return el
    }
    const name = (id: string) => words.find((w) => w.id === id)?.name ?? id
    void Promise.all([loadSigns(), getEl()]).then(([, el]) => {
      if (!alive || !el) return
      reader = new SignReader(
        el,
        (guesses) => {
          const g = guesses[0]
          if (!g) return
          // Only clear signs are spoken to the other person; otherwise ask to sign again (a wrong word is worse than a repeat).
          if (!isSure(guesses)) { setHint(`Not sure (${guesses.slice(0, 2).map((x) => name(x.word)).join(' or ')}?). Sign it again.`); setTimeout(() => setHint(''), 3500); return }
          const c: Caption = { text: name(g.word), how: 'signed', final: true, lang: 'en-IN' }
          add(c, true)
          setReading('')
          void sendCaption(peer, c)
        },
        (st) => setReading(st.recording ? 'Reading your sign…' : st.hands ? 'Hands found' : ''),
        { maxFps: 20 },
      )
      void reader.start().catch(() => {})
    })
    return () => { alive = false; reader?.stop(); own?.getTracks().forEach((t) => t.stop()) }
  }, [deaf, video, camOn, peer, words])

  const understood = useUnderstood()
  const translating = !!theirLang && needsTranslation(theirLang) && understood.length >= 0
  // A call in two languages turns captions on, so you can read the translation (and the original) too.
  const autoOn = useRef(false)
  useEffect(() => { if (translating && !autoOn.current) { autoOn.current = true; setShowCaps(true) } }, [translating])
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
  // Blind: nothing to read on screen. Their speech is still sent as captions (for a deaf or other-language person),
  // and translations are spoken. Only the translation switch is shown, and nothing is announced by the screen reader.
  if (mode === 'blind')
    return translating ? (
      <div className="call-captions">
        <div className="cap-trans">
          <Languages size={15} aria-hidden="true" />
          <span>Translating {langName(theirLang)} → {langName(myLang)}</span>
        </div>
      </div>
    ) : null
  return (
    <div className="call-captions" aria-label="Live captions">
      {deaf && interp && (
        <div className="interp" aria-label="In sign language">
          <SignClip key={interp.key} ids={interp.ids} onDone={() => {}} />
          <span>{interp.text}</span>
        </div>
      )}
      {deaf && !video && (
        <div className="sign-self">
          <video ref={selfCam} muted playsInline aria-label="Your camera, only you see it" />
          <span>Sign to your camera. Only you see it; {them} hears your signs.</span>
        </div>
      )}
      {deaf && (hint || reading) && <p className="cap-reading" role="status">{hint || reading}</p>}
      {translating && (
        <div className="cap-trans" role="status">
          <Languages size={15} aria-hidden="true" />
          <span>Translating {langName(theirLang)} → {langName(myLang)}</span>
        </div>
      )}
      {showCaps && (lines.length > 0 || partial || !video) && <div className="cap-lines" ref={box} aria-live="polite">
        {lines.length === 0 && !partial && <p className="cap-empty">{canSpeak ? `Captions are on. What you and ${them} say appears here.` : `What ${them} says appears here. Type or tap to answer.`}</p>}
        {lines.slice(video ? -3 : -8).map((l) => (
          <p key={l.id} className={`cap-line${l.mine ? ' mine' : ''}`}>
            <b>{l.mine ? 'You' : them}{l.how === 'spoken' ? '' : ` (${l.how})`}:</b> <span dir="auto">{l.text}</span>
            {l.orig && <small className="cap-orig" dir="auto">{langName(l.lang)}: {l.orig}</small>}
          </p>
        ))}
        {partial && <p className="cap-line mine partial"><b>You:</b> {partial}…</p>}
      </div>}
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
