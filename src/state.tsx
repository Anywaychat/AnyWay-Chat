import { disconnect } from './nexconn'
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

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

export interface User {
  id: string
  name: string
  mode: Mode
}

export interface Contact extends User {
  initial: string
  hue: 'coral' | 'indigo' | 'emerald' | 'violet' | 'slate'
}

export interface Group {
  id: string
  name: string
  owner: string
  members: User[]
}

const HUE: Record<Mode, Contact['hue']> = { deaf: 'coral', blind: 'indigo', speech: 'emerald', deafblind: 'violet', standard: 'slate' }

export const toContact = (u: User): Contact => ({ ...u, initial: (u.name || u.id).charAt(0).toUpperCase(), hue: HUE[u.mode] })

// Every user the app has seen, so any screen can show a name and mode from an id.
const known = new Map<string, Contact>()
export const contactById = (id?: string): Contact => known.get(id ?? '') ?? toContact({ id: id ?? '', name: id ?? 'Unknown', mode: 'standard' })

const SESSION_KEY = 'anyway.session'

/** Each tab keeps its own login (sessionStorage), falling back to the last login on this device (localStorage). */
export function readSession(): string | null {
  try {
    const own = sessionStorage.getItem(SESSION_KEY)
    if (own) return own
    const shared = localStorage.getItem(SESSION_KEY)
    if (shared) sessionStorage.setItem(SESSION_KEY, shared)
    return shared
  } catch {
    return null
  }
}
function writeSession(v: string | null) {
  try {
    if (v) {
      sessionStorage.setItem(SESSION_KEY, v)
      localStorage.setItem(SESSION_KEY, v)
    } else {
      sessionStorage.removeItem(SESSION_KEY)
      localStorage.removeItem(SESSION_KEY)
    }
  } catch {
    /* storage unavailable */
  }
}

interface AuthCtx {
  user: User | null
  ready: boolean
  contacts: Contact[]
  groups: Group[]
  createGroup: (name: string, members: string[]) => Promise<string | null>
  api: <T>(path: string, init?: { method?: string; body?: unknown }) => Promise<T>
  login: (username: string, password: string) => Promise<string | null>
  signup: (p: { username: string; name: string; password: string; mode: Mode }) => Promise<string | null>
  logout: () => Promise<void>
  setMode: (m: Mode) => Promise<void>
  addContact: (username: string) => Promise<string | null>
  refreshContacts: () => Promise<void>
}

const Ctx = createContext<AuthCtx | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<string | null>(readSession)
  const [user, setUser] = useState<User | null>(null)
  const [ready, setReady] = useState(false)
  const [contacts, setContacts] = useState<Contact[]>([])
  const [groups, setGroups] = useState<Group[]>([])

  const api = useCallback(
    async <T,>(path: string, init?: { method?: string; body?: unknown }): Promise<T> => {
      const r = await fetch(`/api${path}`, {
        method: init?.method ?? 'GET',
        headers: { 'Content-Type': 'application/json', ...(session ? { Authorization: `Bearer ${session}` } : {}) },
        body: init?.body ? JSON.stringify(init.body) : undefined,
      })
      const j = (await r.json()) as T & { error?: string }
      if (!r.ok) throw new Error(j.error ?? 'Something went wrong.')
      return j
    },
    [session],
  )

  const refreshContacts = useCallback(async () => {
    const { contacts: list } = await api<{ contacts: User[] }>('/contacts')
    const cs = list.map(toContact)
    cs.forEach((c) => known.set(c.id, c))
    setContacts(cs)
    const { groups: gs } = await api<{ groups: Group[] }>('/groups')
    gs.forEach((g) => g.members.forEach((m) => known.has(m.id) || known.set(m.id, toContact(m))))
    setGroups(gs)
  }, [api])

  useEffect(() => {
    if (!session) {
      setUser(null)
      setReady(true)
      return
    }
    api<{ user: User }>('/me')
      .then(({ user: u }) => {
        known.set(u.id, toContact(u))
        setUser(u)
        return refreshContacts()
      })
      .catch(() => {
        writeSession(null)
        setSession(null)
      })
      .finally(() => setReady(true))
  }, [session, api, refreshContacts])

  const start = (s: string, u: User) => {
    writeSession(s)
    known.set(u.id, toContact(u))
    setUser(u)
    setSession(s)
  }

  const value = useMemo<AuthCtx>(
    () => ({
      user,
      ready,
      contacts,
      groups,
      api,
      refreshContacts,
      async login(username, password) {
        try {
          const r = await api<{ session: string; user: User }>('/login', { method: 'POST', body: { username, password } })
          start(r.session, r.user)
          return null
        } catch (e) {
          return (e as Error).message
        }
      },
      async signup(p) {
        try {
          const r = await api<{ session: string; user: User }>('/signup', { method: 'POST', body: p })
          start(r.session, r.user)
          return null
        } catch (e) {
          return (e as Error).message
        }
      },
      async logout() {
        await api('/logout', { method: 'POST' }).catch(() => {})
        await disconnect().catch(() => {})
        writeSession(null)
        setSession(null)
        setUser(null)
        setContacts([])
        setGroups([])
      },
      async createGroup(name, members) {
        try {
          const r = await api<{ group: Group }>('/groups', { method: 'POST', body: { name, members } })
          await refreshContacts()
          return r.group.id
        } catch (e) {
          throw e
        }
      },
      async setMode(m) {
        const r = await api<{ user: User }>('/me', { method: 'PATCH', body: { mode: m } })
        setUser(r.user)
      },
      async addContact(username) {
        try {
          const r = await api<{ contact: User }>('/contacts', { method: 'POST', body: { username } })
          known.set(r.contact.id, toContact(r.contact))
          await refreshContacts()
          return null
        } catch (e) {
          return (e as Error).message
        }
      },
    }),
    [user, ready, contacts, groups, api, refreshContacts],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth() {
  const c = useContext(Ctx)
  if (!c) throw new Error('useAuth outside provider')
  return c
}

/** Shortcut used across screens: who I am and how I talk. */
export function useProfile() {
  const { user, setMode } = useAuth()
  return { mode: user?.mode ?? 'standard', me: user?.id ?? '', name: user?.name ?? '', setMode }
}
