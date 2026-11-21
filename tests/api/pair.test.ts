import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startApi, type TestApi } from '../helpers/api.ts'

let api: TestApi
beforeAll(async () => {
  api = await startApi()
})
afterAll(() => api.close())

describe('Call yourself from your phone (pairing codes)', () => {
  it('makes a code that lasts 30 minutes, and gives the same one back while it has time left', async () => {
    const laptop = await api.guest('deaf')
    const a = await api.call('POST', '/pair', { session: laptop.session })
    expect(a.status).toBe(200)
    expect(a.body.code).toMatch(/^[0-9a-f]{10}$/)
    expect(a.body.expires - Date.now()).toBeGreaterThan(29 * 60_000)
    const b = await api.call('POST', '/pair', { session: laptop.session })
    expect(b.body.code).toBe(a.body.code)
  })

  it('tells the phone whose code it is (name and way of talking only)', async () => {
    const laptop = await api.guest('deaf')
    const { code } = (await api.call('POST', '/pair', { session: laptop.session })).body
    const r = await api.call('GET', `/pair/${code}`)
    expect(r.body).toEqual({ from: { name: laptop.user.name, mode: 'deaf' } })
    expect((await api.call('GET', '/pair/0000000000')).status).toBe(404)
  })

  it('a phone that opens the code starts as a guest already in a chat with the laptop', async () => {
    const laptop = await api.guest('deaf')
    const { code } = (await api.call('POST', '/pair', { session: laptop.session })).body
    const phone = await api.guest('standard', code)
    expect(phone.with).toMatchObject({ id: laptop.user.id })
    // Only each other: no demo friends on the phone.
    const phoneBoot = await api.call('GET', '/bootstrap?token=0', { session: phone.session })
    expect(phoneBoot.body.contacts.map((c: { id: string }) => c.id)).toEqual([laptop.user.id])
    const laptopBoot = await api.call('GET', '/bootstrap?token=0', { session: laptop.session })
    expect(laptopBoot.body.contacts.map((c: { id: string }) => c.id)).toContain(phone.user.id)
    // The laptop's screen learns the phone joined.
    const status = await api.call('GET', `/pair/${code}/status`, { session: laptop.session })
    expect(status.body).toMatchObject({ joined: { id: phone.user.id, mode: 'standard' }, expired: false })
  })

  it('someone already signed in joins with their own account', async () => {
    const laptop = await api.guest('standard')
    const friend = await api.signup('nearbyfriend', 'deaf')
    const { code } = (await api.call('POST', '/pair', { session: laptop.session })).body
    const r = await api.call('POST', `/pair/${code}/join`, { session: friend })
    expect(r.body.contact.id).toBe(laptop.user.id)
    expect(api.readDb().users.nearbyfriend.contacts).toContain(laptop.user.id)
    expect(api.readDb().users[laptop.user.id].contacts).toContain('nearbyfriend')
  })

  it('refuses your own code', async () => {
    const laptop = await api.guest('standard')
    const { code } = (await api.call('POST', '/pair', { session: laptop.session })).body
    const r = await api.call('POST', `/pair/${code}/join`, { session: laptop.session })
    expect(r.status).toBe(400)
  })

  it('only the code’s owner can watch who joined', async () => {
    const laptop = await api.guest('standard')
    const other = await api.guest('standard')
    const { code } = (await api.call('POST', '/pair', { session: laptop.session })).body
    expect((await api.call('GET', `/pair/${code}/status`, { session: other.session })).status).toBe(404)
  })

  it('an expired code no longer works', async () => {
    const laptop = await api.guest('deaf')
    const { code } = (await api.call('POST', '/pair', { session: laptop.session })).body
    const db = api.readDb()
    db.pairs[code].exp = Date.now() - 1000
    api.writeDb(db)
    expect((await api.call('GET', `/pair/${code}`)).status).toBe(404)
    expect((await api.call('POST', '/guest', { body: { mode: 'standard', pair: code } })).status).toBe(404)
    const late = await api.signup('latecomer')
    expect((await api.call('POST', `/pair/${code}/join`, { session: late })).status).toBe(404)
    expect((await api.call('GET', `/pair/${code}/status`, { session: laptop.session })).body.expired).toBe(true)
    // A new code is made after the old one ran out.
    const fresh = await api.call('POST', '/pair', { session: laptop.session })
    expect(fresh.body.code).not.toBe(code)
  })

  it('needs a login to make a code', async () => {
    expect((await api.call('POST', '/pair')).status).toBe(401)
  })
})
