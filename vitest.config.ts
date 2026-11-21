import { defineConfig } from 'vitest/config'

// Unit and API tests (no browser needed). The server tests run the real API on a temporary database file.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 20000,
  },
})
