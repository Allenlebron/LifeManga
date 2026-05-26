import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config'

// 用 2023 minimal preset (transparent + maskable + apple-touch + favicons)
// 紫色填充背景, iOS 主屏幕图标看着干净
export default defineConfig({
  preset: {
    ...minimal2023Preset,
    apple: {
      ...minimal2023Preset.apple,
      // iOS 不会自己加圆角填充, 紫色作为底色
      padding: 0.0,
      resizeOptions: {
        background: '#7b1ee0',
        fit: 'contain',
      },
    },
  },
  images: ['public/icon-source.svg'],
})
