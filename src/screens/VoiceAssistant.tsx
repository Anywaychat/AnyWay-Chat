import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Mic } from 'lucide-react'
import { loadChannels, onMessage, sendText, sendVoice, type ChatMessage } from '../nexconn'
import { ask, canListen, micPermission, onVoiceState, naturalVoiceSettled, recordVoiceNote, requestMic, setRate, setWakeWord, speak, stopSpeaking, whenQuiet, type VoiceState, type WakeState } from '../speech'
import { findMentioned, hasChat, registerAssistant, routeVoice, understand, type Intent, type Person } from '../voice'
import { acceptCall, endCall, getCall, startCall, toggleCam, toggleMic } from '../calls'
import { contactById, useAuth } from '../state'
import { usePresence } from '../useChat'
import { describePhoto, preloadVision, visionReady } from '../vision'
import { getBlindPrefs, setBlindPrefs } from '../blindPrefs'
import { translateForMe } from '../translateMsg'
import { howMade, SAID_VERB } from '../origin'

/**
 * For blind users: "Hey Chat" works on every screen, and every new message is read aloud.
 * Every way of talking to AnyWay (Hey Chat, the big Tap to speak button, the Space key) comes here first.
 */
type MicState = 'checking' | 'ask' | 'ok' | 'denied'

const BLOCKED_HELP =
  'The microphone is turned off for AnyWay, so I cannot hear you. To turn it on, open the site settings next to the web address at the top, and set Microphone to Allow. On a phone, tap the icon left of the address, then Permissions, then Microphone. I will start listening by myself once it is allowed.'

