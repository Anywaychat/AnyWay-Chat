import {
  BaseChannel,
  ChannelHandler,
  ChannelType,
  ConnectionStatusHandler,
  DirectChannel,
  GroupChannel,
  Helper,
  MessageHandler,
  NCEngine,
  SendTextMessageParams,
  SubscribeType,
  UserHandler,
  type Message,
} from '@nexconn/chat'
import type { Mode } from './state'

/** How a message was originally made, carried alongside the text so each receiver can render it their way. */
export interface Origin {
  mode: Mode
  gloss?: string
  confidence?: number
}

export type Kind = 'direct' | 'group'

/** A conversation: one person (direct) or a group. */
export interface Target {
  kind: Kind
  id: string
}

export interface ChatMessage {
  id: string
  /** Conversation key, e.g. `direct:priya` or `group:g123`. */
  key: string
  from: string
  text: string
  type: 'text' | 'image' | 'file'
  url?: string
  thumb?: string
  fileName?: string
  fileSize?: number
  origin?: Origin
  sentTime: number
  read?: boolean
}

export const keyOf = (t: Target) => `${t.kind}:${t.id}`

type Listener = (m: ChatMessage) => void
type StatusListener = (s: 'connecting' | 'connected' | 'error') => void

let initialized = false
let connectedAs: string | null = null
let connecting: Promise<boolean> | null = null
const listeners = new Set<Listener>()
const statusListeners = new Set<StatusListener>()
const typingListeners = new Set<(key: string, userIds: string[]) => void>()
const receiptListeners = new Set<(key: string, messageIds: string[]) => void>()
const presenceListeners = new Set<() => void>()
const sentListeners = new Set<() => void>()

const channelFor = (t: Target) => (t.kind === 'group' ? new GroupChannel(t.id) : new DirectChannel(t.id))

function keyFromIdentifier(type: number, id: string) {
  return `${type === ChannelType.GROUP ? 'group' : 'direct'}:${id}`
}

function toChat(m: Message): ChatMessage | null {
  const c = m.content as Record<string, unknown>
  const base = {
    id: m.messageId || `${m.sentTime}-${m.senderUserId}`,
    key: keyFromIdentifier(m.channelIdentifier.channelType, m.channelIdentifier.channelId),
    from: m.senderUserId,
    sentTime: m.sentTime,
  }
  if (m.messageType === 'RC:TxtMsg') {
    let origin: Origin | undefined
    try {
      origin = c.extra ? (JSON.parse(String(c.extra)) as Origin) : undefined
    } catch {
      origin = undefined
    }
    return { ...base, type: 'text', text: String(c.text ?? ''), origin }
  }
  if (m.messageType === 'RC:ImgMsg') {
    const thumb = c.thumbnailBase64 ? `data:image/jpeg;base64,${String(c.thumbnailBase64)}` : undefined
    return { ...base, type: 'image', text: 'Photo', url: String(c.remoteUrl ?? ''), thumb }
  }
  if (m.messageType === 'RC:FileMsg') {
    return { ...base, type: 'file', text: String(c.name ?? 'File'), url: String(c.remoteUrl ?? ''), fileName: String(c.name ?? 'File'), fileSize: Number(c.size ?? 0) }
  }
  return null
}

function emitStatus(s: Parameters<StatusListener>[0]) {
  statusListeners.forEach((l) => l(s))
}

const sub = <T>(set: Set<T>, l: T) => {
  set.add(l)
  return () => {
    set.delete(l)
  }
}
export const onStatus = (l: StatusListener) => sub(statusListeners, l)
export const onMessage = (l: Listener) => sub(listeners, l)
export const onTyping = (l: (key: string, userIds: string[]) => void) => sub(typingListeners, l)
export const onReceipt = (l: (key: string, messageIds: string[]) => void) => sub(receiptListeners, l)
export const onPresence = (l: () => void) => sub(presenceListeners, l)
/** Fires after this device sends a message, so the chat list can refresh. */
export const onSent = (l: () => void) => sub(sentListeners, l)

export function currentUser() {
  return connectedAs
}

function setupHandlers() {
  NCEngine.addConnectionStatusHandler('anyway', new ConnectionStatusHandler({ onConnectionStatusChanged: () => {} }))
  NCEngine.addMessageHandler(
    'anyway',
    new MessageHandler({
      onMessageReceived({ messages }) {
        messages.forEach((m) => {
          const cm = toChat(m)
          if (cm) listeners.forEach((l) => l(cm))
        })
      },
      onMessageReceiptResponse({ responses }) {
        const byKey = new Map<string, string[]>()
        responses.forEach((r) => {
          if (r.readCount <= 0) return
          const k = keyFromIdentifier(r.channelIdentifier.channelType, r.channelIdentifier.channelId)
          byKey.set(k, [...(byKey.get(k) ?? []), r.messageId])
        })
        byKey.forEach((ids, k) => receiptListeners.forEach((l) => l(k, ids)))
      },
    }),
  )
  NCEngine.addChannelHandler(
    'anyway',
    new ChannelHandler({
      onTypingStatusChanged({ channelIdentifier, userTypingStatus }) {
        const k = keyFromIdentifier(channelIdentifier.channelType, channelIdentifier.channelId)
        const ids = userTypingStatus.map((u) => u.userId).filter((id) => id !== connectedAs)
        typingListeners.forEach((l) => l(k, ids))
      },
    }),
  )
  NCEngine.addUserHandler(
    'anyway',
    new UserHandler({
      onSubscriptionChanged() {
        presenceListeners.forEach((l) => l())
      },
    }),
  )
}

