import react from '@vitejs/plugin-react'
import { createHash, randomBytes } from 'node:crypto'
import { defineConfig, loadEnv, type Plugin } from 'vite'

// Issues Nexconn access tokens on the dev server so the App Secret never reaches the browser.
function nexconnTokenApi(env: Record<string, string>): Plugin {
  const appKey = env.VITE_NEXCONN_APP_KEY
  const secret = env.NEXCONN_APP_SECRET
  const hosts = ['api.sg-light-api.com', 'api-b.sg-light-api.com']
  return {
    name: 'nexconn-token-api',
    configureServer(server) {
      server.middlewares.use('/api/token', async (req, res) => {
        const url = new URL(req.url ?? '', 'http://localhost')
        const userId = (url.searchParams.get('userId') ?? '').replace(/[^A-Za-z0-9]/g, '').slice(0, 64)
        const name = (url.searchParams.get('name') ?? userId).slice(0, 64)
        res.setHeader('Content-Type', 'application/json')
        if (!userId || !appKey || !secret) {
          res.statusCode = 400
          res.end(JSON.stringify({ error: 'Missing userId or Nexconn keys in .env.local' }))
          return
        }
        for (const host of hosts) {
          try {
            const nonce = randomBytes(6).toString('hex')
            const timestamp = String(Date.now())
            const signature = createHash('sha1').update(secret + nonce + timestamp).digest('hex')
            const r = await fetch(`https://${host}/v4/auth/access-token/issue`, {
              method: 'POST',
              headers: { 'App-Key': appKey, Nonce: nonce, Timestamp: timestamp, Signature: signature, 'Content-Type': 'application/json' },
              body: JSON.stringify({ userId, name }),
              signal: AbortSignal.timeout(5000),
            })
            const j = (await r.json()) as { code: number; result?: { accessToken: string } }
            if (j.code === 0 && j.result) {
              res.end(JSON.stringify({ token: j.result.accessToken }))
              return
            }
            res.statusCode = 502
            res.end(JSON.stringify({ error: `Nexconn returned code ${j.code}` }))
            return
          } catch {
            /* try the backup domain */
          }
        }
        res.statusCode = 504
        res.end(JSON.stringify({ error: 'Could not reach Nexconn' }))
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [react(), nexconnTokenApi(env)],
  }
})
