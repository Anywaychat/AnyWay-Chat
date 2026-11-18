/** Where "Hey Chat" commands go: the open chat if there is one, otherwise the app-wide handler.
 *  The assistant passes what it already understood (with any "which one?" answered), so the chat doesn't guess again. */
type ChatVoice = (text: string, intent?: Intent) => void
let chatHandler: ChatVoice | null = null

export function registerChatVoice(fn: ChatVoice) {
  chatHandler = fn
  return () => {
    if (chatHandler === fn) chatHandler = null
  }
}

export const hasChat = () => !!chatHandler

export function routeVoice(text: string, fallback: (text: string) => void, intent?: Intent) {
  if (chatHandler) chatHandler(text, intent)
  else fallback(text)
}

/** The app-wide voice assistant (blind mode). Everything spoken goes through it, however listening was started:
 *  "Hey Chat", the big Tap to speak button or the Space key. Before, the button and Space skipped it, so commands
 *  like "go to my profile" were sent to the open chat as messages. */
let assistant: ((text: string) => void) | null = null
export function registerAssistant(fn: (text: string) => void) {
  assistant = fn
  return () => {
    if (assistant === fn) assistant = null
  }
}
export function runAssistant(text: string, fallback: (text: string) => void) {
  if (assistant) assistant(text)
  else fallback(text)
}

import { classify } from './voiceIntents'

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

export interface Mention {
  who: Person
  start: number
  end: number
  /** Everyone who matches equally well (a first name two contacts share): ask which one instead of guessing. */
  ambiguous?: Person[]
}

/**
 * Finds which contact is mentioned anywhere in what was said, allowing for spacing, spoken numbers and small mishearings.
 * A whole name beats a first name: "send to test deafblind" used to go to "Test Talk", because both start with "Test"
 * and an exact first name outscored a slightly misheard whole name. A first name that several contacts share no longer
 * picks one of them: the caller asks which one.
 */
