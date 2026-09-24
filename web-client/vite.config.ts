import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Deploy base path. GitHub Pages project sites live under `/<repo>/`, so CI
// sets BASE_PATH=/TheFury/. Local dev/preview and the Deno `serve.mjs` keep '/'.
const base = process.env.BASE_PATH || '/'

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/icon-192.png', 'icons/icon-512.png'],
      manifest: {
        name: 'Campus Forge',
        short_name: 'Campus Forge',
        description: 'Campus-wide collectible MTG game',
        theme_color: '#0f1220',
        background_color: '#0f1220',
        display: 'standalone',
        start_url: 'collection',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/ws\//],
        runtimeCaching: [
          {
            urlPattern: /^\/api\/.*/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'campus-forge-api',
              networkTimeoutSeconds: 5,
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 60 * 60 * 24,
              },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  server: {
    port: 17170,
    proxy: {
      '/api': {
        target: 'http://localhost:17172',
        changeOrigin: true,
      },
      '/card-art': {
        target: 'http://localhost:17172',
        changeOrigin: true,
      },
      '/ws': {
        target: 'http://localhost:17172',
        ws: true,
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.{test,spec}.{js,ts,tsx}'],
  },
})
