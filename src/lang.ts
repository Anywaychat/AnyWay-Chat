import { useSyncExternalStore } from 'react'
import { speak } from './speech'

/** Languages people can talk in on calls. Speech is heard in this language and others' words are translated into it. */
export const LANGS: { code: string; name: string; native: string }[] = [
  { code: 'en-IN', name: 'English', native: 'English' },
  { code: 'hi-IN', name: 'Hindi', native: 'हिन्दी' },
  { code: 'ta-IN', name: 'Tamil', native: 'தமிழ்' },
  { code: 'te-IN', name: 'Telugu', native: 'తెలుగు' },
  { code: 'kn-IN', name: 'Kannada', native: 'ಕನ್ನಡ' },
  { code: 'ml-IN', name: 'Malayalam', native: 'മലയാളം' },
  { code: 'bn-IN', name: 'Bengali', native: 'বাংলা' },
  { code: 'mr-IN', name: 'Marathi', native: 'मराठी' },
  { code: 'gu-IN', name: 'Gujarati', native: 'ગુજરાતી' },
  { code: 'pa-IN', name: 'Punjabi', native: 'ਪੰਜਾਬੀ' },
  { code: 'ur-IN', name: 'Urdu', native: 'اردو' },
]
export const base = (l: string) => l.split('-')[0]
export const langName = (l?: string) => LANGS.find((x) => base(x.code) === base(l ?? ''))?.name ?? l ?? ''

const KEY = 'anyway.lang'
let cur = (() => { try { return localStorage.getItem(KEY) ?? 'en-IN' } catch { return 'en-IN' } })()
const subs = new Set<() => void>()
export const getLang = () => cur
export function setLang(l: string) { cur = l; try { localStorage.setItem(KEY, l) } catch { /* ignore */ } subs.forEach((f) => f()) }
export const useLang = () => useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f) }, () => cur)

/** Say text aloud in a given language: the natural voice for English, the phone's own voice for Indian languages. */
export function sayIn(text: string, lang: string) {
  if (base(lang) === 'en' || typeof speechSynthesis === 'undefined') return speak(text)
  const u = new SpeechSynthesisUtterance(text)
  u.lang = lang
  const v = speechSynthesis.getVoices().find((x) => x.lang.replace('_', '-').startsWith(base(lang)))
  if (v) u.voice = v
  speechSynthesis.speak(u)
}
