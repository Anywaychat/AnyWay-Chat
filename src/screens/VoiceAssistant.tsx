import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Mic } from 'lucide-react'
import { onMessage, sendText, type ChatMessage } from '../nexconn'
import { canListen, setWakeWord, speak } from '../speech'
import { routeVoice, understand } from '../voice'
import { startCall } from '../calls'
import { contactById, useAuth } from '../state'

/**
 * For blind users: "Hey Chat" works on every screen, and every new message is read aloud.
 */
export default function VoiceAssistant() {
  const { user, contacts, groups } = useAuth()
  const nav = useNavigate()
  const { pathname } = useLocation()
  const [state, setState] = useState<'off' | 'waiting' | 'awake'>('off')
  const ctx = useRef({ contacts, groups, pathname })
  ctx.current = { contacts, groups, pathname }

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
    const outsideChat = (raw: string) => {
      const it = understand(raw, ctx.current.contacts, false)
      const people = ctx.current.contacts
      switch (it.kind) {
        case 'send':
          return void sendText({ kind: 'direct', id: it.who.id }, it.text, { mode: 'blind' }).then((m) => speak(m ? `Sent to ${it.who.name}.` : `Couldn't send to ${it.who.name}.`, true))
        case 'call':
          speak(`Calling ${it.who.name}`, true)
          return void startCall(it.who.id, it.video)
        case 'open':
          return nav(`/chat/${it.who.id}`)
        case 'list':
        case 'read':
          return speak(people.length ? `Your chats: ${people.map((c) => c.name).join(', ')}. Say open and a name to hear their messages.` : 'You have no contacts yet.', true)
        case 'unclear':
          return speak(it.who ? `Do you want to message or call ${it.who.name}? Say, for example: tell ${it.who.name} hello.` : "Sorry, I didn't get that. You can say: tell Priya I'm on my way, or call Meera.", true)
        default:
          return speak("Open a chat, or say: tell a name your message.", true)
      }
    }
    setWakeWord(true, (text) => routeVoice(text, outsideChat), setState)
    return () => setWakeWord(false)
  }, [user, nav])

  if (!canListen) return <div className="wake-pill off" role="status">Voice needs Chrome or Edge</div>
  return (
    <div className={`wake-pill ${state}`} role="status" aria-live="polite">
      <Mic size={14} aria-hidden="true" />
      {state === 'awake' ? 'Listening…' : state === 'waiting' ? 'Say “Hey Chat”' : 'Voice off: allow the microphone'}
    </div>
  )
}
