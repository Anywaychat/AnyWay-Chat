import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import webpush from 'web-push'
import { dirname, resolve } from 'node:path'

/**
 * Accounts, contacts and groups for AnyWay. Nexconn tokens are issued here, so the App Secret never reaches the browser.
 *
 * Storage: Upstash Redis on Vercel, a local JSON file on your computer.
 * - Every change runs under a short lock and re-reads the data first. Before, two requests at the same moment (a class
 *   signing up together) each saved their own copy of everything, and one of the new accounts silently disappeared.
 * - Profile photos and "last seen" times are kept outside the main record, so each request reads a small record.
 * - With DATA_KEY set, everything stored is encrypted (AES-256-GCM). Passwords are scrypt hashes, and logins are kept
 *   only as SHA-256 hashes of the session token, so a copy of the database can't be used to sign in as anyone.
 */

export type Mode = 'blind' | 'deaf' | 'speech' | 'standard'
const MODES: Mode[] = ['blind', 'deaf', 'speech', 'standard']
/** Accounts from before a mode was retired (deaf-blind) count as talk-and-type. */
const modeOf = (m: string): Mode => (MODES.includes(m as Mode) ? (m as Mode) : 'standard')

interface UserRecord {
  id: string
  name: string
  mode: Mode
  salt: string
  hash: string
  contacts: string[]
  /** Old accounts: the photo itself. New: stored apart, `avatarV` is its version (part of its web address). */
  avatar?: string
  avatarV?: string
  blocked?: string[]
  /** Names this user gave their contacts, only they see them. */
  nicknames?: Record<string, string>
  createdAt: number
  /** Last time this user used the app (older accounts; newer times are kept apart). */
  lastSeen?: number
  /** Turned off by an admin: can't log in or use the app. */
  suspended?: boolean
  /** Saved phrase tiles (non-speaking users), private to the user. */
  phrases?: { text: string; icon: string }[]
  /** A demo friend that answers by itself (not a real person, never counted as a user). */
  demo?: boolean
  /** Made by "Try it now" without signing up. Counted apart from accounts; removed after 14 days unless saved. */
  guest?: boolean
  /** Settings that follow the person to any device: languages, voice, speed, text size, alerts. */
  prefs?: Record<string, unknown>
}
interface GroupRecord {
  id: string
  name: string
  owner: string
  members: string[]
  createdAt: number
}
interface CallLog {
  callId: string
  peer: string
  video: boolean
  outgoing: boolean
  answered: boolean
  time: number
  seconds: number
}
interface Report {
  from: string
  about: string
  reason: string
  time: number
}
interface Review {
  id: string
  user: string
  rating: number
  text: string
  lang: string
  showName: boolean
  hidden?: boolean
  time: number
}
/** A QR code or link that adds the person who opens it to `user`'s contacts ("Call yourself from your phone"). */
interface PairRecord {
  user: string
  exp: number
  joined: string[]
}
interface Db {
  pairs?: Record<string, PairRecord>
  reports?: Report[]
  reviews?: Review[]
  calls?: Record<string, CallLog[]>
  users: Record<string, UserRecord>
  /** Login sessions: SHA-256 of the session token (older ones: the token itself) -> user id. */
  sessions: Record<string, string>
  groups?: Record<string, GroupRecord>
  /** Web Push subscriptions per user (one per device). */
  push?: Record<string, PushSubscription[]>
  /** Local file only: photos and last-seen times (on Redis they have their own keys). */
  avatarStore?: Record<string, string>
  seenStore?: Record<string, number>
}
interface PushSubscription {
  endpoint: string
  keys: { p256dh: string; auth: string }
}

export interface PublicUser {
  id: string
  name: string
  mode: Mode
  avatar?: string
  demo?: boolean
  guest?: boolean
}

let DB_PATH = resolve(process.cwd(), 'data/db.json')

/* ---------- Encryption at rest ---------- */
let dataKey: Buffer | null = null
function seal(plain: string): string {
  if (!dataKey) return plain
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', dataKey, iv)
  const body = Buffer.concat([c.update(plain, 'utf8'), c.final()])
  return `enc1:${Buffer.concat([iv, c.getAuthTag(), body]).toString('base64')}`
}
function unseal(stored: string): string {
  if (!stored.startsWith('enc1:')) return stored // stored before encryption was turned on
  if (!dataKey) throw new Error('The data is encrypted but DATA_KEY is not set.')
  const raw = Buffer.from(stored.slice(5), 'base64')
  const d = createDecipheriv('aes-256-gcm', dataKey, raw.subarray(0, 12))
  d.setAuthTag(raw.subarray(12, 28))
  return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8')
}

/* ---------- Storage ---------- */
let redis: { url: string; token: string } | null = null
export function connectStore(env: Record<string, string | undefined>) {
  const url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL
  const token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN
  redis = url && token ? { url, token } : null
  dataKey = env.DATA_KEY ? createHash('sha256').update(env.DATA_KEY).digest() : null
  // Tests keep their own database file.
  DB_PATH = resolve(process.cwd(), env.ANYWAY_DB_PATH || 'data/db.json')
}
const KEY = 'anyway:db'
const LOCK = 'anyway:lock'
const SEEN = 'anyway:seen'
const AVATAR = (id: string) => `anyway:avatar:${id}`

/** One Redis command over Upstash's REST API. */
async function cmd<T = unknown>(...args: (string | number)[]): Promise<T> {
  const r = await fetch(redis!.url, { method: 'POST', headers: { Authorization: `Bearer ${redis!.token}` }, body: JSON.stringify(args.map(String)) })
  const j = (await r.json()) as { result?: T; error?: string }
  if (j.error) throw new Error(j.error)
  return j.result as T
}

const empty = (): Db => ({ users: {}, sessions: {} })
async function load(): Promise<Db> {
  if (redis) {
    const raw = await cmd<string | null>('GET', KEY)
    return raw ? (JSON.parse(unseal(raw)) as Db) : empty()
  }
  if (!existsSync(DB_PATH)) return empty()
  return JSON.parse(unseal(readFileSync(DB_PATH, 'utf8'))) as Db
}
async function save(db: Db) {
  if (redis) {
    await cmd('SET', KEY, seal(JSON.stringify(db)))
    return
  }
  mkdirSync(dirname(DB_PATH), { recursive: true })
  writeFileSync(DB_PATH, dataKey ? seal(JSON.stringify(db)) : JSON.stringify(db, null, 2))
}

/** A change the request can't make: stop without saving and answer with this. */
class Stop {
  status: number
  body: unknown
  constructor(status: number, body: unknown) {
    this.status = status
    this.body = body
  }
}

let localQueue: Promise<unknown> = Promise.resolve()
/**
 * Makes one change at a time: takes the lock, loads the latest data, applies `fn`, saves, lets go of the lock.
 * Throw a Stop inside `fn` to give up without saving.
 */
async function mutate<T>(fn: (db: Db) => T | Promise<T>): Promise<T> {
  if (!redis) {
    // One process on your computer: a queue is enough.
    const run = localQueue.then(async () => {
      const db = await load()
      const out = await fn(db)
      await save(db)
      return out
    })
    localQueue = run.catch(() => {})
    return run
  }
  const token = randomBytes(8).toString('hex')
  const giveUp = Date.now() + 9000
  // Wait a little longer each try (a crowd signing up together shouldn't hammer the database).
  for (let wait = 30; ; wait = Math.min(250, wait * 1.6)) {
    if ((await cmd('SET', LOCK, token, 'NX', 'PX', 5000)) === 'OK') break
    // Never write without the lock (that is what lost accounts). A crashed holder's lock expires within 5 s.
    if (Date.now() > giveUp) throw new Stop(503, { error: 'AnyWay is busy right now. Please try again.' })
    await new Promise((r) => setTimeout(r, wait * (0.6 + Math.random() * 0.8)))
  }
  try {
    const db = await load()
    const out = await fn(db)
    await save(db)
    return out
  } finally {
    await cmd('EVAL', "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end", 1, LOCK, token).catch(() => {})
  }
}

