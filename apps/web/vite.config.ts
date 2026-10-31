import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { defineConfig } from 'vitest/config';

// The light theme's background (src/styles/index.css).
const BG = '#f5ead8';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // Installable app with an offline app shell (NFR-03). The service worker caches the
    // built files only; data still comes from Supabase. A new version waits until the user
    // chooses to reload (UpdateBanner), so an open form is never reloaded away.
    VitePWA({
      registerType: 'prompt',
      // Registered from UpdateBanner; the plugin's inline script would break the CSP.
      injectRegister: false,
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'POS',
        short_name: 'POS',
        description: 'Point of sale and inventory',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'any',
        background_color: BG,
        theme_color: BG,
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,woff2,svg,png}'],
        // Every route is the single-page app (Cloudflare Pages does the same online).
        navigateFallback: '/index.html',
        cleanupOutdatedCaches: true,
        // The main bundle is over Workbox's 2 MiB default once the app grows.
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
    }),
  ],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    // No source maps in production bundles.
    sourcemap: false,
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    // Placeholders so modules that read the config can load. No test talks to a server.
    env: {
      VITE_SUPABASE_URL: 'http://127.0.0.1:54321',
      VITE_SUPABASE_ANON_KEY: 'test-anon-key',
    },
  },
});
