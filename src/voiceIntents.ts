/**
 * Everyday ways people ask for each thing the app can do.
 * {name} = a contact mentioned in the sentence, {text} = the message that follows.
 * The matcher is fuzzy, so these don't have to be said word for word: they teach it what each action sounds like.
 */
export const PHRASES: Record<string, string[]> = {
  send: [
    'send {name} {text}', 'tell {name} {text}', 'message {name} {text}', 'text {name} {text}', 'let {name} know {text}',
    'send a message to {name} {text}', 'send {name} a message {text}', 'write to {name} {text}', 'reply to {name} {text}',
    'can you tell {name} {text}', 'please tell {name} {text}', 'inform {name} {text}', 'say to {name} {text}', 'ask {name} {text}',
    'drop {name} a message {text}', 'ping {name} {text}', 'shoot {name} a message {text}', 'send this to {name} {text}',
    'i want to tell {name} {text}', 'could you message {name} {text}', 'msg {name} {text}', 'whatsapp {name} {text}',
  ],
  compose: [
    'new message', 'send a message', 'send message', 'type a message', 'type a new message', 'write a message', 'write a new message',
    'compose a message', 'start a message', 'i want to send a message', 'i want to write something', 'send something', 'message someone',
    'text someone', 'write to someone', 'i need to message someone', 'can you send a message', 'help me send a message', 'create a message',
    'make a message', 'send a text', 'write a text', 'new text', 'i want to text', 'i want to message', 'send a message to {name}',
    'message {name}', 'write to {name}', 'text {name}', 'i want to talk to {name}', 'send {name} something', 'reply', 'reply to this', 'reply to them',
  ],
  voiceNote: [
    'send a voice message', 'send voice message', 'voice message', 'record a voice message', 'record a message', 'send a voice note',
    'voice note', 'record voice note', 'send an audio message', 'audio message', 'send my voice', 'record my voice', 'send a recording',
    'i want to send a voice message', 'can you record a message', 'record something', 'send a voice message to {name}',
    'send {name} a voice message', 'record a message for {name}', 'record a voice note for {name}', 'record a voice message for {name}', 'send a voice note to {name}', 'voice note for {name}', 'voice message {name}', 'send audio to {name}', 'leave {name} a voice note',
  ],
  read: [
    'read my messages', 'read messages', 'read the messages', 'read it', 'read this chat', 'read the chat', 'what did they say', 'read out',
    'read aloud', 'read it out', 'read the last messages', 'what are the messages', 'tell me the messages', 'what is in this chat',
    'read the conversation', 'what does it say', 'read the last message', 'what was the last message', 'read me the chat', 'play messages',
  ],
  unread: [
    'any new messages', 'do i have new messages', 'new messages', 'unread messages', 'what did i miss', 'anything new', 'check my messages',
    'did anyone message me', 'did i get any messages', 'any messages', 'who messaged me', 'what is new', 'whats new', 'check messages',
    'do i have any messages', 'are there new messages', 'any updates', 'check unread', 'did someone text me', 'did i get a message',
    'any new texts', 'any texts', 'texts for me', 'has anyone messaged me', 'anyone messaged me', 'has anyone texted me', 'any new chats', 'did i receive anything',
  ],
  repeat: [
    'repeat', 'repeat that', 'say that again', 'say it again', 'again', 'what did you say', 'come again', 'pardon', 'sorry what',
    'once more', 'can you repeat', 'please repeat', 'repeat the last message', 'i did not hear', 'i did not catch that', 'what was that',
  ],
  call: [
    'call {name}', 'ring {name}', 'phone {name}', 'dial {name}', 'voice call {name}', 'make a call to {name}', 'give {name} a call',
    'call {name} please', 'can you call {name}', 'i want to call {name}', 'please call {name}', 'get {name} on the phone', 'audio call {name}',
    'start a call with {name}', 'connect me to {name}', 'talk to {name} on phone',
  ],
  videoCall: [
    'video call {name}', 'facetime {name}', 'video chat {name}', 'start a video call with {name}', 'make a video call to {name}',
    'i want to video call {name}', 'see {name} on video', 'video {name}', 'camera call {name}',
  ],
  callWho: ['make a call', 'call someone', 'i want to make a call', 'start a call', 'place a call', 'phone someone', 'dial someone', 'call'],
  videoWho: ['make a video call', 'video call', 'start a video call', 'video chat', 'i want to video call', 'facetime someone'],
  answer: ['answer', 'answer the call', 'pick up', 'accept', 'accept the call', 'take the call', 'yes answer', 'pick it up', 'receive the call', 'attend the call'],
  decline: ['decline', 'reject', 'reject the call', 'decline the call', 'ignore the call', 'do not answer', 'not now', 'busy'],
  end: ['hang up', 'end the call', 'end call', 'cut the call', 'stop the call', 'finish the call', 'disconnect', 'bye end call', 'cancel the call', 'stop calling'],
  mute: ['mute', 'mute me', 'mute my mic', 'turn off my microphone', 'turn off mic', 'mute microphone', 'silence my mic'],
  unmute: ['unmute', 'unmute me', 'turn on my microphone', 'turn on mic', 'unmute my mic', 'mic on'],
  camOff: ['camera off', 'turn off camera', 'turn off my camera', 'stop video', 'hide my video', 'video off'],
  camOn: ['camera on', 'turn on camera', 'turn on my camera', 'start video', 'show my video', 'video on'],
  open: [
    'open {name}', 'go to {name}', 'open chat with {name}', 'switch to {name}', 'show {name}', 'take me to {name}', 'open {name} chat',
    'chat with {name}', 'go to chat with {name}', 'what did {name} say', 'read {name} messages', 'messages from {name}', 'open my chat with {name}',
    'show me {name}', 'conversation with {name}', 'check {name}',
  ],
  next: ['next chat', 'next', 'next one', 'go next', 'next conversation', 'skip', 'move on', 'next person'],
  previous: ['previous chat', 'previous', 'go back one', 'last chat', 'previous conversation', 'the one before'],
  list: ['list my chats', 'who are my contacts', 'list contacts', 'read my contacts', 'who can i talk to', 'my chats', 'show my chats', 'who is in my list', 'my contacts', 'list people'],
  online: ['who is online', 'whos online', 'anyone online', 'who is available', 'who is active', 'is anyone online', 'online people'],
  isOnline: ['is {name} around', 'is {name} free', 'is {name} awake', 'is {name} online', 'is {name} available', 'is {name} there', 'can i reach {name}', 'is {name} active'],
  home: ['go home', 'home', 'go to chats', 'show my chats screen', 'main screen', 'go back', 'back', 'take me home', 'chat list', 'close this chat'],
  calls: ['go to calls', 'open calls', 'call history', 'my calls', 'show calls', 'recent calls', 'missed calls', 'who called me', 'open call history'],
  profile: ['open profile', 'my profile', 'go to profile', 'settings', 'open settings', 'my account', 'show my profile'],
  go: ['go mode', 'open go mode', 'interpreter', 'face to face', 'talk to someone near me', 'someone is near me', 'start interpreter'],
  addContact: ['add {name}', 'add contact {name}', 'add contact {text}', 'add a contact {text}', 'add friend {text}', 'add a new contact {text}', 'save contact {text}', 'add user {text}', 'add username {text}', 'add person {text}', 'new contact {text}'],
  addWho: ['add a contact', 'add contact', 'add a friend', 'new contact', 'i want to add someone', 'add someone', 'save a contact', 'add a new person'],
  createGroup: ['create a group', 'make a group', 'new group', 'start a group', 'create group', 'make a new group', 'group chat', 'start a group chat', 'i want to make a group'],
  leaveGroup: ['leave this group', 'leave the group', 'exit group', 'leave group', 'get me out of this group', 'quit this group'],
  block: ['block {name}', 'block this person', 'block them', 'block contact {name}', 'stop {name} from messaging me'],
  unblock: ['unblock {name}', 'unblock this person', 'unblock them', 'let {name} message me again'],
  report: ['report {name}', 'report this person', 'report them', 'report this chat', 'report abuse', '{name} is bothering me'],
  react: ['like that', 'like it', 'like this', 'thumbs up', 'love that', 'heart it', 'react with a heart', 'like the last message', 'give it a like', 'laugh at that'],
  deleteLast: ['undo that message', 'undo my message', 'undo', 'delete my last message', 'unsend', 'unsend that', 'delete that', 'remove my last message', 'take back my message', 'delete what i sent', 'undo send', 'unsend my message', 'delete the message'],
  editLast: ['edit my last message to {text}', 'change my last message to {text}', 'correct my last message to {text}', 'change it to {text}', 'edit it to {text}', 'fix my message to {text}'],
  search: ['search for {text}', 'find messages about {text}', 'find {text}', 'search messages for {text}', 'look for {text}', 'did anyone say {text}'],
  faster: ['speak faster', 'talk faster', 'read faster', 'faster', 'speed up', 'too slow'],
  slower: ['speak slower', 'talk slower', 'read slower', 'slower', 'slow down', 'too fast', 'speak slowly'],
  stopTalking: ['stop', 'stop talking', 'quiet', 'be quiet', 'shut up', 'enough', 'silence', 'pause', 'stop reading', 'that is enough'],
  time: ['what is the time now', 'what time is it now', 'what time is it', 'time', 'tell me the time', 'what is the time', 'current time'],
  whoami: ['who am i', 'what is my name', 'what is my username', 'my username', 'tell me my username'],
  logout: ['log out', 'logout', 'sign out', 'log me out', 'sign me out'],
  help: ['help', 'what can i say', 'what can you do', 'how does this work', 'commands', 'what are my options', 'i need help', 'how do i use this'],
}