export default function VoiceAssistant() {
  const auth = useAuth()
  const { user, contacts, groups } = auth
  const online = usePresence()
  const nav = useNavigate()
  const { pathname } = useLocation()
  const [state, setState] = useState<WakeState>('off')
  const [voice, setVoice] = useState<VoiceState>('basic')
  const [mic, setMic] = useState<MicState>('checking')
  useEffect(() => {
    // Photo descriptions use a large model: load it early only where there's room (not small phones or data saver).
    const n = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } }
    if ((n.deviceMemory ?? 8) >= 6 && !n.connection?.saveData) void naturalVoiceSettled().then(() => preloadVision())
    return onVoiceState(setVoice)
  }, [])
  const ctx = useRef({ contacts, groups, pathname, auth, online })
  useEffect(() => {
    ctx.current = { contacts, groups, pathname, auth, online }
  })
  const speed = useRef(getBlindPrefs().rate)
  const userId = user?.id

  // The microphone: ask for it out loud before listening. A blind person can't see the browser's permission popup, and
  // listening straight away made it pop up unannounced; when it was missed, AnyWay said the microphone was "blocked".
  useEffect(() => {
    if (!userId || !canListen) return
    let alive = true
    void micPermission().then((p) => alive && setMic(p === 'granted' || p === 'unknown' ? 'ok' : p === 'denied' ? 'denied' : 'ask'))
    // Allowed (or blocked) in the browser's site settings later: follow it without a reload.
    let status: PermissionStatus | null = null
    navigator.permissions
      ?.query({ name: 'microphone' as PermissionName })
      .then((s) => {
        status = s
        s.onchange = () => alive && setMic(s.state === 'granted' ? 'ok' : s.state === 'denied' ? 'denied' : 'ask')
      })
      .catch(() => {})
    return () => {
      alive = false
      if (status) status.onchange = null
    }
  }, [userId])
  useEffect(() => {
    if (mic !== 'ask') return
    let asked = false
    const go = async () => {
      if (asked) return
      asked = true
      const ok = await requestMic()
      setMic(ok ? 'ok' : 'denied')
      if (ok) speak('Thank you. I can hear you now.', true)
    }
    speak('Welcome to AnyWay. To talk to me, I need your microphone. Your browser will ask now. Choose Allow.', true)
    void whenQuiet().then(go)
    const tap = () => void go()
    window.addEventListener('pointerdown', tap, { once: true })
    window.addEventListener('keydown', tap, { once: true })
    return () => {
      window.removeEventListener('pointerdown', tap)
      window.removeEventListener('keydown', tap)
    }
  }, [mic])
  useEffect(() => {
    if (mic === 'denied') speak(BLOCKED_HELP, true)
  }, [mic])

  // Greet the person by name once (after the microphone question), with what they've missed.
  const greeted = useRef(false)
  useEffect(() => {
    if (!user || greeted.current || mic === 'checking' || mic === 'ask') return
    greeted.current = true
    const h = new Date().getHours()
    const hello = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
    const first = user.name.split(' ')[0]
    const listening = mic === 'ok'
    setTimeout(async () => {
      const ch = await loadChannels().catch(() => [])
      const unread = ch.filter((c) => c.unread > 0)
      const total = unread.reduce((n, c) => n + c.unread, 0)
      const from = unread.slice(0, 3).map((c) => (c.key.startsWith('group:') ? ctx.current.groups.find((g) => `group:${g.id}` === c.key)?.name : contactById(c.key.slice(7)).name)).filter(Boolean)
      await whenQuiet()
      speak(`${hello}, ${first}. ${total ? `You have ${total} unread message${total > 1 ? 's' : ''}${from.length ? ` from ${from.join(' and ')}` : ''}.` : 'No new messages.'}${listening ? ' Say, Hey Chat, whenever you need me.' : ''}`)
    }, 1500)
  }, [user, mic])

  // Read every incoming message aloud, wherever you are in the app.
  useEffect(() => {
    if (!user) return
    return onMessage((m: ChatMessage) => {
      if (m.from === user.id || m.catchUp) return
      const who = contactById(m.from).name
      const group = m.key.startsWith('group:') ? ctx.current.groups.find((g) => `group:${g.id}` === m.key)?.name : undefined
      // "Priya sent you a message: are you coming tonight?" / "Priya signed: hello, how are you?"
      const thing = m.type === 'text' ? 'a message' : m.type === 'image' ? 'a photo' : m.type === 'voice' ? 'a voice message' : `a file, ${m.fileName}`
      const sent = group ? `${who} sent ${thing} in ${group}` : `${who} sent you ${thing}`
      if (m.type === 'image' && m.url && getBlindPrefs().announce === 'full') {
        // Say it arrived straight away, then describe it once the model has looked at it.
        speak(`${sent}. ${visionReady() ? 'Describing it…' : 'Describing it. The first photo takes about a minute while I get ready.'}`)
        void describePhoto(m.url).then((d) => speak(d ? `The photo shows: ${d}` : "Sorry, I couldn't describe this photo."))
        return
      }
      // Privacy: read the whole message, only who sent it, or nothing (the message sound still plays).
      const pref = getBlindPrefs().announce
      if (pref === 'off') return
      if (pref === 'sender' || m.type !== 'text') return speak(`${sent}.`)
      const how = howMade(m.origin)
      const lead = how && how !== 'typed' ? `${who} ${SAID_VERB[how]}${group ? ` in ${group}` : ''}` : sent
      // In my language: translated when they wrote in one I don't understand.
      void translateForMe(m.text).then((t) => speak(t ? `${lead}, in ${t.fromName}: ${t.text}` : `${lead}: ${m.text}`))
    })
  }, [user])

  // The command handler, set up once per signed-in person and used by "Hey Chat", the Tap to speak button and Space.
  const navRef = useRef(nav)
  const userRef = useRef(user)
  useEffect(() => {
    navRef.current = nav
    userRef.current = user
  })
  const handleRef = useRef<((raw: string) => Promise<void>) | null>(null)
  useEffect(() => {
    const user = userRef.current
    if (!user) return
    const nav = (to: string) => navRef.current(to)
    const first = user.name.split(' ')[0]
    // Commands that only make sense inside an open chat are passed to that chat.
    const CHAT_ONLY = new Set(['describe', 'say', 'read', 'repeat', 'react', 'deleteLast', 'editLast', 'next', 'previous', 'search'])
    const cancelled = (t: string) => /^(cancel|stop|never ?mind|forget it|no)\b/i.test(t.trim())
    const openChat = () => (ctx.current.pathname.startsWith('/chat/') ? ctx.current.pathname.slice(6) : null)
    // Two contacts share the name that was heard: ask which one instead of guessing.
    const askWhich = async (options: Person[]): Promise<Person | null> => {
      const names = options.map((p) => p.name)
      const answer = await ask(`Which one: ${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}?`)
      if (!answer || cancelled(answer)) {
        speak('Okay, cancelled.', true)
        return null
      }
      const said = answer.toLowerCase()
      const m = findMentioned(answer, options)
      if (m && !m.ambiguous) return m.who
      const bySurname = options.find((p) => p.name.includes(' ') && said.includes(p.name.split(' ').slice(1).join(' ').toLowerCase()))
      if (bySurname) return bySurname
      const nth = /\b(first|one)\b/.test(said) ? 0 : /\b(second|two)\b/.test(said) ? 1 : /\b(third|three)\b/.test(said) ? 2 : -1
      if (nth >= 0 && options[nth]) return options[nth]
      speak("Sorry, I didn't catch which one. Try again with their full name.", true)
      return null
    }
    // Ask who, retrying once if the name isn't recognised.
    const askWho = async (question: string): Promise<Person | null> => {
      for (let tries = 0; tries < 2; tries++) {
        const answer = await ask(tries ? `Sorry, I didn't find that name. ${question}` : question)
        if (!answer || cancelled(answer)) {
          speak('Okay, cancelled.', true)
          return null
        }
        const m = findMentioned(answer, ctx.current.contacts)
        if (m?.ambiguous) return askWhich(m.ambiguous)
        if (m) return m.who
      }
      speak("I still couldn't find that person. Say, list my chats, to hear their names.", true)
      return null
    }
    const composeTo = async (who: Person) => {
      const text = await ask(`What should I say to ${who.name}?`)
      if (!text || cancelled(text)) return speak('Okay, not sent.', true)
      if (openChat() === who.id && hasChat()) return routeVoice(text, () => {}, { kind: 'say', text })
      const m = await sendText({ kind: 'direct', id: who.id }, text, { mode: 'blind', how: 'spoken' })
      speak(m ? `Sent to ${who.name}.` : `Sorry ${first}, I couldn't send that.`, true)
    }
    const handle = async (raw: string) => {
      const { contacts: people, auth: a, online: on } = ctx.current
      let it: Intent & { ambiguous?: Person[] } = understand(raw, people, hasChat())
      if (it.ambiguous?.length && 'who' in it) {
        const pick = await askWhich(it.ambiguous)
        if (!pick) return
        it = { ...it, who: pick } as Intent
        delete it.ambiguous
      }
      if (CHAT_ONLY.has(it.kind) || (it.kind === 'open' && hasChat()) || (it.kind === 'send' && hasChat())) {
        if (hasChat()) return routeVoice(raw, () => {}, it)
        if (it.kind === 'read') return speak(people.length ? `Your chats are ${people.map((c) => c.name).join(', ')}. Say open and a name.` : 'You have no contacts yet.', true)
        if (it.kind === 'say') return speak(`Open a chat first, ${first}. Or say: tell, a name, and your message.`, true)
      }
      switch (it.kind) {
        case 'compose': {
          const openId = openChat()
          const who = it.who ?? (openId ? contactById(openId) : await askWho('Who should I send it to?'))
          if (who) await composeTo(who)
          return
        }
        case 'voiceNote': {
          const openId = openChat()
          const who = it.who ?? (openId ? contactById(openId) : await askWho('Who should I send the voice message to?'))
          if (!who) return
          speak(`Recording your voice message for ${who.name}. Start after the beep, and just stop talking when you're done.`, true)
          await whenQuiet()
          const blob = await recordVoiceNote()
          if (!blob) return speak(`Sorry ${first}, I couldn't record. Check the microphone is allowed.`, true)
          const m = await sendVoice({ kind: 'direct', id: who.id }, blob)
          return speak(m ? `Voice message sent to ${who.name}.` : `Sorry ${first}, the voice message didn't send.`, true)
        }
        case 'isOnline':
          return speak(on.has(it.who.id) ? `Yes, ${it.who.name} is online.` : `${it.who.name} is offline right now.`, true)
        case 'addWho': {
          const name = await ask("What's their username?")
          if (!name || cancelled(name)) return speak('Okay, cancelled.', true)
          const username = name.toLowerCase().replace(/\bto\b|\btoo\b/g, '2').replace(/[^a-z0-9]/g, '')
          const err = await a.addContact(username)
          return speak(err ? `Sorry ${first}, I couldn't find ${name}.` : `Added ${contactById(username).name}.`, true)
        }
        case 'groupAsk': {
          const name = await ask('What should the group be called?')
          if (!name || cancelled(name)) return speak('Okay, cancelled.', true)
          const who = await ask(`Who should be in ${name}? Say their names.`)
          const members = who.split(/\s*(?:,|\band\b)\s*/i).map((part) => findMentioned(part, people)?.who).filter((p): p is Person => !!p)
          if (!members.length) return speak("I didn't recognise those names, so I didn't make the group.", true)
          try {
            const id = await a.createGroup(name, members.map((m) => m.id))
            speak(`Group ${name} created with ${members.map((m) => m.name).join(' and ')}.`, true)
            if (id) nav(`/group/${id}`)
          } catch {
            speak(`Sorry ${first}, I couldn't create that group.`, true)
          }
          return
        }
        case 'leaveGroup': {
          const gid = ctx.current.pathname.startsWith('/group/') ? ctx.current.pathname.slice(7) : null
          if (!gid) return speak('Open the group first, then say leave this group.', true)
          const yes = await ask('Are you sure you want to leave this group?')
          if (!/\b(yes|yeah|sure|ok|okay|leave)\b/i.test(yes)) return speak('Okay, staying in the group.', true)
          await a.api(`/groups/${gid}/leave`, { method: 'POST' }).catch(() => null)
          await a.refreshContacts()
          speak('You left the group.', true)
          return nav('/home')
        }
        case 'report': {
          const openId = openChat()
          const who = it.who ?? (openId ? contactById(openId) : await askWho('Who do you want to report?'))
          if (!who) return
          const why = await ask(`What happened with ${who.name}?`)
          if (!why || cancelled(why)) return speak('Okay, not reported.', true)
          const err = await a.report(who.id, why)
          return speak(err ? `Sorry ${first}, the report didn't send.` : 'Thanks. Your report was sent.', true)
        }
        case 'stopTalking':
          return stopSpeaking()
        case 'time':
          return speak(`It's ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.`, true)
        case 'callWho': {
          const who = await askWho(it.video ? 'Who should I video call?' : 'Who should I call?')
          if (who) {
            speak(`Calling ${who.name}`, true)
            void startCall(who.id, it.video)
          }
          return
        }
        case 'send': {
          const m = await sendText({ kind: 'direct', id: it.who.id }, it.text, { mode: 'blind', how: 'spoken' })
          return speak(m ? `Sent to ${it.who.name}.` : `Sorry ${first}, I couldn't send that to ${it.who.name}.`, true)
        }
        case 'call':
          speak(`Calling ${it.who.name}`, true)
          return void startCall(it.who.id, it.video)
        case 'open':
          return nav(`/chat/${it.who.id}`)
        case 'nav':
          speak(it.to === 'home' ? 'Your chats.' : it.to === 'calls' ? 'Your calls.' : it.to === 'profile' ? 'Your profile.' : 'Talk face to face.', true)
          return nav(it.to === 'home' ? '/home' : `/${it.to}`)
        case 'callAction': {
          const c = getCall()
          // "mute the TV" in a chat with no call is just a message.
          if (c.phase === 'idle' && hasChat()) return routeVoice(raw, () => {}, { kind: 'say', text: raw })
          if (c.phase === 'idle') return speak(`There's no call right now, ${first}.`, true)
          if (it.action === 'answer') return c.phase === 'incoming' ? void acceptCall() : speak("You're already on the call.", true)
          if (it.action === 'decline' || it.action === 'end') return void endCall()
          if (it.action === 'mute' || it.action === 'unmute') {
            if ((it.action === 'mute') === c.micOn) void toggleMic()
            return speak(it.action === 'mute' ? 'Muted.' : 'Unmuted.', true)
          }
          if ((it.action === 'camOff') === c.camOn) void toggleCam()
          return speak(it.action === 'camOff' ? 'Camera off.' : 'Camera on.', true)
        }
        case 'unread': {
          const ch = (await loadChannels().catch(() => [])).filter((c) => c.unread > 0)
          if (!ch.length) return speak(`No new messages, ${first}.`, true)
          return speak(ch.map((c) => `${c.unread} from ${c.key.startsWith('group:') ? ctx.current.groups.find((g) => `group:${g.id}` === c.key)?.name ?? 'a group' : contactById(c.key.slice(7)).name}`).join(', ') + '. Say open and a name to hear them.', true)
        }
        case 'online': {
          const names = people.filter((p) => on.has(p.id)).map((p) => p.name)
          return speak(names.length ? `Online now: ${names.join(', ')}.` : 'Nobody is online right now.', true)
        }
        case 'list':
          return speak(people.length ? `Your chats are ${people.map((c) => c.name).join(', ')}.` : 'You have no contacts yet.', true)
        case 'addContact': {
          const err = await a.addContact(it.username)
          return speak(err ? `Sorry ${first}, I couldn't find ${it.username}.` : `Added ${contactById(it.username).name}. You can message them now.`, true)
        }
        case 'createGroup': {
          if (!it.members.length) return speak("I didn't catch who to add. Say, for example: create a group called Family with Priya and Meera.", true)
          try {
            const id = await a.createGroup(it.name, it.members.map((m) => m.id))
            speak(`Group ${it.name} created with ${it.members.map((m) => m.name).join(' and ')}.`, true)
            if (id) nav(`/group/${id}`)
          } catch {
            speak(`Sorry ${first}, I couldn't create that group.`, true)
          }
          return
        }
        case 'block': {
          const err = await a.setBlocked(it.who.id, it.block)
          return speak(err ? `Sorry ${first}, that didn't work.` : it.block ? `${it.who.name} is blocked.` : `${it.who.name} is unblocked.`, true)
        }
        case 'speed':
          speed.current = Math.min(1.6, Math.max(0.7, speed.current + (it.faster ? 0.15 : -0.15)))
          setRate(speed.current)
          setBlindPrefs({ rate: speed.current })
          return speak(it.faster ? 'Okay, I will speak faster.' : 'Okay, I will speak slower.', true)
        case 'whoami':
          return speak(`You are ${user.name}. Your username is ${user.id.split('').join(' ')}.`, true)
        case 'logout':
          speak(`Logging you out. Bye ${first}.`, true)
          await a.logout()
          return nav('/login')
        case 'help':
          return speak(`${first}, just talk normally. For example: any new messages? Tell Priya I'm on my way. Call Meera. Send a voice message to Priya. Read my messages. What time is it? Answer, or hang up, during a call.`, true)
        case 'unclear': {
          if (!it.who) return speak(`Sorry ${first}, I didn't get that. Say help to hear what I can do.`, true)
          const answer = (await ask(`Do you want to message or call ${it.who.name}?`)).toLowerCase()
          if (/video/.test(answer)) return void startCall(it.who.id, true)
          if (/call|ring|phone/.test(answer)) {
            speak(`Calling ${it.who.name}`, true)
            return void startCall(it.who.id, false)
          }
          if (/message|text|send|write|tell/.test(answer)) return composeTo(it.who)
          return speak('Okay, cancelled.', true)
        }
        default:
          return speak(`Open a chat first, ${first}. Or say: tell, a name, and your message.`, true)
      }
    }
    handleRef.current = handle
    const off = registerAssistant((text) => void handle(text))
    return () => {
      off()
      handleRef.current = null
    }
  }, [userId])

  // "Hey Chat" everywhere, once the microphone is allowed. Started once per signed-in person: it used to restart on
  // every page change (the router hands out a new navigate function each time).
  useEffect(() => {
    if (!userId || !canListen || mic !== 'ok') return
    setWakeWord(true, (text) => void handleRef.current?.(text), setState)
    return () => setWakeWord(false)
  }, [userId, mic])

  // Say it out loud when listening really has a problem (instead of only showing it), and when it works again.
  const wasStuck = useRef(false)
  useEffect(() => {
    if (state === 'blocked') setMic('denied')
    else if (state === 'nomic') speak("I can't hear a microphone, so Hey Chat is off. Check that one is connected and not in use by another app.")
    else if (state === 'unavailable') speak("Hey Chat can't reach the speech service right now. I'll keep trying. You can still tap the big button at the bottom to speak.")
    else if (state === 'waiting' && wasStuck.current) speak('Hey Chat is on again.')
    if (state === 'nomic' || state === 'unavailable') wasStuck.current = true
    else if (state === 'waiting') wasStuck.current = false
  }, [state])
  // Say when the internet drops and comes back.
  useEffect(() => {
    const off = () => speak('No internet connection. Messages will send when you are back online.', true)
    const on = () => speak('Back online.', true)
    window.addEventListener('offline', off)
    window.addEventListener('online', on)
    return () => {
      window.removeEventListener('offline', off)
      window.removeEventListener('online', on)
    }
  }, [])

  if (!canListen) return <div className="wake-pill blocked" role="status">Voice needs Chrome or Edge</div>
  if (mic === 'denied')
    return (
      <div className="mic-help" role="alert">
        <strong>The microphone is off for AnyWay</strong>
        <span>Open the site settings next to the web address and set Microphone to Allow. AnyWay starts listening by itself.</span>
        <button className="btn primary" onClick={() => void requestMic().then((ok) => ok && setMic('ok'))}>Try again</button>
      </div>
    )
  const label =
    mic === 'ask'
      ? 'Allow the microphone to talk'
      : mic === 'checking'
        ? 'Starting voice…'
        : ({ awake: 'Listening…', waiting: 'Say “Hey Chat”', blocked: 'Voice off: allow the microphone', nomic: 'Voice off: no microphone found', unavailable: 'Voice paused: trying again', off: 'Starting voice…' } as const)[state]
  return (
    <div className={`wake-pill ${mic === 'ask' ? 'blocked' : state}`} role="status" aria-live="polite">
      <Mic size={14} aria-hidden="true" />
      {label}
      {voice === 'loading' && <span className="voice-loading"> · loading natural voice</span>}
    </div>
  )
}
