import type { IncomingMessage, ServerResponse } from 'node:http'
import { createApi } from '../server/api.js'

// On Vercel every /api/* request comes here. The same API runs inside the Vite dev server locally.
const api = createApi(process.env)

export default function handler(req: IncomingMessage, res: ServerResponse) {
  return api(req, res, () => {
    res.statusCode = 404
    res.end(JSON.stringify({ error: 'Not found' }))
  })
}
