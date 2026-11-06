import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// 오프라인: 서비스 워커가 앱 껍데기(HTML·JS·CSS)를 미리 저장 → 인터넷 없이 새로고침해도 열림.
// 데이터(/api)는 서비스 워커가 건드리지 않고, 앱이 localStorage 에 마지막 내용을 저장해 먼저 그린다.
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',            // 새 배포가 있으면 다음 열 때 자동 교체 (옛 화면이 남지 않게)
      manifest: {
        name: '여행 노트', short_name: '여행', lang: 'ko', display: 'standalone',
        background_color: '#F6F6F3', theme_color: '#F6F6F3', start_url: '/',
        icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],   // API 는 절대 캐시하지 않음
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          { urlPattern: ({ url }) => url.origin === 'https://fonts.googleapis.com' || url.origin === 'https://fonts.gstatic.com',
            handler: 'CacheFirst', options: { cacheName: 'fonts', expiration: { maxEntries: 60, maxAgeSeconds: 60 * 60 * 24 * 365 }, cacheableResponse: { statuses: [0, 200] } } },
          { urlPattern: ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith('/img/'),
            handler: 'CacheFirst', options: { cacheName: 'img', expiration: { maxEntries: 300 }, cacheableResponse: { statuses: [200] } } },
        ],
      },
    }),
  ],
  server: {
    host: true,
    proxy: { '/api': 'http://localhost:8771' },   // LEDGER_FAKE=1 node dev/server.js 8771
  },
})
