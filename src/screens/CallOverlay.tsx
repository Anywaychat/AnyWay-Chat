import { useEffect, useState } from 'react'
import { Mic, MicOff, Phone, PhoneOff, Video, VideoOff } from 'lucide-react'
import { LOCAL_VIDEO_ID, REMOTE_VIDEO_ID, acceptCall, endCall, getCall, onCall, toggleCam, toggleMic, type CallState } from '../calls'
import { contactById } from '../state'
import { Avatar } from '../components/ui'

function useCall() {
  const [s, setS] = useState<CallState>(getCall())
  useEffect(() => onCall(setS), [])
  return s
}

function useTimer(start: number | null) {
  const [, tick] = useState(0)
  useEffect(() => {
    if (!start) return
    const t = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [start])
  if (!start) return ''
  const secs = Math.max(0, Math.floor((Date.now() - start) / 1000))
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`
}

/** Always mounted so the video elements exist before a call starts or is answered. */
export default function CallOverlay() {
  const s = useCall()
  const timer = useTimer(s.phase === 'connected' ? s.startTime : null)
  // An incoming call buzzes in a strong repeating pattern, so people who can't hear a ringtone still feel it.
  useEffect(() => {
    if (s.phase !== 'incoming') return
    const ring = () => navigator.vibrate?.([700, 300, 700, 300, 700])
    ring()
    const t = setInterval(ring, 3000)
    return () => {
      clearInterval(t)
      navigator.vibrate?.(0)
    }
  }, [s.phase])
  const active = s.phase !== 'idle'
  const peer = contactById(s.peer ?? '')
  const showVideo = s.video && (s.phase === 'connected' || s.phase === 'connecting' || s.phase === 'outgoing')

  const status =
    s.phase === 'outgoing'
      ? 'Calling…'
      : s.phase === 'incoming'
        ? `Incoming ${s.video ? 'video' : 'voice'} call`
        : s.phase === 'connecting'
          ? 'Connecting…'
          : s.phase === 'connected'
            ? timer || 'Connected'
            : (s.endedReason ?? 'Call ended')

  return (
    <div className={`call-overlay${active ? ' open' : ''}${showVideo ? ' with-video' : ''}`} aria-hidden={!active} role="dialog" aria-label="Call">
      <video id={REMOTE_VIDEO_ID} className="remote-video" autoPlay playsInline />
      <video id={LOCAL_VIDEO_ID} className="local-video" autoPlay playsInline muted />

      {active && (
        <div className="call-ui">
          <div className="call-head">
            {!showVideo && <div className="ring"><Avatar c={peer} size="xl" /></div>}
            <div className="call-name">{peer.name}</div>
            <div className="call-status" aria-live="polite">{status}</div>
          </div>

          {s.phase === 'incoming' ? (
            <div className="call-ctrls two">
              <button className="ctrl end" onClick={() => endCall()}><i><PhoneOff size={24} aria-hidden="true" /></i>Decline</button>
              <button className="ctrl accept" onClick={() => acceptCall()}><i>{s.video ? <Video size={24} aria-hidden="true" /> : <Phone size={24} aria-hidden="true" />}</i>Accept</button>
            </div>
          ) : s.phase === 'ended' ? null : (
            <div className="call-ctrls">
              <button className="ctrl" onClick={() => toggleMic()} aria-pressed={!s.micOn}>
                <i>{s.micOn ? <Mic size={24} aria-hidden="true" /> : <MicOff size={24} aria-hidden="true" />}</i>{s.micOn ? 'Mute' : 'Unmute'}
              </button>
              {s.video && (
                <button className="ctrl" onClick={() => toggleCam()} aria-pressed={!s.camOn}>
                  <i>{s.camOn ? <Video size={24} aria-hidden="true" /> : <VideoOff size={24} aria-hidden="true" />}</i>{s.camOn ? 'Camera off' : 'Camera on'}
                </button>
              )}
              <button className="ctrl end" onClick={() => endCall()}><i><PhoneOff size={24} aria-hidden="true" /></i>{s.phase === 'connected' ? 'End' : 'Cancel'}</button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
