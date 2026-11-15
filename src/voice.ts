/** Where "Hey AnyWay" commands go: the open chat if there is one, otherwise the app-wide handler. */
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

interface Person {
  id: string
  name: string
}

/**
 * "send Priya I'm on my way", "tell Priya ...", "message Priya ...", "send a message to Priya saying ...".
 * Matches the longest contact name at the start, so "send Priya Sharma hi" picks Priya Sharma over Priya.
 */
export function parseSendTo(spoken: string, people: Person[]): { who: Person; text: string } | null {
  const t = spoken.trim().replace(/[.!?]$/, '')
  const m = t.match(/^(?:send(?: a message)?(?: to)?|tell|message|text)\s+(.+)$/i)
  if (!m) return null
  const rest = m[1]
  const lower = rest.toLowerCase()
  const options = people
    .flatMap((p) => [p.name.toLowerCase(), p.name.toLowerCase().split(' ')[0], p.id].map((n) => ({ p, n })))
    .filter(({ n }) => n && (lower === n || lower.startsWith(`${n} `) || lower.startsWith(`${n},`)))
    .sort((a, b) => b.n.length - a.n.length)
  if (!options.length) return null
  const { p, n } = options[0]
  const text = rest.slice(n.length).replace(/^[\s,]*(?:saying|that|to say)?[\s,:]*/i, '').trim()
  return text ? { who: p, text } : null
}
