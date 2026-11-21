import { describe, expect, it } from 'vitest'
import { framingHint, glossToSentence, isSure, matchMine, readGuesses, signVector, type Pt } from '../src/sign.ts'

const labels = ['hello', 'thankyou', 'good', 'morning', 'deaf']
const ids = [0, 1, 2, 3, 4]

describe('sign reader: turning model scores into words', () => {
  it('gives the best three guesses, scores adding up within the allowed words', () => {
    const g = readGuesses([0.7, 0.1, 0.1, 0.05, 0.05], labels, ids, null)
    expect(g.map((x) => x.word)).toEqual(['hello', 'thankyou', 'good'])
    expect(g[0].score).toBeCloseTo(0.7)
  })

  it('only offers the words the model was trained for', () => {
    const g = readGuesses([0.9, 0.05, 0.03, 0.01, 0.01], labels, [1, 2, 3], null)
    expect(g.map((x) => x.word)).not.toContain('hello')
  })

  it('is sure only with a clear winner, otherwise it asks "Did you sign…?"', () => {
    expect(isSure([{ word: 'hello', score: 0.8 }, { word: 'good', score: 0.1 }])).toBe(true)
    expect(isSure([{ word: 'hello', score: 0.45 }, { word: 'good', score: 0.1 }])).toBe(false)
    expect(isSure([{ word: 'hello', score: 0.55 }, { word: 'good', score: 0.4 }])).toBe(false)
    expect(isSure([])).toBe(false)
  })

  it('turns signed words into a sentence', () => {
    const s = glossToSentence(['hello', 'thankyou'])
    expect(s.length).toBeGreaterThan(0)
    expect(s[0]).toBe(s[0].toUpperCase())
  })
})

describe('sign reader: learning your own signs', () => {
  it('matches an attempt to the closest taught example', () => {
    const hello = signVector([0.5, 0.2, 0.1, 0.1, 0.1], ids)
    const thanks = signVector([0.1, 0.5, 0.2, 0.1, 0.1], ids)
    const attempt = signVector([0.45, 0.25, 0.1, 0.1, 0.1], ids)
    const m = matchMine(attempt, { hello: [{ id: 'hello', v: hello }], thankyou: [{ id: 'thankyou', v: thanks }] })
    expect(m?.word).toBe('hello')
    expect(m?.second).toBe('thankyou')
    expect(m!.sim).toBeGreaterThan(m!.next)
  })

  it('has nothing to match before anything is taught', () => {
    expect(matchMine([1, 2, 3], {})).toBeNull()
  })
})

describe('sign reader: framing tips', () => {
  const body = (shoulderY: number, halfWidth: number): Pt[] => {
    const pts: Pt[] = Array.from({ length: 67 }, () => [0.5, 0.5] as Pt)
    pts[0] = [0.5, shoulderY - 0.15]
    pts[11] = [0.5 + halfWidth, shoulderY]
    pts[12] = [0.5 - halfWidth, shoulderY]
    return pts
  }
  it('asks for head and shoulders when no body is seen', () => {
    expect(framingHint(body(0.4, 0.1), false, 4 / 3)).toMatch(/head and shoulders/)
  })
  it('asks to move back when very close', () => {
    expect(framingHint(body(0.6, 0.3), true, 4 / 3)).toMatch(/Move back/)
  })
  it('asks to show the chest when shoulders sit low in the picture', () => {
    expect(framingHint(body(0.85, 0.12), true, 4 / 3)).toMatch(/chest/)
  })
  it('says nothing when the picture is fine', () => {
    expect(framingHint(body(0.35, 0.1), true, 4 / 3)).toBe('')
  })
})
