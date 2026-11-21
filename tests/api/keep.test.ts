import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startApi, type TestApi } from '../helpers/api.ts'

let api: TestApi
beforeAll(async () => {
  api = await startApi()
})
afterAll(() => api.close())

describe('a guest keeps their account', () => {
  it('gets their own username and password, and keeps contacts, settings and their login', async () => {
    const g = await api.guest('deaf')
    const friend = await api.signup('keepfriend')
    await api.call('POST', '/contacts', { session: friend, body: { username: g.user.id } })
    await api.call('POST', '/nickname', { session: friend, body: { username: g.user.id, nickname: 'My guest' } })
    await api.call('PATCH', '/me', { session: g.session, body: { prefs: { lang: 'hi-IN' } } })

    const r = await api.call('POST', '/guest/keep', { session: g.session, body: { username: 'Lakshmi', name: 'Lakshmi R', password: 'goodpass' } })
    expect(r.status).toBe(200)
    expect(r.body.user).toEqual({ id: 'lakshmi', name: 'Lakshmi R', mode: 'deaf' })

    // Same login, new name.
    const boot = await api.call('GET', '/bootstrap?token=0', { session: g.session })
    expect(boot.body.user).toEqual({ id: 'lakshmi', name: 'Lakshmi R', mode: 'deaf' })
    expect(boot.body.prefs).toEqual({ lang: 'hi-IN' })
    expect(boot.body.contacts.map((c: { id: string }) => c.id).sort()).toEqual(['demoarjun', 'demomeera', 'demopriya', 'keepfriend'])

    // Everyone who knew the guest now knows the new username (and nicknames follow).
    const db = api.readDb()
    expect(db.users[g.user.id]).toBeUndefined()
    expect(db.users.keepfriend.contacts).toEqual(['lakshmi'])
    expect(db.users.keepfriend.nicknames).toEqual({ lakshmi: 'My guest' })
    expect(db.users.demopriya.contacts).toContain('lakshmi')
    expect(db.users.demopriya.contacts).not.toContain(g.user.id)

    // And they can log in anywhere now.
    expect((await api.call('POST', '/login', { body: { username: 'lakshmi', password: 'goodpass' } })).status).toBe(200)
    // Counted as a sign-up from now on.
    const stats = (await api.call('GET', '/stats')).body
    expect(stats.people.length).toBe(stats.users.total)
  })

  it('their pairing code and groups follow them', async () => {
    const g = await api.guest('standard')
    const { code } = (await api.call('POST', '/pair', { session: g.session })).body
    const phone = await api.guest('deaf', code)
    await api.call('POST', '/guest/keep', { session: g.session, body: { username: 'pairedkeeper', name: 'P K', password: 'goodpass' } })
    const db = api.readDb()
    expect(db.pairs[code].user).toBe('pairedkeeper')
    expect(db.users[phone.user.id].contacts).toEqual(['pairedkeeper'])
  })

  it.each([
    ['ab', 'Name', 'goodpass', 400],
    ['guestnew', 'Name', 'goodpass', 409],
    ['demoname', 'Name', 'goodpass', 409],
    ['fineuser', '', 'goodpass', 400],
    ['fineuser', 'Name', 'short', 400],
  ])('checks the new details (%s)', async (username, name, password, status) => {
    const g = await api.guest('standard')
    const r = await api.call('POST', '/guest/keep', { session: g.session, body: { username, name, password } })
    expect(r.status).toBe(status)
    expect(api.readDb().users[g.user.id]?.guest).toBe(true)
  })

  it('refuses a username someone already has', async () => {
    await api.signup('takenname')
    const g = await api.guest('standard')
    const r = await api.call('POST', '/guest/keep', { session: g.session, body: { username: 'takenname', name: 'X', password: 'goodpass' } })
    expect(r.status).toBe(409)
  })

  it('only guests can do this', async () => {
    const s = await api.signup('alreadyreal')
    const r = await api.call('POST', '/guest/keep', { session: s, body: { username: 'another', name: 'X', password: 'goodpass' } })
    expect(r.status).toBe(400)
  })
})
