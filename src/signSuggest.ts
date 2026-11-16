/**
 * Sign suggestions, like a phone keyboard's word bar: learns which signs this person uses,
 * which sign usually comes next, and what fits as a reply to the last message.
 * Stored only on this device.
 */
import { toSigns, type SignWord } from './signs'

type Memory = { used: Record<string, number>; next: Record<string, Record<string, number>> }
const KEY = 'anyway.signs.memory'

function read(): Memory {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '') as Memory
  } catch {
    return { used: {}, next: {} }
  }
}

/** Call after sending: remembers the signs and their order. */
export function rememberSigns(ids: string[]) {
  const m = read()
  ids.forEach((id, i) => {
    m.used[id] = (m.used[id] ?? 0) + 1
    if (i > 0) {
      const prev = ids[i - 1]
      m.next[prev] ??= {}
      m.next[prev][id] = (m.next[prev][id] ?? 0) + 1
    }
  })
  try {
    localStorage.setItem(KEY, JSON.stringify(m))
  } catch {
    /* private mode: suggestions just won't learn */
  }
}

// Good replies to common things people say.
const REPLIES: Record<string, string[]> = {
  howareyou: ['good', 'alright', 'thankyou', 'sick', 'happy'],
  hello: ['hello', 'howareyou', 'goodmorning', 'nice'],
  goodmorning: ['goodmorning', 'howareyou', 'thankyou'],
  goodnight: ['goodnight', 'thankyou', 'tomorrow'],
  thankyou: ['alright', 'good', 'happy'],
  sick: ['doctor', 'medicine', 'hospital', 'sad'],
  where: ['house', 'school', 'office', 'market'],
}
// Everyday starters for someone who hasn't signed much yet.
const STARTERS = ['hello', 'howareyou', 'thankyou', 'good', 'alright', 'goodmorning', 'i', 'you']

/** All signs, best first. The first `top` are the personal picks to highlight. */
export function suggestSigns(words: SignWord[], opts: { context?: string; last?: string; top?: number } = {}) {
  const m = read()
  const avail = new Map(words.filter((w) => w.clip).map((w) => [w.id, w]))
  const score = new Map<string, number>()
  const add = (id: string, n: number) => avail.has(id) && score.set(id, (score.get(id) ?? 0) + n)

  Object.entries(m.used).forEach(([id, n]) => add(id, Math.log2(1 + n) * 2))
  if (opts.last) Object.entries(m.next[opts.last] ?? {}).forEach(([id, n]) => add(id, 3 + n))
  if (opts.context) {
    // Later words count more: the question is usually at the end ("Hey, how are you?").
    const said = toSigns(opts.context, words).flatMap((p) => (p.kind === 'sign' ? [p.word.id] : []))
    said.forEach((w, k) => (REPLIES[w] ?? [w]).forEach((id, i) => add(id, 3 + k * 2 - i * 0.3)))
  }
  STARTERS.forEach((id, i) => add(id, 1 - i * 0.05))

  const top = [...score.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => avail.get(id)!).slice(0, opts.top ?? 5)
  const rest = [...avail.values()].filter((w) => !top.includes(w)).sort((a, b) => a.name.localeCompare(b.name))
  return { top, rest }
}
