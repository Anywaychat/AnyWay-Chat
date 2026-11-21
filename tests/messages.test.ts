import { describe, expect, it } from 'vitest'
import { howLabel, howMade, SAID_VERB } from '../src/origin.ts'
import { sentences } from '../src/sentences.ts'
import { toSigns, type SignWord } from '../src/signs.ts'

describe('how a message was made', () => {
  it('labels signed, spoken and tapped messages for the reader', () => {
    expect(howLabel({ mode: 'deaf', how: 'signed', gloss: 'HELLO · I · DEAF' })).toBe('Signed in ISL · HELLO · I · DEAF')
    expect(howLabel({ mode: 'blind', how: 'spoken' })).toMatch(/Spoken/)
    expect(howLabel({ mode: 'speech', how: 'tapped' })).toMatch(/phrase board/)
    expect(howLabel({ mode: 'standard', how: 'typed' })).toBeNull()
  })
  it('works out older messages that had no "how"', () => {
    expect(howMade({ mode: 'deaf', gloss: 'HELLO' })).toBe('signed')
    expect(howMade({ mode: 'blind' })).toBe('spoken')
    expect(howMade(undefined)).toBeNull()
  })
  it('reads aloud as "Priya signed", "Arjun said"', () => {
    expect(SAID_VERB.signed).toBe('signed')
    expect(SAID_VERB.spoken).toBe('said')
  })
})

describe('reading long text sentence by sentence', () => {
  it('splits on sentence ends, including the Hindi danda', () => {
    expect(sentences('This is the first sentence here. And this is the second one!')).toEqual(['This is the first sentence here.', 'And this is the second one!'])
    expect(sentences('यह पहला लंबा वाक्य है जो बहुत लंबा है। यह दूसरा वाक्य है।')).toHaveLength(2)
  })
  it('keeps very short bits with their neighbour', () => {
    expect(sentences('Okay. See you at the bus stand at 5 then.')).toEqual(['Okay. See you at the bus stand at 5 then.'])
  })
  it('never loses text (a time like 3.30 is not a sentence end)', () => {
    const t = 'Shall we meet at 3.30? I will bring the tickets for everyone.'
    expect(sentences(t).join(' ')).toBe(t)
  })
})

describe('turning a message into sign videos', () => {
  const w = (id: string, name: string): SignWord => ({ id, name, category: 'Greetings', clip: true } as SignWord)
  const words = [w('hello', 'Hello'), w('howareyou', 'How are you'), w('goodmorning', 'Good morning'), w('friend', 'Friend')]
  it('uses whole-phrase signs first, then single words', () => {
    const pieces = toSigns('Good morning friend, how are you?', words)
    expect(pieces.filter((p) => p.kind === 'sign').map((p) => (p.kind === 'sign' ? p.word.id : ''))).toEqual(['goodmorning', 'friend', 'howareyou'])
  })
  it('keeps words without a sign as text', () => {
    const pieces = toSigns('hello Ramesh', words)
    expect(pieces[0]).toMatchObject({ kind: 'sign' })
    expect(pieces.some((p) => p.kind === 'text' && p.text.includes('Ramesh'))).toBe(true)
  })
})
