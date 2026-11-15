import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
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
  createdAt: number
}
interface Db {
  users: Record<string, UserRecord>
  sessions: Record<string, string>
}

export interface PublicUser {
  id: string
  name: string
  mode: Mode
}

const DB_PATH = resolve(process.cwd(), 'data/db.json')

function load(): Db {
  if (!existsSync(DB_PATH)) return { users: {}, sessions: {} }
  return JSON.parse(readFileSync(DB_PATH, 'utf8')) as Db
}
function save(db: Db) {
  mkdirSync(dirname(DB_PATH), { recursive: true })
  writeFileSync(DB_PATH, JSON.stringify(db, null, 2))
}

const pub = (u: UserRecord): PublicUser => ({ id: u.id, name: u.name, mode: u.mode })
const hashPw = (pw: string, salt: string) => scryptSync(pw, salt, 32).toString('hex')

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  let raw = ''
  for await (const chunk of req) raw += chunk
  if (raw.length > 10_000) return {}
  try {
    return JSON.parse(raw || '{}') as Record<string, unknown>
  } catch {
    return {}
  }
}

async function issueNexconnToken(env: Record<string, string>, user: PublicUser): Promise<string | null> {
  const appKey = env.VITE_NEXCONN_APP_KEY
  const secret = env.NEXCONN_APP_SECRET
  if (!appKey || !secret) return null
  for (const host of ['api.sg-light-api.com', 'api-b.sg-light-api.com']) {
    try {
      const nonce = randomBytes(6).toString('hex')
      const timestamp = String(Date.now())
      const signature = createHash('sha1').update(secret + nonce + timestamp).digest('hex')
      const r = await fetch(`https://${host}/v4/auth/access-token/issue`, {
        method: 'POST',
        headers: { 'App-Key': appKey, Nonce: nonce, Timestamp: timestamp, Signature: signature, 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, name: user.name }),
        signal: AbortSignal.timeout(5000),
      })
      const j = (await r.json()) as { code: number; result?: { accessToken: string } }
      return j.code === 0 && j.result ? j.result.accessToken : null
    } catch {
      /* try backup domain */
    }
  }
  return null
}

const cleanId = (v: unknown) => String(v ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 32)

export function createApi(env: Record<string, string>) {
  return async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = new URL(req.url ?? '', 'http://localhost')
    if (!url.pathname.startsWith('/api/')) return next()
    const path = url.pathname.slice(4)
    const db = load()
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
        save(db)
        return send(res, 200, { session: token, user: pub(db.users[id]) })
      }

      if (path === '/login' && req.method === 'POST') {
        const b = await readBody(req)
        const u = db.users[cleanId(b.username)]
        const ok = u && timingSafeEqual(Buffer.from(hashPw(String(b.password ?? ''), u.salt), 'hex'), Buffer.from(u.hash, 'hex'))
        if (!u || !ok) return send(res, 401, { error: 'Wrong username or password.' })
        const token = randomBytes(24).toString('hex')
        db.sessions[token] = u.id
        save(db)
        return send(res, 200, { session: token, user: pub(u) })
      }

      if (!me) return send(res, 401, { error: 'Please log in again.' })

      if (path === '/logout' && req.method === 'POST') {
        delete db.sessions[session]
        save(db)
        return send(res, 200, { ok: true })
      }

      if (path === '/me' && req.method === 'GET') return send(res, 200, { user: pub(me) })

      if (path === '/me' && req.method === 'PATCH') {
        const b = await readBody(req)
        if (MODES.includes(b.mode as Mode)) me.mode = b.mode as Mode
        if (typeof b.name === 'string' && b.name.trim()) me.name = b.name.trim().slice(0, 40)
        save(db)
        return send(res, 200, { user: pub(me) })
      }

      if (path === '/nexconn-token' && req.method === 'GET') {
        const token = await issueNexconnToken(env, pub(me))
        return token ? send(res, 200, { token }) : send(res, 502, { error: 'Could not reach the chat service.' })
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
        return send(res, 200, { contacts: me.contacts.map((id) => db.users[id]).filter(Boolean).map(pub) })
      }

      if (path === '/contacts' && req.method === 'POST') {
        const b = await readBody(req)
        const other = db.users[cleanId(b.username)]
        if (!other || other.id === me.id) return send(res, 404, { error: 'No one with that username.' })
        if (!me.contacts.includes(other.id)) me.contacts.push(other.id)
        // Adding someone makes the contact mutual, so they can reply straight away.
        if (!other.contacts.includes(me.id)) other.contacts.push(me.id)
        save(db)
        return send(res, 200, { contact: pub(other) })
      }

      return send(res, 404, { error: 'Not found' })
    } catch {
      return send(res, 500, { error: 'Something went wrong. Try again.' })
    }
  }
}
