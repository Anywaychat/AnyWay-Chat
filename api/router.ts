import type { IncomingMessage, ServerResponse } from 'node:http'
import { createApi } from '../server/api.js'

// vercel.json sends every /api/* request here as /api/router?__path=<rest>.
// Rebuild the original URL so the same API code works on Vercel and in the Vite dev server.
const api = createApi(process.env)

export default function handler(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '', 'http://localhost')
  const rest = url.searchParams.get('__path')
  if (rest !== null) {
    url.searchParams.delete('__path')
    const q = url.searchParams.toString()
    req.url = `/api/${rest}${q ? `?${q}` : ''}`
  }
  return api(req, res, () => {
    res.statusCode = 404
    res.end(JSON.stringify({ error: 'Not found' }))
  })
}
