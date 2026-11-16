/** Where "Hey Chat" commands go: the open chat if there is one, otherwise the app-wide handler. */
let chatHandler: ((text: string) => void) | null = null

export function registerChatVoice(fn: (text: string) => void) {
  chatHandler = fn
  return () => {
    if (chatHandler === fn) chatHandler = null
  }
}

export const hasChat = () => !!chatHandler

export function routeVoice(text: string, fallback: (text: string) => void) {
  if (chatHandler) chatHandler(text)
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

/** Finds which contact is mentioned anywhere in what was said, allowing for spacing, spoken numbers and small mishearings. */
export function findMentioned(spoken: string, people: Person[]): { who: Person; start: number; end: number } | null {
  const w = words(spoken)
  let best: { who: Person; start: number; end: number; score: number } | null = null
  for (const p of people) {
    const real = (p as { realName?: string }).realName ?? ''
    // Match the nickname you gave them, their own name, or their username.
    const keys = [compact(p.name), compact(p.name.split(' ')[0]), compact(real), compact(real.split(' ')[0]), compact(p.id)].filter((k) => k.length >= 2)
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

  if (/\b(describe|what'?s in|what is in|what does)\b.*\b(photo|picture|image|pic)\b|^describe( it| that)?$/.test(t)) return { kind: 'describe' }

  // Starting something without saying who or what: the assistant will ask.
  if (/\b(new message|send (a |an )?(message|text)|write (a |an )?(message|text)?|type (a |an )?(new )?(message|text)?|compose|text someone|message someone|send something|write to someone)\b/.test(t) && !/\bsaying\b|\bthat\b/.test(t)) {
    const who = findMentioned(raw, people)?.who
    return { kind: 'compose', who }
  }
  if (short && /^(make|place|start|do)( a| an)? (video )?call$|^(video )?call( someone)?$/.test(t)) return { kind: 'callWho', video: /video/.test(t) }

  // Calls
  if (short && /\b(answer|accept|pick up|take)\b( (it|the call|call))?$/.test(t)) return { kind: 'callAction', action: 'answer' }
  if (short && /\b(decline|reject|ignore)\b( (it|the call|call))?$/.test(t)) return { kind: 'callAction', action: 'decline' }
  if (short && /\b(hang up|end (the )?call|cut (the )?call|stop (the )?call|cancel (the )?call)\b/.test(t)) return { kind: 'callAction', action: 'end' }
  if (short && /^(unmute|turn on (my )?(mic|microphone))\b/.test(t)) return { kind: 'callAction', action: 'unmute' }
  if (short && /^(mute|turn off (my )?(mic|microphone))\b/.test(t)) return { kind: 'callAction', action: 'mute' }
  if (short && /\b(camera|video) off\b|turn off (my )?(camera|video)/.test(t)) return { kind: 'callAction', action: 'camOff' }
  if (short && /\b(camera|video) on\b|turn on (my )?(camera|video)/.test(t)) return { kind: 'callAction', action: 'camOn' }

  // Screens
  if (short && /^(go|open|take me|show|switch)\b.*\b(call history|calls|recent calls)\b/.test(t)) return { kind: 'nav', to: 'calls' }
  if (short && /^(go|open|take me|show)\b.*\b(profile|settings|my account)\b/.test(t)) return { kind: 'nav', to: 'profile' }
  if (short && /^(go|open|take me|start)\b.*\b(go mode|interpreter|face to face)\b/.test(t)) return { kind: 'nav', to: 'go' }
  if (short && /^(go|take me|back)\b.*\b(home|chats|chat list|main)\b|^go back$/.test(t)) return { kind: 'nav', to: 'home' }

  // Account and status
  if (short && /\b(log ?out|sign out)\b/.test(t)) return { kind: 'logout' }
  if (short && /\b(who am i|what'?s my (name|username))\b/.test(t)) return { kind: 'whoami' }
  if (short && /\b(who'?s|who is|anyone) online\b/.test(t)) return { kind: 'online' }
  if (short && /\b(any (new|unread) messages|what did i miss|unread|new messages|anything new)\b/.test(t)) return { kind: 'unread' }
  if (short && /\b(speak|talk|read)\b.*\b(faster|quicker)\b|^faster$/.test(t)) return { kind: 'speed', faster: true }
  if (short && /\b(speak|talk|read)\b.*\b(slower|slowly)\b|^slower$/.test(t)) return { kind: 'speed', faster: false }

  // Contacts and groups
  const add = t.match(/^(?:add|save)\s+(?:a\s+)?(?:new\s+)?(?:contact|friend|person|user(?:name)?)\s+(.+)$/)
  if (add && !/\bto\b.*\bgroup\b/.test(t)) return { kind: 'addContact', username: add[1].split(/\s+/).map((x) => NUMBERS[x] ?? x).join('').replace(/[^a-z0-9]/g, '') }
  const group = raw.match(/\b(?:create|make|start|new)\s+(?:a\s+)?group\s+(?:called|named)?\s*(.+?)\s+with\s+(.+)$/i)
  if (group) {
    const members = group[2].split(/\s*(?:,|\band\b)\s*/i).map((part) => findMentioned(part, people)?.who).filter((p): p is Person => !!p)
    return { kind: 'createGroup', name: group[1].trim(), members }
  }
  const blk = t.match(/^(un)?block\s+(.+)$/)
  if (blk) {
    const who = findMentioned(blk[2], people)?.who
    if (who) return { kind: 'block', who, block: !blk[1] }
  }

  // Acting on the last message in the open chat
  if (inChat && short && /^(like|love|heart|thumbs up|laugh at|react to)\b( (it|that|this|the last (one|message)))?$/.test(t))
    return { kind: 'react', emoji: /love|heart/.test(t) ? '❤️' : /laugh/.test(t) ? '😂' : '👍' }
  if (inChat && /^(delete|unsend|remove) (my )?(last|that|previous) message$|^unsend( that)?$/.test(t)) return { kind: 'deleteLast' }
  const edit = raw.match(/^(?:edit|change|correct) (?:my )?(?:last|that|previous) message to (.+)$/i)
  if (inChat && edit) return { kind: 'editLast', text: edit[1] }
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
      if (/^(?:a |an )?(?:voice|audio)\s*(?:message|note|msg)?$/i.test(text)) return { kind: 'voiceNote', who: mention.who }
      if (text) return { kind: 'send', who: mention.who, text }
      return { kind: 'open', who: mention.who }
    }
    if (/\b(open|go to|switch to|chat with|show|talk to|talk with)\b/.test(before) && after.split(/\s+/).filter(Boolean).length <= 2) return { kind: 'open', who: mention.who }
    if (/\b(what did|did|any|read|messages? from|new from)\b/.test(t) && short) return { kind: 'open', who: mention.who }
  }

  if (short && /\b(any new|new (messages|texts)|what'?s new|unread)\b/.test(t)) return { kind: 'unread' }
  if (short && /\b(read|my messages)\b/.test(t)) return inChat ? { kind: 'read' } : { kind: 'unread' }

  // Nothing matched exactly: find the closest action from the phrase library.
  const fuzzy = fromLibrary(raw, people, inChat)
  if (fuzzy) return fuzzy
  if (inChat) return { kind: 'say', text: raw }
  return { kind: 'unclear', who: mention?.who }
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
