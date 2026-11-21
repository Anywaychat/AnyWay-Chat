/** Long text is said sentence by sentence, so the first words start quickly instead of after the whole text is made. */
export function sentences(text: string): string[] {
  const parts = text.split(/(?<=[.!?।])\s+/).map((p) => p.trim()).filter(Boolean)
  const out: string[] = []
  // Very short bits ("Okay.", "ok") stay with their neighbour.
  for (const p of parts) {
    const last = out[out.length - 1]
    if (last !== undefined && (last.length < 30 || p.length < 12)) out[out.length - 1] = `${last} ${p}`
    else out.push(p)
  }
  return out.length ? out : [text]
}
