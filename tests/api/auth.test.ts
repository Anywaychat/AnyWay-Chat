import { createHash } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startApi, type TestApi } from '../helpers/api.ts'

let api: TestApi
beforeAll(async () => {
  api = await startApi()
})
afterAll(() => api.close())

describe('sign up', () => {
  it('makes an account and logs it in', async () => {
    const r = await api.call('POST', '/signup', { body: { consent: 'adult', username: 'Asha_01', name: '  Asha  ', password: 'secret1', mode: 'deaf' } })
    expect(r.status).toBe(200)
    // Usernames keep only lowercase letters and numbers.
    expect(r.body.user).toEqual({ id: 'asha01', name: 'Asha', mode: 'deaf' })
    const me = await api.call('GET', '/me', { session: r.body.session })
    expect(me.body.user.id).toBe('asha01')
  })

  it('refuses a username that is taken', async () => {
    await api.signup('ravi')
    const r = await api.call('POST', '/signup', { body: { consent: 'adult', username: 'RAVI', name: 'Ravi 2', password: 'secret1' } })
    expect(r.status).toBe(409)
    expect(r.body.error).toMatch(/taken/)
  })

  it.each([
    ['ab', 'secret1', 'Name', /at least 3/],
    ['validname', '12345', 'Name', /at least 6/],
    ['validname', 'secret1', '   ', /Enter your name/],
  ])('checks the details (%s / %s / %s)', async (username, password, name, error) => {
    const r = await api.call('POST', '/signup', { body: { consent: 'adult', username, password, name } })
    expect(r.status).toBe(400)
    expect(r.body.error).toMatch(error)
  })

  it('keeps "demo" and "guest" names for the app’s own accounts', async () => {
    for (const username of ['demopriya', 'demoanything', 'guest123', 'guestbook']) {
      const r = await api.call('POST', '/signup', { body: { consent: 'adult', username, name: 'X', password: 'secret1' } })
      expect(r.status, username).toBe(409)
    }
  })

  it('falls back to talk-and-type for an unknown way of talking', async () => {
    const r = await api.call('POST', '/signup', { body: { consent: 'adult', username: 'kiran', name: 'Kiran', password: 'secret1', mode: 'telepathy' } })
    expect(r.body.user.mode).toBe('standard')
  })
})

describe('log in and out', () => {
  it('logs in with the right password only', async () => {
    await api.signup('meena', 'blind', 'rightpass')
    expect((await api.call('POST', '/login', { body: { username: 'meena', password: 'wrongpass' } })).status).toBe(401)
    expect((await api.call('POST', '/login', { body: { username: 'nobody', password: 'rightpass' } })).status).toBe(401)
    const ok = await api.call('POST', '/login', { body: { username: 'Meena', password: 'rightpass' } })
    expect(ok.status).toBe(200)
    expect(ok.body.user).toMatchObject({ id: 'meena', mode: 'blind' })
  })

  it('stores only a hash of each login, never the login itself', async () => {
    const session = await api.signup('hashcheck')
    const db = api.readDb()
    expect(Object.keys(db.sessions)).not.toContain(session)
    expect(db.sessions[createHash('sha256').update(session).digest('hex')]).toBe('hashcheck')
  })

  it('stores passwords as salted hashes', async () => {
    await api.signup('pwcheck', 'standard', 'mysecretpw')
    expect(api.rawDb()).not.toContain('mysecretpw')
    const u = api.readDb().users.pwcheck
    expect(u.salt).toMatch(/^[0-9a-f]{32}$/)
    expect(u.hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('logging out ends that login', async () => {
    const session = await api.signup('leaver')
    expect((await api.call('GET', '/me', { session })).status).toBe(200)
    await api.call('POST', '/logout', { session })
    expect((await api.call('GET', '/me', { session })).status).toBe(401)
  })

  it('keeps at most 10 logins per person', async () => {
    await api.signup('manydevices', 'standard', 'secret1')
    const logins: string[] = []
    for (let i = 0; i < 12; i++) logins.push((await api.call('POST', '/login', { body: { username: 'manydevices', password: 'secret1' } })).body.session)
    const kept = Object.values(api.readDb().sessions).filter((id) => id === 'manydevices').length
    expect(kept).toBe(10)
    expect((await api.call('GET', '/me', { session: logins[0] })).status).toBe(401)
    expect((await api.call('GET', '/me', { session: logins[11] })).status).toBe(200)
  })

  it('asks to log in again without a valid login', async () => {
    expect((await api.call('GET', '/bootstrap')).status).toBe(401)
    expect((await api.call('GET', '/bootstrap', { session: 'not-a-real-session' })).status).toBe(401)
  })
})

describe('bootstrap', () => {
  it('returns everything the app needs in one call', async () => {
    const session = await api.signup('booter', 'speech')
    const r = await api.call('GET', '/bootstrap?token=0', { session })
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ user: { id: 'booter', mode: 'speech' }, contacts: [], groups: [], blocked: [], token: null })
  })

  it('saves settings that follow the person to another device', async () => {
    const session = await api.signup('prefsuser')
    await api.call('PATCH', '/me', { session, body: { prefs: { lang: 'ta-IN', display: { size: 1.3 } } } })
    const r = await api.call('GET', '/bootstrap?token=0', { session })
    expect(r.body.prefs).toEqual({ lang: 'ta-IN', display: { size: 1.3 } })
  })
})
