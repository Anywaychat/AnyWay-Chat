// AnyWay service worker: makes the app installable and opens it even on a flaky connection.
// It never caches the API or chat traffic, so messages are always live.
const SHELL = 'anyway-shell-v3'

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(['/index.html', '/icons/icon-192.png'])))
  self.skipWaiting()
})

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== SHELL).map((k) => caches.delete(k)))))
  self.clients.claim()
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET' || new URL(req.url).pathname.startsWith('/api/')) return
  // Pages: try the network first, fall back to the saved app shell when offline.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone()
          caches.open(SHELL).then((c) => c.put('/index.html', copy))
          return res
        })
        .catch(() => caches.match('/index.html')),
    )
  }
})

// Push: a message arrived while the app was closed or in the background.
self.addEventListener('push', (e) => {
  let d = {}
  try { d = e.data ? e.data.json() : {} } catch { d = { body: e.data && e.data.text() } }
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      // If the person is looking at the app right now, the app itself handles it.
      if (wins.some((w) => w.focused && w.visibilityState === 'visible')) return
      // A call stays on screen until it's answered or dismissed, and buzzes like a ringing phone.
      return self.registration.showNotification(d.title || 'AnyWay Chat', {
        body: d.body || 'New message',
        tag: d.tag,
        renotify: true,
        requireInteraction: !!d.call,
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
        vibrate: d.call ? [800, 400, 800, 400, 800, 400, 800, 400, 800] : [200, 100, 200],
        data: { url: d.url || '/home' },
      })
    }),
  )
})

// Tapping a notification opens that chat, reusing an open window when there is one.
self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  const url = (e.notification.data && e.notification.data.url) || '/home'
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      const w = wins[0]
      if (w) return w.focus().then(() => w.navigate(url)).catch(() => self.clients.openWindow(url))
      return self.clients.openWindow(url)
    }),
  )
})
