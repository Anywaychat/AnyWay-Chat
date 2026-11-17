import { NCCallEngine, NCCallEndReason, NCCallMediaType, NCCallType, NCCallUserState, NCCallVideoFrameRate, NCCallVideoResolution, type NCCallSession } from '@nexconn/call'

/**
 * One-to-one voice and video calls on the Nexconn Call SDK.
 * The call engine rides on the same Nexconn connection as chat.
 */

export type Phase = 'idle' | 'outgoing' | 'incoming' | 'connecting' | 'connected' | 'ended'

export interface CallState {
  phase: Phase
  callId: string | null
  peer: string | null
  video: boolean
  startTime: number | null
  micOn: boolean
  camOn: boolean
  endedReason: string | null
  /** The connection has been losing packets for a few seconds. */
  poor: boolean
}

let outgoing = false
let connectedAt: number | null = null
let placedAt = 0

function session() {
  return sessionStorage.getItem('anyway.session') ?? localStorage.getItem('anyway.session') ?? ''
}

/** Saves the finished call to this user's history on our server. */
function saveCall(answered: boolean) {
  if (!state.callId || !state.peer) return
  const seconds = answered && connectedAt ? (Date.now() - connectedAt) / 1000 : 0
  void fetch('/api/calls', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session()}` },
    body: JSON.stringify({ callId: state.callId, peer: state.peer, video: state.video, outgoing, answered, time: placedAt || Date.now(), seconds }),
  })
    .then(() => historyListeners.forEach((l) => l()))
    .catch(() => {})
}

const IDLE: CallState = { phase: 'idle', callId: null, peer: null, video: false, startTime: null, micOn: true, camOn: true, endedReason: null, poor: false }

let state: CallState = IDLE
let engine: NCCallEngine | null = null
let me: string | null = null
const listeners = new Set<(s: CallState) => void>()

export const LOCAL_VIDEO_ID = 'aw-local-video'
export const REMOTE_VIDEO_ID = 'aw-remote-video'

function set(patch: Partial<CallState>) {
  state = { ...state, ...patch }
  listeners.forEach((l) => l(state))
}

export function getCall() {
  return state
}

export function onCall(l: (s: CallState) => void) {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

/** Must run before NCEngine.initialize. */
export function installCalls() {
  NCCallEngine.install()
}

const REASONS: Partial<Record<NCCallEndReason, string>> = {
  [NCCallEndReason.NO_ANSWER]: 'No answer',
  [NCCallEndReason.MISSED]: 'Missed call',
  [NCCallEndReason.CANCELED]: 'Call cancelled',
  [NCCallEndReason.DECLINED]: 'Call declined',
}

function peerOf(session: NCCallSession) {
  const caller = session.getCallerUserId()
  if (caller && caller !== me) return caller
  return session.getRemoteParticipants().map((p) => p.userId).find((id) => id !== me) ?? null
}

/** Asks for mic (and camera) first, so a blocked device gives a clear message instead of a silent failure. */
async function checkDevices(video: boolean): Promise<string | null> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video })
    stream.getTracks().forEach((t) => t.stop())
    return null
  } catch {
    return video ? 'Allow camera and microphone for this site in your browser, then try again.' : 'Allow microphone for this site in your browser, then try again.'
  }
}

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)))

function bindViews(peer: string | null) {
  if (!engine) return
  const local = document.getElementById(LOCAL_VIDEO_ID) as HTMLVideoElement | null
  const remote = document.getElementById(REMOTE_VIDEO_ID) as HTMLVideoElement | null
  if (local) engine.setLocalVideoView({ videoElement: local })
  if (remote && peer) engine.setRemoteVideoView([{ userId: peer, videoElement: remote }])
}

/** Remember who is signed in, so we can tell the caller from the callee. */
export function setCallUser(userId: string) {
  me = userId
}

/** Must run after NCEngine.initialize and before NCEngine.connect, or incoming calls are never delivered. */
export function startCallEngine() {
  if (engine) return
  engine = NCCallEngine.initialize({})
  // Phone-friendly video: 640x480 at 24 fps, letting the bitrate drop to 250 kbps on a weak network
  // instead of freezing. (Higher resolutions only add delay on mobile data.)
  try {
    engine.setVideoConfig(engine.createVideoConfigBuilder().setResolution(NCCallVideoResolution.RESOLUTION_640X480).setFrameRate(NCCallVideoFrameRate.FPS_24).setMinBitrate(250).setMaxBitrate(1200).build())
  } catch { /* keep the default */ }
  // Watch the connection so people are told when it's weak.
  let bad = 0
  engine.setConnectionQualityHandler({
    onSendQualityChanged(q) {
      const loss = Math.max(q.audioPacketLostRate ?? 0, q.videoPacketLostRate ?? 0)
      bad = loss > 8 ? bad + 1 : 0
      const poor = bad >= 3
      if (poor !== state.poor) set({ poor })
    },
  })
  engine.setCallEventHandler({
    onCallReceived({ session }) {
      if (state.phase !== 'idle' && state.phase !== 'ended') return
      outgoing = false
      connectedAt = null
      placedAt = Date.now()
      set({
        ...IDLE,
        phase: 'incoming',
        callId: session.getCallId(),
        peer: peerOf(session),
        video: session.getMediaType() === NCCallMediaType.AUDIO_VIDEO,
      })
    },
    onRemoteUserStateChanged({ userId, userState }) {
      if (userState === NCCallUserState.ONCALL) bindViews(userId)
    },
    onCallConnected({ session }) {
      connectedAt = connectedAt ?? Date.now()
      set({ phase: 'connected', callId: session.getCallId(), startTime: state.startTime ?? Date.now() })
      bindViews(state.peer)
    },
    onStartTimeReceived({ startTime }) {
      set({ startTime })
    },
    onLocalCallLogReceived() {
      historyListeners.forEach((l) => l())
    },
    onServerCallLogReceived() {
      historyListeners.forEach((l) => l())
    },
    onCallEnded({ reason }) {
      saveCall(connectedAt !== null)
      set({ phase: 'ended', endedReason: REASONS[reason] ?? 'Call ended' })
      setTimeout(() => state.phase === 'ended' && set(IDLE), 1800)
    },
  })
}

export async function startCall(peer: string, video: boolean): Promise<string | null> {
  if (!engine) return 'Calls are still connecting. Try again in a moment.'
  if (state.phase !== 'idle' && state.phase !== 'ended') return 'You are already in a call.'
  outgoing = true
  connectedAt = null
  placedAt = Date.now()
  set({ ...IDLE, phase: 'outgoing', peer, video })
  const blocked = await checkDevices(video)
  if (blocked) {
    set({ phase: 'ended', endedReason: blocked })
    setTimeout(() => set(IDLE), 4000)
    return blocked
  }
  await nextFrame()
  bindViews(peer)
  const { code, callId } = await engine.startCall({
    calleeIds: [peer],
    callType: NCCallType.SINGLE,
    mediaType: video ? NCCallMediaType.AUDIO_VIDEO : NCCallMediaType.AUDIO,
  })
  if (code !== 0 || !callId) {
    set({ phase: 'ended', endedReason: `Couldn't start the call (code ${code}). Check calling is enabled in the Nexconn console.` })
    setTimeout(() => set(IDLE), 3500)
    return `code ${code}`
  }
  set({ callId })
  return null
}