/** Profile photos live apart from the main record (they made every request large). */
async function putAvatar(db: Db, id: string, dataUrl: string | null) {
  if (redis) {
    if (dataUrl) await cmd('SET', AVATAR(id), seal(dataUrl))
    else await cmd('DEL', AVATAR(id))
    return
  }
  db.avatarStore ??= {}
  if (dataUrl) db.avatarStore[id] = dataUrl
  else delete db.avatarStore[id]
}
async function getAvatar(db: Db, id: string): Promise<string | null> {
  if (redis) {
    const raw = await cmd<string | null>('GET', AVATAR(id))
    return raw ? unseal(raw) : (db.users[id]?.avatar ?? null)
  }
  return db.avatarStore?.[id] ?? db.users[id]?.avatar ?? null
}

/** "Last seen", written at most once an hour per person, without rewriting everything. */
const seenNow = new Map<string, number>()
async function touchSeen(id: string) {
  const now = Date.now()
  if (now - (seenNow.get(id) ?? 0) < 3600_000) return
  seenNow.set(id, now)
  if (redis) await cmd('HSET', SEEN, id, now).catch(() => {})
  else await mutate((db) => void ((db.seenStore ??= {})[id] = now))
}
async function allSeen(db: Db): Promise<Record<string, number>> {
  const out: Record<string, number> = {}
  for (const u of Object.values(db.users)) if (u.lastSeen) out[u.id] = u.lastSeen
  if (redis) {
    const flat = await cmd<string[]>('HGETALL', SEEN).catch(() => [] as string[])
    for (let i = 0; i + 1 < flat.length; i += 2) out[flat[i]] = Math.max(out[flat[i]] ?? 0, Number(flat[i + 1]))
  } else Object.assign(out, db.seenStore ?? {})
  return out
}

/* ---------- Sessions ---------- */
const sessionKey = (token: string) => createHash('sha256').update(token).digest('hex')
function newSession(db: Db, userId: string): string {
  const token = randomBytes(24).toString('hex')
  db.sessions[sessionKey(token)] = userId
  // Keep each person's 10 newest logins.
  const mine = Object.keys(db.sessions).filter((k) => db.sessions[k] === userId)
  for (const k of mine.slice(0, Math.max(0, mine.length - 10))) delete db.sessions[k]
  return token
}
const sessionUser = (db: Db, token: string) => (token ? (db.sessions[sessionKey(token)] ?? db.sessions[token]) : undefined)

const pub = (u: UserRecord): PublicUser => ({
  id: u.id,
  name: u.name,
  mode: modeOf(u.mode),
  avatar: u.avatarV ? `/api/avatar/${u.id}?v=${u.avatarV}` : u.avatar,
  ...(u.demo ? { demo: true } : {}),
  ...(u.guest ? { guest: true } : {}),
})
const hashPw = (pw: string, salt: string) => scryptSync(pw, salt, 32).toString('hex')
const real = (u: UserRecord) => !u.demo

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  // Vercel may have parsed the body already.
  const pre = (req as IncomingMessage & { body?: unknown }).body
  if (pre && typeof pre === 'object') return pre as Record<string, unknown>
  if (typeof pre === 'string') {
    try {
      return JSON.parse(pre) as Record<string, unknown>
    } catch {
      return {}
    }
  }
  let raw = ''
  for await (const chunk of req) raw += chunk
  if (raw.length > 150_000) return {}
  try {
    return JSON.parse(raw || '{}') as Record<string, unknown>
  } catch {
    return {}
  }
}

/** The raw request body, for the Sign lab's uploads (larger than the usual JSON limit). */
async function readRaw(req: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const c of req) {
    size += (c as Buffer).length
    if (size > limit) throw new Stop(413, { error: 'Too big.' })
    chunks.push(c as Buffer)
  }
  return Buffer.concat(chunks)
}
const LAB_DIR = resolve(process.cwd(), 'data/signlab')

