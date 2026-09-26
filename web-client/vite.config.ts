import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Deploy base path. GitHub Pages project sites live under `/<repo>/`, so CI
// sets BASE_PATH=/TheFury/. Local dev/preview keep '/'.
const base = process.env.BASE_PATH || '/'

/**
 * GitHub Pages has no SPA rewrites: a deep link such as /TheFury/leaderboard
 * only rendered via the 404.html copy of the app, i.e. with an HTTP 404 (logged
 * in the console, and hit by every hard reload and by the PWA start_url). Emit
 * the app shell at every static route instead (`leaderboard.html` +
 * `leaderboard/index.html`) so those URLs are real 200 pages. Routes are read
 * from App.tsx so the list cannot drift; 404.html stays as the fallback for
 * anything else.
 */
function staticRouteShells(): Plugin {
  let outDir = 'dist'
  return {
    name: 'campusforge-static-route-shells',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir
    },
    closeBundle() {
      const app = readFileSync(join(__dirname, 'src/App.tsx'), 'utf8')
      const routes = [...app.matchAll(/<Route\s+path="(\/[^"]+)"/g)]
        .map((m) => m[1].replace(/^\/+|\/+$/g, ''))
        .filter((r) => r && !/[:*]/.test(r))
      const shell = readFileSync(join(outDir, 'index.html'), 'utf8')
      for (const route of routes) {
        for (const file of [`${route}.html`, `${route}/index.html`]) {
          const target = join(outDir, file)
          mkdirSync(dirname(target), { recursive: true })
          writeFileSync(target, shell)
        }
      }
      console.log(`static route shells: ${routes.join(', ')}`)
    },
  }
}

export default defineConfig({
  base,
  plugins: [
    react(),
    staticRouteShells(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/icon-192.png', 'icons/icon-512.png'],
      manifest: {
        name: 'The Fury · IGDA IIITD',
        short_name: 'The Fury',
        description: 'The Fury: IGDA IIITD campus collectible card game',
        theme_color: '#b3202b',
        background_color: '#eadcc5',
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
      },
      devOptions: { enabled: false },
    }),
  ],
  server: {
    // Supabase and the battle engine are called cross-origin; no dev proxy.
    port: 17170,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.{test,spec}.{js,ts,tsx}'],
  },
})
