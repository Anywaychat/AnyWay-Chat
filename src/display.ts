import { useSyncExternalStore } from 'react'

/** Per-device display choices: text size, light/dark, high contrast. */
export type Display = { theme: 'auto' | 'light' | 'dark'; contrast: boolean; size: number }
const KEY = 'anyway.display'
const DEF: Display = { theme: 'auto', contrast: false, size: 1 }
export const SIZES = [{ v: 0.9, label: 'Small' }, { v: 1, label: 'Normal' }, { v: 1.15, label: 'Large' }, { v: 1.3, label: 'Larger' }, { v: 1.5, label: 'Huge' }]

let cur: Display = (() => { try { return { ...DEF, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') } } catch { return DEF } })()
const subs = new Set<() => void>()
export function setDisplay(p: Partial<Display>) {
  cur = { ...cur, ...p }
  try { localStorage.setItem(KEY, JSON.stringify(cur)) } catch { /* ignore */ }
  apply(); subs.forEach((f) => f())
}
function apply() { document.documentElement.style.setProperty('--fs', String(cur.size)) }
apply()
export const useDisplay = () => useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f) }, () => cur)

export const getDisplay = () => cur
/** Called on every change (used to save settings to the account). */
export const onDisplayChange = (f: () => void) => {
  subs.add(f)
  return () => subs.delete(f)
}
