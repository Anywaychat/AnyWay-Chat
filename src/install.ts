import { useEffect, useState } from 'react'

/** Lets the app offer "Install app" (Android/desktop Chrome) or explain Add to Home Screen (iPhone). */
type Prompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }
let deferred: Prompt | null = null
const listeners = new Set<() => void>()

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault()
  deferred = e as Prompt
  listeners.forEach((l) => l())
})
window.addEventListener('appinstalled', () => {
  deferred = null
  listeners.forEach((l) => l())
})

export function registerServiceWorker() {
  if ('serviceWorker' in navigator && import.meta.env.PROD) {
    window.addEventListener('load', () => void navigator.serviceWorker.register('/sw.js').catch(() => {}))
  }
}

const standalone = () => window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent)

export function useInstall() {
  const [, rerender] = useState(0)
  useEffect(() => {
    const l = () => rerender((n) => n + 1)
    listeners.add(l)
    return () => {
      listeners.delete(l)
    }
  }, [])
  return {
    installed: standalone(),
    canInstall: !!deferred,
    ios: isIOS() && !standalone(),
    install: async () => {
      if (!deferred) return
      await deferred.prompt()
      await deferred.userChoice
      deferred = null
      rerender((n) => n + 1)
    },
  }
}
