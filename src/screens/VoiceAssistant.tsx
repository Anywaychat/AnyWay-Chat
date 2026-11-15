import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Mic } from 'lucide-react'
import { onMessage, sendText, type ChatMessage } from '../nexconn'
import { canListen, setWakeWord, speak } from '../speech'
import { parseSendTo, routeVoice } from '../voice'
import { startCall } from '../calls'
import { contactById, useAuth } from '../state'

/**
 * For blind users: "Hey AnyWay" works on every screen, and every new message is read aloud.
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

  // "Hey AnyWay" everywhere.
  useEffect(() => {
    if (!user || !canListen) return
    const find = (spoken: string) => {
      const q = spoken.trim().toLowerCase()
      return ctx.current.contacts.find((p) => p.name.toLowerCase() === q || p.id === q.replace(/\s+/g, '')) ?? ctx.current.contacts.find((p) => p.name.toLowerCase().split(' ')[0] === q.split(' ')[0])
    }
    const outsideChat = (raw: string) => {
      const t = raw.trim().toLowerCase().replace(/[.!?]$/, '')
      const sendTo = parseSendTo(raw, ctx.current.contacts)
      if (sendTo) {
        void sendText({ kind: 'direct', id: sendTo.who.id }, sendTo.text, { mode: 'blind' }).then((m) => speak(m ? `Sent to ${sendTo.who.name}.` : `Couldn't send to ${sendTo.who.name}.`, true))
        return
      }
      const open = t.match(/^(?:open|go to|chat with|message)\s+(.+)$/)
      const call = t.match(/^(video )?call\s+(.+)$/)
      if (open) {
        const who = find(open[1])
        if (!who) return speak(`I couldn't find ${open[1]} in your contacts.`, true)
        nav(`/chat/${who.id}`)
      } else if (call) {
        const who = find(call[2])
        if (!who) return speak(`I couldn't find ${call[2]} in your contacts.`, true)
        speak(`Calling ${who.name}`, true)
        void startCall(who.id, !!call[1])
      } else if (/^(who|list|read) (are )?(my )?(contacts|chats)$/.test(t)) {
        const names = ctx.current.contacts.map((c) => c.name)
        speak(names.length ? `Your chats: ${names.join(', ')}.` : 'You have no contacts yet.', true)
      } else {
        speak('Say: Hey AnyWay, send, a name, and your message. Or: Hey AnyWay, open, and a name.', true)
      }
    }
    setWakeWord(true, (text) => routeVoice(text, outsideChat), setState)
    return () => setWakeWord(false)
  }, [user, nav])

  if (!canListen) return <div className="wake-pill off" role="status">Voice needs Chrome or Edge</div>
  return (
    <div className={`wake-pill ${state}`} role="status" aria-live="polite">
      <Mic size={14} aria-hidden="true" />
      {state === 'awake' ? 'Listening…' : state === 'waiting' ? 'Say “Hey AnyWay”' : 'Voice off: allow the microphone'}
    </div>
  )
}
