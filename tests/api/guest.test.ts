import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startApi, type TestApi } from '../helpers/api.ts'

let api: TestApi
beforeAll(async () => {
  api = await startApi()
})
afterAll(() => api.close())

const DEMO = ['demopriya', 'demoarjun', 'demomeera']

describe('Try it now (guest accounts)', () => {
  it.each(['deaf', 'blind', 'speech', 'standard'])('starts a %s guest in one call, with the three demo friends', async (mode) => {
    const g = await api.guest(mode)
    expect(g.user).toMatchObject({ mode, guest: true })
    expect(g.user.id).toMatch(/^guest[0-9a-f]{6}$/)
    expect(g.user.name).toMatch(/^Guest \d{4}$/)
    const boot = await api.call('GET', '/bootstrap?token=0', { session: g.session })
    expect(boot.body.contacts.map((c: { id: string }) => c.id).sort()).toEqual([...DEMO].sort())
    expect(boot.body.contacts.every((c: { demo?: boolean }) => c.demo)).toBe(true)
  })

  it('makes the demo friends know the guest back, so they can answer', async () => {
    const g = await api.guest('deaf')
    const db = api.readDb()
    for (const id of DEMO) expect(db.users[id].contacts).toContain(g.user.id)
  })

  it('treats an unknown way of talking as talk-and-type', async () => {
    expect((await api.guest('martian')).user.mode).toBe('standard')
  })

  it('a guest has no password, so nobody can log in to it', async () => {
    const g = await api.guest('blind')
    for (const password of ['', '123456', 'password'])
      expect((await api.call('POST', '/login', { body: { username: g.user.id, password } })).status).toBe(401)
  })

  it('a guest can switch to another way of talking', async () => {
    const g = await api.guest('deaf')
    const r = await api.call('PATCH', '/me', { session: g.session, body: { mode: 'blind' } })
    expect(r.body.user).toMatchObject({ mode: 'blind', guest: true })
  })

  it('limits guest accounts from one address to 30 an hour', async () => {
    const ip = '203.0.113.7'
    for (let i = 0; i < 30; i++) expect((await api.call('POST', '/guest', { ip, body: { mode: 'standard' } })).status).toBe(200)
    const r = await api.call('POST', '/guest', { ip, body: { mode: 'standard' } })
    expect(r.status).toBe(429)
    expect(r.body.error).toMatch(/Too many/)
    // Someone else is not affected.
    expect((await api.call('POST', '/guest', { ip: '203.0.113.8', body: { mode: 'standard' } })).status).toBe(200)
  })

  it('removes guests nobody kept after 14 days, with every link to them', async () => {
    const old = await api.guest('deaf')
    const friend = await api.signup('oldfriend')
    // The guest and a real person became contacts, 15 days ago.
    const db = api.readDb()
    db.users[old.user.id].createdAt = Date.now() - 15 * 86400_000
    db.users[old.user.id].contacts.push('oldfriend')
    db.users.oldfriend.contacts.push(old.user.id)
    api.writeDb(db)
    await api.guest('standard') // any new guest tidies up
    const after = api.readDb()
    expect(after.users[old.user.id]).toBeUndefined()
    expect(after.users.oldfriend.contacts).not.toContain(old.user.id)
    for (const id of DEMO) expect(after.users[id].contacts).not.toContain(old.user.id)
    expect(Object.values(after.sessions)).not.toContain(old.user.id)
    expect((await api.call('GET', '/me', { session: old.session })).status).toBe(401)
    expect((await api.call('GET', '/me', { session: friend })).status).toBe(200)
  })

  it('counts guests apart from sign-ups on the public dashboard', async () => {
    const before = (await api.call('GET', '/stats')).body
    await api.guest('speech')
    await api.signup('countedperson')
    const after = (await api.call('GET', '/stats')).body
    expect(after.users.total).toBe(before.users.total + 1)
    expect(after.guests.total).toBe(before.guests.total + 1)
    // Demo friends are never counted.
    expect(after.people.length).toBe(after.users.total)
  })

  it('the admin list marks guests', async () => {
    const g = await api.guest('deaf')
    const r = await api.call('GET', '/admin/users') // the admin panel is open: no key
    const row = r.body.users.find((u: { id: string }) => u.id === g.user.id)
    expect(row).toMatchObject({ guest: true, mode: 'deaf' })
    expect(r.body.users.some((u: { id: string }) => DEMO.includes(u.id))).toBe(false)
  })
})
