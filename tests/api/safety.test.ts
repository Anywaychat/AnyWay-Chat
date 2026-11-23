import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startApi, type TestApi } from '../helpers/api.ts'

let api: TestApi
beforeAll(async () => {
  api = await startApi()
})
afterAll(() => api.close())

describe('Age confirmation at sign-up', () => {
  it('asks people to confirm they are 18+, or that a parent or guardian agrees', async () => {
    const r = await api.call('POST', '/signup', { body: { username: 'noconsent', name: 'N', password: 'secret1' } })
    expect(r.status).toBe(400)
    expect(r.body.error).toMatch(/18 or older/)
  })

  it('accepts either answer and remembers it', async () => {
    for (const [username, consent] of [['adultone', 'adult'], ['teenone', 'guardian']]) {
      expect((await api.call('POST', '/signup', { body: { username, name: 'X', password: 'secret1', consent } })).status).toBe(200)
      expect(api.readDb().users[username]).toMatchObject({ consent })
    }
  })
})

describe('Delete my account', () => {
  it('needs the password, then removes the account and every link to it', async () => {
    const a = await api.signup('leaver')
    const b = await api.signup('stayer')
    await api.call('POST', '/contacts', { session: a, body: { username: 'stayer' } })
    expect((await api.call('POST', '/me/delete', { session: a, body: { password: 'wrong' } })).status).toBe(401)
    expect((await api.call('POST', '/me/delete', { session: a, body: { password: 'secret1' } })).status).toBe(200)
    const db = api.readDb()
    expect(db.users.leaver).toBeUndefined()
    expect(db.users.stayer.contacts).not.toContain('leaver')
    expect((await api.call('GET', '/me', { session: a })).status).toBe(401)
    expect((await api.call('GET', '/me', { session: b })).status).toBe(200)
  })

  it('a guest can delete without a password', async () => {
    const g = await api.guest('blind')
    expect((await api.call('POST', '/me/delete', { session: g.session, body: {} })).status).toBe(200)
    expect(api.readDb().users[g.user.id]).toBeUndefined()
  })
})

describe('Wrong-password limit', () => {
  it('stops guessing after 10 wrong tries for a username, even with the right password', async () => {
    await api.signup('guessme')
    for (let i = 0; i < 10; i++) expect((await api.call('POST', '/login', { ip: '198.51.100.1', body: { username: 'guessme', password: `nope${i}` } })).status).toBe(401)
    const r = await api.call('POST', '/login', { ip: '198.51.100.2', body: { username: 'guessme', password: 'secret1' } })
    expect(r.status).toBe(429)
    expect(r.body.error).toMatch(/15 minutes/)
  })

  it('a right password clears the wrong tries', async () => {
    await api.signup('forgetful')
    for (let i = 0; i < 9; i++) await api.call('POST', '/login', { ip: '198.51.100.3', body: { username: 'forgetful', password: 'nope' } })
    expect((await api.call('POST', '/login', { ip: '198.51.100.3', body: { username: 'forgetful', password: 'secret1' } })).status).toBe(200)
    expect((await api.call('POST', '/login', { ip: '198.51.100.3', body: { username: 'forgetful', password: 'nope' } })).status).toBe(401)
  })
})
