import { createServer } from 'node:http'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApi } from '../../server/api.ts'

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Json = Record<string, any>
export type Reply = { status: number; body: Json }

let nextIp = 1

/**
 * Runs the real AnyWay API (server/api.ts) on a random local port with its own temporary database file.
 * No Nexconn keys are set, so nothing is sent to the chat service: tokens come back empty and demo messages are skipped.
 */
export async function startApi(env: Record<string, string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'anyway-test-'))
  const dbPath = join(dir, 'db.json')
  const handler = createApi({ ANYWAY_DB_PATH: dbPath, ...env })
  const server = createServer((req, res) => {
    void handler(req, res, () => {
      res.statusCode = 404
      res.end()
    })
  })
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', () => ok()))
  const { port } = server.address() as { port: number }

  async function call(method: string, path: string, opts: { body?: unknown; session?: string; ip?: string; headers?: Record<string, string> } = {}): Promise<Reply> {
    // Each request looks like it comes from its own address, so the guest limit (per address) only bites when a test wants it to.
    const ip = opts.ip ?? `10.1.${Math.floor(nextIp / 250)}.${nextIp++ % 250}`
    const r = await fetch(`http://127.0.0.1:${port}/api${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip, ...(opts.session ? { Authorization: `Bearer ${opts.session}` } : {}), ...opts.headers },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    })
    return { status: r.status, body: (await r.json().catch(() => ({}))) as Json }
  }

  return {
    call,
    dbPath,
    rawDb: () => (existsSync(dbPath) ? readFileSync(dbPath, 'utf8') : ''),
    readDb: () => JSON.parse(readFileSync(dbPath, 'utf8')) as Json,
    writeDb: (db: Json) => writeFileSync(dbPath, JSON.stringify(db)),
    /** Makes an account and returns its login. */
    async signup(username: string, mode = 'standard', password = 'secret1', name = username): Promise<string> {
      const r = await call('POST', '/signup', { body: { username, name, password, mode } })
      if (r.status !== 200) throw new Error(`signup ${username}: ${r.status} ${JSON.stringify(r.body)}`)
      return r.body.session as string
    },
    /** "Try it now": a guest account. */
    async guest(mode = 'standard', pair?: string): Promise<{ session: string; user: Json; with: Json | null }> {
      const r = await call('POST', '/guest', { body: { mode, pair } })
      if (r.status !== 200) throw new Error(`guest: ${r.status} ${JSON.stringify(r.body)}`)
      return r.body as { session: string; user: Json; with: Json | null }
    },
    close: () => new Promise<void>((ok) => server.close(() => ok())),
  }
}
export type TestApi = Awaited<ReturnType<typeof startApi>>
