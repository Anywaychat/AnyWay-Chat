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

const DARK_MODES: Mode[] = ['blind', 'deafblind']

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

  if (pathname === '/') return <Landing />
  if (pathname === '/admin') return <Admin />
  if (!ready) return null

  const onboarding = ['/start', '/login', '/signup'].includes(pathname)
  if (!user && !onboarding) return <Navigate to="/login" replace />
  if (user && onboarding) return <Navigate to="/home" replace />
  if (!user && pathname === '/start') return <Navigate to="/signup" replace />

  const dark = !!user && DARK_MODES.includes(user.mode)

  return (
    <div className={`shell${dark ? ' dark' : ''}${onboarding ? ' onboarding' : ''}`}>
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
          <Route path="/go" element={user?.mode === 'blind' ? <Navigate to="/home" replace /> : <Go />} />
          <Route path="/calls" element={<Calls />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/signs" element={<SignDictionary />} />
          <Route path="/review" element={<Review />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <CallOverlay />
      {user?.mode === 'blind' && <VoiceAssistant />}
    </div>
  )
}
