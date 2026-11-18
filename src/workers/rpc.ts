/**
 * Small helpers for the background threads that run AnyWay's on-device AI (voice, speech-to-text, photo descriptions).
 * Running those models on the page's own thread froze every tap and click while they worked.
 */

type Reply = { id: number; ok: boolean; error?: string }

/** The page side: send a request to a worker and get its answer back as a promise. */
export function workerClient<Req extends object, Res extends object>(make: () => Worker) {
  let worker: Worker | null = null
  let next = 0
  const waiting = new Map<number, { ok: (r: Res) => void; fail: (e: Error) => void }>()
  const get = () => {
    if (worker) return worker
    const w = make()
    w.onmessage = (e: MessageEvent<Reply & Res>) => {
      const p = waiting.get(e.data.id)
      if (!p) return
      waiting.delete(e.data.id)
      if (e.data.ok) p.ok(e.data)
      else p.fail(new Error(e.data.error ?? 'failed'))
    }
    // A worker that crashed (for example out of memory) fails what was waiting; the next request starts a fresh one.
    w.onerror = (e) => {
      e.preventDefault()
      for (const p of waiting.values()) p.fail(new Error(e.message || 'background worker stopped'))
      waiting.clear()
      w.terminate()
      if (worker === w) worker = null
    }
    worker = w
    return w
  }
  return (req: Req, transfer: Transferable[] = []) =>
    new Promise<Res>((ok, fail) => {
      const id = ++next
      waiting.set(id, { ok, fail })
      get().postMessage({ ...req, id }, transfer)
    })
}

type Scope = { onmessage: ((e: MessageEvent) => void) | null; postMessage: (m: unknown, transfer?: Transferable[]) => void }

/**
 * The worker side: answers requests one at a time (the models can't run two jobs at once).
 * `handle` returns the reply fields; a thrown error is sent back as a failure.
 */
export function serve<Req extends object>(handle: (req: Req) => Promise<object | void>) {
  const scope = self as unknown as Scope
  let chain: Promise<unknown> = Promise.resolve()
  scope.onmessage = (e: MessageEvent<Req & { id: number }>) => {
    const { id } = e.data
    chain = chain.then(async () => {
      try {
        scope.postMessage({ ...((await handle(e.data)) ?? {}), id, ok: true })
      } catch (err) {
        scope.postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) })
      }
    })
  }
}
