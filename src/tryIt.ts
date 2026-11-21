import { useSyncExternalStore } from 'react'
import { useAuth } from './state'

export { AS, SHORT, STEPS, type Step } from './trySteps'

export const DONE_KEY = 'anyway.tried'
const HIDE_KEY = 'anyway.tryHidden'
export const read = (k: string) => {
  try {
    return localStorage.getItem(k)
  } catch {
    return null
  }
}
export const write = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v)
  } catch {
    /* storage unavailable */
  }
}

// One shared state for every copy of the card (a laptop has one in the chat list and one on the empty side).
const listeners = new Set<() => void>()
const subscribe = (f: () => void) => {
  listeners.add(f)
  return () => void listeners.delete(f)
}
let hidden = read(HIDE_KEY) === '1'
let done: string[] = (() => {
  try {
    const v = JSON.parse(read(DONE_KEY) ?? '[]') as unknown
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
})()
const changed = () => listeners.forEach((f) => f())

/** Close the card for good (on this device). */
export function hideTry() {
  hidden = true
  write(HIDE_KEY, '1')
  changed()
}
/** Tick a step, as "mode:key". */
export function markTried(k: string) {
  if (done.includes(k)) return
  done = [...done, k]
  write(DONE_KEY, JSON.stringify(done))
  changed()
}
export const useTried = () => useSyncExternalStore(subscribe, () => done)

/** Shown to guests and to anyone with the demo friends, until they close it. */
export function useShowTry() {
  const { user, contacts } = useAuth()
  const isHidden = useSyncExternalStore(subscribe, () => hidden)
  return { show: !isHidden && !!user && (!!user.guest || contacts.some((c) => c.demo)), hide: hideTry }
}
