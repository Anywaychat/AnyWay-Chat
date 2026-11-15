import { useEffect, useState } from 'react'
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
  sendFile,
  sendText,
  sendTyping,
  watchPresence,
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

  useEffect(() => {
    if (status !== 'connected') return
    let alive = true
    setLoading(true)
    setMessages([])
    loadHistory(target).then((h) => {
      if (!alive) return
      setMessages(h)
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
      setFailed("Couldn't send that message. Check your connection, or this person may not be accepting messages.")
      setTimeout(() => setFailed(null), 6000)
      return
    }
    setFailed(null)
    setMessages((list) => [...list, m])
  }

  return {
    messages,
    status,
    loading,
    me,
    typing,
    failed,
    send: async (text: string, origin: Origin) => {
      if (text.trim()) add(await sendText(target, text.trim(), origin))
    },
    sendFile: async (file: File) => add(await sendFile(target, file)),
    sendVoice: async (blob: Blob) => add(await sendVoice(target, blob)),
    reply: async (text: string, origin: Origin, to: ChatMessage) => {
      if (text.trim()) add(await sendReply(target, text.trim(), origin, to))
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
export function usePresence() {
  const { contacts } = useAuth()
  const status = useConnection()
  const [online, setOnline] = useState<Set<string>>(new Set())
  const ids = contacts.map((c) => c.id).join(',')
  useEffect(() => {
    if (status !== 'connected' || !ids) return
    let alive = true
    const refresh = () => watchPresence(ids.split(',')).then((s) => alive && setOnline(s))
    refresh()
    const off = onPresence(refresh)
    const t = setInterval(refresh, 30000)
    return () => {
      alive = false
      off()
      clearInterval(t)
    }
  }, [status, ids])
  return online
}

/** Shows a browser notification for new messages when you aren't looking at that chat. */
export function useNotifications(openKey: string | null) {
  const { me } = useProfile()
  const { groups } = useAuth()
  useEffect(() => {
    if (!me) return
    return onMessage((m) => {
      if (m.from === me) return
      if (!document.hidden && m.key === openKey) return
      if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
      const sender = contactById(m.from).name
      const group = m.key.startsWith('group:') ? groups.find((g) => `group:${g.id}` === m.key)?.name : undefined
      const n = new Notification(group ? `${sender} in ${group}` : sender, { body: m.type === 'text' ? m.text : m.type === 'image' ? 'Sent a photo' : `Sent a file: ${m.fileName}`, tag: m.key })
      n.onclick = () => {
        window.focus()
        window.location.href = m.key.startsWith('group:') ? `/group/${m.key.slice(6)}` : `/chat/${m.key.slice(7)}`
      }
    })
  }, [me, openKey, groups])
}
