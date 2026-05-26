<script setup lang="ts">
// 底部 Tab 导航。三个图标 + 文字。
//
// 用 SVG 内联画图标，避免引第三方图标库。后续 Weekend 5 可以替换成更精致的图标。

const tabs = [
  { to: '/', label: '创作', iconPath: 'M12 4v16m8-8H4' },
  {
    to: '/history',
    label: '历史',
    iconPath:
      'M3 4h18M3 12h18M3 20h18M9 4v16M9 12h6M9 20h6M15 4v16',
  },
  {
    to: '/settings',
    label: '设置',
    iconPath:
      'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065zM15 12a3 3 0 11-6 0 3 3 0 016 0z',
  },
]
</script>

<template>
  <nav
    class="fixed inset-x-0 bottom-0 z-50 border-t border-ink-100 bg-white/95 backdrop-blur"
    style="padding-bottom: env(safe-area-inset-bottom)"
  >
    <ul class="mx-auto flex max-w-2xl">
      <li v-for="t in tabs" :key="t.to" class="flex-1">
        <RouterLink
          :to="t.to"
          class="flex flex-col items-center gap-0.5 py-2 text-xs text-ink-500 transition hover:text-ink-900"
          active-class="!text-accent-500"
          exact-active-class="!text-accent-500"
        >
          <svg
            class="h-6 w-6"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path :d="t.iconPath" />
          </svg>
          {{ t.label }}
        </RouterLink>
      </li>
    </ul>
  </nav>
</template>
