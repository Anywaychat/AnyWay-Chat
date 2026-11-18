import { useEffect, useRef, useState } from 'react'
import { Mic, MicOff, Phone, PhoneOff, Video, VideoOff } from 'lucide-react'
import { LOCAL_VIDEO_ID, REMOTE_VIDEO_ID, acceptCall, endCall, getCall, onCall, toggleCam, toggleMic, type CallState } from '../calls'
import { contactById, useProfile } from '../state'
import { speak, stopSpeaking } from '../speech'
import { Avatar } from '../components/ui'
import CallCaptions from '../components/CallCaptions'

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
  const { mode } = useProfile()
  const canHear = mode !== 'deaf'
  const blind = mode === 'blind'
  const who = contactById(s.peer ?? '').name
  // Ringtone for everyone who can hear, and for blind users the caller's name and how to answer, repeated while it rings.
  useEffect(() => {
    if (s.phase !== 'incoming' || !canHear) return
    let ctx: AudioContext | null = null
    try { ctx = new AudioContext() } catch { /* no audio */ }
    const tone = () => {
      if (!ctx) return
      void ctx.resume()
      ;[0, 0.45].forEach((at) => {
        const o = ctx!.createOscillator(); const g = ctx!.createGain()
        o.frequency.value = 880; o.connect(g); g.connect(ctx!.destination)
        const t = ctx!.currentTime + at
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25, t + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35)
        o.start(t); o.stop(t + 0.36)
      })
    }
    const say = () => speak(`${who} is calling you. ${s.video ? 'Video call' : 'Voice call'}. Say Hey Chat, answer. Or say Hey Chat, decline.`, true)
    tone()
    if (blind) setTimeout(say, 1000)
    let n = 0
    const t = setInterval(() => { n++; tone(); if (blind && n % 3 === 0) setTimeout(say, 1000) }, 3000)
    return () => { clearInterval(t); void ctx?.close(); if (blind) stopSpeaking() }
  }, [s.phase, canHear, blind, who, s.video])
  // Blind: say what happens with the call.
  useEffect(() => {
    if (!blind || !s.peer) return
    if (s.phase === 'outgoing') speak(`Calling ${who}.`, true)
    else if (s.phase === 'connected') speak(`Connected with ${who}. Say Hey Chat, hang up, to end.`, true)
    else if (s.phase === 'ended') speak(s.endedReason ?? 'Call ended.', true)
  }, [s.phase, blind]) // eslint-disable-line react-hooks/exhaustive-deps
  const first = useRef(true)
  useEffect(() => {
    if (first.current) { first.current = false; return }
    if (blind && s.phase === 'connected') speak(s.micOn ? 'Microphone on.' : 'Muted.', true)
  }, [s.micOn]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (blind && s.phase === 'connected' && s.poor) speak('The connection is weak.', true) }, [s.poor]) // eslint-disable-line react-hooks/exhaustive-deps
  const firstCam = useRef(true)
  useEffect(() => {
    if (firstCam.current) { firstCam.current = false; return }
    if (blind && s.phase === 'connected' && s.video) speak(s.camOn ? 'Camera on.' : 'Camera off.', true)
  }, [s.camOn]) // eslint-disable-line react-hooks/exhaustive-deps
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
            {s.phase === 'connected' && s.poor && <div className="call-poor" role="status">Weak connection: video may freeze</div>}
          </div>

          {s.phase === 'connected' && s.peer && <CallCaptions peer={s.peer} micOn={s.micOn} video={s.video} camOn={s.camOn} />}

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
