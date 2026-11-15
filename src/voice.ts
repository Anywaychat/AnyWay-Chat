/** Where "Hey AnyWay" commands go: the open chat if there is one, otherwise the app-wide handler. */
let chatHandler: ((text: string) => void) | null = null

export function registerChatVoice(fn: (text: string) => void) {
  chatHandler = fn
  return () => {
    if (chatHandler === fn) chatHandler = null
  }
}

export function routeVoice(text: string, fallback: (text: string) => void) {
  if (chatHandler) chatHandler(text)
  else fallback(text)
}