/** Signed call to the Nexconn Platform Chat API (Singapore, with backup domain). */
async function nexconnPost<T>(env: Record<string, string | undefined>, path: string, body: unknown): Promise<(T & { code: number }) | null> {
  const appKey = env.VITE_NEXCONN_APP_KEY
  const secret = env.NEXCONN_APP_SECRET
  if (!appKey || !secret) return null
  for (const host of ['api.sg-light-api.com', 'api-b.sg-light-api.com']) {
    try {
      const nonce = randomBytes(6).toString('hex')
      const timestamp = String(Date.now())
      const signature = createHash('sha1').update(secret + nonce + timestamp).digest('hex')
      const r = await fetch(`https://${host}${path}`, {
        method: 'POST',
        headers: { 'App-Key': appKey, Nonce: nonce, Timestamp: timestamp, Signature: signature, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(5000),
      })
      return (await r.json()) as T & { code: number }
    } catch {
      /* try backup domain */
    }
  }
  return null
}

async function issueNexconnToken(env: Record<string, string | undefined>, user: PublicUser): Promise<string | null> {
  const j = await nexconnPost<{ result?: { accessToken: string } }>(env, '/v4/auth/access-token/issue', { userId: user.id, name: user.name })
  return j && j.code === 0 && j.result ? j.result.accessToken : null
}

const cleanId = (v: unknown) => String(v ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 32)

/* ---------- Demo friends: so anyone (a judge, a teacher) can try every way of talking on their own ---------- */
type Origin = { mode: Mode; how: 'signed' | 'spoken' | 'tapped' | 'typed'; gloss?: string }
const DEMO: Record<string, { name: string; mode: Mode; hello: string; how: Origin['how']; gloss?: string }> = {
  demopriya: {
    name: 'Priya (demo)',
    mode: 'deaf',
    how: 'signed',
    gloss: 'HELLO · I · DEAF',
    hello: "Hello! I'm Priya. I'm deaf and I sign. I signed this to my camera, and AnyWay turned my signs into this text. When you write to me, I see your words as sign language.",
  },
  demoarjun: {
    name: 'Arjun (demo)',
    mode: 'blind',
    how: 'spoken',
    hello: "Hi, I'm Arjun. I'm blind, so I don't type. I said this out loud and AnyWay wrote it for you. Send me anything, and AnyWay reads it to me.",
  },
  demomeera: {
    name: 'Meera (demo)',
    mode: 'speech',
    how: 'tapped',
    hello: "Hi! 👋 I'm Meera. I can't speak. I tap pictures on my phrase board, and AnyWay says them out loud for me. Ask me something!",
  },
}
const isDemo = (id: string) => id in DEMO

/** What a demo friend says back, in their own way. */
export function demoReply(id: string, said: string, kind: string): { text: string; gloss?: string } {
  const t = said.toLowerCase()
  const has = (re: RegExp) => re.test(t)
  if (id === 'demopriya') {
    if (kind === 'voice') return { text: 'AnyWay wrote your voice message out for me, so I could read it. Thank you!', gloss: 'THANK YOU' }
    if (kind === 'image') return { text: 'Nice photo! 😊', gloss: 'NICE' }
    if (has(/how are (you|u)/)) return { text: "I'm good, thank you! How are you?", gloss: 'GOOD · THANK YOU · HOW ARE YOU' }
    if (has(/\b(hi|hello|hey|vanakkam|namaste)\b/)) return { text: 'Hello! Nice to meet you.', gloss: 'HELLO · NICE' }
    if (has(/\b(dinner|lunch|food|eat|hungry)\b/)) return { text: "Yes! I'm hungry. What time?", gloss: 'YES · HUNGRY · TIME' }
    if (has(/\b(when|time|tomorrow|today)\b/)) return { text: 'Tomorrow is good for me.', gloss: 'TOMORROW · GOOD' }
    if (has(/\b(thank|thanks)\b/)) return { text: "You're welcome!", gloss: 'ALRIGHT' }
    if (has(/\b(sign|signs|language)\b/)) return { text: 'I use Indian Sign Language. Open the sign dictionary to learn some signs!', gloss: 'I · SIGN · LANGUAGE' }
    return { text: 'I read your message. Try a video call with a real friend: you talk, and I read live captions and see signs.', gloss: 'GOOD · CALL · FRIEND' }
  }
  if (id === 'demoarjun') {
    if (kind === 'voice') return { text: 'I listened to your voice message. Thanks!' }
    if (kind === 'image') return { text: 'AnyWay described your photo to me out loud. Thanks for sharing!' }
    if (has(/how are (you|u)/)) return { text: "I'm doing well, thanks! AnyWay read your message to me." }
    if (has(/\b(hi|hello|hey|vanakkam|namaste)\b/)) return { text: 'Hello! AnyWay just read your message to me.' }
    if (has(/\b(where|when|time)\b/)) return { text: "Let's meet at the bus stand at 5." }
    if (has(/\b(thank|thanks)\b/)) return { text: "You're welcome!" }
    return { text: 'Got it. AnyWay read that out to me. I answer by talking, and AnyWay types it for you.' }
  }
  if (kind === 'voice') return { text: 'Thank you 🙏' }
  if (has(/how are (you|u)/)) return { text: 'I am happy 😊' }
  if (has(/\b(hi|hello|hey|vanakkam|namaste)\b/)) return { text: 'Hello! 👋' }
  if (has(/\?$|\b(do you|can you|will you|are you)\b/)) return { text: 'Yes 👍' }
  if (has(/\b(thank|thanks)\b/)) return { text: "You're welcome 🙏" }
  return { text: 'See you soon 👋' }
}

async function demoSay(env: Record<string, string | undefined>, from: string, to: string, text: string, gloss?: string) {
  const d = DEMO[from]
  const origin: Origin = { mode: d.mode, how: d.how, ...(gloss ? { gloss } : {}) }
  return nexconnPost(env, '/v4/direct-channel/message/send', {
    fromUserId: from,
    toUserIds: [to],
    messageType: 'RC:TxtMsg',
    content: JSON.stringify({ content: text, extra: JSON.stringify(origin) }),
    pushContent: text.slice(0, 80),
    isEchoToSender: 0,
  })
}

/** Adds the demo friends to `userId`'s contacts (and `userId` to theirs), making the friends if needed. */
function addDemoFriends(d: Db, userId: string) {
  for (const [id, p] of Object.entries(DEMO)) {
    d.users[id] ??= { id, name: p.name, mode: p.mode, salt: '', hash: randomBytes(32).toString('hex'), contacts: [], createdAt: Date.now(), demo: true }
    linkUsers(d, userId, id)
  }
}
/** Each demo friend says hello in their own way. The chat service needs to know a user before it can send for them. */
async function greetFromDemo(env: Record<string, string | undefined>, to: string) {
  await Promise.all(Object.entries(DEMO).map(([id, p]) => issueNexconnToken(env, { id, name: p.name, mode: p.mode }).catch(() => null)))
  for (const [id, p] of Object.entries(DEMO)) await demoSay(env, id, to, p.hello, p.gloss).catch(() => null)
}
/** Two people in each other's contacts, so either can start a chat or a call. */
function linkUsers(d: Db, a: string, b: string) {
  if (!d.users[a].contacts.includes(b)) d.users[a].contacts.push(b)
  if (!d.users[b].contacts.includes(a)) d.users[b].contacts.push(a)
}

/** Deletes an account, its logins, its photo and every link to it. */
async function removeUser(d: Db, id: string) {
  delete d.users[id]
  for (const [t, uid] of Object.entries(d.sessions)) if (uid === id) delete d.sessions[t]
  for (const other of Object.values(d.users)) {
    if (other.contacts.includes(id)) other.contacts = other.contacts.filter((c) => c !== id)
    if (other.blocked?.includes(id)) other.blocked = other.blocked.filter((c) => c !== id)
    if (other.nicknames && id in other.nicknames) delete other.nicknames[id]
  }
  for (const g of Object.values(d.groups ?? {})) g.members = g.members.filter((m) => m !== id)
  if (d.reviews?.some((r) => r.user === id)) d.reviews = d.reviews.filter((r) => r.user !== id)
  if (d.push) delete d.push[id]
  if (d.calls) delete d.calls[id]
  for (const [k, p] of Object.entries(d.pairs ?? {})) if (p.user === id) delete d.pairs![k]
  if (d.seenStore) delete d.seenStore[id]
  await putAvatar(d, id, null)
}

/** Gives an account a new username: every contact list, group, login and setting follows it. */
async function renameUser(d: Db, from: string, to: string) {
  const u = d.users[from]
  const photo = u.avatarV ? await getAvatar(d, from) : null
  d.users[to] = { ...u, id: to }
  delete d.users[from]
  const swap = (x: string) => (x === from ? to : x)
  for (const k of Object.keys(d.sessions)) if (d.sessions[k] === from) d.sessions[k] = to
  for (const o of Object.values(d.users)) {
    o.contacts = o.contacts.map(swap)
    if (o.blocked) o.blocked = o.blocked.map(swap)
    if (o.nicknames && from in o.nicknames) {
      o.nicknames[to] = o.nicknames[from]
      delete o.nicknames[from]
    }
  }
  for (const g of Object.values(d.groups ?? {})) {
    g.members = g.members.map(swap)
    g.owner = swap(g.owner)
  }
  for (const r of d.reviews ?? []) r.user = swap(r.user)
  for (const p of Object.values(d.pairs ?? {})) {
    p.user = swap(p.user)
    p.joined = p.joined.map(swap)
  }
  for (const store of [d.push, d.calls, d.seenStore] as (Record<string, unknown> | undefined)[]) {
    if (store && from in store) {
      store[to] = store[from]
      delete store[from]
    }
  }
  if (photo) {
    await putAvatar(d, to, photo)
    await putAvatar(d, from, null)
  }
}

const GUEST_DAYS = 14
const MAX_GUESTS = 3000
/** Guest accounts nobody saved are removed after two weeks (and the oldest go first past 3,000), so tries don't pile up. */
async function pruneGuests(d: Db, now = Date.now()) {
  const guests = Object.values(d.users).filter((u) => u.guest).sort((a, b) => a.createdAt - b.createdAt)
  const old = guests.filter((u, i) => u.createdAt < now - GUEST_DAYS * 86400_000 || i < guests.length - MAX_GUESTS)
  for (const u of old) await removeUser(d, u.id)
  return old.length
}

/** At most 30 guest accounts an hour from one address (per server instance), so a script can't flood the database. */
const guestHits = new Map<string, number[]>()
function allowGuest(ip: string, now = Date.now()) {
  const recent = (guestHits.get(ip) ?? []).filter((t) => t > now - 3600_000)
  if (recent.length >= 30) return false
  recent.push(now)
  guestHits.set(ip, recent)
  if (guestHits.size > 5000) guestHits.clear()
  return true
}
const clientIp = (req: IncomingMessage) => String(req.headers['x-forwarded-for'] ?? req.socket?.remoteAddress ?? '').split(',')[0].trim()

/** Usernames people pick themselves. "demo" and "guest" names are kept for the app's own accounts. */
export function usernameProblem(id: string): string | null {
  if (id.length < 3) return 'Username must be at least 3 letters or numbers.'
  if (isDemo(id) || id.startsWith('demo') || id.startsWith('guest')) return 'That username is taken. Try another.'
  return null
}
const cleanCode = (v: unknown) => String(v ?? '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 16)
const PAIR_MINUTES = 30

export function createApi(env: Record<string, string | undefined>) {
  connectStore(env)
  const pushReady = !!(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY)
  if (pushReady) webpush.setVapidDetails('https://anywaychat.vercel.app', env.VAPID_PUBLIC_KEY!, env.VAPID_PRIVATE_KEY!)
  // Photos kept inside old accounts move to their own keys (once per server start, when there are any).
  let moved = false
  const movePhotos = async (db: Db) => {
    if (moved) return
    moved = true
    if (!Object.values(db.users).some((u) => u.avatar?.startsWith('data:'))) return
    await mutate(async (fresh) => {
      for (const u of Object.values(fresh.users)) {
        if (!u.avatar?.startsWith('data:')) continue
        await putAvatar(fresh, u.id, u.avatar)
        u.avatarV = randomBytes(4).toString('hex')
        delete u.avatar
      }
    }).catch(() => {
      moved = false
    })
  }

  return async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = new URL(req.url ?? '', 'http://localhost')
    if (!url.pathname.startsWith('/api/')) return next()
    const path = url.pathname.slice(4)
    try {
      const db = await load()
      void movePhotos(db)
      const session = (req.headers.authorization ?? '').replace(/^Bearer /, '')
      const uid = sessionUser(db, session)
      const found = uid ? db.users[uid] : undefined
      const me = found && !found.suspended ? found : undefined

      // Profile photos: plain images, cached by the browser (the address changes when the photo does).
      const am = path.match(/^\/avatar\/([a-z0-9]+)$/)
      if (am && req.method === 'GET') {
        const data = await getAvatar(db, am[1])
        const m = data?.match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/)
        if (!m) {
          res.statusCode = 404
          return res.end()
        }
        res.statusCode = 200
        res.setHeader('Content-Type', m[1])
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
        return res.end(Buffer.from(m[2], 'base64'))
      }

      if (path === '/signup' && req.method === 'POST') {
        const b = await readBody(req)
        const id = cleanId(b.username)
        const name = String(b.name ?? '').trim().slice(0, 40)
        const password = String(b.password ?? '')
        const mode = MODES.includes(b.mode as Mode) ? (b.mode as Mode) : 'standard'
        const bad = usernameProblem(id)
        if (bad) return send(res, id.length < 3 ? 400 : 409, { error: bad })
        if (!name) return send(res, 400, { error: 'Enter your name.' })
        if (password.length < 6) return send(res, 400, { error: 'Password must be at least 6 characters.' })
        const salt = randomBytes(16).toString('hex')
        const hash = hashPw(password, salt)
        const token = await mutate((d) => {
          if (d.users[id]) throw new Stop(409, { error: 'That username is taken. Try another.' })
          d.users[id] = { id, name, mode, salt, hash, contacts: [], createdAt: Date.now() }
          return newSession(d, id)
        })
        return send(res, 200, { session: token, user: { id, name, mode } })
      }

      if (path === '/login' && req.method === 'POST') {
        const b = await readBody(req)
        const u = db.users[cleanId(b.username)]
        const ok = u && !u.demo && !u.guest && timingSafeEqual(Buffer.from(hashPw(String(b.password ?? ''), u.salt), 'hex'), Buffer.from(u.hash, 'hex'))
        if (!u || !ok) return send(res, 401, { error: 'Wrong username or password.' })
        if (u.suspended) return send(res, 403, { error: 'This account has been turned off. Contact the AnyWay team.' })
        const token = await mutate((d) => newSession(d, u.id))
        return send(res, 200, { session: token, user: pub(u) })
      }

      // "Try it now": a guest account in one tap, no sign-up. It starts with the demo friends, or, from a
      // "Call yourself from your phone" QR code, with the person who showed the code.
      if (path === '/guest' && req.method === 'POST') {
        const b = await readBody(req)
        const mode = MODES.includes(b.mode as Mode) ? (b.mode as Mode) : 'standard'
        if (!allowGuest(clientIp(req))) return send(res, 429, { error: 'Too many guest accounts from this network. Try again in an hour, or create an account.' })
        const code = cleanCode(b.pair)
        const made = await mutate(async (d) => {
          await pruneGuests(d)
          const pair = code ? d.pairs?.[code] : undefined
          if (code && (!pair || pair.exp < Date.now() || !d.users[pair.user])) throw new Stop(404, { error: 'This QR code has expired. Ask for a new one.' })
          let id = ''
          do id = `guest${randomBytes(3).toString('hex')}`
          while (d.users[id])
          const name = `Guest ${1000 + (randomBytes(2).readUInt16BE(0) % 9000)}`
          d.users[id] = { id, name, mode, salt: '', hash: randomBytes(32).toString('hex'), contacts: [], createdAt: Date.now(), guest: true }
          if (pair) {
            linkUsers(d, id, pair.user)
            pair.joined.push(id)
          } else addDemoFriends(d, id)
          return { token: newSession(d, id), user: pub(d.users[id]), with: pair ? pub(d.users[pair.user]) : null }
        })
        if (!made.with) await greetFromDemo(env, made.user.id)
        return send(res, 200, { session: made.token, user: made.user, with: made.with })
      }

      const pm = path.match(/^\/pair\/([a-z0-9]{6,16})$/)
      if (pm && req.method === 'GET') {
        const p = db.pairs?.[pm[1]]
        const owner = p && p.exp > Date.now() ? db.users[p.user] : undefined
        if (!owner) return send(res, 404, { error: 'This QR code has expired. Ask for a new one.' })
        return send(res, 200, { from: { name: owner.name, mode: modeOf(owner.mode) } })
      }

      // ---------- Admin (needs the ADMIN_KEY secret in the x-admin-key header) ----------
      if (path.startsWith('/admin/')) {
        // Needs ADMIN_KEY on the live site. Without one it is locked there (anyone could delete accounts);
        // on your own computer (no Redis) it stays open for testing.
        const key = String(req.headers['x-admin-key'] ?? '')
        const realKey = env.ADMIN_KEY ?? ''
        const okKey = realKey ? key.length === realKey.length && timingSafeEqual(Buffer.from(key), Buffer.from(realKey)) : !redis
        if (!okKey) return send(res, 401, { error: 'Wrong admin key.' })
        if (path === '/admin/check') return send(res, 200, { ok: true })
        if (path === '/admin/users' && req.method === 'GET') {
          const seen = await allSeen(db)
          return send(res, 200, {
            users: Object.values(db.users)
              .filter(real)
              .map((u) => ({ id: u.id, name: u.name, mode: modeOf(u.mode), createdAt: u.createdAt, lastSeen: seen[u.id] ?? null, contacts: u.contacts.filter((c) => !isDemo(c)).length, suspended: !!u.suspended, reviewed: (db.reviews ?? []).some((r) => r.user === u.id), ...(u.guest ? { guest: true } : {}) }))
              .sort((a, b) => (b.lastSeen ?? b.createdAt) - (a.lastSeen ?? a.createdAt)),
          })
        }
        if (path === '/admin/reviews' && req.method === 'GET') {
          return send(res, 200, { reviews: (db.reviews ?? []).slice().sort((a, b) => b.time - a.time).map((r) => ({ ...r, name: db.users[r.user]?.name ?? r.user, mode: db.users[r.user] ? modeOf(db.users[r.user].mode) : undefined })) })
        }
        if (path === '/admin/reports' && req.method === 'GET') {
          return send(res, 200, { reports: (db.reports ?? []).slice().reverse().map((r) => ({ ...r, fromName: db.users[r.from]?.name, aboutName: db.users[r.about]?.name })) })
        }
        const um = path.match(/^\/admin\/users\/([a-z0-9]+)\/(suspend|delete)$/)
        if (um && req.method === 'POST') {
          const b = await readBody(req)
          await mutate(async (d) => {
            const u = d.users[um[1]]
            if (!u) throw new Stop(404, { error: 'No such user.' })
            if (um[2] === 'suspend') {
              u.suspended = !!b.suspended
              return
            }
            await removeUser(d, u.id)
          })
          return send(res, 200, { ok: true })
        }
        const rm = path.match(/^\/admin\/reviews\/([a-z0-9]+)\/(hide|delete)$/)
        if (rm && req.method === 'POST') {
          const b = await readBody(req)
          await mutate((d) => {
            const r = (d.reviews ?? []).find((x) => x.id === rm[1])
            if (!r) throw new Stop(404, { error: 'No such review.' })
            if (rm[2] === 'hide') r.hidden = !!b.hidden
            else d.reviews = (d.reviews ?? []).filter((x) => x.id !== r.id)
          })
          return send(res, 200, { ok: true })
        }
        return send(res, 404, { error: 'Not found' })
      }

      // Public usage dashboard (/admin): numbers only, nothing that identifies anyone. Demo friends aren't counted.
      if (path === '/stats' && req.method === 'GET') {
        // Accounts people made. "Try it now" guests are counted on their own, never as sign-ups.
        const users = Object.values(db.users).filter((u) => real(u) && !u.guest)
        const guests = Object.values(db.users).filter((u) => u.guest)
        const seen = await allSeen(db)
        const now = Date.now()
        const DAY = 86400_000
        const byMode: Record<string, number> = {}
        users.forEach((u) => (byMode[modeOf(u.mode)] = (byMode[modeOf(u.mode)] ?? 0) + 1))
        const signups: { day: string; count: number }[] = []
        for (let i = 13; i >= 0; i--) {
          const start = new Date(new Date(now - i * DAY).toDateString()).getTime()
          signups.push({ day: new Date(start).toISOString().slice(0, 10), count: users.filter((u) => u.createdAt >= start && u.createdAt < start + DAY).length })
        }
        const calls = Object.values(db.calls ?? {}).flat()
        const realContacts = (u: UserRecord) => u.contacts.filter((c) => !isDemo(c))
        return send(res, 200, {
          generatedAt: now,
          users: {
            total: users.length,
            activeToday: users.filter((u) => (seen[u.id] ?? 0) > now - DAY).length,
            activeWeek: users.filter((u) => (seen[u.id] ?? 0) > now - 7 * DAY).length,
            newWeek: users.filter((u) => u.createdAt > now - 7 * DAY).length,
            byMode,
            withContacts: users.filter((u) => realContacts(u).length > 0).length,
            withPhoto: users.filter((u) => u.avatar || u.avatarV).length,
          },
          signups,
          guests: { total: guests.length, activeToday: guests.filter((u) => (seen[u.id] ?? 0) > now - DAY).length, week: guests.filter((u) => u.createdAt > now - 7 * DAY).length },
          groups: { total: Object.keys(db.groups ?? {}).length, members: Object.values(db.groups ?? {}).reduce((n, g) => n + g.members.length, 0) },
          contacts: users.reduce((n, u) => n + realContacts(u).length, 0) / 2,
          calls: { logged: calls.length, week: calls.filter((c) => c.time > now - 7 * DAY).length, video: calls.filter((c) => c.video).length },
          push: Object.values(db.push ?? {}).reduce((n, l) => n + l.length, 0),
          blocks: users.reduce((n, u) => n + (u.blocked?.length ?? 0), 0),
          reports: (db.reports ?? []).length,
          // Reviews people chose to share (name only if they allowed it).
          reviews: (() => {
            const shown = (db.reviews ?? []).filter((r) => !r.hidden && db.users[r.user])
            return {
              count: shown.length,
              average: shown.length ? +(shown.reduce((n, r) => n + r.rating, 0) / shown.length).toFixed(2) : null,
              list: shown
                .slice()
                .sort((a, b) => b.time - a.time)
                .map((r) => ({ rating: r.rating, text: r.text, lang: r.lang, time: r.time, mode: modeOf(db.users[r.user].mode), name: r.showName ? db.users[r.user].name : null })),
            }
          })(),
          // Open to anyone, so no names, usernames or report text: only how people use the app.
          people: users
            .map((u) => ({ mode: modeOf(u.mode), createdAt: u.createdAt, lastSeen: seen[u.id] ?? null, contacts: realContacts(u).length }))
            .sort((a, b) => (b.lastSeen ?? b.createdAt) - (a.lastSeen ?? a.createdAt)),
        })
      }

      if (!me) return send(res, 401, { error: 'Please log in again.' })

      // Remember when people use the app (for the usage dashboard), at most once an hour per person.
      void touchSeen(me.id)

      if (path === '/logout' && req.method === 'POST') {
        await mutate((d) => {
          delete d.sessions[sessionKey(session)]
          delete d.sessions[session]
        })
        return send(res, 200, { ok: true })
      }

      if (path === '/me' && req.method === 'GET') return send(res, 200, { user: pub(me), blocked: me.blocked ?? [] })

      // Sign lab (testing only): each attempt's points, readings and a short video, saved on this computer.
      // Never on the live site: there is no local disk there, and camera video shouldn't leave the person's computer.
      if (path.startsWith('/signlab') && req.method === 'POST') {
        if (redis) return send(res, 404, { error: 'Not found' })
        const id = String(url.searchParams.get('id') ?? '').replace(/[^a-z0-9-]/gi, '').slice(0, 80)
        if (!id) return send(res, 400, { error: 'Missing id.' })
        mkdirSync(LAB_DIR, { recursive: true })
        if (path === '/signlab/video') {
          writeFileSync(resolve(LAB_DIR, `${id}.webm`), await readRaw(req, 25_000_000))
          return send(res, 200, { ok: true })
        }
        const body = JSON.parse((await readRaw(req, 10_000_000)).toString('utf8') || '{}') as Record<string, unknown>
        writeFileSync(resolve(LAB_DIR, `${id}.json`), JSON.stringify({ ...body, user: me.id, savedAt: Date.now() }))
        return send(res, 200, { ok: true })
      }

      // Everything the app needs to start (or refresh), in one round trip. ?token=0 skips the chat token.
      if (path === '/bootstrap' && req.method === 'GET') {
        const contacts = me.contacts.map((id) => db.users[id]).filter(Boolean).map((u) => ({ ...pub(u), nickname: me.nicknames?.[u.id] }))
        const groups = Object.values(db.groups ?? {})
          .filter((g) => g.members.includes(me.id))
          .map((g) => ({ id: g.id, name: g.name, owner: g.owner, members: g.members.map((id) => db.users[id]).filter(Boolean).map(pub) }))
        const token = url.searchParams.get('token') === '0' ? null : await issueNexconnToken(env, pub(me)).catch(() => null)
        return send(res, 200, { user: pub(me), blocked: me.blocked ?? [], contacts, groups, token, prefs: me.prefs ?? null })
      }

      if (path === '/block' && req.method === 'POST') {
        const b = await readBody(req)
        const other = cleanId(b.username)
        if (!db.users[other] || other === me.id) return send(res, 404, { error: 'No one with that username.' })
        const block = b.block !== false
        const r = block
          ? await nexconnPost(env, '/v4/user/blocklist/add', { userId: me.id, targetUserIds: [other] })
          : await nexconnPost(env, '/v4/user/blocklist/remove', { userId: me.id, blockedUserIds: [other] })
        if (!r || r.code !== 0) return send(res, 502, { error: 'Could not update the block right now.' })
        const blocked = await mutate((d) => {
          const u = d.users[me.id]
          const list = new Set(u.blocked ?? [])
          if (block) list.add(other)
          else list.delete(other)
          u.blocked = [...list]
          return u.blocked
        })
        return send(res, 200, { blocked })
      }

      if (path === '/report' && req.method === 'POST') {
        const b = await readBody(req)
        const about = cleanId(b.username)
        if (!db.users[about]) return send(res, 404, { error: 'No one with that username.' })
        await mutate((d) => {
          d.reports = d.reports ?? []
          d.reports.push({ from: me.id, about, reason: String(b.reason ?? '').slice(0, 500), time: Date.now() })
        })
        return send(res, 200, { ok: true })
      }

      if (path === '/me' && req.method === 'PATCH') {
        const b = await readBody(req)
        if (typeof b.avatar === 'string' && !(/^data:image\/(jpeg|png|webp);base64,/.test(b.avatar) && b.avatar.length < 120_000)) return send(res, 400, { error: 'That photo could not be used.' })
        const prefs = b.prefs && typeof b.prefs === 'object' && !Array.isArray(b.prefs) && JSON.stringify(b.prefs).length < 6000 ? (b.prefs as Record<string, unknown>) : null
        const user = await mutate(async (d) => {
          const u = d.users[me.id]
          if (MODES.includes(b.mode as Mode)) u.mode = b.mode as Mode
          if (prefs) u.prefs = prefs
          if (typeof b.name === 'string' && b.name.trim()) u.name = b.name.trim().slice(0, 40)
          if (b.avatar === null) {
            await putAvatar(d, u.id, null)
            delete u.avatar
            delete u.avatarV
          } else if (typeof b.avatar === 'string') {
            await putAvatar(d, u.id, b.avatar)
            delete u.avatar
            u.avatarV = randomBytes(4).toString('hex')
          }
          return pub(u)
        })
        return send(res, 200, { user })
      }

      if (path === '/nexconn-token' && req.method === 'GET') {
        const token = await issueNexconnToken(env, pub(me))
        return token ? send(res, 200, { token }) : send(res, 502, { error: 'Could not reach the chat service.' })
      }

      if (path === '/push/key' && req.method === 'GET') {
        return send(res, 200, { key: pushReady ? env.VAPID_PUBLIC_KEY : null })
      }

      if (path === '/push/subscribe' && req.method === 'POST') {
        const b = await readBody(req)
        const sub = b.subscription as PushSubscription | undefined
        if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) return send(res, 400, { error: 'Bad subscription.' })
        await mutate((d) => {
          d.push ??= {}
          // An endpoint belongs to one device, so move it to whoever is signed in there now.
          for (const id of Object.keys(d.push)) d.push[id] = d.push[id].filter((x) => x.endpoint !== sub.endpoint)
          d.push[me.id] = [...(d.push[me.id] ?? []), { endpoint: sub.endpoint, keys: sub.keys }].slice(-5)
        })
        return send(res, 200, { ok: true })
      }

      // Demo friends: added on request, each says hello in their own way.
      if (path === '/demo/start' && req.method === 'POST') {
        await mutate((d) => addDemoFriends(d, me.id))
        await greetFromDemo(env, me.id)
        return send(res, 200, { ok: true })
      }

      // "Call yourself from your phone" (or add a friend next to you): a QR code that links the two of you.
      if (path === '/pair' && req.method === 'POST') {
        const made = await mutate((d) => {
          const now = Date.now()
          d.pairs ??= {}
          for (const [k, p] of Object.entries(d.pairs)) if (p.exp < now) delete d.pairs[k]
          // One code at a time per person: the same one comes back while it has 10 minutes left.
          const mine = Object.entries(d.pairs).find(([, p]) => p.user === me.id && p.exp > now + 600_000)
          if (mine) return { code: mine[0], expires: mine[1].exp }
          let c = ''
          do c = randomBytes(5).toString('hex')
          while (d.pairs[c])
          d.pairs[c] = { user: me.id, exp: now + PAIR_MINUTES * 60_000, joined: [] }
          return { code: c, expires: d.pairs[c].exp }
        })
        return send(res, 200, made)
      }
      const pj = path.match(/^\/pair\/([a-z0-9]{6,16})\/(join|status)$/)
      if (pj && pj[2] === 'status' && req.method === 'GET') {
        const p = db.pairs?.[pj[1]]
        if (!p || p.user !== me.id) return send(res, 404, { error: 'Not found' })
        const last = [...p.joined].reverse().find((id) => db.users[id])
        return send(res, 200, { joined: last ? pub(db.users[last]) : null, expired: p.exp < Date.now() })
      }
      if (pj && pj[2] === 'join' && req.method === 'POST') {
        const owner = await mutate((d) => {
          const p = d.pairs?.[pj[1]]
          if (!p || p.exp < Date.now() || !d.users[p.user]) throw new Stop(404, { error: 'This QR code has expired. Ask for a new one.' })
          if (p.user === me.id) throw new Stop(400, { error: 'This is your own code. Open it on another phone.' })
          linkUsers(d, me.id, p.user)
          if (!p.joined.includes(me.id)) p.joined.push(me.id)
          return pub(d.users[p.user])
        })
        return send(res, 200, { contact: owner })
      }

      // A guest keeps their account: a username of their own and a password, with their contacts and settings.
      if (path === '/guest/keep' && req.method === 'POST') {
        if (!me.guest) return send(res, 400, { error: 'This account is already saved.' })
        const b = await readBody(req)
        const id = cleanId(b.username)
        const name = String(b.name ?? '').trim().slice(0, 40)
        const password = String(b.password ?? '')
        const bad = usernameProblem(id)
        if (bad) return send(res, id.length < 3 ? 400 : 409, { error: bad })
        if (!name) return send(res, 400, { error: 'Enter your name.' })
        if (password.length < 6) return send(res, 400, { error: 'Password must be at least 6 characters.' })
        const salt = randomBytes(16).toString('hex')
        const user = await mutate(async (d) => {
          if (d.users[id]) throw new Stop(409, { error: 'That username is taken. Try another.' })
          await renameUser(d, me.id, id)
          // (the check above narrowed d.users[id] to "missing"; it exists now)
          const u = d.users[id] as UserRecord
          Object.assign(u, { name, salt, hash: hashPw(password, salt), createdAt: Date.now() })
          delete u.guest
          return pub(u)
        })
        // The groups on the chat service follow the new username too.
        for (const g of Object.values(db.groups ?? {})) if (g.members.includes(me.id)) await nexconnPost(env, '/v4/group-channel/join', { channelId: g.id, userIds: [id] }).catch(() => null)
        return send(res, 200, { user })
      }

      if (path === '/push/notify' && req.method === 'POST') {
        // Called by the sender's app right after a message goes out, so the other person's phone buzzes even with the app closed.
        const b = await readBody(req)
        const kind = b.kind === 'group' ? 'group' : 'direct'
        const target = cleanId(b.id)
        const body = String(b.body ?? 'New message').slice(0, 140)
        // A demo friend answers after a moment, in their own way.
        if (kind === 'direct' && isDemo(target) && me.contacts.includes(target)) {
          const what = String(b.what ?? 'text')
          const r = demoReply(target, body, what)
          await new Promise((ok) => setTimeout(ok, 1200))
          await demoSay(env, target, me.id, r.text, r.gloss).catch(() => null)
          return send(res, 200, { sent: 0, demo: true })
        }
        if (!pushReady) return send(res, 200, { sent: 0 })
        let to: string[] = []
        let title = me.name
        if (kind === 'direct') {
          const other = db.users[target]
          if (other && me.contacts.includes(other.id) && !(other.blocked ?? []).includes(me.id)) to = [other.id]
        } else {
          const g = db.groups?.[target]
          if (g?.members.includes(me.id)) {
            to = g.members.filter((m) => m !== me.id)
            title = `${me.name} in ${g.name}`
          }
        }
        const call = b.call === true
        const link = kind === 'group' ? `/group/${target}` : `/chat/${me.id}`
        const payload = JSON.stringify(
          call
            ? { title: `${me.name} is calling you`, body: b.video ? 'Video call · tap to answer' : 'Voice call · tap to answer', url: link, tag: `call:${me.id}`, call: true }
            : { title, body, url: link, tag: kind === 'group' ? `group:${target}` : `direct:${me.id}` },
        )
        let sent = 0
        const gone: { id: string; endpoint: string }[] = []
        await Promise.all(
          to.flatMap((id) =>
            (db.push?.[id] ?? []).map(async (sub) => {
              try {
                await webpush.sendNotification(sub, payload, { TTL: call ? 45 : 3600, urgency: 'high' })
                sent++
              } catch (e) {
                const code = (e as { statusCode?: number }).statusCode
                // The device unsubscribed or the app was uninstalled: forget it.
                if (code === 404 || code === 410) gone.push({ id, endpoint: sub.endpoint })
              }
            }),
          ),
        )
        if (gone.length)
          await mutate((d) => {
            for (const g of gone) if (d.push?.[g.id]) d.push[g.id] = d.push[g.id].filter((x) => x.endpoint !== g.endpoint)
          })
        return send(res, 200, { sent })
      }

      if (path === '/phrases' && req.method === 'GET') return send(res, 200, { phrases: me.phrases ?? [] })

      if (path === '/phrases' && req.method === 'POST') {
        const b = await readBody(req)
        const list = Array.isArray(b.phrases) ? b.phrases : []
        const phrases = list
          .map((x: { text?: unknown; icon?: unknown }) => ({ text: String(x?.text ?? '').trim().slice(0, 80), icon: String(x?.icon ?? '💬').slice(0, 8) }))
          .filter((x: { text: string }) => x.text)
          .slice(0, 60)
        await mutate((d) => void (d.users[me.id].phrases = phrases))
        return send(res, 200, { phrases })
      }

      if (path === '/reviews/mine' && req.method === 'GET') {
        return send(res, 200, { review: (db.reviews ?? []).find((r) => r.user === me.id) ?? null })
      }

      if (path === '/reviews' && req.method === 'POST') {
        const b = await readBody(req)
        const rating = Math.round(Number(b.rating))
        const text = String(b.text ?? '').trim().slice(0, 1500)
        if (!(rating >= 1 && rating <= 5)) return send(res, 400, { error: 'Pick 1 to 5 stars.' })
        if (!text) return send(res, 400, { error: 'Write a few words about AnyWay.' })
        const review = await mutate((d) => {
          d.reviews ??= []
          const old = d.reviews.find((r) => r.user === me.id)
          const r: Review = { id: old?.id ?? randomBytes(6).toString('hex'), user: me.id, rating, text, lang: String(b.lang ?? '').trim().slice(0, 40) || 'Not given', showName: !!b.showName, hidden: old?.hidden, time: Date.now() }
          d.reviews = [...d.reviews.filter((x) => x.user !== me.id), r]
          return r
        })
        return send(res, 200, { review })
      }

      if (path === '/users/search' && req.method === 'GET') {
        const q = cleanId(url.searchParams.get('q'))
        const nameQ = (url.searchParams.get('q') ?? '').trim().toLowerCase()
        const found = Object.values(db.users)
          .filter((u) => u.id !== me.id && real(u) && q && (u.id.includes(q) || u.name.toLowerCase().includes(nameQ)))
          .slice(0, 10)
          .map(pub)
        return send(res, 200, { users: found })
      }

      if (path === '/contacts' && req.method === 'GET') {
        return send(res, 200, { contacts: me.contacts.map((id) => db.users[id]).filter(Boolean).map((u) => ({ ...pub(u), nickname: me.nicknames?.[u.id] })) })
      }

      if (path === '/translate' && req.method === 'POST') {
        const b = await readBody(req)
        const text = String(b.text ?? '').slice(0, 1000)
        const to = String(b.to ?? 'en').split('-')[0]
        const from = String(b.from ?? 'auto').split('-')[0]
        if (!text.trim()) return send(res, 200, { text: '' })
        if (from === 'auto') return send(res, 200, await translateAuto(text, to))
        return send(res, 200, { text: await translate(text, from, to) })
      }

      if (path === '/nickname' && req.method === 'POST') {
        const b = await readBody(req)
        const other = cleanId(b.username)
        if (!me.contacts.includes(other)) return send(res, 404, { error: 'That person is not in your contacts.' })
        const nick = String(b.nickname ?? '').trim().slice(0, 40)
        await mutate((d) => {
          const u = d.users[me.id]
          u.nicknames ??= {}
          if (nick) u.nicknames[other] = nick
          else delete u.nicknames[other]
        })
        return send(res, 200, { nickname: nick || null })
      }

      if (path === '/contacts' && req.method === 'POST') {
        const b = await readBody(req)
        const otherId = cleanId(b.username)
        const other = db.users[otherId]
        if (!other || other.id === me.id || other.demo) return send(res, 404, { error: 'No one with that username.' })
        await mutate((d) => {
          const u = d.users[me.id]
          const o = d.users[otherId]
          if (!o) throw new Stop(404, { error: 'No one with that username.' })
          if (!u.contacts.includes(o.id)) u.contacts.push(o.id)
          // Adding someone makes the contact mutual, so they can reply straight away.
          if (!o.contacts.includes(u.id)) o.contacts.push(u.id)
        })
        return send(res, 200, { contact: pub(other) })
      }

      if (path === '/contacts/remove' && req.method === 'POST') {
        const b = await readBody(req)
        const otherId = cleanId(b.username)
        await mutate((d) => {
          const u = d.users[me.id]
          u.contacts = u.contacts.filter((c) => c !== otherId)
          // Demo friends forget you too; real people keep you until they remove you themselves.
          const o = d.users[otherId]
          if (o?.demo) o.contacts = o.contacts.filter((c) => c !== me.id)
        })
        return send(res, 200, { ok: true })
      }

      if (path === '/calls' && req.method === 'GET') {
        return send(res, 200, { calls: (db.calls?.[me.id] ?? []).slice().sort((a, b) => b.time - a.time).slice(0, 100) })
      }

      if (path === '/calls' && req.method === 'POST') {
        const b = await readBody(req)
        const callId = String(b.callId ?? '').slice(0, 80)
        const peer = cleanId(b.peer)
        if (!callId || !peer) return send(res, 400, { error: 'Missing call details.' })
        const log: CallLog = {
          callId,
          peer,
          video: !!b.video,
          outgoing: !!b.outgoing,
          answered: !!b.answered,
          time: Number(b.time) || Date.now(),
          seconds: Math.max(0, Math.min(86400, Math.round(Number(b.seconds) || 0))),
        }
        await mutate((d) => {
          d.calls = d.calls ?? {}
          const list = (d.calls[me.id] = (d.calls[me.id] ?? []).slice(-199))
          const i = list.findIndex((c) => c.callId === callId)
          if (i >= 0) list[i] = log
          else list.push(log)
        })
        return send(res, 200, { ok: true })
      }

      const gm = path.match(/^\/groups\/([a-z0-9]+)\/(members|leave)$/)
      if (gm && req.method === 'POST') {
        const g = db.groups?.[gm[1]]
        if (!g || !g.members.includes(me.id)) return send(res, 404, { error: 'Group not found.' })
        const b = await readBody(req)
        if (gm[2] === 'leave') {
          const r = await nexconnPost(env, '/v4/group-channel/leave', { channelId: g.id, userIds: [me.id] })
          if (!r || r.code !== 0) return send(res, 502, { error: 'Could not leave the group. Try again.' })
          await mutate((d) => {
            const fresh = d.groups?.[g.id]
            if (!fresh) return
            fresh.members = fresh.members.filter((id) => id !== me.id)
            if (fresh.owner === me.id && fresh.members.length) fresh.owner = fresh.members[0]
            if (!fresh.members.length) delete d.groups![g.id]
          })
          return send(res, 200, { ok: true })
        }
        if (g.owner !== me.id) return send(res, 403, { error: 'Only the group admin can change members.' })
        const add = (Array.isArray(b.add) ? b.add : []).map(cleanId).filter((id) => db.users[id] && !db.users[id].demo && !g.members.includes(id))
        const remove = (Array.isArray(b.remove) ? b.remove : []).map(cleanId).filter((id) => g.members.includes(id) && id !== me.id)
        if (add.length) {
          const r = await nexconnPost(env, '/v4/group-channel/join', { channelId: g.id, userIds: add })
          if (!r || r.code !== 0) return send(res, 502, { error: 'Could not add people right now.' })
        }
        if (remove.length) {
          const r = await nexconnPost(env, '/v4/group-channel/leave', { channelId: g.id, userIds: remove })
          if (!r || r.code !== 0) return send(res, 502, { error: 'Could not remove people right now.' })
        }
        const group = await mutate((d) => {
          const fresh = d.groups?.[g.id]
          if (!fresh) throw new Stop(404, { error: 'Group not found.' })
          for (const id of add) if (!fresh.members.includes(id)) fresh.members.push(id)
          fresh.members = fresh.members.filter((id) => !remove.includes(id))
          return { id: fresh.id, name: fresh.name, owner: fresh.owner, members: fresh.members.map((id) => d.users[id]).filter(Boolean).map(pub) }
        })
        return send(res, 200, { group })
      }

      if (path === '/groups' && req.method === 'GET') {
        const groups = Object.values(db.groups ?? {})
          .filter((g) => g.members.includes(me.id))
          .map((g) => ({ id: g.id, name: g.name, owner: g.owner, members: g.members.map((id) => db.users[id]).filter(Boolean).map(pub) }))
        return send(res, 200, { groups })
      }

      if (path === '/groups' && req.method === 'POST') {
        const b = await readBody(req)
        const name = String(b.name ?? '').trim().slice(0, 64)
        const members = Array.isArray(b.members) ? b.members.map(cleanId).filter((id) => db.users[id] && !db.users[id].demo && id !== me.id) : []
        if (!name) return send(res, 400, { error: 'Give the group a name.' })
        if (members.length === 0) return send(res, 400, { error: 'Pick at least one person (demo friends can’t join groups).' })
        const id = `g${randomBytes(6).toString('hex')}`
        const r = await nexconnPost(env, '/v4/group-channel/create', { channelId: id, name, owner: me.id, userIds: members.slice(0, 30) })
        if (!r || r.code !== 0) return send(res, 502, { error: `Could not create the group on the chat service${r ? ` (code ${r.code})` : ''}.` })
        const group = await mutate((d) => {
          d.groups = d.groups ?? {}
          d.groups[id] = { id, name, owner: me.id, members: [me.id, ...members], createdAt: Date.now() }
          return { id, name, owner: me.id, members: d.groups[id].members.map((m) => d.users[m]).filter(Boolean).map(pub) }
        })
        return send(res, 200, { group })
      }

      return send(res, 404, { error: 'Not found' })
    } catch (e) {
      if (e instanceof Stop) return send(res, e.status, e.body)
      console.error('[anyway api]', e)
      return send(res, 500, { error: 'Something went wrong. Try again.' })
    }
  }
}

