/** The chat-service token from the startup call, so connecting doesn't need its own request.
 *  Kept with the user it belongs to: after logging out and into another account, a leftover token from the first
 *  account used to connect the new one as the old person (their chats showed, and live messages never came). */
let token: { user: string; t: string } | null = null
const waiters: { user: string; done: (t: string | null) => void }[] = []
export function setStartToken(t: string, user: string) {
  token = { user, t }
  for (const w of waiters.splice(0)) w.done(w.user === user ? (token = null, t) : null)
}
/** Forget any token (logging out). */
export function clearStartToken() {
  token = null
  waiters.splice(0).forEach((w) => w.done(null))
}
/** Waits briefly for this user's startup token; null if it doesn't come. */
export function takeStartToken(user: string, ms = 4000): Promise<string | null> {
  if (token) {
    const mine = token.user === user ? token.t : null
    token = null
    if (mine) return Promise.resolve(mine)
  }
  return new Promise((done) => {
    const t = setTimeout(() => done(null), ms)
    waiters.push({ user, done: (v) => { clearTimeout(t); done(v) } })
  })
}
