/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // where the app is served from: the desk mounts it under /rooms/office/app/ (docs/plan.md 2.1). Vercel builds use that
  // path without needing an env var (the office's own domain strips it with a rewrite, vercel.json); local dev is /.
  // OFFICE_BASE still overrides both.
  base: process.env.OFFICE_BASE || (process.env.VERCEL ? '/rooms/office/app/' : '/'),
  plugins: [react()],
  build: {
    // three + R3F + postprocessing is ~1MB raw by design
    chunkSizeWarningLimit: 1200,
  },
  test: {
    // unit tests never talk to Supabase: a local .env.local must not give them a live client (Node 20 has no
    // WebSocket, so creating one fails at import)
    env: { VITE_SUPABASE_URL: '', VITE_SUPABASE_PUBLISHABLE_KEY: '' },
  },
})
