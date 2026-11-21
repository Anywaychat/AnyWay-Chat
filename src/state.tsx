import { disconnect, onMessage } from './nexconn'
import { setStartToken } from './startToken'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { announce } from './speech'
import { applyPrefs, collectPrefs, startPrefsSync, type Prefs } from './prefsSync'

export type Mode = 'blind' | 'deaf' | 'speech' | 'standard'
const MODE_IDS: Mode[] = ['blind', 'deaf', 'speech', 'standard']
/** Accounts from before a mode was retired (deaf-blind) are shown as talk-and-type. */
export const modeOf = (m: unknown): Mode => (MODE_IDS.includes(m as Mode) ? (m as Mode) : 'standard')

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
  avatar?: string
  /** The name you gave this contact. Only you see it. */
  nickname?: string
  /** A demo friend that answers by itself, so anyone can try every way of talking alone. */
  demo?: boolean
  /** Made by "Try it now" without signing up; can be saved with a username and password. */
  guest?: boolean
}

export interface Contact extends User {
  /** Their own name, even when you gave them a nickname. */
  realName: string
  initial: string
  hue: 'coral' | 'indigo' | 'emerald' | 'violet' | 'slate'
}

export interface Group {
  id: string
  name: string
  owner: string
  members: User[]
}

const HUES: Contact['hue'][] = ['coral', 'indigo', 'emerald', 'violet', 'slate']
// Avatar colour comes from the username, so it never hints at how someone talks.
const hueFor = (id: string) => HUES[[...id].reduce((n, ch) => n + ch.charCodeAt(0), 0) % HUES.length]
export const toContact = (u: User): Contact => {
  const name = u.nickname || u.name
  return { ...u, mode: modeOf(u.mode), name, realName: u.name, initial: (name || u.id).charAt(0).toUpperCase(), hue: hueFor(u.id) }
}

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
  setName: (name: string) => Promise<string | null>
  setNickname: (username: string, nickname: string) => Promise<string | null>
  setAvatar: (dataUrl: string | null) => Promise<void>
  blocked: string[]
  setBlocked: (username: string, block: boolean) => Promise<string | null>
  report: (username: string, reason: string) => Promise<string | null>
  addContact: (username: string) => Promise<string | null>
  removeContact: (username: string) => Promise<string | null>
  startDemo: () => Promise<string | null>
  refreshContacts: () => Promise<void>
  /** "Try it now": a guest account in one tap. With a pairing code, it starts in a chat with whoever showed the code. */
  tryAs: (mode: Mode, pair?: string) => Promise<{ error: string | null; with?: User | null }>
  /** Signed in already and opened someone's pairing code: become contacts. */
  joinPair: (code: string) => Promise<{ error: string | null; contact?: User }>
  /** A guest keeps their account with a username and password. */
  keepGuest: (p: { username: string; name: string; password: string }) => Promise<string | null>
}

