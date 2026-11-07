import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    // three + R3F + postprocessing is ~1MB raw by design
    chunkSizeWarningLimit: 1200,
  },
})
