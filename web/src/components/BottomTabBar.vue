<script setup lang="ts">
// 底部 Tab 导航。半透明 + 毛玻璃, iOS-Native 感。
import { useRoute } from 'vue-router'
const route = useRoute()

interface Tab {
  to: string
  label: string
  iconPath: string
}

const tabs: Tab[] = [
  // 创作: 闪电 (动作 / 创意)
  { to: '/', label: '创作', iconPath: 'M13 2L4.5 12.5h6L9 22l8.5-10.5h-6z' },
  // 角色: 人形头像
  { to: '/characters', label: '角色', iconPath: 'M16 14a4 4 0 10-8 0M5 21v-2a4 4 0 014-4h6a4 4 0 014 4v2' },
  // 历史: 时钟
  { to: '/history', label: '历史', iconPath: 'M12 7v5l3 3M21 12a9 9 0 11-18 0 9 9 0 0118 0z' },
  // 设置: 齿轮 (简版 8 齿)
  { to: '/settings', label: '设置', iconPath: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 008 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H2a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V2a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H22a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z' },
]

function isActive(to: string): boolean {
  if (to === '/') return route.path === '/'
  return route.path.startsWith(to)
}
</script>

<template>
  <nav
    class="fixed inset-x-0 bottom-0 z-50 border-t border-white/5 bg-ink-900/70 backdrop-blur-xl"
    style="padding-bottom: env(safe-area-inset-bottom)"
  >
    <ul class="mx-auto flex max-w-2xl">
      <li v-for="t in tabs" :key="t.to" class="flex-1">
        <RouterLink
          :to="t.to"
          class="group flex flex-col items-center gap-1 py-2.5 text-[11px] transition"
          :class="[
            isActive(t.to)
              ? 'text-accent-300'
              : 'text-ink-300 hover:text-ink-100',
          ]"
        >
          <div
            class="relative flex h-7 w-7 items-center justify-center rounded-full transition"
            :class="[isActive(t.to) ? 'bg-accent-500/20' : '']"
          >
            <svg
              class="h-5 w-5 transition"
              :class="[isActive(t.to) ? 'scale-110' : 'group-hover:scale-105']"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path :d="t.iconPath" />
            </svg>
          </div>
          {{ t.label }}
        </RouterLink>
      </li>
    </ul>
  </nav>
</template>
