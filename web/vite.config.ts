import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    tailwindcss(),
    VitePWA({
      // dev 期不启用，避免 dev hot reload 被 service worker 缓存搅乱
      devOptions: { enabled: false },
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon-180x180.png'],
      manifest: {
        name: '漫画人生 LifeManga',
        short_name: 'LifeManga',
        description: '把生活照转成日式漫画风的 Web 应用',
        lang: 'zh-Hans',
        theme_color: '#aa3bff',
        background_color: '#0f0d1a',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'maskable-icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // 离线兜底：所有 SPA 路由 fallback 到 /index.html
        navigateFallback: '/index.html',
        // 排除 API 调用（Worker 跨域请求不能被 SW 缓存到 history 里，会污染响应）
        navigateFallbackDenylist: [/^\/jobs/, /^\/api/],
        // 运行时缓存：图标和 favicon 这种静态资源
        runtimeCaching: [
          {
            urlPattern: /\/(pwa-|maskable-|apple-touch-|favicon)/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'lifemanga-icons',
              expiration: { maxEntries: 16, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
        ],
      },
    }),
  ],
})