const Ctx = createContext<AuthCtx | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<string | null>(readSession)
  const [user, setUser] = useState<User | null>(null)
  const [ready, setReady] = useState(false)
  const [contacts, setContacts] = useState<Contact[]>([])
  const [groups, setGroups] = useState<Group[]>([])
  const [blocked, setBlockedList] = useState<string[]>([])
  const expire = useRef<() => void>(() => {})
  useEffect(() => {
    expire.current = () => {
      try {
        sessionStorage.setItem('anyway.expired', '1')
      } catch {
        /* storage unavailable */
      }
      if (user?.mode === 'blind') announce('You were signed out of AnyWay. Please log in again.', true)
      void disconnect().catch(() => {})
      writeSession(null)
      setSession(null)
      setUser(null)
      setContacts([])
      setGroups([])
    }
  })

  const api = useCallback(
    async <T,>(path: string, init?: { method?: string; body?: unknown }): Promise<T> => {
      const r = await fetch(`/api${path}`, {
        method: init?.method ?? 'GET',
        headers: { 'Content-Type': 'application/json', ...(session ? { Authorization: `Bearer ${session}` } : {}) },
        body: init?.body ? JSON.stringify(init.body) : undefined,
      })
      const j = (await r.json().catch(() => ({}))) as T & { error?: string }
      // The server no longer accepts this login (logged out elsewhere, or removed): say so and go to Log in,
      // instead of leaving every action quietly failing until a reload.
      if (r.status === 401 && session && !/^\/(login|signup)$/.test(path)) expire.current()
      if (!r.ok) throw new Error(j.error ?? 'Something went wrong.')
      return j
    },
    [session],
  )

  // One call for contacts, groups and blocks (it used to be two calls every 20 seconds from every open app).
  const refreshContacts = useCallback(async () => {
    const b = await api<{ contacts: User[]; groups: Group[]; blocked: string[] }>('/bootstrap?token=0')
    const cs = b.contacts.map(toContact)
    cs.forEach((c) => known.set(c.id, c))
    setContacts(cs)
    b.groups.forEach((g) => g.members.forEach((m) => known.has(m.id) || known.set(m.id, toContact(m))))
    setGroups(b.groups)
    setBlockedList(b.blocked ?? [])
  }, [api])

  useEffect(() => {
    if (!session) {
      setUser(null)
      setReady(true)
      return
    }
    // Show the last known chats straight away, then refresh everything in one call.
    const CK = `anyway.boot.${session.slice(0, 12)}`
    type Boot = { user: User; blocked: string[]; contacts: User[]; groups: Group[]; token?: string | null; prefs?: Prefs | null }
    const apply = (b: Boot) => {
      setBlockedList(b.blocked ?? [])
      known.set(b.user.id, toContact(b.user))
      const cs = b.contacts.map(toContact)
      cs.forEach((c) => known.set(c.id, c))
      b.groups.forEach((g) => g.members.forEach((m) => known.has(m.id) || known.set(m.id, toContact(m))))
      setContacts(cs)
      setGroups(b.groups)
      setUser({ ...b.user, mode: modeOf(b.user.mode) })
    }
    try {
      const cached = JSON.parse(localStorage.getItem(CK) ?? 'null') as Boot | null
      if (cached?.user) { apply(cached); if (cached.token) setStartToken(cached.token); setReady(true) }
    } catch { /* no cache */ }
    api<Boot>('/bootstrap')
      .then((b) => {
        apply(b)
        if (b.token) setStartToken(b.token)
        // Settings saved on the account win (signing in on a new phone); an account without any gets this phone's.
        if (b.prefs) applyPrefs(b.prefs)
        else void api('/me', { method: 'PATCH', body: { prefs: collectPrefs() } }).catch(() => {})
        try { localStorage.setItem(CK, JSON.stringify({ ...b, prefs: undefined })) } catch { /* full */ }
      })
      .catch((e: Error) => {
        // Only a rejected session logs you out; a network hiccup keeps the cached screen.
        if (/sign in|log in|session|401/i.test(e.message)) {
          try { localStorage.removeItem(CK) } catch { /* ignore */ }
          writeSession(null)
          setSession(null)
        }
      })
      .finally(() => setReady(true))
  }, [session, api, refreshContacts])

  // Any settings change is saved to the account a moment later.
  const userId = user?.id
  useEffect(() => {
    if (!userId) return
    return startPrefsSync((p) => api('/me', { method: 'PATCH', body: { prefs: p } }))
  }, [userId, api])

  // Someone new may add you, message you or put you in a group at any time: pick that up without a refresh.
  useEffect(() => {
    if (!user) return
    const known = () => new Set([...contacts.map((c) => `direct:${c.id}`), ...groups.map((g) => `group:${g.id}`)])
    const off = onMessage((m) => {
      if (!known().has(m.key)) void refreshContacts().catch(() => {})
    })
    const onFocus = () => void refreshContacts().catch(() => {})
    window.addEventListener('focus', onFocus)
    const t = setInterval(() => !document.hidden && onFocus(), 60000)
    return () => {
      off()
      window.removeEventListener('focus', onFocus)
      clearInterval(t)
    }
  }, [user, contacts, groups, refreshContacts])

  const start = (s: string, u: User) => {
    writeSession(s)
    known.set(u.id, toContact(u))
    setUser({ ...u, mode: modeOf(u.mode) })
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
      blocked,
      async setBlocked(username, block) {
        try {
          const r = await api<{ blocked: string[] }>('/block', { method: 'POST', body: { username, block } })
          setBlockedList(r.blocked)
          return null
        } catch (e) {
          return (e as Error).message
        }
      },
      async report(username, reason) {
        try {
          await api('/report', { method: 'POST', body: { username, reason } })
          return null
        } catch (e) {
          return (e as Error).message
        }
      },
      async setAvatar(avatar) {
        const r = await api<{ user: User }>('/me', { method: 'PATCH', body: { avatar } })
        known.set(r.user.id, toContact(r.user))
        setUser({ ...r.user, mode: modeOf(r.user.mode) })
      },
      async setName(name) {
        try {
          const r = await api<{ user: User }>('/me', { method: 'PATCH', body: { name } })
          known.set(r.user.id, toContact(r.user))
          setUser({ ...r.user, mode: modeOf(r.user.mode) })
          return null
        } catch (e) {
          return (e as Error).message
        }
      },
      async setNickname(username, nickname) {
        try {
          await api('/nickname', { method: 'POST', body: { username, nickname } })
          await refreshContacts()
          return null
        } catch (e) {
          return (e as Error).message
        }
      },
      async setMode(m) {
        const r = await api<{ user: User }>('/me', { method: 'PATCH', body: { mode: m } })
        setUser({ ...r.user, mode: modeOf(r.user.mode) })
      },
      async removeContact(username) {
        try {
          await api('/contacts/remove', { method: 'POST', body: { username } })
          await refreshContacts()
          return null
        } catch (e) {
          return (e as Error).message
        }
      },
      async tryAs(mode, pair) {
        try {
          const r = await api<{ session: string; user: User; with: User | null }>('/guest', { method: 'POST', body: { mode, pair } })
          if (r.with) known.set(r.with.id, toContact(r.with))
          start(r.session, r.user)
          return { error: null, with: r.with }
        } catch (e) {
          return { error: (e as Error).message }
        }
      },
      async joinPair(code) {
        try {
          const r = await api<{ contact: User }>(`/pair/${encodeURIComponent(code)}/join`, { method: 'POST' })
          known.set(r.contact.id, toContact(r.contact))
          await refreshContacts()
          return { error: null, contact: r.contact }
        } catch (e) {
          return { error: (e as Error).message }
        }
      },
      async keepGuest(p) {
        try {
          await api('/guest/keep', { method: 'POST', body: p })
        } catch (e) {
          return (e as Error).message
        }
        // The username changed, so start fresh: a new chat connection under the new name.
        try {
          if (session) localStorage.removeItem(`anyway.boot.${session.slice(0, 12)}`)
        } catch {
          /* storage unavailable */
        }
        await disconnect().catch(() => {})
        location.assign('/home')
        return null
      },
      async startDemo() {
        try {
          await api('/demo/start', { method: 'POST' })
          await refreshContacts()
          return null
        } catch (e) {
          return (e as Error).message
        }
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
    [user, ready, contacts, groups, blocked, api, refreshContacts, session],
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
