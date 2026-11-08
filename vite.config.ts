import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // OFFICE_BASE: where the app is served from (default /; the desk mounts it under /rooms/office/app/, see docs/plan.md 2.1)
  base: process.env.OFFICE_BASE || '/',
  plugins: [react()],
  build: {
    // three + R3F + postprocessing is ~1MB raw by design
    chunkSizeWarningLimit: 1200,
  },
})
