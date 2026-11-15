/** Where "Hey Chat" commands go: the open chat if there is one, otherwise the app-wide handler. */
let chatHandler: ((text: string) => void) | null = null

export function registerChatVoice(fn: (text: string) => void) {
  chatHandler = fn
  return () => {
    if (chatHandler === fn) chatHandler = null
  }
}

export function routeVoice(text: string, fallback: (text: string) => void) {
  if (chatHandler) chatHandler(text)
  else fallback(text)
}

export interface Person {
  id: string
  name: string
}

const NUMBERS: Record<string, string> = {
  zero: '0', one: '1', two: '2', to: '2', too: '2', three: '3', four: '4', for: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10',
}

/** Lowercase, drop punctuation, and turn spoken numbers into digits ("test two" → "test 2"). */
function words(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
}
const compact = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

function distance(a: string, b: string) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
  return d[a.length][b.length]
}
const similar = (a: string, b: string) => (a === b ? 1 : 1 - distance(a, b) / Math.max(a.length, b.length))

/** Finds which contact is mentioned anywhere in what was said, allowing for spacing, spoken numbers and small mishearings. */
export function findMentioned(spoken: string, people: Person[]): { who: Person; start: number; end: number } | null {
  const w = words(spoken)
  let best: { who: Person; start: number; end: number; score: number } | null = null
  for (const p of people) {
    const keys = [compact(p.name), compact(p.name.split(' ')[0]), compact(p.id)].filter((k) => k.length >= 2)
    for (let i = 0; i < w.length; i++) {
      for (let n = 1; n <= 3 && i + n <= w.length; n++) {
        const spokenRaw = w.slice(i, i + n).join('')
        const spokenNum = w.slice(i, i + n).map((x) => NUMBERS[x] ?? x).join('')
        for (const k of keys) {
          const score = Math.max(similar(spokenRaw, k), similar(spokenNum, k))
          const need = k.length <= 4 ? 1 : 0.8
          if (score >= need && (!best || score > best.score || (score === best.score && n > best.end - best.start))) best = { who: p, start: i, end: i + n, score }
        }
      }
    }
  }
  return best ? { who: best.who, start: best.start, end: best.end } : null
}

export type Intent =
  | { kind: 'send'; who: Person; text: string }
  | { kind: 'call'; who: Person; video: boolean }
  | { kind: 'open'; who: Person }
  | { kind: 'read' }
  | { kind: 'repeat' }
  | { kind: 'list' }
  | { kind: 'next' }
  | { kind: 'help' }
  | { kind: 'say'; text: string }
  | { kind: 'unclear'; who?: Person }

const POLITE = /^(?:(?:please|can you|could you|would you|will you|i want to|i'd like to|go ahead and|just)\s+)+/

/**
 * Understands everyday phrasing instead of fixed commands:
 * "can you tell test two I'm on my way", "let Priya know I'll be late", "ring Meera", "what did Priya say".
 * Inside a chat, anything that isn't a command is the message itself.
 */
export function understand(spoken: string, people: Person[], inChat: boolean): Intent {
  const raw = spoken.trim().replace(/[.!?]+$/, '')
  const t = raw.toLowerCase().replace(POLITE, '')
  const mention = findMentioned(raw, people)
  const short = t.split(/\s+/).length <= 6

  if (/^(help|what can i say|what can you do)\b/.test(t)) return { kind: 'help' }
  if (short && /^(repeat|say (it|that) again|again|what did (he|she|they) say)\b/.test(t)) return { kind: 'repeat' }
  if (short && /\b(list|who are|read)\b.*\b(chats|contacts|people)\b/.test(t)) return { kind: 'list' }
  if (short && /^(next|next chat|next one|go next)$/.test(t)) return { kind: 'next' }

  if (mention) {
    const w = words(raw)
    const before = w.slice(0, mention.start).join(' ')
    const after = raw.split(/\s+/).slice(mention.end).join(' ')
    if (/\b(video call|video chat|facetime)\b/.test(before)) return { kind: 'call', who: mention.who, video: true }
    if (/\b(call|ring|phone|dial|voice call)\b/.test(before) && after.split(/\s+/).filter(Boolean).length <= 2) return { kind: 'call', who: mention.who, video: false }
    if (/\b(send|tell|message|text|let|inform|ask|reply|write)\b/.test(before)) {
      const text = after
        .replace(/^[\s,:]*(?:know|that|saying|to say|and say|say|a message|the message|message)?[\s,:]*(?:that|saying)?[\s,:]*/i, '')
        .trim()
      if (text) return { kind: 'send', who: mention.who, text }
      return { kind: 'open', who: mention.who }
    }
    if (/\b(open|go to|switch to|chat with|show|talk to|talk with)\b/.test(before) && after.split(/\s+/).filter(Boolean).length <= 2) return { kind: 'open', who: mention.who }
    if (/\b(what did|did|any|read|messages? from|new from)\b/.test(t) && short) return { kind: 'open', who: mention.who }
  }

  if (short && /\b(read|any new|new messages|what'?s new|my messages|unread)\b/.test(t)) return { kind: 'read' }
  if (inChat) return { kind: 'say', text: raw }
  return { kind: 'unclear', who: mention?.who }
}
