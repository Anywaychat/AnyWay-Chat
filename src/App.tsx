import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { MessageCircle } from 'lucide-react'
import { contactById, useAuth, type Mode } from './state'
import { Login, Signup } from './screens/Auth'
import Home from './screens/Home'
import Chat from './screens/Chat'
import CallOverlay from './screens/CallOverlay'
import VoiceAssistant from './screens/VoiceAssistant'
import Go from './screens/Go'
import Calls from './screens/Calls'
import Profile from './screens/Profile'
import SignDictionary from './screens/SignDictionary'
import Review from './screens/Review'
import Landing from './screens/Landing'
import Admin from './screens/Admin'
import { useLink, useNotifications } from './useChat'
import { useEffect, useRef, useState } from 'react'
import { enablePush } from './push'
import { useDisplay } from './display'
import FlashAlert from './components/FlashAlert'
import { useLang } from './lang'
import { setNaturalVoice, setRate, setScreenReaderMode, setSpeechLang } from './speech'
import { useBlindPrefs } from './blindPrefs'

const DARK_MODES: Mode[] = ['blind']

function EmptyPane() {
  return (
    <div className="empty-pane">
      <span className="empty-ico"><MessageCircle size={34} aria-hidden="true" /></span>
      <h2>Pick a chat to start talking</h2>
      <p>Every message is translated into the way each person understands it.</p>
    </div>
  )
}

const TITLES: Record<string, string> = { '/home': 'Chats', '/calls': 'Calls', '/profile': 'Profile', '/go': 'Face to face', '/signs': 'Sign dictionary', '/review': 'Review AnyWay', '/login': 'Log in', '/signup': 'Create your account', '/admin': 'Dashboard' }

/**
 * Screen readers announce the page title, and every screen used to share one ("AnyWay Chat · talk your way"), so moving
 * around was silent. Each screen gets its own title, and after moving, focus goes to that screen's heading.
 */
function useScreenTitle(pathname: string) {
  const { groups, contacts } = useAuth()
  const id = pathname.split('/')[2] ?? ''
  const name = pathname.startsWith('/chat/') ? `Chat with ${contactById(id).name}` : pathname.startsWith('/group/') ? `${groups.find((g) => g.id === id)?.name ?? 'Group'}, group chat` : TITLES[pathname]
  useEffect(() => {
    document.title = name ? `${name} · AnyWay Chat` : 'AnyWay Chat · talk your way'
  }, [name, contacts])
  const first = useRef(true)
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    const t = setTimeout(() => {
      const h = document.querySelector<HTMLElement>('main h1, main h2')
      if (!h) return
      h.setAttribute('tabindex', '-1')
      h.focus({ preventScroll: true })
    }, 120)
    return () => clearTimeout(t)
  }, [pathname])
}

/** Shows when the chat connection is lost or coming back, for everyone (it used to be invisible). */
function ConnectionBar() {
  const link = useLink()
  const [show, setShow] = useState(false)
  useEffect(() => {
    if (link === 'online') return setShow(false)
    // A short blink while reconnecting isn't worth a warning; a real outage is shown at once.
    const t = setTimeout(() => setShow(true), link === 'offline' ? 0 : 2500)
    return () => clearTimeout(t)
  }, [link])
  // Push the app down by the bar's height while it shows, so it never covers the back button or a name.
  const bar = useRef<HTMLDivElement>(null)
  const visible = show && link !== 'online'
  useEffect(() => {
    const root = document.documentElement
    const el = bar.current
    if (!visible || !el) {
      root.style.removeProperty('--conn')
      return
    }
    const fit = () => root.style.setProperty('--conn', `${el.offsetHeight}px`)
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => {
      ro.disconnect()
      root.style.removeProperty('--conn')
    }
  }, [visible])
  if (!visible) return null
  return (
    <div ref={bar} className={`conn-bar ${link}`} role="status">
      {link === 'offline' ? 'No internet connection. Messages you send will go when you are back online.' : 'Connecting to AnyWay…'}
    </div>
  )
}

export default function App() {
  const { user, ready } = useAuth()
  const { pathname } = useLocation()
  const open = pathname.startsWith('/chat/') ? `direct:${pathname.slice(6)}` : pathname.startsWith('/group/') ? `group:${pathname.slice(7)}` : null
  useNotifications(open)
  // Once notifications are allowed, sign this device up for push so messages arrive even when the app is closed.
  useEffect(() => {
    if (user) void enablePush()
  }, [user])

  const disp = useDisplay()
  useScreenTitle(pathname)
  // How AnyWay talks: in the person's language, at their speed, with the natural voice only if they turned it on.
  const lang = useLang()
  const vp = useBlindPrefs()
  useEffect(() => setSpeechLang(lang), [lang])
  useEffect(() => setRate(vp.rate), [vp.rate])
  const talks = user?.mode === 'blind' || user?.mode === 'speech'
  useEffect(() => setNaturalVoice(talks && vp.natural), [talks, vp.natural])
  useEffect(() => setScreenReaderMode(user?.mode === 'blind' && vp.screenReader), [user?.mode, vp.screenReader])
  if (pathname === '/') return <Landing />
  if (pathname === '/admin') return <Admin />
  if (!ready) return null

  const onboarding = ['/start', '/login', '/signup'].includes(pathname)
  if (!user && !onboarding) return <Navigate to="/login" replace />
  if (user && onboarding) return <Navigate to="/home" replace />
  if (!user && pathname === '/start') return <Navigate to="/signup" replace />

  const dark = disp.theme === 'dark' || (disp.theme === 'auto' && !!user && DARK_MODES.includes(user.mode))

  return (
    <div className={`shell${dark ? ' dark' : ''}${disp.contrast ? ' contrast' : ''}${onboarding ? ' onboarding' : ''}`}>
      {!onboarding && (
        <aside className="side" aria-label="Chats">
          <Home />
        </aside>
      )}
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <main className="app" id="main-content" tabIndex={-1}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route
            path="/home"
            element={
              <>
                <div className="only-mobile screen"><Home /></div>
                <div className="only-desktop screen"><EmptyPane /></div>
              </>
            }
          />
          <Route path="/chat/:id" element={<Chat key={pathname} />} />
          <Route path="/group/:id" element={<Chat key={pathname} kind="group" />} />
          <Route path="/go" element={<Go />} />
          <Route path="/calls" element={<Calls />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/signs" element={<SignDictionary />} />
          <Route path="/review" element={<Review />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <ConnectionBar />
      <CallOverlay />
      <FlashAlert />
      {user?.mode === 'blind' && <VoiceAssistant />}
    </div>
  )
}
