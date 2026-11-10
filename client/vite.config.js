import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    // the client talks to webcam_demo.py on :8000; proxied so the page
    // can keep webcam.html's location.host logic in dev and prod
    proxy: { '/ws': { target: 'ws://localhost:8000', ws: true } },
  },
})
