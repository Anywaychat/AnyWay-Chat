import { describe, expect, it } from 'vitest'
import { demoReply, usernameProblem } from '../server/api.ts'
import { STEPS } from '../src/trySteps.ts'

describe('demo friends answer in their own way', () => {
  it('Priya (deaf) answers with the signs she used', () => {
    const r = demoReply('demopriya', 'Hi Priya!', 'text')
    expect(r.text).toMatch(/Hello/)
    expect(r.gloss).toBe('HELLO · NICE')
    expect(demoReply('demopriya', 'dinner tonight?', 'text').gloss).toMatch(/HUNGRY/)
  })
  it('Arjun (blind) says AnyWay read it to him, and describes photos', () => {
    expect(demoReply('demoarjun', 'hello', 'text').text).toMatch(/read your message/)
    expect(demoReply('demoarjun', '', 'image').text).toMatch(/described your photo/)
    expect(demoReply('demoarjun', 'hello', 'text').gloss).toBeUndefined()
  })
  it('Meera (non-speaking) answers like taps on a phrase board', () => {
    expect(demoReply('demomeera', 'are you coming?', 'text').text).toBe('Yes 👍')
    expect(demoReply('demomeera', 'thanks', 'text').text).toMatch(/welcome/)
  })
})

describe('username rules', () => {
  it('keeps demo and guest names for the app', () => {
    expect(usernameProblem('demoxyz')).toMatch(/taken/)
    expect(usernameProblem('guest42')).toMatch(/taken/)
    expect(usernameProblem('ab')).toMatch(/at least 3/)
    expect(usernameProblem('priya2026')).toBeNull()
  })
})

describe('things to try', () => {
  const ROUTES = /^\/(chat\/demo(priya|arjun|meera)|go|signs)$/
  it.each(Object.entries(STEPS))('%s: three steps, each going somewhere real, one of them a call from your phone', (_, steps) => {
    expect(steps).toHaveLength(3)
    for (const s of steps) if (s.to) expect(s.to).toMatch(ROUTES)
    expect(steps.filter((s) => s.pair)).toHaveLength(1)
    expect(new Set(steps.map((s) => s.key)).size).toBe(3)
  })
})