/** Words that carry no meaning for matching. */
const FILLER = new Set(['please', 'can', 'could', 'would', 'you', 'will', 'just', 'hey', 'ok', 'okay', 'um', 'uh', 'so', 'now', 'the', 'a', 'an', 'my', 'me', 'for', 'to', 'i', 'want', 'like', 'need', 'kindly', 'quickly', 'go', 'ahead', 'and'])

const CONTRACTIONS: Record<string, string> = {
  whats: 'what is', wats: 'what is', im: 'i am', wanna: 'want to', gonna: 'going to', gotta: 'got to', dont: 'do not', didnt: 'did not',
  cant: 'can not', its: 'it is', thats: 'that is', whos: 'who is', wheres: 'where is', theres: 'there is', isnt: 'is not', ive: 'i have',
  id: 'i would', ill: 'i will', youre: 'you are', lemme: 'let me', gimme: 'give me', pls: 'please', plz: 'please', msg: 'message', txt: 'text',
}

const tokens = (s: string) =>
  s
    .toLowerCase()
    .replace(/'/g, '')
    .replace(/\b[a-z]+\b/g, (w) => CONTRACTIONS[w] ?? w)
    .replace(/[^a-z0-9{}\s']/g, ' ')
    .replace(/'/g, '')
    .split(/\s+/)
    .filter(Boolean)

function dist(a: string, b: string) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
  return d[a.length][b.length]
}
const sameWord = (a: string, b: string) => a === b || (a.length > 4 && b.length > 4 && dist(a, b) <= 1) || (a.length > 3 && b.startsWith(a) && b.length - a.length <= 2) || (b.length > 3 && a.startsWith(b) && a.length - b.length <= 2)

export interface Match {
  intent: string
  score: number
  /** Words after the matched command, for {text} phrases. */
  rest: string
}

/**
 * Finds the action closest to what was said. `utterance` should already have any contact name replaced by "{name}".
 */
export function classify(utterance: string): Match | null {
  const u = tokens(utterance)
  if (!u.length) return null
  let best: Match | null = null
  for (const [intent, list] of Object.entries(PHRASES)) {
    for (const phrase of list) {
      const p = tokens(phrase)
      const hasText = p[p.length - 1] === '{text}'
      const want = p.filter((w) => w !== '{text}')
      const key = want.filter((w) => !FILLER.has(w))
      if (!key.length) continue
      // How much of the phrase was said, in order.
      let at = 0
      let hit = 0
      let lastIndex = -1
      for (const w of key) {
        const i = u.findIndex((x, k) => k >= at && sameWord(x, w))
        if (i >= 0) {
          hit++
          at = i + 1
          lastIndex = i
        }
      }
      const coverage = hit / key.length
      if (coverage < 0.6) continue
      const rest = hasText && lastIndex >= 0 ? u.slice(lastIndex + 1).filter((w) => w !== '{name}').join(' ') : ''
      // Penalise extra words when the phrase doesn't expect a message after it.
      const meaningful = u.filter((w) => !FILLER.has(w))
      const extra = hasText ? 0 : Math.max(0, meaningful.length - key.length) / Math.max(meaningful.length, 1)
      const nameFit = want.includes('{name}') === u.includes('{name}') ? 0.05 : want.includes('{name}') ? -0.25 : -0.1
      const textFit = hasText ? (rest ? 0.05 : -0.3) : 0
      const score = coverage - extra * 0.5 + nameFit + textFit
      if (!best || score > best.score) best = { intent, score, rest }
    }
  }
  return best
}