/** Translate a line of speech. Cached in memory (only real translations), since calls repeat short phrases. */
const tcache = new Map<string, string>()
async function getJson(u: string, ms: number) {
  const r = await fetch(u, { signal: AbortSignal.timeout(ms), headers: { 'User-Agent': 'Mozilla/5.0' } })
  if (!r.ok) throw new Error(String(r.status))
  return r.json()
}
async function translate(text: string, from: string, to: string): Promise<string> {
  if (from === to) return text
  const k = `${from}|${to}|${text}`
  const hit = tcache.get(k)
  if (hit) return hit
  const q = encodeURIComponent(text)
  const tries: (() => Promise<string>)[] = [
    async () => ((await getJson(`https://translate.googleapis.com/translate_a/single?client=gtx&dt=t&sl=${from}&tl=${to}&q=${q}`, 3500)) as [[string][]])[0].map((x) => x[0]).join(''),
    async () => { const j = await getJson(`https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=${from}&tl=${to}&q=${q}`, 3500); const jj = j as { sentences?: { trans: string }[] } | string[]; const v = Array.isArray(jj) ? jj[0] : jj?.sentences?.map((x: { trans: string }) => x.trans).join(''); return String(Array.isArray(v) ? v[0] : v ?? '') },
    async () => ((await getJson(`https://translate.googleapis.com/translate_a/single?client=gtx&dt=t&sl=auto&tl=${to}&q=${q}`, 3500)) as [[string][]])[0].map((x) => x[0]).join(''),
    async () => String(((await getJson(`https://api.mymemory.translated.net/get?q=${q}&langpair=${from === 'auto' ? 'en' : from}|${to}`, 5000)) as { responseData?: { translatedText?: string } }).responseData?.translatedText ?? ''),
  ]
  for (const t of tries) {
    try {
      const out = (await t()).trim()
      if (out && out.toLowerCase() !== text.trim().toLowerCase()) {
        if (tcache.size > 2000) tcache.clear()
        tcache.set(k, out)
        return out
      }
    } catch { /* try the next one */ }
  }
  return text
}

/** Detect the language of a chat message and translate it. Returns the detected language too. */
const acache = new Map<string, { text: string; from: string }>()
async function translateAuto(text: string, to: string): Promise<{ text: string; from: string; failed?: boolean }> {
  const k = `${to}|${text}`
  const hit = acache.get(k)
  if (hit) return hit
  for (let i = 0; i < 2; i++) {
    try {
      const j = (await getJson(`https://translate.googleapis.com/translate_a/single?client=gtx&dt=t&sl=auto&tl=${to}&q=${encodeURIComponent(text)}`, 3500)) as [[string][], unknown, string]
      const out = { text: j[0].map((x) => x[0]).join('').trim(), from: String(j[2] ?? '') }
      if (out.text) {
        if (acache.size > 3000) acache.clear()
        acache.set(k, out)
        return out
      }
    } catch { /* retry once */ }
  }
  // Detection failed: fall back to the plain translator, language unknown. Unchanged text means it couldn't translate.
  const t = await translate(text, 'auto', to)
  return t === text ? { text, from: '', failed: true } : { text: t, from: '' }
}
