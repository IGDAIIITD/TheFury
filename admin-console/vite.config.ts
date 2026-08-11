import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 17173,
    proxy: {
      '/api': {
        target: 'http://localhost:17172',
        changeOrigin: true,
      },
    },
  },
})
