import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    // the live camera demo talks to webcam_demo.py on :8000, and the auth
    // api runs on :8001; proxied so the page keeps location.host logic
    proxy: {
      '/ws': { target: 'ws://localhost:8000', ws: true },
      '/api': { target: 'http://localhost:8001' },
    },
  },
  test: {
    environment: 'jsdom',
  },
})
