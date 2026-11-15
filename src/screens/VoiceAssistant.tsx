import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Mic } from 'lucide-react'
import { loadChannels, onMessage, sendText, sendVoice, type ChatMessage } from '../nexconn'
import { ask, canListen, onVoiceState, preloadNaturalVoice, recordVoiceNote, setRate, setWakeWord, speak, stopSpeaking, whenQuiet, type VoiceState } from '../speech'
import { findMentioned, hasChat, routeVoice, understand, type Person } from '../voice'
import { acceptCall, endCall, getCall, startCall, toggleCam, toggleMic } from '../calls'
import { contactById, useAuth } from '../state'
import { usePresence } from '../useChat'

/**
 * For blind users: "Hey Chat" works on every screen, and every new message is read aloud.
 */
export default function VoiceAssistant() {
  const auth = useAuth()
  const { user, contacts, groups } = auth
  const online = usePresence()
  const nav = useNavigate()
  const { pathname } = useLocation()
  const [state, setState] = useState<'off' | 'waiting' | 'awake'>('off')
  const [voice, setVoice] = useState<VoiceState>('basic')
  useEffect(() => {
    preloadNaturalVoice()
    return onVoiceState(setVoice)
  }, [])
  const ctx = useRef({ contacts, groups, pathname, auth, online })
  ctx.current = { contacts, groups, pathname, auth, online }
  const speed = useRef(1)

  // Greet the person by name once, with what they've missed.
  const greeted = useRef(false)
  useEffect(() => {
    if (!user || greeted.current) return
    greeted.current = true
    const h = new Date().getHours()
    const hello = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
    const first = user.name.split(' ')[0]
    setTimeout(async () => {
      const ch = await loadChannels().catch(() => [])
      const unread = ch.filter((c) => c.unread > 0)
      const total = unread.reduce((n, c) => n + c.unread, 0)
      const from = unread.slice(0, 3).map((c) => (c.key.startsWith('group:') ? ctx.current.groups.find((g) => `group:${g.id}` === c.key)?.name : contactById(c.key.slice(7)).name)).filter(Boolean)
      speak(`${hello}, ${first}. ${total ? `You have ${total} unread message${total > 1 ? 's' : ''}${from.length ? ` from ${from.join(' and ')}` : ''}.` : 'No new messages.'} Say, Hey Chat, whenever you need me.`)
    }, 2500)
  }, [user])

  // Read every incoming message aloud, wherever you are in the app.
  useEffect(() => {
    if (!user) return
    return onMessage((m: ChatMessage) => {
      if (m.from === user.id) return
      const who = contactById(m.from).name
      const group = m.key.startsWith('group:') ? ctx.current.groups.find((g) => `group:${g.id}` === m.key)?.name : undefined
      const what = m.type === 'text' ? m.text : m.type === 'image' ? 'sent a photo' : m.type === 'voice' ? 'sent a voice message' : `sent a file, ${m.fileName}`
      const open = ctx.current.pathname === (group ? `/group/${m.key.slice(6)}` : `/chat/${m.from}`)
      speak(open ? `${who}: ${what}` : `New message from ${who}${group ? ` in ${group}` : ''}. ${what}`)
    })
  }, [user])

  // "Hey Chat" everywhere.
  useEffect(() => {
    if (!user || !canListen) return
    const first = user.name.split(' ')[0]
    // Commands that only make sense inside an open chat are passed to that chat.
    const CHAT_ONLY = new Set(['say', 'read', 'repeat', 'react', 'deleteLast', 'editLast', 'next', 'previous', 'search'])
    const cancelled = (t: string) => /^(cancel|stop|never ?mind|forget it|no)\b/i.test(t.trim())
    // Ask who, retrying once if the name isn't recognised.
    const askWho = async (question: string): Promise<Person | null> => {
      for (let tries = 0; tries < 2; tries++) {
        const answer = await ask(tries ? `Sorry, I didn't find that name. ${question}` : question)
        if (!answer || cancelled(answer)) {
          speak('Okay, cancelled.', true)
          return null
        }
        const who = findMentioned(answer, ctx.current.contacts)?.who
        if (who) return who
      }
      speak("I still couldn't find that person. Say, list my chats, to hear their names.", true)
      return null
    }
    const composeTo = async (who: Person) => {
      const text = await ask(`What should I say to ${who.name}?`)
      if (!text || cancelled(text)) return speak('Okay, not sent.', true)
      const openId = ctx.current.pathname.startsWith('/chat/') ? ctx.current.pathname.slice(6) : null
      if (openId === who.id && hasChat()) return routeVoice(text, () => {})
      const m = await sendText({ kind: 'direct', id: who.id }, text, { mode: 'blind' })
      speak(m ? `Sent to ${who.name}.` : `Sorry ${first}, I couldn't send that.`, true)
    }
    const handle = async (raw: string) => {
      const { contacts: people, auth: a, online: on } = ctx.current
      const it = understand(raw, people, hasChat())
      if (CHAT_ONLY.has(it.kind) || (it.kind === 'open' && hasChat()) || (it.kind === 'send' && hasChat())) {
        if (hasChat()) return routeVoice(raw, () => {})
        if (it.kind === 'read') return speak(people.length ? `Your chats are ${people.map((c) => c.name).join(', ')}. Say open and a name.` : 'You have no contacts yet.', true)
      }
      switch (it.kind) {
        case 'compose': {
          const openId = ctx.current.pathname.startsWith('/chat/') ? ctx.current.pathname.slice(6) : null
          const who = it.who ?? (openId ? contactById(openId) : await askWho('Who should I send it to?'))
          if (who) await composeTo(who)
          return
        }
        case 'voiceNote': {
          const openId = ctx.current.pathname.startsWith('/chat/') ? ctx.current.pathname.slice(6) : null
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
          const openId = ctx.current.pathname.startsWith('/chat/') ? ctx.current.pathname.slice(6) : null
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
          const m = await sendText({ kind: 'direct', id: it.who.id }, it.text, { mode: 'blind' })
          return speak(m ? `Sent to ${it.who.name}.` : `Sorry ${first}, I couldn't send that to ${it.who.name}.`, true)
        }
        case 'call':
          speak(`Calling ${it.who.name}`, true)
          return void startCall(it.who.id, it.video)
        case 'open':
          return nav(`/chat/${it.who.id}`)
        case 'nav':
          speak(it.to === 'home' ? 'Your chats.' : it.to === 'calls' ? 'Your calls.' : it.to === 'profile' ? 'Your profile.' : 'Go mode.', true)
          return nav(it.to === 'home' ? '/home' : `/${it.to}`)
        case 'callAction': {
          const c = getCall()
          // "mute the TV" in a chat with no call is just a message.
          if (c.phase === 'idle' && hasChat()) return routeVoice(raw, () => {})
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
          return speak(it.faster ? 'Okay, I will speak faster.' : 'Okay, I will speak slower.', true)
        case 'whoami':
          return speak(`You are ${user.name}. Your username is ${user.id.split('').join(' ')}.`, true)
        case 'logout':
          speak(`Logging you out. Bye ${first}.`, true)
          await a.logout()
          return nav('/login')
        case 'help':
          return speak(`${first}, just talk normally. For example: any new messages? Send a voice message to Priya. New message. Tell Priya I'm on my way. Call Meera. Any new messages. Open my calls. Create a group called Family with Priya and Meera. Answer, or hang up, during a call.`, true)
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
          return speak(`Open a chat first, ${first}. Or say: tell a name your message.`, true)
      }
    }
    setWakeWord(true, (text) => void handle(text), setState)
    return () => setWakeWord(false)
  }, [user, nav])


  if (!canListen) return <div className="wake-pill off" role="status">Voice needs Chrome or Edge</div>
  return (
    <div className={`wake-pill ${state}`} role="status" aria-live="polite">
      <Mic size={14} aria-hidden="true" />
      {state === 'awake' ? 'Listening…' : state === 'waiting' ? 'Say “Hey Chat”' : 'Voice off: allow the microphone'}
      {voice === 'loading' && <span className="voice-loading"> · loading natural voice</span>}
    </div>
  )
}
