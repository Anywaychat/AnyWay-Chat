import { Link, NavLink } from 'react-router-dom'
import { ChevronLeft, Ear, EyeOff, Hand, LayoutGrid, MessageCircle, Footprints, UserRound, Vibrate } from 'lucide-react'
import type { Contact, Mode } from '../state'
import { MODES } from '../state'

export function ModeIcon({ mode, size = 24 }: { mode: Mode; size?: number }) {
  const p = { size, strokeWidth: 2, 'aria-hidden': true } as const
  switch (mode) {
    case 'blind':
      return <EyeOff {...p} />
    case 'deaf':
      return <Hand {...p} />
    case 'speech':
      return <LayoutGrid {...p} />
    case 'deafblind':
      return <Vibrate {...p} />
    default:
      return <Ear {...p} />
  }
}

const HOW: Record<Mode, string> = {
  deaf: 'Signs',
  blind: 'Speaks',
  speech: 'Taps phrases',
  deafblind: 'Braille + touch',
  standard: 'Talks & types',
}

export function ModeTag({ mode }: { mode: Mode }) {
  return (
    <span className={`mode-tag mode-${mode}`}>
      <ModeIcon mode={mode} size={14} />
      {HOW[mode]}
    </span>
  )
}

export function Avatar({ c, size = '', online }: { c: Pick<Contact, 'initial' | 'hue'> & { avatar?: string }; size?: '' | 'sm' | 'xl'; online?: boolean }) {
  return (
    <div className={`avatar ${size} hue-${c.hue}`} aria-hidden="true">
      {c.avatar ? <img src={c.avatar} alt="" /> : c.initial}
      {online && <span className="dot" />}
    </div>
  )
}

export function BackButton({ to = '/home', label = 'Back to chats' }: { to?: string; label?: string }) {
  return (
    <Link to={to} className="icon-btn back-btn" aria-label={label}>
      <ChevronLeft size={24} strokeWidth={2.4} aria-hidden="true" />
    </Link>
  )
}

export function Wave({ n = 14 }: { n?: number }) {
  const hs = [5, 9, 13, 8, 12, 6, 14, 10, 7, 12, 9, 5, 11, 8, 13, 6]
  return (
    <span className="wave" aria-hidden="true">
      {hs.slice(0, n).map((h, i) => (
        <i key={i} style={{ height: h }} />
      ))}
    </span>
  )
}

export function TabBar() {
  const tabs = [
    { to: '/home', label: 'Chats', icon: MessageCircle },
    { to: '/go', label: 'Go', icon: Footprints },
    { to: '/calls', label: 'Calls', icon: Ear },
    { to: '/profile', label: 'Me', icon: UserRound },
  ]
  return (
    <nav className="tabbar" aria-label="Main">
      {tabs.map(({ to, label, icon: I }) => (
        <NavLink key={to} to={to} className={({ isActive }) => `tab${isActive ? ' active' : ''}`}>
          <I size={24} strokeWidth={2} aria-hidden="true" />
          {label}
        </NavLink>
      ))}
    </nav>
  )
}

export const modeLabel = (m: Mode) => MODES[m].short
