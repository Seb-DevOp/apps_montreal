import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * Configuration Vite + PWA.
 *
 * Choix structurant : `injectManifest` plutôt que `generateSW`. On a besoin
 * d'un Service Worker écrit à la main (src/sw.ts) pour deux raisons propres à
 * ce projet :
 *   1. `/config.json` ne doit JAMAIS être servi depuis le cache, sinon une
 *      migration GCP laisserait les clients pointés sur l'ancien projet ;
 *   2. les photos Cloud Storage ont une politique de cache dédiée avec
 *      plafond, pour ne pas saturer le stockage du téléphone.
 *
 * `registerType: 'prompt'` : on ne remplace jamais le SW sans l'accord de
 * l'utilisateur — le rechargement silencieux au milieu d'un upload de photo
 * serait pire que le bug qu'il corrige.
 */
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'prompt',
      injectRegister: null, // l'enregistrement est fait par src/lib/pwa.ts
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,woff2,png,svg,webmanifest}'],
        // config.json est volontairement hors du précache.
        globIgnores: ['**/config.json'],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
      },
      devOptions: {
        enabled: false,
        type: 'module',
      },
      manifest: {
        id: '/',
        name: 'Montréal Compagnon',
        short_name: 'Montréal',
        description:
          'Préparation et carnet de voyage à Montréal : check-list, taxes et pourboires, double horloge, spots, météo ressentie et journal photo.',
        lang: 'fr-CA',
        dir: 'ltr',
        start_url: '/?source=pwa',
        scope: '/',
        display: 'standalone',
        display_override: ['standalone', 'minimal-ui'],
        orientation: 'portrait',
        background_color: '#0b1220',
        theme_color: '#0b1220',
        categories: ['travel', 'lifestyle', 'utilities'],
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        shortcuts: [
          { name: 'Calculateur de taxes', short_name: 'Taxes', url: '/taxes?source=shortcut' },
          { name: 'Journal photo', short_name: 'Journal', url: '/journal?source=shortcut' },
          { name: 'Check-list départ', short_name: 'Check-list', url: '/checklist?source=shortcut' },
        ],
      },
    }),
  ],
  build: {
    target: 'es2020',
    sourcemap: false,
    rollupOptions: {
      output: {
        // Sépare le SDK Firebase du code applicatif : il change rarement, le
        // cache long des navigateurs est ainsi bien mieux exploité.
        manualChunks: {
          firebase: ['firebase/app', 'firebase/auth', 'firebase/firestore', 'firebase/storage'],
          vendor: ['react', 'react-dom', 'react-router-dom'],
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      // En dev, l'API tourne en local : on reproduit le rewrite Hosting.
      '/api': { target: 'http://localhost:8080', changeOrigin: true },
    },
  },
});
