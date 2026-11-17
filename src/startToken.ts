/** The chat-service token from the startup call, so connecting doesn't need its own request. */
let token: string | null = null
const waiters: ((t: string) => void)[] = []
export function setStartToken(t: string) { token = t; waiters.splice(0).forEach((w) => w(t)) }
/** Waits briefly for the startup token; null if it doesn't come. */
export function takeStartToken(ms = 4000): Promise<string | null> {
  if (token) { const t = token; token = null; return Promise.resolve(t) }
  return new Promise((done) => {
    const t = setTimeout(() => done(null), ms)
    waiters.push((v) => { clearTimeout(t); token = null; done(v) })
  })
}
