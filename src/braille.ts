/** Grade 1 braille helpers shared by the deaf-blind chat and other screens. */
// Grade 1 braille: which of the 6 dots make each letter.
export const BRAILLE: Record<string, number[]> = {
  a: [1], b: [1, 2], c: [1, 4], d: [1, 4, 5], e: [1, 5], f: [1, 2, 4], g: [1, 2, 4, 5], h: [1, 2, 5], i: [2, 4], j: [2, 4, 5],
  k: [1, 3], l: [1, 2, 3], m: [1, 3, 4], n: [1, 3, 4, 5], o: [1, 3, 5], p: [1, 2, 3, 4], q: [1, 2, 3, 4, 5], r: [1, 2, 3, 5], s: [2, 3, 4], t: [2, 3, 4, 5],
  u: [1, 3, 6], v: [1, 2, 3, 6], w: [2, 4, 5, 6], x: [1, 3, 4, 6], y: [1, 3, 4, 5, 6], z: [1, 3, 5, 6],
}
export const key = (dots: number[]) => [...dots].sort().join('')
export const FROM_DOTS = Object.fromEntries(Object.entries(BRAILLE).map(([ch, d]) => [key(d), ch]))
/** Text as Unicode braille cells, so it can be read on screen or by a braille display. */
export const toBraille = (text: string) =>
  [...text.toLowerCase()].map((ch) => (BRAILLE[ch] ? String.fromCharCode(0x2800 + BRAILLE[ch].reduce((n, d) => n | (1 << (d - 1)), 0)) : ch === ' ' ? '⠀' : ch)).join('')
