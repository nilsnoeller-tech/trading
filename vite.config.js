import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  base: '/ncapital-app/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/icon-192.png', 'icons/icon-512.png'],
      manifest: {
        name: 'N-Capital Trading Journal',
        short_name: 'N-Capital',
        description: 'Trade-Bewertung, Journal & Performance-Tracking',
        theme_color: '#6C5CE7',
        background_color: '#0A0D11',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/ncapital-app/',
        scope: '/ncapital-app/',
        icons: [
          { src: '/ncapital-app/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/ncapital-app/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/ncapital-app/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/api\.frankfurter\.(app|dev)\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'fx-api',
              expiration: { maxEntries: 10, maxAgeSeconds: 86400 },
            },
          },
          {
            urlPattern: /^https:\/\/ncapital-market-proxy\..*\.workers\.dev\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'market-data-api',
              expiration: { maxEntries: 50, maxAgeSeconds: 14400 }, // 4h
            },
          },
          {
            urlPattern: /^https:\/\/finviz\.com\/chart\.ashx\?.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'finviz-charts',
              expiration: { maxEntries: 30, maxAgeSeconds: 3600 }, // 1h
            },
          },
        ],
      },
    }),
  ],
})
