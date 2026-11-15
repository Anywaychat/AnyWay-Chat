import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { MessageCircle } from 'lucide-react'
import { useProfile, type Mode } from './state'
import Welcome from './screens/Welcome'
import Home from './screens/Home'
import Chat from './screens/Chat'
import VoiceCall from './screens/VoiceCall'
import VideoCall from './screens/VideoCall'
import Go from './screens/Go'
import Calls from './screens/Calls'
import Profile from './screens/Profile'
import Landing from './screens/Landing'

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
  const { mode } = useProfile()
  const { pathname } = useLocation()

  if (pathname === '/') return <Landing />

  const onboarding = pathname === '/start'
  const dark = DARK_MODES.includes(mode) && !onboarding

  return (
    <div className={`shell${dark ? ' dark' : ''}${onboarding ? ' onboarding' : ''}`}>
      {!onboarding && (
        <aside className="side" aria-label="Chats">
          <Home />
        </aside>
      )}
      <main className="app">
        <Routes>
          <Route path="/start" element={<Welcome />} />
          <Route
            path="/home"
            element={
              <>
                <div className="only-mobile screen"><Home /></div>
                <div className="only-desktop screen"><EmptyPane /></div>
              </>
            }
          />
          <Route path="/chat/:id" element={<Chat />} />
          <Route path="/call/voice/:id" element={<VoiceCall />} />
          <Route path="/call/video/:id" element={<VideoCall />} />
          <Route path="/go" element={<Go />} />
          <Route path="/calls" element={<Calls />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  )
}