export function findMentioned(spoken: string, people: Person[]): Mention | null {
  const w = words(spoken)
  if (!w.length || !people.length) return null
  const realOf = (p: Person) => (p as { realName?: string }).realName ?? ''
  const firstsOf = (p: Person) => [...new Set([compact(p.name.split(' ')[0]), compact(realOf(p).split(' ')[0])])].filter((k) => k.length >= 2)
  const shared = new Map<string, number>()
  for (const p of people) for (const k of firstsOf(p)) shared.set(k, (shared.get(k) ?? 0) + 1)
  type Cand = { who: Person; start: number; end: number; rank: number; weak: boolean; key: string }
  const cands: Cand[] = []
  for (const p of people) {
    const whole = [...new Set([compact(p.name), compact(realOf(p)), compact(p.id)])].filter((k) => k.length >= 2)
    const firsts = firstsOf(p).filter((k) => !whole.includes(k))
    let best: Cand | null = null
    for (let i = 0; i < w.length; i++) {
      for (let n = 1; n <= 4 && i + n <= w.length; n++) {
        const spokenRaw = w.slice(i, i + n).join('')
        const spokenNum = w.slice(i, i + n).map((x) => NUMBERS[x] ?? x).join('')
        const consider = (k: string, first: boolean) => {
          const score = Math.max(similar(spokenRaw, k), similar(spokenNum, k))
          if (score < (k.length <= 4 ? 1 : 0.8)) return
          const weak = first && (shared.get(k) ?? 0) > 1
          const rank = score + (first ? (weak ? 0 : 0.1) : 0.3) + n * 0.01
          if (!best || rank > best.rank) best = { who: p, start: i, end: i + n, rank, weak, key: k }
        }
        whole.forEach((k) => consider(k, false))
        firsts.forEach((k) => consider(k, true))
      }
    }
    if (best) cands.push(best)
  }
  if (!cands.length) return null
  cands.sort((a, b) => b.rank - a.rank)
  const top = cands[0]
  if (top.weak) {
    const same = cands.filter((c) => c.weak && c.key === top.key && top.rank - c.rank < 0.05)
    if (same.length > 1) return { who: top.who, start: top.start, end: top.end, ambiguous: same.map((c) => c.who) }
  }
  return { who: top.who, start: top.start, end: top.end }
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
  | { kind: 'nav'; to: 'home' | 'calls' | 'profile' | 'go' }
  | { kind: 'callAction'; action: 'answer' | 'decline' | 'end' | 'mute' | 'unmute' | 'camOff' | 'camOn' }
  | { kind: 'unread' }
  | { kind: 'online' }
  | { kind: 'addContact'; username: string }
  | { kind: 'createGroup'; name: string; members: Person[] }
  | { kind: 'block'; who: Person; block: boolean }
  | { kind: 'react'; emoji: string }
  | { kind: 'deleteLast' }
  | { kind: 'editLast'; text: string }
  | { kind: 'speed'; faster: boolean }
  | { kind: 'logout' }
  | { kind: 'whoami' }
  | { kind: 'compose'; who?: Person }
  | { kind: 'voiceNote'; who?: Person }
  | { kind: 'previous' }
  | { kind: 'isOnline'; who: Person }
  | { kind: 'addWho' }
  | { kind: 'groupAsk' }
  | { kind: 'leaveGroup' }
  | { kind: 'report'; who?: Person }
  | { kind: 'search'; query: string }
  | { kind: 'stopTalking' }
  | { kind: 'time' }
  | { kind: 'describe' }
  | { kind: 'callWho'; video: boolean }
  | { kind: 'when' }
  | { kind: 'readMore' }
  | { kind: 'playVoice' }
  | { kind: 'pauseVoice' }

const POLITE = /^(?:(?:please|can you|could you|would you|will you|i want to|i'd like to|go ahead and|just|now|ok|okay|hey)\s+)+/

// Command words must come first ("tell Priya …"), so an ordinary sentence that mentions someone
// ("did you tell Ravi about it") stays a message to the open chat instead of going to Ravi.
const LEAD_VIDEO = /^(?:(?:start|make|do|place)\s+(?:a\s+)?)?(?:video call|video chat|facetime|video)(?:\s+(?:with|to))?$/
const LEAD_CALL = /^(?:(?:start|make|do|place)\s+(?:a\s+)?)?(?:call|ring|phone|dial|voice call|audio call)(?:\s+(?:with|to))?$/
const LEAD_SEND = /^(?:send|tell|message|text|let|inform|ask|reply to|reply|write to|write|msg|whatsapp)(?:\s+(?:a\s+|the\s+)?(?:message|text|msg))?(?:\s+to)?$/
const LEAD_OPEN = /^(?:open|go to|switch to|chat with|show|talk to|talk with|open (?:my )?chat with|open (?:my )?messages (?:with|from))$/
const LEAD_ASK = /^(?:what did|what has|any messages from|messages from|read messages from|read|did)$/

/**
 * Understands everyday phrasing instead of fixed commands:
 * "can you tell test two I'm on my way", "let Priya know I'll be late", "ring Meera", "what did Priya say".
 * Inside a chat, anything that isn't clearly a command is the message itself.
 * When only a shared first name was heard ("send Ravi …" with two Ravis), the intent carries `ambiguous`.
 */
export function understand(spoken: string, people: Person[], inChat: boolean): Intent & { ambiguous?: Person[] } {
  const raw = spoken.trim().replace(/[.!?]+$/, '')
  const t = raw.toLowerCase().replace(/[,]/g, '').replace(POLITE, '')
  const mention = findMentioned(raw, people)
  const n = t.split(/\s+/).filter(Boolean).length
  const short = n <= 6
  const ambiguous = mention?.ambiguous
  const withWho = <T extends Intent>(i: T): T & { ambiguous?: Person[] } => (ambiguous ? { ...i, ambiguous } : i)

  if (/^(help|what can i say|what can you do)\b/.test(t)) return { kind: 'help' }

  if (/^(describe|what'?s in|what is in|what does)\b.*\b(photo|picture|image|pic)\b|^describe( it| that| the photo)?$/.test(t)) return { kind: 'describe' }

  // Starting something without saying who or what: the assistant will ask.
  if (/^(new message|(send|write|type|compose) (a |an )?(new )?(message|text)|compose|text someone|message someone|send something|write to someone)\b/.test(t) && !/\bsaying\b|\bthat\b/.test(t)) {
    return withWho({ kind: 'compose', who: mention?.who })
  }
  if (short && /^(make|place|start|do)( a| an)? (video )?call$|^(video )?call( someone)?$/.test(t)) return { kind: 'callWho', video: /video/.test(t) }

  // Calls
  if (short && /^(answer|accept|pick up|take)( (it|the call|call))?$/.test(t)) return { kind: 'callAction', action: 'answer' }
  if (short && /^(decline|reject|ignore)( (it|the call|call))?$/.test(t)) return { kind: 'callAction', action: 'decline' }
  if (short && /^(hang up|end (the )?call|cut (the )?call|stop (the )?call|cancel (the )?call)$/.test(t)) return { kind: 'callAction', action: 'end' }
  if (short && /^(unmute( me)?|turn on (my )?(mic|microphone))$/.test(t)) return { kind: 'callAction', action: 'unmute' }
  if (short && /^(mute( me)?|turn off (my )?(mic|microphone))$/.test(t)) return { kind: 'callAction', action: 'mute' }
  if (short && /^((my )?(camera|video) off|turn off (my )?(camera|video))$/.test(t)) return { kind: 'callAction', action: 'camOff' }
  if (short && /^((my )?(camera|video) on|turn on (my )?(camera|video))$/.test(t)) return { kind: 'callAction', action: 'camOn' }

  // Screens
  if (short && /^(go|open|take me|show|switch)\b.*\b(call history|calls|recent calls)$/.test(t)) return { kind: 'nav', to: 'calls' }
  if (short && /^(go|open|take me|show)\b.*\b(profile|settings|my account)$/.test(t)) return { kind: 'nav', to: 'profile' }
  if (short && /^(go|open|take me|start)\b.*\b(go mode|interpreter|face to face)$/.test(t)) return { kind: 'nav', to: 'go' }
  if (short && /^((go|take me) (back )?(to )?(the )?(home|chats|chat list|main)( screen| page)?|go back|go home)$/.test(t)) return { kind: 'nav', to: 'home' }

  // Account and status
  if (short && /^(log ?out|sign out)( of anyway)?$/.test(t)) return { kind: 'logout' }
  if (short && /^(who am i|what'?s my (name|username)|what is my (name|username))$/.test(t)) return { kind: 'whoami' }
  if (short && /^(who'?s online|who is online|is anyone online|anyone online)$/.test(t)) return { kind: 'online' }
  if (short && /^((do i have |are there |any )?(any )?(new|unread) (messages|texts)|what did i miss|anything new|check (my )?messages|unread)$/.test(t)) return { kind: 'unread' }
  if (short && /^((speak|talk|read)( a bit)? (faster|quicker)|faster)$/.test(t)) return { kind: 'speed', faster: true }
  if (short && /^((speak|talk|read)( a bit)? (slower|more slowly|slowly)|slower)$/.test(t)) return { kind: 'speed', faster: false }
  if (short && /^(stop|stop talking|be quiet|quiet|shut up|silence)$/.test(t)) return { kind: 'stopTalking' }
  if (short && /^(what time is it|what'?s the time|what is the time|time)$/.test(t)) return { kind: 'time' }

  // Contacts and groups
  const add = t.match(/^(?:add|save)\s+(?:a\s+)?(?:new\s+)?(?:contact|friend|person|user(?:name)?)\s+(.+)$/)
  if (add && !/\bto\b.*\bgroup\b/.test(t)) return { kind: 'addContact', username: add[1].split(/\s+/).map((x) => NUMBERS[x] ?? x).join('').replace(/[^a-z0-9]/g, '') }
  const group = t.match(/^(?:create|make|start|new)\s+(?:a\s+)?(?:new\s+)?group\s+(?:called|named)\s+(.+?)\s+with\s+(.+)$/) ?? (inChat ? null : t.match(/^(?:create|make|start)\s+(?:a\s+)?(?:new\s+)?group\s+(.+?)\s+with\s+(.+)$/))
  if (group) {
    const members = group[2].split(/\s*(?:,|\band\b)\s*/i).map((part) => findMentioned(part, people)?.who).filter((p): p is Person => !!p)
    return { kind: 'createGroup', name: group[1].trim().replace(/\b\w/g, (c) => c.toUpperCase()), members }
  }
  const blk = t.match(/^(un)?block\s+(.+)$/)
  if (blk) {
    const m = findMentioned(blk[2], people)
    if (m) return { kind: 'block', who: m.who, block: !blk[1], ...(m.ambiguous ? { ambiguous: m.ambiguous } : {}) }
  }

  // Acting on the last message in the open chat
  if (inChat && short && /^(like|love|heart|thumbs up|laugh at|react to)( (it|that|this|the last (one|message)))?$/.test(t))
    return { kind: 'react', emoji: /love|heart/.test(t) ? '❤️' : /laugh/.test(t) ? '😂' : '👍' }
  if (inChat && /^(delete|unsend|remove) (my )?(last|that|previous) message$|^unsend( that)?$/.test(t)) return { kind: 'deleteLast' }
  const edit = raw.match(/^(?:edit|change|correct) (?:my )?(?:last|that|previous) message to (.+)$/i)
  if (inChat && edit) return { kind: 'editLast', text: edit[1] }
  if (short && /^(repeat( that| it| the last message)?|say (it|that) again|again|what did (he|she|they) say)$/.test(t)) return { kind: 'repeat' }
  if (short && /^((list|read)( out)? (my |all )?(chats|contacts|people)|who are my (chats|contacts|friends))$/.test(t)) return { kind: 'list' }
  if (short && /^(next|next chat|next one|go next)$/.test(t)) return { kind: 'next' }
  if (short && /^(previous|previous chat|last chat|go back a chat)$/.test(t)) return { kind: 'previous' }
  // Message times, older messages and voice messages, inside a chat
  if (inChat && short && /^(when (was|did) (that|it|this|the last message|that message) (sent|come|arrive|come in)|what time (was|did) (that|it|this) (sent|come|arrive)?|when did (he|she|they|it) (send|write) (it|that|this)|what time was that( sent)?|when was it sent)$/.test(t)) return { kind: 'when' }
  if (inChat && short && /^(read (more|older|earlier|previous)( messages)?|(older|earlier|more|previous) messages|go back( further)?)$/.test(t)) return { kind: 'readMore' }
  if (inChat && short && /^((play|listen to|open)( the| that| this| her| his| their| last)? (voice (message|note)|audio( message)?|recording)|play it)$/.test(t)) return { kind: 'playVoice' }
  if (inChat && short && /^(pause( it| that)?|(pause|stop) the (voice (message|note)|audio|recording))$/.test(t)) return { kind: 'pauseVoice' }
  if (inChat && short && /^(read|read (it|this|out|aloud|the chat|this chat|my messages|messages|the messages|the last messages?)|what did they say|play messages)$/.test(t)) return { kind: 'read' }

  if (mention) {
    const before = words(raw).slice(0, mention.start).join(' ').replace(POLITE, '').trim()
    const afterWords = raw.split(/\s+/).slice(mention.end)
    const after = afterWords.join(' ')
    const fewAfter = afterWords.filter(Boolean).length <= 2
    if (LEAD_VIDEO.test(before) && fewAfter) return withWho({ kind: 'call', who: mention.who, video: true })
    if ((LEAD_CALL.test(before) && fewAfter) || (before === 'give' && /^a (voice |phone )?call\b/i.test(after))) return withWho({ kind: 'call', who: mention.who, video: false })
    if (LEAD_SEND.test(before)) {
      const text = after
        .replace(/^[\s,:]*(?:know|that|saying|to say|and say|say|a message|the message|message)?[\s,:]*(?:that|saying)?[\s,:]*/i, '')
        .trim()
      if (/^(?:a |an )?(?:voice|audio)\s*(?:message|note|msg)?$/i.test(text)) return withWho({ kind: 'voiceNote', who: mention.who })
      if (text) return withWho({ kind: 'send', who: mention.who, text })
      return withWho({ kind: inChat ? 'compose' : 'open', who: mention.who } as Intent)
    }
    if (LEAD_OPEN.test(before) && fewAfter) return withWho({ kind: 'open', who: mention.who })
    if (!inChat && short && (LEAD_ASK.test(before) || before === '')) {
      if (/^(say|send|write|text|message|call)?\s*(anything|something)?\??$/i.test(after) || /^(?:'s|s)?\s*messages?$/i.test(after) || before !== '') return withWho({ kind: 'open', who: mention.who })
    }
    if (!inChat && short && /^is$/.test(before) && /^online\b/i.test(after)) return withWho({ kind: 'isOnline', who: mention.who })
  }

  if (!inChat && short && /\b(read|my messages)\b/.test(t)) return { kind: 'unread' }

  // Nothing matched exactly: find the closest action from the phrase library.
  const fuzzy = fromLibrary(raw, people, inChat)
  // Inside a chat, the loose matcher never sends words to someone else: only a clear command (above) does that.
  if (fuzzy && !(inChat && 'who' in fuzzy && fuzzy.who)) return withWho(fuzzy)
  if (inChat) return { kind: 'say', text: raw }
  return withWho({ kind: 'unclear', who: mention?.who })
}

const cleanText = (s: string) => s.replace(/^(?:that|to|saying|say|about|is)\s+/i, '').trim()

function fromLibrary(raw: string, people: Person[], inChat: boolean): Intent | null {
  const mention = findMentioned(raw, people)
  const w = raw.split(/\s+/)
  const masked = mention ? [...w.slice(0, mention.start), '{name}', ...w.slice(mention.end)].join(' ') : raw
  const m = classify(masked)
  // Inside a chat, be stricter so normal messages aren't mistaken for commands.
  if (!m || m.score < (inChat ? 0.9 : 0.7)) return null
  const who = mention?.who
  const text = cleanText(m.rest)
  switch (m.intent) {
    case 'send': return who && text ? { kind: 'send', who, text } : { kind: 'compose', who }
    case 'compose': return { kind: 'compose', who }
    case 'voiceNote': return { kind: 'voiceNote', who }
    case 'describe': return { kind: 'describe' }
    case 'read': return { kind: 'read' }
    case 'unread': return { kind: 'unread' }
    case 'repeat': return { kind: 'repeat' }
    case 'call': return who ? { kind: 'call', who, video: false } : { kind: 'callWho', video: false }
    case 'videoCall': return who ? { kind: 'call', who, video: true } : { kind: 'callWho', video: true }
    case 'callWho': return { kind: 'callWho', video: false }
    case 'videoWho': return { kind: 'callWho', video: true }
    case 'answer': case 'decline': case 'end': case 'mute': case 'unmute': case 'camOff': case 'camOn':
      return { kind: 'callAction', action: m.intent }
    case 'open': return who ? { kind: 'open', who } : null
    case 'next': return { kind: 'next' }
    case 'previous': return { kind: 'previous' }
    case 'list': return { kind: 'list' }
    case 'online': return { kind: 'online' }
    case 'isOnline': return who ? { kind: 'isOnline', who } : { kind: 'online' }
    case 'home': case 'calls': case 'profile': case 'go': return { kind: 'nav', to: m.intent }
    case 'addContact': return who ? { kind: 'addContact', username: who.id } : text ? { kind: 'addContact', username: text.toLowerCase().split(/\s+/).map((x) => NUMBERS[x] ?? x).join('').replace(/[^a-z0-9]/g, '') } : { kind: 'addWho' }
    case 'addWho': return { kind: 'addWho' }
    case 'createGroup': return { kind: 'groupAsk' }
    case 'leaveGroup': return { kind: 'leaveGroup' }
    case 'block': return who ? { kind: 'block', who, block: true } : null
    case 'unblock': return who ? { kind: 'block', who, block: false } : null
    case 'report': return { kind: 'report', who }
    case 'react': return { kind: 'react', emoji: /love|heart/i.test(raw) ? '❤️' : /laugh|funny/i.test(raw) ? '😂' : '👍' }
    case 'deleteLast': return { kind: 'deleteLast' }
    case 'editLast': return text ? { kind: 'editLast', text } : null
    case 'search': return text ? { kind: 'search', query: text } : null
    case 'faster': return { kind: 'speed', faster: true }
    case 'slower': return { kind: 'speed', faster: false }
    case 'stopTalking': return { kind: 'stopTalking' }
    case 'time': return { kind: 'time' }
    case 'whoami': return { kind: 'whoami' }
    case 'logout': return { kind: 'logout' }
    case 'help': return { kind: 'help' }
    default: return null
  }
}
