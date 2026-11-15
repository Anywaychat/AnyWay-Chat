import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import { createApi } from './server/api.ts'

// Accounts, contacts and Nexconn token issuing. The App Secret stays on the server.
function anywayApi(env: Record<string, string>): Plugin {
  return {
    name: 'anyway-api',
    configureServer(server) {
      server.middlewares.use(createApi(env))
    },
    configurePreviewServer(server) {
      server.middlewares.use(createApi(env))
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [react(), anywayApi(env)],
    server: { watch: { ignored: ['**/data/**'] } },
  }
})