export async function acceptCall() {
  if (!engine || !state.callId) return
  const blocked = await checkDevices(state.video)
  if (blocked) {
    set({ endedReason: blocked })
    await engine.endCall({ callId: state.callId }).catch(() => {})
    set({ phase: 'ended' })
    setTimeout(() => set(IDLE), 4000)
    return
  }
  set({ phase: 'connecting' })
  await nextFrame()
  bindViews(state.peer)
  const { code } = await engine.acceptCall({ callId: state.callId })
  if (code !== 0) {
    set({ phase: 'ended', endedReason: `Couldn't answer (code ${code})` })
    setTimeout(() => set(IDLE), 2500)
  }
}

export async function endCall() {
  if (!engine) return set(IDLE)
  await engine.endCall(state.callId ? { callId: state.callId } : undefined).catch(() => {})
  if (state.phase !== 'ended') {
    saveCall(connectedAt !== null)
    set({ phase: 'ended', endedReason: 'Call ended' })
    setTimeout(() => state.phase === 'ended' && set(IDLE), 1200)
  }
}

export async function toggleMic() {
  if (!engine) return
  const next = !state.micOn
  await engine.enableMicrophone(next)
  set({ micOn: next })
}

export async function toggleCam() {
  if (!engine) return
  const next = !state.camOn
  await engine.enableCamera(next)
  set({ camOn: next })
}

export interface CallRecord {
  callId: string
  peer: string
  video: boolean
  outgoing: boolean
  missed: boolean
  time: number
  seconds: number
}

const historyListeners = new Set<() => void>()
export function onHistoryChange(l: () => void) {
  historyListeners.add(l)
  return () => {
    historyListeners.delete(l)
  }
}

/** Past calls for the signed-in user, newest first (saved by the app on our server). */
export async function loadCallHistory(): Promise<CallRecord[]> {
  const r = await fetch('/api/calls', { headers: { Authorization: `Bearer ${session()}` } }).catch(() => null)
  if (!r || !r.ok) return []
  const { calls } = (await r.json()) as { calls: { callId: string; peer: string; video: boolean; outgoing: boolean; answered: boolean; time: number; seconds: number }[] }
  return calls.map((c) => ({ callId: c.callId, peer: c.peer, video: c.video, outgoing: c.outgoing, missed: !c.answered, time: c.time, seconds: c.seconds }))
}
