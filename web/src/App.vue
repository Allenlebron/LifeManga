<script setup lang="ts">
// Weekend 1 占位首页。Weekend 2 会换成带 vue-router 的多 Tab 结构。
const placeholders = [
  { tag: '创作', desc: '拍照 / 选图 → 选风格 → 生成漫画' },
  { tag: '历史', desc: '过去生成的作品全部本地存储 (IndexedDB)' },
  { tag: '设置', desc: '粘贴 OpenAI API Key (BYOK) + 关于' },
]
</script>

<template>
  <main class="mx-auto flex min-h-screen max-w-2xl flex-col px-6 py-10">
    <header class="mb-12">
      <h1 class="text-4xl font-semibold tracking-tight text-ink-900">
        漫画人生 · LifeManga
      </h1>
      <p class="mt-2 text-sm text-ink-500">
        Web 版 v0.0.1 · scaffolding 已就绪
      </p>
    </header>

    <section class="space-y-4">
      <div
        v-for="card in placeholders"
        :key="card.tag"
        class="rounded-xl border border-ink-100 bg-white p-5 transition hover:border-accent-500/50 hover:shadow-md"
      >
        <div class="flex items-center justify-between">
          <span
            class="rounded-md bg-accent-50 px-2 py-0.5 text-xs font-medium text-accent-500"
          >
            {{ card.tag }}
          </span>
          <span class="text-xs text-ink-300">即将到来</span>
        </div>
        <p class="mt-3 text-sm text-ink-700">{{ card.desc }}</p>
      </div>
    </section>

    <footer class="mt-auto pt-12 text-center text-xs text-ink-300">
      iOS 版同源 · MIT · iam567/LifeManga
    </footer>
  </main>
</template>
