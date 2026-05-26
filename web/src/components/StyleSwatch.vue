<script setup lang="ts">
// 8 种风格的内联 SVG 预览。
// 跟 iOS 端 StylePreviewIcon (SwiftUI Canvas) 视觉语义对齐：
// 每个风格的预览不只是颜色块，而是一个能"看一眼就明白调子"的微型构图。
//
// 用 SVG 而不是位图：
// - 完全矢量, 任意 DPR 都清晰
// - 总体几 KB, 全装进 JS bundle 不影响包大小
// - 主题色变了直接改 CSS variable 就行
import type { MangaStyleId } from '../models/MangaStyle'

defineProps<{ style: MangaStyleId }>()
</script>

<template>
  <!-- 共用尺寸: 1.6:1 比例的预览框, 高度由父组件 className 控制 -->
  <svg viewBox="0 0 80 50" preserveAspectRatio="xMidYMid slice" class="block h-full w-full">

    <!-- shonenJump: 白底 + 放射速度线 -->
    <g v-if="style === 'shonenJump'">
      <rect width="80" height="50" fill="#fff" />
      <g stroke="#0d0c14" stroke-width="0.5" stroke-linecap="round">
        <line v-for="(deg, i) in [10, 22, 34, 46, 58, 70, 82, 94]" :key="i"
          x1="20" y1="60"
          :x2="20 + 80 * Math.cos(-deg * Math.PI / 180)"
          :y2="60 + 80 * Math.sin(-deg * Math.PI / 180)"
        />
      </g>
      <!-- 中心闪点 -->
      <circle cx="55" cy="20" r="2" fill="#0d0c14" />
      <circle cx="58" cy="14" r="1" fill="#0d0c14" />
    </g>

    <!-- sliceOfLife: 粉橘渐变 + 漂浮云 -->
    <g v-else-if="style === 'sliceOfLife'">
      <defs>
        <linearGradient :id="'sof-' + style" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#ffe1e8" />
          <stop offset="100%" stop-color="#fff4d6" />
        </linearGradient>
      </defs>
      <rect width="80" height="50" :fill="`url(#sof-${style})`" />
      <!-- 软云 -->
      <ellipse cx="55" cy="14" rx="8" ry="3" fill="#fff" opacity="0.85" />
      <ellipse cx="62" cy="12" rx="6" ry="2.5" fill="#fff" opacity="0.7" />
      <!-- 小心形 -->
      <path d="M18 32 Q15 28 18 26 Q21 28 18 32 Z M18 32 Q21 28 24 26 Q21 28 18 32 Z" fill="#ff8aa3" opacity="0.8" />
    </g>

    <!-- darkSeinen: 黑底 + 斜光 -->
    <g v-else-if="style === 'darkSeinen'">
      <rect width="80" height="50" fill="#0d0c14" />
      <defs>
        <linearGradient :id="'ds-' + style" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="20%" stop-color="#fff" stop-opacity="0" />
          <stop offset="50%" stop-color="#fff" stop-opacity="0.3" />
          <stop offset="80%" stop-color="#fff" stop-opacity="0" />
        </linearGradient>
      </defs>
      <polygon points="0,50 80,0 80,15 25,50" :fill="`url(#ds-${style})`" />
      <!-- 黑色块对比 -->
      <rect x="50" y="30" width="30" height="20" fill="#0d0c14" />
    </g>

    <!-- retroGekiga: 米黄+横纹 -->
    <g v-else-if="style === 'retroGekiga'">
      <rect width="80" height="50" fill="#f5edcc" />
      <g stroke="#a47d2e" stroke-width="0.4" opacity="0.4">
        <line v-for="(y, i) in [8, 16, 24, 32, 40]" :key="i" :x1="0" :y1="y" :x2="80" :y2="y" />
      </g>
      <!-- 装饰小斑点 -->
      <circle cx="65" cy="38" r="1" fill="#a47d2e" opacity="0.5" />
      <circle cx="20" cy="12" r="0.8" fill="#a47d2e" opacity="0.4" />
    </g>

    <!-- chibi4Koma: 粉点阵 + 心形 -->
    <g v-else-if="style === 'chibi4Koma'">
      <rect width="80" height="50" fill="#ffe5ed" />
      <g fill="#ff8aa3" opacity="0.5">
        <circle v-for="i in 24" :key="i"
          :cx="(i % 8) * 10 + 5"
          :cy="Math.floor(i / 8) * 12 + 6"
          r="1.2"
        />
      </g>
      <!-- 大心 -->
      <path d="M40 28 L36 24 Q33 21 36 18 Q40 18 40 22 Q40 18 44 18 Q47 21 44 24 Z"
        fill="#ff5c7a" opacity="0.85" />
    </g>

    <!-- sportsHotBlooded: 橙红渐变 + 斜速度线 -->
    <g v-else-if="style === 'sportsHotBlooded'">
      <defs>
        <linearGradient :id="'spt-' + style" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#ff8c2e" />
          <stop offset="100%" stop-color="#ff2e4f" />
        </linearGradient>
      </defs>
      <rect width="80" height="50" :fill="`url(#spt-${style})`" />
      <g stroke="#fff" stroke-width="1.2" opacity="0.4" stroke-linecap="round">
        <line x1="-10" y1="55" x2="55" y2="-5" />
        <line x1="0" y1="55" x2="65" y2="-5" />
        <line x1="10" y1="55" x2="75" y2="-5" />
      </g>
    </g>

    <!-- scifiMecha: 深蓝 + 几何线条 -->
    <g v-else-if="style === 'scifiMecha'">
      <defs>
        <linearGradient :id="'sm-' + style" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#1e2956" />
          <stop offset="100%" stop-color="#0a0e2a" />
        </linearGradient>
      </defs>
      <rect width="80" height="50" :fill="`url(#sm-${style})`" />
      <!-- 电路/几何线 -->
      <polyline points="0,32 28,32 36,24 80,24" stroke="#42d6ff" stroke-width="0.7" fill="none" opacity="0.85" />
      <polyline points="50,50 50,40 56,34 80,34" stroke="#42d6ff" stroke-width="0.5" fill="none" opacity="0.6" />
      <circle cx="36" cy="24" r="1.4" fill="#42d6ff" opacity="0.9" />
      <circle cx="56" cy="34" r="1" fill="#42d6ff" opacity="0.7" />
    </g>

    <!-- horrorJunjiIto: 灰黑 + 散光 -->
    <g v-else-if="style === 'horrorJunjiIto'">
      <defs>
        <linearGradient :id="'hji-' + style" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#4a4856" />
          <stop offset="100%" stop-color="#0d0c14" />
        </linearGradient>
        <radialGradient :id="'hji-light-' + style" cx="80%" cy="20%" r="60%">
          <stop offset="0%" stop-color="#fff" stop-opacity="0.4" />
          <stop offset="100%" stop-color="#fff" stop-opacity="0" />
        </radialGradient>
      </defs>
      <rect width="80" height="50" :fill="`url(#hji-${style})`" />
      <rect width="80" height="50" :fill="`url(#hji-light-${style})`" />
      <!-- 黑色剪影 -->
      <polygon points="0,50 18,30 30,50" fill="#0d0c14" opacity="0.85" />
    </g>

    <!-- fallback -->
    <g v-else>
      <rect width="80" height="50" fill="#1a1822" />
    </g>
  </svg>
</template>