/** Connect the signed-in user. Safe to call repeatedly; reconnects only when the user changes. */
export async function connectAs(userId: string): Promise<boolean> {
  if (connectedAs === userId) return true
  if (connecting) await connecting
  if (connectedAs === userId) return true

  connecting = (async () => {
    emitStatus('connecting')
    if (!initialized) {
      NCEngine.initialize({ appKey: import.meta.env.VITE_NEXCONN_APP_KEY })
      setupHandlers()
      initialized = true
    }
    if (connectedAs) await NCEngine.disconnect()
    try {
      const session = sessionStorage.getItem('anyway.session') ?? localStorage.getItem('anyway.session') ?? ''
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

export async function disconnect() {
  if (!connectedAs) return
  await NCEngine.disconnect()
  connectedAs = null
}

export async function sendText(t: Target, text: string, origin: Origin): Promise<ChatMessage | null> {
  const params = new SendTextMessageParams({ text, extra: JSON.stringify(origin) })
  params.needReceipt = t.kind === 'direct'
  const { code, data } = await channelFor(t).sendMessage(params)
  if (code !== 0 || !data) return null
  sentListeners.forEach((l) => l())
  return toChat(data)
}

/** Sends a photo or any other file. Images become photo messages; everything else a file message. */
export async function sendFile(t: Target, file: File): Promise<ChatMessage | null> {
  const isImage = file.type.startsWith('image/') && file.type !== 'image/gif'
  const made = isImage ? await Helper.createSendImageMessageParams(file) : await Helper.createSendFileMessageParams(file)
  if (made.code !== 0 || !made.data) return null
  const { code, data } = await channelFor(t).sendMediaMessage(made.data as never)
  if (code !== 0 || !data) return null
  sentListeners.forEach((l) => l())
  return toChat(data as Message)
}

let lastTyping = 0
export function sendTyping(t: Target) {
  if (t.kind !== 'direct') return
  const now = Date.now()
  if (now - lastTyping < 3000) return
  lastTyping = now
  if (t.kind === 'direct') void new DirectChannel(t.id).sendTypingStatus('RC:TxtMsg')
}

export async function loadHistory(t: Target): Promise<ChatMessage[]> {
  const query = BaseChannel.createMessagesQuery({
    channelIdentifier: channelFor(t).identifier,
    startTime: Date.now(),
    pageSize: 50,
    isAscending: false,
  })
  const { code, data } = await query.loadNextPage()
  if (code !== 0 || !data) return []
  const list = (Array.isArray(data) ? data : (data as { data?: Message[] }).data ?? []) as Message[]
  return list
    .map((m) => {
      const cm = toChat(m)
      if (cm && m.senderUserId === connectedAs && m.needReceipt) cm.read = m.sentReceipt
      return cm
    })
    .filter((m): m is ChatMessage => !!m)
    .sort((a, b) => a.sentTime - b.sentTime)
}

/** Clears unread and tells the sender their direct messages were read. */
export async function markRead(t: Target, incoming: ChatMessage[] = []) {
  const ch = channelFor(t)
  await ch.clearUnreadCount()
  const ids = incoming.filter((m) => m.from !== connectedAs).map((m) => m.id)
  if (t.kind === 'direct' && ids.length) await ch.sendReadReceiptResponse(ids).catch(() => {})
}

export interface ChannelSummary {
  key: string
  lastText: string
  lastFrom: string
  lastTime: number
  unread: number
}

/** Conversations with their latest message and unread count, newest first. */
export async function loadChannels(): Promise<ChannelSummary[]> {
  const query = BaseChannel.createChannelsQuery({ pageSize: 50 })
  const { code, data } = await query.loadNextPage()
  if (code !== 0 || !data) return []
  const list = (Array.isArray(data) ? data : (data as { data?: BaseChannel[] }).data ?? []) as BaseChannel[]
  return list
    .filter((c) => c.channelType === ChannelType.DIRECT || c.channelType === ChannelType.GROUP)
    .map((c) => {
      const m = c.latestMessage
      const cm = m ? toChat(m) : null
      return {
        key: keyFromIdentifier(c.channelType, c.channelId),
        lastText: cm ? (cm.type === 'image' ? 'Photo' : cm.type === 'file' ? `File: ${cm.fileName}` : cm.text) : m ? 'Message' : '',
        lastFrom: m?.senderUserId ?? '',
        lastTime: m?.sentTime ?? c.operationTime,
        unread: c.unreadCount,
      }
    })
    .sort((a, b) => b.lastTime - a.lastTime)
}

/** Watches contacts' online status. Returns the ids currently online. */
export async function watchPresence(userIds: string[]): Promise<Set<string>> {
  if (!userIds.length) return new Set()
  await NCEngine.userModule.subscribeEvent({ subscribeType: SubscribeType.ONLINE_STATUS, userIds, expiry: 86400 }).catch(() => {})
  const r = await NCEngine.userModule.getSubscribeUsersOnlineStatus(userIds).catch(() => null)
  const online = new Set<string>()
  if (r && r.code === 0 && r.data) r.data.forEach((s) => s.isOnline && online.add(s.userId))
  return online
}

/** Creates a group on Nexconn with the given members. */
export async function createGroup(groupId: string, groupName: string, memberIds: string[]) {
  const r = await GroupChannel.createGroup({ groupId, groupName, inviteeUserIds: memberIds })
  return r.code
}
