import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startApi, type TestApi } from '../helpers/api.ts'

// The admin panel is open to anyone on purpose: no key, even if an old ADMIN_KEY is still set on the server.
let api: TestApi
beforeAll(async () => {
  api = await startApi({ ADMIN_KEY: 'an-old-secret-nobody-needs-now' })
})
afterAll(() => api.close())

describe('Admin panel (open, no key)', () => {
  it('lists people, reviews and reports with no key', async () => {
    await api.signup('adminlistperson')
    const users = await api.call('GET', '/admin/users')
    expect(users.status).toBe(200)
    expect(users.body.users.some((u: { id: string }) => u.id === 'adminlistperson')).toBe(true)
    expect((await api.call('GET', '/admin/reviews')).status).toBe(200)
    expect((await api.call('GET', '/admin/reports')).status).toBe(200)
  })

  it('ignores a key that is sent: a wrong one is not refused', async () => {
    const r = await api.call('GET', '/admin/users', { headers: { 'x-admin-key': 'wrong' } })
    expect(r.status).toBe(200)
  })

  it('turns a person off and on, then deletes them, with no key', async () => {
    await api.signup('adminvictim')
    expect((await api.call('POST', '/admin/users/adminvictim/suspend', { body: { suspended: true } })).status).toBe(200)
    expect(api.readDb().users.adminvictim.suspended).toBe(true)
    expect((await api.call('POST', '/admin/users/adminvictim/suspend', { body: { suspended: false } })).status).toBe(200)
    expect(api.readDb().users.adminvictim.suspended).toBe(false)
    expect((await api.call('POST', '/admin/users/adminvictim/delete', { body: {} })).status).toBe(200)
    expect(api.readDb().users.adminvictim).toBeUndefined()
  })

  it('says so for someone who is not there', async () => {
    expect((await api.call('POST', '/admin/users/nobodyhere/delete', { body: {} })).status).toBe(404)
  })

  it('has no key check endpoint any more', async () => {
    expect((await api.call('GET', '/admin/check')).status).toBe(404)
  })
})
