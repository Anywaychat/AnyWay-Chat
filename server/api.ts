import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import webpush from 'web-push'
import { dirname, resolve } from 'node:path'

/**
 * Minimal account + contacts API for AnyWay.
 * Accounts live in data/db.json. Nexconn tokens are issued here so the App Secret never reaches the browser.
 */

export type Mode = 'blind' | 'deaf' | 'speech' | 'deafblind' | 'standard'
const MODES: Mode[] = ['blind', 'deaf', 'speech', 'deafblind', 'standard']

interface UserRecord {
  id: string
  name: string
  mode: Mode
  salt: string
  hash: string
  contacts: string[]
  avatar?: string
  blocked?: string[]
  /** Names this user gave their contacts, only they see them. */
  nicknames?: Record<string, string>
  createdAt: number
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
interface Db {
  reports?: Report[]
  calls?: Record<string, CallLog[]>
  users: Record<string, UserRecord>
  sessions: Record<string, string>
  groups?: Record<string, GroupRecord>
  /** Web Push subscriptions per user (one per device). */
  push?: Record<string, PushSubscription[]>
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
}

const DB_PATH = resolve(process.cwd(), 'data/db.json')

/**
 * Storage: Upstash Redis when its keys are set (on Vercel), otherwise a local JSON file (on your computer).
 */
let redis: { url: string; token: string } | null = null
export function useRedis(env: Record<string, string | undefined>) {
  const url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL
  const token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN
  redis = url && token ? { url, token } : null
}
const KEY = 'anyway:db'

async function load(): Promise<Db> {
  if (redis) {
    const r = await fetch(`${redis.url}/get/${KEY}`, { headers: { Authorization: `Bearer ${redis.token}` } })
    const j = (await r.json()) as { result: string | null }
    return j.result ? (JSON.parse(j.result) as Db) : { users: {}, sessions: {} }
  }
  if (!existsSync(DB_PATH)) return { users: {}, sessions: {} }
  return JSON.parse(readFileSync(DB_PATH, 'utf8')) as Db
}
async function save(db: Db) {
  if (redis) {
    await fetch(`${redis.url}/set/${KEY}`, { method: 'POST', headers: { Authorization: `Bearer ${redis.token}` }, body: JSON.stringify(db) })
    return
  }
  mkdirSync(dirname(DB_PATH), { recursive: true })
  writeFileSync(DB_PATH, JSON.stringify(db, null, 2))
}

const pub = (u: UserRecord): PublicUser => ({ id: u.id, name: u.name, mode: u.mode, avatar: u.avatar })
const hashPw = (pw: string, salt: string) => scryptSync(pw, salt, 32).toString('hex')

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

export function createApi(env: Record<string, string | undefined>) {
  useRedis(env)
  const pushReady = !!(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY)
  if (pushReady) webpush.setVapidDetails('https://anywaychat.vercel.app', env.VAPID_PUBLIC_KEY!, env.VAPID_PRIVATE_KEY!)
  return async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = new URL(req.url ?? '', 'http://localhost')
    if (!url.pathname.startsWith('/api/')) return next()
    const path = url.pathname.slice(4)
    const db = await load()
    const session = (req.headers.authorization ?? '').replace(/^Bearer /, '')
    const me = db.sessions[session] ? db.users[db.sessions[session]] : undefined

    try {
      if (path === '/signup' && req.method === 'POST') {
        const b = await readBody(req)
        const id = cleanId(b.username)
        const name = String(b.name ?? '').trim().slice(0, 40)
        const password = String(b.password ?? '')
        const mode = MODES.includes(b.mode as Mode) ? (b.mode as Mode) : 'standard'
        if (id.length < 3) return send(res, 400, { error: 'Username must be at least 3 letters or numbers.' })
        if (!name) return send(res, 400, { error: 'Enter your name.' })
        if (password.length < 6) return send(res, 400, { error: 'Password must be at least 6 characters.' })
        if (db.users[id]) return send(res, 409, { error: 'That username is taken. Try another.' })
        const salt = randomBytes(16).toString('hex')
        db.users[id] = { id, name, mode, salt, hash: hashPw(password, salt), contacts: [], createdAt: Date.now() }
        const token = randomBytes(24).toString('hex')
        db.sessions[token] = id
        await save(db)
        return send(res, 200, { session: token, user: pub(db.users[id]) })
      }

      if (path === '/login' && req.method === 'POST') {
        const b = await readBody(req)
        const u = db.users[cleanId(b.username)]
        const ok = u && timingSafeEqual(Buffer.from(hashPw(String(b.password ?? ''), u.salt), 'hex'), Buffer.from(u.hash, 'hex'))
        if (!u || !ok) return send(res, 401, { error: 'Wrong username or password.' })
        const token = randomBytes(24).toString('hex')
        db.sessions[token] = u.id
        await save(db)
        return send(res, 200, { session: token, user: pub(u) })
      }

      if (!me) return send(res, 401, { error: 'Please log in again.' })

      if (path === '/logout' && req.method === 'POST') {
        delete db.sessions[session]
        await save(db)
        return send(res, 200, { ok: true })
      }

      if (path === '/me' && req.method === 'GET') return send(res, 200, { user: pub(me), blocked: me.blocked ?? [] })

      if (path === '/block' && req.method === 'POST') {
        const b = await readBody(req)
        const other = cleanId(b.username)
        if (!db.users[other] || other === me.id) return send(res, 404, { error: 'No one with that username.' })
        const block = b.block !== false
        const r = block
          ? await nexconnPost(env, '/v4/user/blocklist/add', { userId: me.id, targetUserIds: [other] })
          : await nexconnPost(env, '/v4/user/blocklist/remove', { userId: me.id, blockedUserIds: [other] })
        if (!r || r.code !== 0) return send(res, 502, { error: 'Could not update the block right now.' })
        const list = new Set(me.blocked ?? [])
        if (block) list.add(other)
        else list.delete(other)
        me.blocked = [...list]
        await save(db)
        return send(res, 200, { blocked: me.blocked })
      }

      if (path === '/report' && req.method === 'POST') {
        const b = await readBody(req)
        const about = cleanId(b.username)
        if (!db.users[about]) return send(res, 404, { error: 'No one with that username.' })
        db.reports = db.reports ?? []
        db.reports.push({ from: me.id, about, reason: String(b.reason ?? '').slice(0, 500), time: Date.now() })
        await save(db)
        return send(res, 200, { ok: true })
      }

      if (path === '/me' && req.method === 'PATCH') {
        const b = await readBody(req)
        if (MODES.includes(b.mode as Mode)) me.mode = b.mode as Mode
        if (typeof b.name === 'string' && b.name.trim()) me.name = b.name.trim().slice(0, 40)
        if (b.avatar === null) delete me.avatar
        else if (typeof b.avatar === 'string' && /^data:image\/(jpeg|png|webp);base64,/.test(b.avatar) && b.avatar.length < 120_000) me.avatar = b.avatar
        await save(db)
        return send(res, 200, { user: pub(me) })
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
        db.push ??= {}
        // An endpoint belongs to one device, so move it to whoever is signed in there now.
        for (const id of Object.keys(db.push)) db.push[id] = db.push[id].filter((x) => x.endpoint !== sub.endpoint)
        db.push[me.id] = [...(db.push[me.id] ?? []), { endpoint: sub.endpoint, keys: sub.keys }].slice(-5)
        await save(db)
        return send(res, 200, { ok: true })
      }

      if (path === '/push/notify' && req.method === 'POST') {
        // Called by the sender's app right after a message goes out, so the other person's phone buzzes even with the app closed.
        if (!pushReady) return send(res, 200, { sent: 0 })
        const b = await readBody(req)
        const kind = b.kind === 'group' ? 'group' : 'direct'
        const target = cleanId(b.id)
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
        const body = String(b.body ?? 'New message').slice(0, 140)
        const url = kind === 'group' ? `/group/${target}` : `/chat/${me.id}`
        const payload = JSON.stringify({ title, body, url, tag: kind === 'group' ? `group:${target}` : `direct:${me.id}` })
        let sent = 0
        let changed = false
        await Promise.all(
          to.flatMap((id) =>
            (db.push?.[id] ?? []).map(async (sub) => {
              try {
                await webpush.sendNotification(sub, payload, { TTL: 3600, urgency: 'high' })
                sent++
              } catch (e) {
                const code = (e as { statusCode?: number }).statusCode
                // The device unsubscribed or the app was uninstalled: forget it.
                if (code === 404 || code === 410) {
                  db.push![id] = db.push![id].filter((x) => x.endpoint !== sub.endpoint)
                  changed = true
                }
              }
            }),
          ),
        )
        if (changed) await save(db)
        return send(res, 200, { sent })
      }

      if (path === '/users/search' && req.method === 'GET') {
        const q = cleanId(url.searchParams.get('q'))
        const nameQ = (url.searchParams.get('q') ?? '').trim().toLowerCase()
        const found = Object.values(db.users)
          .filter((u) => u.id !== me.id && q && (u.id.includes(q) || u.name.toLowerCase().includes(nameQ)))
          .slice(0, 10)
          .map(pub)
        return send(res, 200, { users: found })
      }

      if (path === '/contacts' && req.method === 'GET') {
        return send(res, 200, { contacts: me.contacts.map((id) => db.users[id]).filter(Boolean).map((u) => ({ ...pub(u), nickname: me.nicknames?.[u.id] })) })
      }

      if (path === '/nickname' && req.method === 'POST') {
        const b = await readBody(req)
        const other = cleanId(b.username)
        if (!me.contacts.includes(other)) return send(res, 404, { error: 'That person is not in your contacts.' })
        const nick = String(b.nickname ?? '').trim().slice(0, 40)
        me.nicknames ??= {}
        if (nick) me.nicknames[other] = nick
        else delete me.nicknames[other]
        await save(db)
        return send(res, 200, { nickname: nick || null })
      }

      if (path === '/contacts' && req.method === 'POST') {
        const b = await readBody(req)
        const other = db.users[cleanId(b.username)]
        if (!other || other.id === me.id) return send(res, 404, { error: 'No one with that username.' })
        if (!me.contacts.includes(other.id)) me.contacts.push(other.id)
        // Adding someone makes the contact mutual, so they can reply straight away.
        if (!other.contacts.includes(me.id)) other.contacts.push(me.id)
        await save(db)
        return send(res, 200, { contact: pub(other) })
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
        db.calls = db.calls ?? {}
        const list = (db.calls[me.id] = db.calls[me.id] ?? [])
        const i = list.findIndex((c) => c.callId === callId)
        if (i >= 0) list[i] = log
        else list.push(log)
        await save(db)
        return send(res, 200, { ok: true })
      }

      const gm = path.match(/^\/groups\/([a-z0-9]+)\/(members|leave)$/)
      if (gm && req.method === 'POST') {
        const g = db.groups?.[gm[1]]
        if (!g || !g.members.includes(me.id)) return send(res, 404, { error: 'Group not found.' })
        const b = await readBody(req)
        const groupOut = () => ({ id: g.id, name: g.name, owner: g.owner, members: g.members.map((id) => db.users[id]).filter(Boolean).map(pub) })
        if (gm[2] === 'leave') {
          const r = await nexconnPost(env, '/v4/group-channel/leave', { channelId: g.id, userIds: [me.id] })
          if (!r || r.code !== 0) return send(res, 502, { error: 'Could not leave the group. Try again.' })
          g.members = g.members.filter((id) => id !== me.id)
          if (g.owner === me.id && g.members.length) g.owner = g.members[0]
          if (!g.members.length) delete db.groups![g.id]
          await save(db)
          return send(res, 200, { ok: true })
        }
        if (g.owner !== me.id) return send(res, 403, { error: 'Only the group admin can change members.' })
        const add = (Array.isArray(b.add) ? b.add : []).map(cleanId).filter((id) => db.users[id] && !g.members.includes(id))
        const remove = (Array.isArray(b.remove) ? b.remove : []).map(cleanId).filter((id) => g.members.includes(id) && id !== me.id)
        if (add.length) {
          const r = await nexconnPost(env, '/v4/group-channel/join', { channelId: g.id, userIds: add })
          if (!r || r.code !== 0) return send(res, 502, { error: 'Could not add people right now.' })
          g.members.push(...add)
        }
        if (remove.length) {
          const r = await nexconnPost(env, '/v4/group-channel/leave', { channelId: g.id, userIds: remove })
          if (!r || r.code !== 0) return send(res, 502, { error: 'Could not remove people right now.' })
          g.members = g.members.filter((id) => !remove.includes(id))
        }
        await save(db)
        return send(res, 200, { group: groupOut() })
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
        const members = Array.isArray(b.members) ? b.members.map(cleanId).filter((id) => db.users[id] && id !== me.id) : []
        if (!name) return send(res, 400, { error: 'Give the group a name.' })
        if (members.length === 0) return send(res, 400, { error: 'Pick at least one person.' })
        const id = `g${randomBytes(6).toString('hex')}`
        const r = await nexconnPost(env, '/v4/group-channel/create', { channelId: id, name, owner: me.id, userIds: members.slice(0, 30) })
        if (!r || r.code !== 0) return send(res, 502, { error: `Could not create the group on the chat service${r ? ` (code ${r.code})` : ''}.` })
        db.groups = db.groups ?? {}
        db.groups[id] = { id, name, owner: me.id, members: [me.id, ...members], createdAt: Date.now() }
        await save(db)
        return send(res, 200, { group: { id, name, owner: me.id, members: db.groups[id].members.map((m) => pub(db.users[m])) } })
      }

      return send(res, 404, { error: 'Not found' })
    } catch {
      return send(res, 500, { error: 'Something went wrong. Try again.' })
    }
  }
}
