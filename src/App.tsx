import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { MessageCircle } from 'lucide-react'
import { useAuth, type Mode } from './state'
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
import { useNotifications } from './useChat'
import { useEffect } from 'react'
import { enablePush } from './push'
import { useDisplay } from './display'
import FlashAlert from './components/FlashAlert'
import { useLang } from './lang'
import { setNaturalVoice, setRate, setSpeechLang } from './speech'
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
  // How AnyWay talks: in the person's language, at their speed, with the natural voice only if they turned it on.
  const lang = useLang()
  const vp = useBlindPrefs()
  useEffect(() => setSpeechLang(lang), [lang])
  useEffect(() => setRate(vp.rate), [vp.rate])
  const talks = user?.mode === 'blind' || user?.mode === 'speech'
  useEffect(() => setNaturalVoice(talks && vp.natural), [talks, vp.natural])
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
      <main className="app">
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
      <CallOverlay />
      <FlashAlert />
      {user?.mode === 'blind' && <VoiceAssistant />}
    </div>
  )
}
