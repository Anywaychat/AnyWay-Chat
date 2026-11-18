import { getBlindPrefs } from './blindPrefs'
import { showLocalNotification } from './push'
import { useEffect, useRef, useState } from 'react'
import {
  connectAs,
  keyOf,
  loadChannels,
  loadHistory,
  markRead,
  onChange,
  sendReply,
  editMessage,
  deleteForEveryone,
  toggleReaction,
  sendVoice,
  onMessage,
  onPresence,
  onReceipt,
  onSent,
  onStatus,
  onTyping,
  onLink,
  getLink,
  type Link,
  sendFile,
  sendText,
  sendTyping,
  subscribePresence,
  queryPresence,
  type ChannelSummary,
  type ChatMessage,
  type Origin,
  type Target,
} from './nexconn'
import { contactById, useAuth, useProfile } from './state'

export type Status = 'connecting' | 'connected' | 'error'

/** Keeps the signed-in user connected to Nexconn. */
export function useConnection() {
  const { me } = useProfile()
  const [status, setStatus] = useState<Status>('connecting')
  useEffect(() => onStatus(setStatus), [])
  useEffect(() => {
    if (!me) return
    connectAs(me).then((ok) => setStatus(ok ? 'connected' : 'error'))
  }, [me])
  return status
}

/** Live conversation with one person or a group. */
export function useThread(target: Target) {
  const { me } = useProfile()
  const status = useConnection()
  const key = keyOf(target)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [typing, setTyping] = useState<string[]>([])
  const [failed, setFailed] = useState<string | null>(null)
  const retries = useRef(new Map<string, { text: string; origin: Origin; to?: ChatMessage }>())

  useEffect(() => {
    if (status !== 'connected') return
    let alive = true
    setLoading(true)
    setMessages([])
    loadHistory(target).then((h) => {
      if (!alive) return
      // Messages still being sent, or kept after failing, stay on screen.
      setMessages((list) => [...h, ...list.filter((m) => m.key === key && (m.pending || m.failed))])
      setLoading(false)
      void markRead(target, h)
    })
    const offMsg = onMessage((m) => {
      if (m.key !== key || m.from === me) return
      setMessages((list) => (list.some((x) => x.id === m.id) ? list : [...list, m]))
      setTyping([])
      if (!document.hidden) void markRead(target, [m])
    })
    let typingTimer: ReturnType<typeof setTimeout> | undefined
    const offTyping = onTyping((k, ids) => {
      if (k !== key) return
      setTyping(ids)
      clearTimeout(typingTimer)
      typingTimer = setTimeout(() => setTyping([]), 6000)
    })
    const offReceipt = onReceipt((k, ids) => {
      if (k !== key) return
      setMessages((list) => list.map((m) => (ids.includes(m.id) ? { ...m, read: true } : m)))
    })
    const offChange = onChange((c) => {
      if (c.kind === 'update') {
        if (c.message.key !== key) return
        setMessages((list) => list.map((m) => (m.id === c.message.id ? { ...c.message, read: m.read } : m)))
      } else if (c.key === key) {
        if (c.kind === 'delete') setMessages((list) => list.filter((m) => m.id !== c.id))
        else setMessages((list) => list.map((m) => (m.id === c.id ? { ...m, reactions: c.reactions } : m)))
      }
    })
    return () => {
      alive = false
      offChange()
      offMsg()
      offTyping()
      offReceipt()
      clearTimeout(typingTimer)
    }
    // target is rebuilt each render; key captures its identity
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, me, status])

  const add = (m: ChatMessage | null) => {
    if (!m) {
      setFailed("Couldn't send that. Check your connection, or this person may not be accepting messages.")
      setTimeout(() => setFailed(null), 6000)
      return
    }
    setFailed(null)
    setMessages((list) => [...list, m])
  }
  /**
   * Text appears straight away as "Sending…" and is swapped for the real message once it's sent. If sending fails,
   * it stays with Retry instead of disappearing (typed words used to be lost when the connection dropped).
   */
  const sendNow = async (text: string, origin: Origin, to?: ChatMessage, localId?: string) => {
    const id = localId ?? `local-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    const draft: ChatMessage = { id, key, from: me, text, type: 'text', origin, sentTime: Date.now(), pending: true, replyTo: to ? { id: to.id, from: to.from, text: to.text } : undefined }
    retries.current.set(id, { text, origin, to })
    setMessages((list) => (list.some((m) => m.id === id) ? list.map((m) => (m.id === id ? draft : m)) : [...list, draft]))
    const sent = await (to ? sendReply(target, text, origin, to) : sendText(target, text, origin)).catch(() => null)
    if (sent) {
      retries.current.delete(id)
      setFailed(null)
      setMessages((list) => (list.some((m) => m.id === sent.id) ? list.filter((m) => m.id !== id) : list.map((m) => (m.id === id ? sent : m))))
    } else {
      setFailed('Not sent. Your message is kept in the chat: tap Retry.')
      setTimeout(() => setFailed(null), 6000)
      setMessages((list) => list.map((m) => (m.id === id ? { ...m, pending: false, failed: true } : m)))
    }
  }

  return {
    messages,
    status,
    loading,
    me,
    typing,
    failed,
    send: async (text: string, origin: Origin) => {
      if (text.trim()) await sendNow(text.trim(), origin)
    },
    retry: (id: string) => {
      const r = retries.current.get(id)
      if (r) void sendNow(r.text, r.origin, r.to, id)
    },
    discard: (id: string) => {
      retries.current.delete(id)
      setMessages((list) => list.filter((m) => m.id !== id))
    },
    sendFile: async (file: File) => add(await sendFile(target, file)),
    sendVoice: async (blob: Blob) => add(await sendVoice(target, blob)),
    reply: async (text: string, origin: Origin, to: ChatMessage) => {
      if (text.trim()) await sendNow(text.trim(), origin, to)
    },
    edit: async (id: string, text: string) => {
      if (await editMessage(id, text.trim())) setMessages((list) => list.map((m) => (m.id === id ? { ...m, text: text.trim(), edited: true } : m)))
    },
    remove: async (id: string) => {
      if (await deleteForEveryone(target, id)) setMessages((list) => list.filter((m) => m.id !== id))
    },
    react: async (id: string, emoji: string) => {
      const r = await toggleReaction(id, emoji)
      setMessages((list) => list.map((m) => (m.id === id ? { ...m, reactions: r } : m)))
    },
    notifyTyping: () => sendTyping(target),
  }
}

/** Chat list: latest message and unread count per conversation, kept live. */
export function useChannels() {
  const status = useConnection()
  const [channels, setChannels] = useState<ChannelSummary[]>([])
  useEffect(() => {
    if (status !== 'connected') return
    let alive = true
    const refresh = () => loadChannels().then((c) => alive && setChannels(c))
    refresh()
    const first = setTimeout(refresh, 1500)
    const later = () => setTimeout(refresh, 400)
    const off1 = onMessage(later)
    const off2 = onSent(later)
    const t = setInterval(refresh, 15000)
    return () => {
      alive = false
      off1()
      off2()
      clearTimeout(first)
      clearInterval(t)
    }
  }, [status])
  return { channels, status }
}

/** Which contacts are online right now. */
// One shared presence watcher for the whole app. Before, every screen showing an online dot subscribed on its own,
// and each subscribe fired a presence event that triggered another subscribe: a loop Nexconn started refusing (20607).
let presenceKey = ''
let presenceOnline = new Set<string>()
let presenceTimer: ReturnType<typeof setTimeout> | undefined
const presenceViews = new Set<(s: Set<string>) => void>()
function readPresence(ids: string[]) {
  clearTimeout(presenceTimer)
  // Bunch up bursts of presence events into one read.
  presenceTimer = setTimeout(async () => {
    presenceOnline = await queryPresence(ids)
    presenceViews.forEach((v) => v(presenceOnline))
  }, 400)
}

export function usePresence() {
  const { contacts } = useAuth()
  const status = useConnection()
  const [online, setOnline] = useState<Set<string>>(presenceOnline)
  const ids = contacts.map((c) => c.id).sort().join(',')
  useEffect(() => {
    presenceViews.add(setOnline)
    return () => {
      presenceViews.delete(setOnline)
    }
  }, [])
  useEffect(() => {
    if (status !== 'connected' || !ids) return
    const list = ids.split(',')
    if (presenceKey !== ids) {
      presenceKey = ids
      void subscribePresence(list).then(() => readPresence(list))
    }
    const off = onPresence(() => readPresence(list))
    const t = setInterval(() => readPresence(list), 60000)
    return () => {
      off()
      clearInterval(t)
    }
  }, [status, ids])
  return online
}

/** Shows a browser notification for new messages when you aren't looking at that chat. */
export function useNotifications(openKey: string | null) {
  const { me, mode } = useProfile()
  const { groups } = useAuth()
  useEffect(() => {
    if (!me) return
    return onMessage((m) => {
      if (m.from === me || m.catchUp) return
      // Deaf users can't hear a message tone, blind users get a tap to go with the voice.
      if (mode === 'deaf') navigator.vibrate?.([250, 120, 250])
      else if (mode === 'blind') navigator.vibrate?.(120)
      const sender = contactById(m.from).name
      const group = m.key.startsWith('group:') ? groups.find((g) => `group:${g.id}` === m.key)?.name : undefined
      const body = m.type === 'text' ? m.text : m.type === 'image' ? 'Sent a photo' : m.type === 'voice' ? 'Sent a voice message' : `Sent a file: ${m.fileName}`
      const url = m.key.startsWith('group:') ? `/group/${m.key.slice(6)}` : `/chat/${m.key.slice(7)}`
      const here = !document.hidden && m.key === openKey
      // On-screen flash: the edge glows (deaf users see it even inside the chat), plus a banner for other chats.
      if (!document.hidden && (!here || mode === 'deaf')) window.dispatchEvent(new CustomEvent('anyway:flash', { detail: { title: group ? `${sender} in ${group}` : sender, body, url: here ? null : url } }))
      // A message sound for everyone who can hear (blind users also hear it read aloud in the open chat).
      if (mode !== 'deaf' && !document.hidden && getBlindPrefs().sounds) chime()
      if (here) return
      if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
      void showLocalNotification(group ? `${sender} in ${group}` : sender, body, m.key, url)
    })
  }, [me, mode, openKey, groups])
}

/** A short two-note chime for a new message. */
let chimeCtx: AudioContext | null = null
function chime() {
  try {
    chimeCtx ??= new AudioContext()
    const ctx = chimeCtx
    void ctx.resume()
    ;[[660, 0], [990, 0.12]].forEach(([f, at]) => {
      const o = ctx.createOscillator(); const g = ctx.createGain()
      o.frequency.value = f; o.connect(g); g.connect(ctx.destination)
      const t = ctx.currentTime + at
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.2, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25)
      o.start(t); o.stop(t + 0.26)
    })
  } catch { /* no audio */ }
}

/** The chat connection: online, reconnecting, or offline. */
export function useLink(): Link {
  const [l, setL] = useState<Link>(getLink())
  useEffect(() => onLink(setL), [])
  return l
}
