import { createContext, useContext, useState, type ReactNode } from 'react'

export type Mode = 'blind' | 'deaf' | 'speech' | 'deafblind' | 'standard'

export interface ModeInfo {
  id: Mode
  label: string
  short: string
  sends: string
  receives: string
  theme: string
}

export const MODES: Record<Mode, ModeInfo> = {
  blind: {
    id: 'blind',
    label: 'I’m blind or low-vision',
    short: 'Blind',
    sends: 'Speak to send',
    receives: 'Hear every reply',
    theme: 'theme-blind',
  },
  deaf: {
    id: 'deaf',
    label: 'I’m deaf · I sign',
    short: 'Deaf',
    sends: 'Sign or type',
    receives: 'See text and signs',
    theme: 'theme-deaf',
  },
  speech: {
    id: 'speech',
    label: 'I don’t speak',
    short: 'Non-speaking',
    sends: 'Tap phrases or type',
    receives: 'App speaks for you',
    theme: 'theme-speech',
  },
  deafblind: {
    id: 'deafblind',
    label: 'I’m deaf-blind',
    short: 'Deaf-blind',
    sends: 'Type or braille',
    receives: 'Feel vibrations',
    theme: 'theme-deafblind',
  },
  standard: {
    id: 'standard',
    label: 'I talk and type',
    short: 'Talk & type',
    sends: 'Type or speak',
    receives: 'Read or listen',
    theme: 'theme-standard',
  },
}

export interface Contact {
  id: string
  name: string
  mode: Mode
  initial: string
  hue: 'coral' | 'indigo' | 'emerald' | 'violet' | 'slate'
  last: string
  lastVia: string
  time: string
  unread?: number
  online?: boolean
}

export const CONTACTS: Contact[] = [
  { id: 'priya', name: 'Priya', mode: 'deaf', initial: 'P', hue: 'coral', last: 'Are you coming tonight?', lastVia: 'Signed', time: '10:42', unread: 2, online: true },
  { id: 'arjun', name: 'Arjun', mode: 'blind', initial: 'A', hue: 'indigo', last: 'I reached the station.', lastVia: 'Spoke', time: '09:15', online: true },
  { id: 'meera', name: 'Meera', mode: 'speech', initial: 'M', hue: 'emerald', last: 'Thank you so much', lastVia: 'Tapped', time: 'Mon' },
  { id: 'amma', name: 'Amma', mode: 'standard', initial: 'A', hue: 'slate', last: 'Dinner at 8', lastVia: 'Spoke', time: 'Sun' },
  { id: 'kavin', name: 'Kavin', mode: 'deafblind', initial: 'K', hue: 'violet', last: 'Coming in 5 min', lastVia: 'Braille', time: 'Sat' },
]

export interface Message {
  id: string
  from: 'me' | 'them'
  text: string
  via: string
  time: string
  signGloss?: string
  confidence?: number
}

export const THREAD: Message[] = [
  { id: '1', from: 'them', text: 'Hi! Movie night at my place tonight.', via: 'Signed in ISL', time: '10:38', signGloss: 'HI · MOVIE · NIGHT · MY HOUSE', confidence: 94 },
  { id: '2', from: 'me', text: 'That sounds great. What time?', via: 'You spoke', time: '10:40' },
  { id: '3', from: 'them', text: 'Around 8. Bring snacks!', via: 'Signed in ISL', time: '10:41', signGloss: '8 · BRING · SNACKS', confidence: 91 },
  { id: '4', from: 'them', text: 'Are you coming tonight?', via: 'Signed in ISL', time: '10:42', signGloss: 'YOU · COME · TONIGHT ?', confidence: 92 },
]

/** Each demo profile signs in as one of the demo people, so two browser windows can chat with each other. */
export const ME_BY_MODE: Record<Mode, string> = { blind: 'arjun', deaf: 'priya', speech: 'meera', deafblind: 'kavin', standard: 'amma' }

interface Ctx {
  mode: Mode
  setMode: (m: Mode) => void
  name: string
  me: string
}

const ProfileCtx = createContext<Ctx | null>(null)

export function ProfileProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<Mode>(() => {
    const fromUrl = new URLSearchParams(window.location.search).get('mode') as Mode | null
    if (fromUrl && fromUrl in MODES) {
      try {
        localStorage.setItem('anyway.mode', fromUrl)
      } catch {
        /* storage unavailable */
      }
      return fromUrl
    }
    try {
      return (localStorage.getItem('anyway.mode') as Mode) || 'blind'
    } catch {
      return 'blind'
    }
  })
  const update = (m: Mode) => {
    setMode(m)
    try {
      localStorage.setItem('anyway.mode', m)
    } catch {
      /* storage unavailable */
    }
  }
  return <ProfileCtx.Provider value={{ mode, setMode: update, me: ME_BY_MODE[mode], name: contactById(ME_BY_MODE[mode]).name }}>{children}</ProfileCtx.Provider>
}

export function useProfile() {
  const c = useContext(ProfileCtx)
  if (!c) throw new Error('useProfile outside provider')
  return c
}

export const contactById = (id?: string) => CONTACTS.find((c) => c.id === id) ?? CONTACTS[0]
