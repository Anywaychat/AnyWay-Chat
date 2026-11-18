import {
  BaseChannel,
  ChannelHandler,
  ChannelType,
  ConnectionStatus,
  ConnectionStatusHandler,
  DirectChannel,
  GroupChannel,
  Helper,
  MessageDirection,
  MessageHandler,
  NCEngine,
  SendReferenceMessageParams,
  SendTextMessageParams,
  SendMessageParams,
  SubscribeType,
  UserHandler,
  type Message,
} from '@nexconn/chat'
import type { Mode } from './state'
import { installCalls, setCallUser, startCallEngine } from './calls'
import { notifyPush } from './push'
import { takeStartToken } from './startToken'

/** How a message was originally made, carried alongside the text so each receiver can render it their way. */
export interface Origin {
  mode: Mode
  /** How it was made: signed to the camera, spoken, tapped on the phrase board, or typed. */
  how?: 'signed' | 'spoken' | 'tapped' | 'typed'
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
  type: 'text' | 'image' | 'file' | 'voice'
  replyTo?: { id: string; from: string; text: string }
  edited?: boolean
  reactions?: Record<string, string[]>
  duration?: number
  url?: string
  thumb?: string
  fileName?: string
  fileSize?: number
  origin?: Origin
  sentTime: number
  read?: boolean
  /** Arrived while you were away and was delivered when you connected: shown in the chat, but not announced one by one. */
  catchUp?: boolean
  /** Shown straight away while it is being sent (local id), or kept with Retry if sending failed. */
  pending?: boolean
  failed?: boolean
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
/** Edits, deletions and reaction changes to messages already on screen. */
export type Change = { kind: 'update'; message: ChatMessage } | { kind: 'delete'; key: string; id: string } | { kind: 'react'; key: string; id: string; reactions?: Record<string, string[]> }
const changeListeners = new Set<(c: Change) => void>()

const channelFor = (t: Target) => (t.kind === 'group' ? new GroupChannel(t.id) : new DirectChannel(t.id))

function keyFromIdentifier(type: number, id: string) {
  return `${type === ChannelType.GROUP ? 'group' : 'direct'}:${id}`
}

/** The SDK's own message objects, kept so we can edit, delete and react to them later. */
const raw = new Map<string, Message>()

function reactionsOf(m: Message): Record<string, string[]> | undefined {
  const out: Record<string, string[]> = {}
  m.metadata?.forEach((v, k) => {
    if (!k.startsWith('r_')) return
    try {
      const ids = JSON.parse(v) as string[]
      if (ids.length) out[decodeURIComponent(k.slice(2).replace(/_/g, '%'))] = ids
    } catch {
      /* ignore bad data */
    }
  })
  return Object.keys(out).length ? out : undefined
}

function toChat(m: Message): ChatMessage | null {
  if (m.messageId) raw.set(m.messageId, m)
  const c = m.content as Record<string, unknown>
  const base = {
    id: m.messageId || `${m.sentTime}-${m.senderUserId}`,
    key: keyFromIdentifier(m.channelIdentifier.channelType, m.channelIdentifier.channelId),
    // Messages you sent always count as yours (a missing sender put them on the other side of the chat).
    from: m.senderUserId || (m.direction === MessageDirection.SEND ? connectedAs ?? '' : ''),
    sentTime: m.sentTime,
    edited: m.hasChanged || undefined,
    reactions: reactionsOf(m),
  }
  if (m.messageType === 'RC:ReferenceMsg') {
    const refText = String((c.referMsg as { content?: string; text?: string } | undefined)?.content ?? (c.referMsg as { text?: string } | undefined)?.text ?? '')
    const refId = String(c.referMsgId ?? c.referMsgUid ?? '')
    const refFrom = String(c.referMsgSenderId ?? c.referMsgUserId ?? '')
    return { ...base, type: 'text', text: String(c.text ?? c.content ?? ''), replyTo: { id: refId, from: refFrom, text: refText || raw.get(refId)?.content?.text || 'Message' } }
  }
  if (m.messageType === 'RC:HQVCMsg') {
    return { ...base, type: 'voice', text: 'Voice message', url: String(c.remoteUrl ?? ''), duration: Number(c.duration ?? 0) }
  }
  if (m.messageType === 'RC:TxtMsg') {
    let origin: Origin | undefined
    try {
      origin = c.extra ? (JSON.parse(String(c.extra)) as Origin) : undefined
    } catch {
      origin = undefined
    }
    return { ...base, type: 'text', text: String(c.text || c.content || ''), origin }
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
export const onChange = (l: (c: Change) => void) => sub(changeListeners, l)
const emitChange = (c: Change) => changeListeners.forEach((l) => l(c))

export function currentUser() {
  return connectedAs
}

/* ---------- Live call captions ---------- */
const CAPTION_TYPE = 'anyway:caption'
/** One line said or typed during a call. `how`: spoken (speech to text), typed, tapped or signed. */
export interface Caption { text: string; how: 'spoken' | 'typed' | 'tapped' | 'signed'; final: boolean; from?: string; lang?: string; /** Empty "hello" lines carry what this person needs: captions, and their language. */ want?: boolean }
const captionListeners = new Set<(c: Caption) => void>()
export const onCaption = (l: (c: Caption) => void) => sub(captionListeners, l)
/** Sends a caption to the other person in the call (direct chat channel, not stored). */
export async function sendCaption(to: string, c: Caption) {
  const params = new SendMessageParams({ text: c.text, how: c.how, final: c.final, lang: c.lang, want: c.want }, CAPTION_TYPE)
  params.disableNotification = true
  params.disableUpdateLastMessage = true
  await new DirectChannel(to).sendMessage(params as never).catch(() => {})
}

// Messages that arrived while you were offline are delivered right after connecting. They go into the chats, but
// aren't read aloud, flashed or chimed one by one (a blind user heard every missed message on opening the app).
let catchingUp = true
let catchUpTimer: ReturnType<typeof setTimeout> | undefined
function startCatchUp() {
  catchingUp = true
  clearTimeout(catchUpTimer)
  catchUpTimer = setTimeout(() => (catchingUp = false), 8000) // in case the "sync finished" event never comes
}

/* ---------- Connection state, shown to everyone (it used to be invisible after the first connect) ---------- */
export type Link = 'online' | 'connecting' | 'offline'
let link: Link = 'online'
const linkListeners = new Set<(l: Link) => void>()
export const onLink = (l: (l: Link) => void) => sub(linkListeners, l)
export const getLink = () => link
let linkTimer: ReturnType<typeof setInterval> | undefined
function setLink(l: Link) {
  if (l === link) return
  link = l
  linkListeners.forEach((f) => f(l))
  // While not online, check the chat connection's real state every few seconds: the service doesn't always report
  // coming back (when the connection never really dropped), which left "Reconnecting…" on screen.
  clearInterval(linkTimer)
  if (l !== 'online') linkTimer = setInterval(syncLink, 3000)
}
function syncLink() {
  if (!initialized || !connectedAs) return
  if (!navigator.onLine) return setLink('offline')
  let st: ConnectionStatus | undefined
  try {
    st = NCEngine.getConnectionStatus()
  } catch {
    return
  }
  setLink(st === ConnectionStatus.CONNECTED ? 'online' : 'connecting')
}
if (typeof window !== 'undefined') {
  window.addEventListener('offline', () => setLink('offline'))
  window.addEventListener('online', () => {
    if (link === 'offline') setLink('connecting')
    setTimeout(syncLink, 800)
  })
}

function setupHandlers() {
  NCEngine.addConnectionStatusHandler(
    'anyway',
    new ConnectionStatusHandler({
      onConnectionStatusChanged({ status }) {
        if (status === ConnectionStatus.CONNECTED) setLink('online')
        else if (!navigator.onLine) setLink('offline')
        else setLink(status === ConnectionStatus.DISCONNECTED ? 'offline' : 'connecting')
      },
    }),
  )
  NCEngine.addMessageHandler(
    'anyway',
    new MessageHandler({
      onMessageReceived({ messages }) {
        messages.forEach((m) => {
          if (m.messageType === CAPTION_TYPE) {
            const c = m.content as unknown as Caption
            captionListeners.forEach((l) => l({ ...c, from: m.senderUserId }))
            return
          }
          const cm = toChat(m)
          if (!cm) return
          setLink('online')
          if (catchingUp) cm.catchUp = true
          listeners.forEach((l) => l(cm))
        })
      },
      onOfflineMessageSyncCompleted() {
        clearTimeout(catchUpTimer)
        catchingUp = false
      },
      onMessagesUpdated({ messages }) {
        messages.forEach((m) => {
          const cm = toChat(m)
          if (cm) emitChange({ kind: 'update', message: cm })
        })
      },
      onMessageDeleted({ messages }) {
        messages.forEach((d) => emitChange({ kind: 'delete', key: keyFromIdentifier(d.channelIdentifier.channelType, d.channelIdentifier.channelId), id: d.messageId }))
      },
      onMessageMetadataUpdated({ messageId, channelIdentifier, metadata }) {
        const m = raw.get(messageId)
        if (m) Object.entries(metadata).forEach(([k, v]) => m.metadata.set(k, v))
        emitChange({ kind: 'react', key: keyFromIdentifier(channelIdentifier.channelType, channelIdentifier.channelId), id: messageId, reactions: m ? reactionsOf(m) : undefined })
      },
      onMessageMetadataDeleted({ messageId, channelIdentifier, keys }) {
        const m = raw.get(messageId)
        if (m) keys.forEach((k) => m.metadata.delete(k))
        emitChange({ kind: 'react', key: keyFromIdentifier(channelIdentifier.channelType, channelIdentifier.channelId), id: messageId, reactions: m ? reactionsOf(m) : undefined })
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
      installCalls()
      NCEngine.initialize({ appKey: import.meta.env.VITE_NEXCONN_APP_KEY })
      // Live call captions: delivered instantly, never stored, never counted as unread.
      NCEngine.registerCustomMessages([{ messageType: CAPTION_TYPE, isPersisted: false, isCounted: false }])
      startCallEngine()
      setupHandlers()
      initialized = true
    }
    if (connectedAs) await NCEngine.disconnect()
    try {
      const session = sessionStorage.getItem('anyway.session') ?? localStorage.getItem('anyway.session') ?? ''
      const fresh = async () => ((await (await fetch('/api/nexconn-token', { headers: { Authorization: `Bearer ${session}` } })).json()) as { token?: string }).token
      // Use the token that came with the startup call (or the cached one); fetch a new one only if it's refused.
      let token = (await takeStartToken()) ?? (await fresh())
      if (!token) throw new Error('no token')
      setCallUser(userId)
      startCatchUp()
      let res = await NCEngine.connect({ token })
      if (res.code !== 0) {
        token = await fresh()
        if (!token) throw new Error('no token')
        res = await NCEngine.connect({ token })
      }
      if (res.code !== 0) throw new Error(`connect ${res.code}`)
      connectedAs = userId
      setCallUser(userId)
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
  setLink('online')
  notifyPush(t, text)
  sentListeners.forEach((l) => l())
  return toChat(data)
}

/** Sends a photo or any other file. Images become photo messages; everything else a file message. */
export async function sendFile(t: Target, file: File): Promise<ChatMessage | null> {
  const isImage = file.type.startsWith('image/') && file.type !== 'image/gif'
  const made = isImage ? await Helper.createSendImageMessageParams(file) : await Helper.createSendFileMessageParams(file)
  if (made.code !== 0 || !made.data) return null
  if (t.kind === 'direct') (made.data as { needReceipt?: boolean }).needReceipt = true
  const { code, data } = await channelFor(t).sendMediaMessage(made.data as never)
  if (code !== 0 || !data) return null
  notifyPush(t, isImage ? '📷 Photo' : file.type.startsWith('video/') ? '🎥 Video message' : `📎 ${file.name}`, isImage ? 'image' : 'file')
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
  const out = list
    .map((m) => toChat(m))
    .filter((m): m is ChatMessage => !!m)
    .sort((a, b) => a.sentTime - b.sentTime)
  // Ask the server which of my direct messages the other person has read, so old messages show the right ticks.
  const mine = list.filter((m) => m.senderUserId === connectedAs && m.needReceipt && m.messageId).map((m) => m.messageId)
  if (t.kind === 'direct' && mine.length) {
    const r = await channelFor(t).getMessageReadReceiptInfo(mine).catch(() => null)
    const read = new Set((r?.code === 0 && r.data ? r.data : []).filter((x) => x.readCount > 0).map((x) => x.messageId))
    out.forEach((m) => {
      if (read.has(m.id)) m.read = true
    })
  }
  return out
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
        lastText: cm ? (cm.type === 'image' ? 'Photo' : cm.type === 'file' ? (/\.(mp4|webm|mov|m4v)$/i.test(cm.fileName ?? '') ? 'Video message' : `File: ${cm.fileName}`) : cm.type === 'voice' ? 'Voice message' : cm.text) : m ? 'Message' : '',
        lastFrom: m?.senderUserId ?? '',
        lastTime: m?.sentTime ?? c.operationTime,
        unread: c.unreadCount,
      }
    })
    .sort((a, b) => b.lastTime - a.lastTime)
}

/** Subscribes to contacts' online status. Call rarely: each call can itself trigger a presence event. */
export async function subscribePresence(userIds: string[]) {
  if (!userIds.length) return
  await NCEngine.userModule.subscribeEvent({ subscribeType: SubscribeType.ONLINE_STATUS, userIds, expiry: 86400 }).catch(() => {})
}

/** Reads who is online right now, without subscribing again. */
export async function queryPresence(userIds: string[]): Promise<Set<string>> {
  const online = new Set<string>()
  if (!userIds.length) return online
  const r = await NCEngine.userModule.getSubscribeUsersOnlineStatus(userIds).catch(() => null)
  if (r && r.code === 0 && r.data) r.data.forEach((s) => s.isOnline && online.add(s.userId))
  return online
}

/** Creates a group on Nexconn with the given members. */
export async function createGroup(groupId: string, groupName: string, memberIds: string[]) {
  const r = await GroupChannel.createGroup({ groupId, groupName, inviteeUserIds: memberIds })
  return r.code
}

/** Reply to a message, quoting it. */
export async function sendReply(t: Target, text: string, origin: Origin, to: ChatMessage): Promise<ChatMessage | null> {
  const ref = raw.get(to.id)
  const params = new SendReferenceMessageParams({
    text,
    referMsgId: to.id,
    referMsgType: ref?.messageType ?? 'RC:TxtMsg',
    referMsgSenderId: to.from,
    referMsg: { content: to.text },
    extra: JSON.stringify(origin),
  } as never)
  ;(params as { needReceipt?: boolean }).needReceipt = t.kind === 'direct'
  const { code, data } = await channelFor(t).sendMessage(params)
  if (code !== 0 || !data) return null
  notifyPush(t, text)
  sentListeners.forEach((l) => l())
  const cm = toChat(data)
  if (cm && !cm.replyTo) cm.replyTo = { id: to.id, from: to.from, text: to.text }
  return cm
}

/** Change the text of one of my messages, for everyone. */
export async function editMessage(id: string, text: string): Promise<boolean> {
  const m = raw.get(id)
  if (!m) return false
  const old = m.content as Record<string, unknown>
  // Edited messages come back with the text under `content`, so send both fields.
  const r = await BaseChannel.updateMessage({ messageId: id, channelIdentifier: m.channelIdentifier, content: { ...old, text, content: text } })
  return r.code === 0
}

/** Unsend one of my messages for everyone in the chat. */
export async function deleteForEveryone(t: Target, id: string): Promise<boolean> {
  const m = raw.get(id)
  if (!m) return false
  // Messages loaded from history carry an empty "directed users" list, which the recall call rejects (34215).
  if (Array.isArray(m.directedUserIds) && m.directedUserIds.length === 0) (m as { directedUserIds?: string[] }).directedUserIds = undefined
  const r = await channelFor(t).deleteMessageForAll(m)
  return r.code === 0
}

/** Add or remove my emoji reaction on a message. */
export async function toggleReaction(id: string, emoji: string): Promise<Record<string, string[]> | undefined> {
  const m = raw.get(id)
  if (!m || !connectedAs) return undefined
  const key = `r_${encodeURIComponent(emoji)}`.replace(/%/g, '_')
  const current = reactionsOf(m)?.[emoji] ?? []
  const next = current.includes(connectedAs) ? current.filter((u) => u !== connectedAs) : [...current, connectedAs]
  if (next.length) {
    await m.setMetadata({ [key]: JSON.stringify(next) })
    m.metadata.set(key, JSON.stringify(next))
  } else {
    await m.deleteMetadata([key])
    m.metadata.delete(key)
  }
  return reactionsOf(m)
}

/** Send a recorded voice note. */
export async function sendVoice(t: Target, blob: Blob): Promise<ChatMessage | null> {
  const file = new File([blob], `voice-${Date.now()}.webm`, { type: blob.type || 'audio/webm' })
  const made = await Helper.createSendHDVoiceMessageParams(file)
  if (made.code !== 0 || !made.data) return null
  if (t.kind === 'direct') (made.data as { needReceipt?: boolean }).needReceipt = true
  const { code, data } = await channelFor(t).sendMediaMessage(made.data as never)
  if (code !== 0 || !data) return null
  notifyPush(t, '🎤 Voice message', 'voice')
  sentListeners.forEach((l) => l())
  return toChat(data as Message)
}
