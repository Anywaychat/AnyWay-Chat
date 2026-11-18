import type { Origin } from './nexconn'

/** How a message was made: signed to the camera, spoken, tapped on the phrase board, or typed. */
export type How = 'signed' | 'spoken' | 'tapped' | 'typed'

export function howMade(o?: Origin): How | null {
  if (!o) return null
  if (o.how) return o.how
  // Messages from before "how" was recorded: a gloss means signs, a blind sender means speech.
  if (o.mode === 'deaf' && o.gloss) return 'signed'
  if (o.mode === 'blind') return 'spoken'
  return null
}

/** "Priya signed", "Arjun said", "Meera tapped": used when reading a message aloud. */
export const SAID_VERB: Record<How, string> = { signed: 'signed', spoken: 'said', tapped: 'tapped', typed: 'wrote' }

/** The small label under a received message, so everyone sees how the other person talks. */
export function howLabel(o?: Origin): string | null {
  const h = howMade(o)
  if (!h || h === 'typed') return null
  if (h === 'signed') return `Signed in ISL${o?.gloss ? ` · ${o.gloss}` : ''}`
  if (h === 'spoken') return 'Spoken, written out by AnyWay'
  return 'Tapped on the phrase board, said aloud'
}
