<script setup lang="ts">
import { ref } from 'vue'
import { MANGA_STYLES, type MangaStyleId } from '../models/MangaStyle'

const selectedStyle = ref<MangaStyleId>('shonenJump')
const isColor = ref(true)

function pickStyle(id: MangaStyleId) {
  selectedStyle.value = id
}
</script>

<template>
  <main class="mx-auto max-w-2xl px-5 pt-6 pb-24">
    <header class="mb-6">
      <h1 class="text-2xl font-semibold tracking-tight text-ink-900">创作</h1>
      <p class="mt-1 text-sm text-ink-500">
        选风格 + 上传参考图，几分钟后拿到一张漫画。
      </p>
    </header>

    <!-- 上传占位区 -->
    <section class="mb-8">
      <button
        type="button"
        disabled
        class="flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-ink-100 px-6 py-10 text-ink-300 transition hover:border-accent-500/40 hover:text-ink-500"
      >
        <svg
          class="h-10 w-10"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M3 16.5V19a2 2 0 002 2h14a2 2 0 002-2v-2.5M16 8l-4-4m0 0L8 8m4-4v12" />
        </svg>
        <span class="text-sm">点击拍照 / 选图（Weekend 4 接通）</span>
      </button>
    </section>

    <!-- 颜色模式切换 -->
    <section class="mb-6 flex items-center justify-between">
      <span class="text-sm font-medium text-ink-700">颜色</span>
      <div class="inline-flex rounded-lg border border-ink-100 p-0.5">
        <button
          type="button"
          @click="isColor = true"
          :class="[
            'px-3 py-1 text-xs font-medium transition rounded-md',
            isColor
              ? 'bg-accent-500 text-white'
              : 'text-ink-500 hover:text-ink-900',
          ]"
        >
          彩色
        </button>
        <button
          type="button"
          @click="isColor = false"
          :class="[
            'px-3 py-1 text-xs font-medium transition rounded-md',
            !isColor
              ? 'bg-ink-900 text-white'
              : 'text-ink-500 hover:text-ink-900',
          ]"
        >
          黑白
        </button>
      </div>
    </section>

    <!-- 8 种风格九宫格 -->
    <section>
      <h2 class="mb-3 text-sm font-medium text-ink-700">漫画风格</h2>
      <div class="grid grid-cols-2 gap-3">
        <button
          v-for="s in MANGA_STYLES"
          :key="s.id"
          type="button"
          @click="pickStyle(s.id)"
          :class="[
            'rounded-xl border p-3 text-left transition',
            selectedStyle === s.id
              ? 'border-accent-500 ring-2 ring-accent-500/30'
              : 'border-ink-100 hover:border-ink-300',
          ]"
        >
          <div
            :class="[
              'h-16 w-full rounded-md mb-2 ring-1 ring-inset ring-ink-100/60',
              s.swatchClass,
            ]"
          />
          <div class="text-sm font-medium text-ink-900">
            {{ s.displayName }}
          </div>
          <div class="mt-0.5 line-clamp-2 text-xs text-ink-500">
            {{ s.subtitle }}
          </div>
        </button>
      </div>
    </section>

    <!-- 生成按钮（暂时禁用） -->
    <section class="mt-8">
      <button
        type="button"
        disabled
        class="w-full rounded-xl bg-ink-300 px-6 py-3 text-sm font-medium text-white opacity-60"
      >
        生成漫画（Weekend 4 接通后可点）
      </button>
    </section>
  </main>
</template>
