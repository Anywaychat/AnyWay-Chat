import { useEffect, useState } from 'react'
import { connectAs, loadHistory, onMessage, onStatus, sendText, type ChatMessage, type Origin } from './nexconn'
import { useProfile } from './state'

export type Status = 'connecting' | 'connected' | 'error'

/** Keeps the signed-in user connected to Nexconn. */
export function useConnection() {
  const { me, name } = useProfile()
  const [status, setStatus] = useState<Status>('connecting')
  useEffect(() => {
    const off = onStatus(setStatus)
    return () => {
      off()
    }
  }, [])
  useEffect(() => {
    connectAs(me, name).then((ok) => setStatus(ok ? 'connected' : 'error'))
  }, [me, name])
  return status
}

/** Live message thread with one person. */
export function useThread(peer: string) {
  const { me } = useProfile()
  const status = useConnection()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (status !== 'connected') return
    let alive = true
    setLoading(true)
    loadHistory(peer).then((h) => {
      if (alive) {
        setMessages(h)
        setLoading(false)
      }
    })
    const off = onMessage((m) => {
      if (m.from === peer && m.to === me) setMessages((list) => (list.some((x) => x.id === m.id) ? list : [...list, m]))
    })
    return () => {
      alive = false
      void off()
    }
  }, [peer, me, status])

  const send = async (text: string, origin: Origin) => {
    const clean = text.trim()
    if (!clean) return
    const m = await sendText(peer, clean, origin)
    if (m) setMessages((list) => [...list, m])
  }

  return { messages, send, status, loading, me }
}
