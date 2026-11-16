/**
 * Text -> Indian Sign Language clips, using the INCLUDE sign videos (CC BY 4.0, AI4Bharat).
 * Words the dictionary doesn't have stay as text.
 */
export interface SignWord {
  id: string
  name: string
  category: string
  clip: boolean
}

export type Piece = { kind: 'sign'; word: SignWord; said: string } | { kind: 'text'; text: string }

let index: Promise<SignWord[]> | null = null
export const loadSigns = () => (index ??= fetch('/signs/index.json').then((r) => (r.ok ? (r.json() as Promise<SignWord[]>) : [])).catch(() => []))
export const clipUrl = (id: string) => `/signs/${id}.mp4`

// Everyday words people type, mapped to the sign that means the same thing.
const SAME: Record<string, string> = {
  hi: 'hello', hey: 'hello', hii: 'hello', thanks: 'thankyou', thx: 'thankyou', ty: 'thankyou',
  mom: 'mother', mum: 'mother', amma: 'mother', mummy: 'mother', ma: 'mother', dad: 'father', appa: 'father', papa: 'father', daddy: 'father',
  grandma: 'grandmother', paati: 'grandmother', grandpa: 'grandfather', thatha: 'grandfather',
  big: 'biglarge', large: 'biglarge', small: 'smalllittle', little: 'smalllittle', shop: 'storeorshop', store: 'storeorshop',
  road: 'streetorroad', street: 'streetorroad', phone: 'cellphone', mobile: 'cellphone', photo: 'photograph', pic: 'photograph',
  tv: 'television', me: 'i', my: 'i', mine: 'i', your: 'you', u: 'you', ur: 'you', him: 'he', his: 'he', her: 'she',
  us: 'we', our: 'we', them: 'they', their: 'they', kid: 'child', kids: 'child', children: 'child', sick: 'sick', ill: 'sick',
  ok: 'alright', okay: 'alright', fine: 'alright', good: 'good', great: 'good', nice: 'nice', home: 'house', clothes: 'clothing',
  station: 'trainstation', ticket: 'trainticket', cop: 'police', doc: 'doctor', money: 'money', cash: 'money', job: 'job', work: 'job',
}
// Phrases that are a single sign.
const PHRASES: Record<string, string> = {
  'good morning': 'goodmorning', 'good afternoon': 'goodafternoon', 'good evening': 'goodevening', 'good night': 'goodnight',
  'gm': 'goodmorning', 'gn': 'goodnight', 'how are you': 'howareyou', 'how r u': 'howareyou', 'how are u': 'howareyou',
  'thank you': 'thankyou', 'thank u': 'thankyou', 'train station': 'trainstation', 'train ticket': 'trainticket',
  't shirt': 'tshirt', 'cell phone': 'cellphone', 'you all': 'youplural',
}

/** Splits a message into sign clips (where we have one) and plain text (where we don't). */
export function toSigns(text: string, words: SignWord[]): Piece[] {
  const byId = new Map(words.filter((w) => w.clip).map((w) => [w.id, w]))
  const tokens = text.split(/(\s+)/)
  const plain = tokens.map((t) => t.toLowerCase().replace(/[^a-z]/g, ''))
  const out: Piece[] = []
  const pushText = (t: string) => {
    const last = out[out.length - 1]
    if (last?.kind === 'text') last.text += t
    else out.push({ kind: 'text', text: t })
  }
  for (let i = 0; i < tokens.length; ) {
    if (!plain[i]) {
      pushText(tokens[i++])
      continue
    }
    // Try 3- and 2-word phrases first ("how are you", "good morning").
    let matched = false
    for (const n of [3, 2]) {
      const idxs: number[] = []
      for (let j = i; j < tokens.length && idxs.length < n; j++) if (plain[j]) idxs.push(j)
      if (idxs.length < n) continue
      const id = PHRASES[idxs.map((j) => plain[j]).join(' ')]
      const w = id && byId.get(id)
      if (w) {
        out.push({ kind: 'sign', word: w, said: tokens.slice(i, idxs[n - 1] + 1).join('') })
        i = idxs[n - 1] + 1
        matched = true
        break
      }
    }
    if (matched) continue
    const p = plain[i]
    // Plurals ("brothers" -> brother) only for longer words, so "is" never becomes "I".
    const plural = p.length > 3 ? byId.get(p.replace(/es$/, '')) ?? byId.get(p.replace(/s$/, '')) : undefined
    const w = byId.get(PHRASES[p] ?? SAME[p] ?? p) ?? plural
    if (w) out.push({ kind: 'sign', word: w, said: tokens[i] })
    else pushText(tokens[i])
    i++
  }
  return out
}
