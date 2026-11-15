import {
  BaseChannel,
  ConnectionStatusHandler,
  DirectChannel,
  MessageHandler,
  NCEngine,
  SendTextMessageParams,
  type Message,
} from '@nexconn/chat'
import type { Mode } from './state'

/** How a message was originally made, carried alongside the text so each receiver can render it their way. */
export interface Origin {
  mode: Mode
  gloss?: string
  confidence?: number
}

export interface ChatMessage {
  id: string
  from: string
  to: string
  text: string
  origin?: Origin
  sentTime: number
}

type Listener = (m: ChatMessage) => void
type StatusListener = (s: 'connecting' | 'connected' | 'error') => void

let initialized = false
let connectedAs: string | null = null
let connecting: Promise<boolean> | null = null
const listeners = new Set<Listener>()
const statusListeners = new Set<StatusListener>()

function toChat(m: Message): ChatMessage | null {
  if (m.messageType !== 'RC:TxtMsg') return null
  const c = m.content as { text?: string; extra?: string }
  let origin: Origin | undefined
  try {
    origin = c.extra ? (JSON.parse(c.extra) as Origin) : undefined
  } catch {
    origin = undefined
  }
  const peer = m.channelIdentifier.channelId
  const mine = m.senderUserId === connectedAs
  return {
    id: m.messageId || `${m.sentTime}-${m.senderUserId}`,
    from: m.senderUserId,
    to: mine ? peer : (connectedAs ?? ''),
    text: c.text ?? '',
    origin,
    sentTime: m.sentTime,
  }
}

function emitStatus(s: Parameters<StatusListener>[0]) {
  statusListeners.forEach((l) => l(s))
}

export function onStatus(l: StatusListener) {
  statusListeners.add(l)
  return () => statusListeners.delete(l)
}

export function onMessage(l: Listener) {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function currentUser() {
  return connectedAs
}

/** Connect as a demo user. Safe to call repeatedly; reconnects only when the user changes. */
export async function connectAs(userId: string, name: string): Promise<boolean> {
  if (connectedAs === userId) return true
  if (connecting) await connecting
  if (connectedAs === userId) return true

  connecting = (async () => {
    emitStatus('connecting')
    if (!initialized) {
      NCEngine.initialize({ appKey: import.meta.env.VITE_NEXCONN_APP_KEY })
      NCEngine.addConnectionStatusHandler(
        'anyway',
        new ConnectionStatusHandler({ onConnectionStatusChanged: () => {} }),
      )
      NCEngine.addMessageHandler(
        'anyway',
        new MessageHandler({
          onMessageReceived({ messages }) {
            messages.forEach((m) => {
              const cm = toChat(m)
              if (cm) listeners.forEach((l) => l(cm))
            })
          },
        }),
      )
      initialized = true
    }
    if (connectedAs) await NCEngine.disconnect()
    try {
      void name
      const session = localStorage.getItem('anyway.session') ?? ''
      const r = await fetch('/api/nexconn-token', { headers: { Authorization: `Bearer ${session}` } })
      const { token } = (await r.json()) as { token?: string }
      if (!token) throw new Error('no token')
      const res = await NCEngine.connect({ token })
      if (res.code !== 0) throw new Error(`connect ${res.code}`)
      connectedAs = userId
      emitStatus('connected')
      return true
    } catch {
      connectedAs = null
      emitStatus('error')
      return false
    }
  })()
  const ok = await connecting
  connecting = null
  return ok
}

export async function sendText(to: string, text: string, origin: Origin): Promise<ChatMessage | null> {
  const channel = new DirectChannel(to)
  const params = new SendTextMessageParams({ text, extra: JSON.stringify(origin) })
  const { code, data } = await channel.sendMessage(params)
  if (code !== 0 || !data) return null
  return toChat(data)
}

export async function loadHistory(peer: string): Promise<ChatMessage[]> {
  const channel = new DirectChannel(peer)
  const query = BaseChannel.createMessagesQuery({
    channelIdentifier: channel.identifier,
    startTime: Date.now(),
    pageSize: 50,
    isAscending: false,
  })
  const { code, data } = await query.loadNextPage()
  if (code !== 0 || !data) return []
  const list = (Array.isArray(data) ? data : (data as { data?: Message[] }).data ?? []) as Message[]
  return list
    .map(toChat)
    .filter((m): m is ChatMessage => !!m)
    .sort((a, b) => a.sentTime - b.sentTime)
}

export interface ChannelSummary {
  peer: string
  lastText: string
  lastFrom: string
  lastTime: number
  unread: number
}

/** Direct chats with their latest message and unread count, newest first. */
export async function loadChannels(): Promise<ChannelSummary[]> {
  const query = BaseChannel.createChannelsQuery({ pageSize: 50 })
  const { code, data } = await query.loadNextPage()
  if (code !== 0 || !data) return []
  const list = (Array.isArray(data) ? data : (data as { data?: BaseChannel[] }).data ?? []) as BaseChannel[]
  return list
    .filter((c) => c instanceof DirectChannel || c.identifier.channelType === new DirectChannel('x').identifier.channelType)
    .map((c) => {
      const m = c.latestMessage
      const text = m && m.messageType === 'RC:TxtMsg' ? ((m.content as { text?: string }).text ?? '') : m ? 'Message' : ''
      return { peer: c.channelId, lastText: text, lastFrom: m?.senderUserId ?? '', lastTime: m?.sentTime ?? c.operationTime, unread: c.unreadCount }
    })
    .sort((a, b) => b.lastTime - a.lastTime)
}

export async function markRead(peer: string) {
  await new DirectChannel(peer).clearUnreadCount()
}
