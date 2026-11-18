import { readSession } from './state'
import type { Target } from './nexconn'

/** Shows a notification through the service worker. Works on Android and in the installed app, where `new Notification()` is not allowed. */
export async function showLocalNotification(title: string, body: string, tag: string, url: string) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
  try {
    const reg = await navigator.serviceWorker?.getRegistration()
    if (reg) {
      await reg.showNotification(title, { body, tag, icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', data: { url } })
      return
    }
  } catch {
    /* fall back below */
  }
  try {
    const n = new Notification(title, { body, tag })
    n.onclick = () => {
      window.focus()
      window.location.href = url
    }
  } catch {
    /* this browser can't show notifications */
  }
}

async function call<T>(path: string, body?: unknown): Promise<T | null> {
  const session = readSession()
  if (!session) return null
  try {
    const r = await fetch(`/api${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session}` },
      body: body ? JSON.stringify(body) : undefined,
    })
    return r.ok ? ((await r.json()) as T) : null
  } catch {
    return null
  }
}

const toBytes = (b64: string) => {
  const s = atob((b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(s, (c) => c.charCodeAt(0))
}

/** Signs this device up for push, so messages buzz even when the app is closed. Needs notification permission first. */
export async function enablePush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false
  if (Notification.permission !== 'granted') return false
  const res = await call<{ key: string | null }>('/push/key')
  if (!res?.key) return false
  const reg = await navigator.serviceWorker.ready
  let sub = await reg.pushManager.getSubscription()
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toBytes(res.key) })
  return !!(await call('/push/subscribe', { subscription: sub.toJSON() }))
}

/** Tells the server a message went out, so it can push it to the other person's devices (and demo friends can answer). */
export function notifyPush(t: Target, body: string, what: 'text' | 'image' | 'voice' | 'file' = 'text') {
  void call('/push/notify', { kind: t.kind, id: t.id, body, what })
}

/** Tells the server a call is ringing, so the other person's phone shows "… is calling you" even when the app is closed. */
export function notifyCall(peer: string, video: boolean) {
  void call('/push/notify', { kind: 'direct', id: peer, call: true, video, body: '' })
}
