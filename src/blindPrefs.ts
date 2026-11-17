import { useSyncExternalStore } from 'react'

/** Blind users' listening choices, saved on this device. */
export type Announce = 'full' | 'sender' | 'off'
export type BlindPrefs = { announce: Announce; rate: number; sounds: boolean }
const KEY = 'anyway.blind'
const DEF: BlindPrefs = { announce: 'full', rate: 1, sounds: true }
let cur: BlindPrefs = (() => { try { return { ...DEF, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') } } catch { return DEF } })()
const subs = new Set<() => void>()
export const getBlindPrefs = () => cur
export function setBlindPrefs(p: Partial<BlindPrefs>) {
  cur = { ...cur, ...p }
  try { localStorage.setItem(KEY, JSON.stringify(cur)) } catch { /* ignore */ }
  subs.forEach((f) => f())
}
export const useBlindPrefs = () => useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f) }, () => cur)
