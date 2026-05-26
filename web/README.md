# LifeManga Web · 漫画人生 网页版

iOS 同源的 PWA。把生活照转成日式漫画，**浏览器里能跑、能加到 iPhone 主屏幕**、不依赖任何 native SDK。

production: https://lifemanga-web.pages.dev/

---

## 它解决的什么问题

iOS 端是个原生 App，朋友没 iPhone 装不了、国内用户不开发者证书也别想跑。Web 版一个 URL 谁都能用，**核心功能跟 iOS 端 1:1**：

- 选 1-5 张参考图 + 选风格（8 种漫画风格，9 种角色风格）
- 颜色 / 黑白切换
- BYOK（用户自己的 OpenAI / SiliconFlow / FreeModel key）
- **故事模式**：GPT vision 看图自动写多格剧本（标题 + 简介 + 每格台词与画面），你可以编辑后再画
- **角色库**：真人照 → 漫画角色设定稿（含动作合集，31 个 pose 多选）
- **角色 ↔ 创作打通**：把角色作为参考图载入，AI 编剧会知道主角是谁
- 生成结果存浏览器 (IndexedDB) + 可下载 + 可加收藏 + 可删除

---

## 跑起来

### 本地开发

```bash
cd web
npm install
npm run dev
```

打开 `http://localhost:5173/`。

注意：本地需要后端 Worker（`/jobs` 和 `/story` 路由）能访问。两条路：

1. **用线上 prod Worker**（默认）— 啥都不用改，前端直接打 `https://lifemanga-worker.myzwilpan.workers.dev`
2. **跑本地 Worker** — `cd worker && npm run dev`，然后在前端 → 设置 → 高级 → Worker URL 覆盖填 `http://localhost:8787`

### 手动部署到 Cloudflare Pages

```bash
cd web
npm run build
npx wrangler pages deploy dist --project-name=lifemanga-web --branch=main
```

第一次需要 `npx wrangler login`（浏览器 OAuth 一次）。

> 这套手动流程已经被 GitHub Actions 替代了，见仓库根 `.github/workflows/deploy-web.yml`。push 到 main 自动部署。

---

## 技术栈

| 层 | 技术 |
|---|---|
| 框架 | Vue 3 + `<script setup>` + TypeScript |
| 构建 | Vite 8 |
| 样式 | Tailwind CSS 4 (CSS-first @theme, 暗色) |
| 路由 | vue-router 4 (HTML5 history) |
| 状态 | pinia (准备用，目前主要 ref+组件内) |
| 持久化 | dexie.js (IndexedDB wrapper) |
| 图片压缩 | browser-image-compression |
| PWA | vite-plugin-pwa + Workbox (offline 看历史) |
| 后端 | Cloudflare Worker + Durable Object (见 `worker/`) |
| AI Provider | OpenAI / SiliconFlow / FreeModel (BYOK) |

总 bundle: ~115 KB gzip (含全部依赖)，PWA precache 11 entries / ~370 KB。

---

## 架构图

```
                       ┌──────────────────────────────────┐
   浏览器 (PWA)         │ Vue 3 + Tailwind + IndexedDB     │
   user 在 lifemanga    │ 本地存: 工程/作品/角色/图 Blob   │
   -web.pages.dev       └──────────────┬───────────────────┘
                                       │ multipart POST /jobs
                                       │ multipart POST /story
                                       │ Authorization: Bearer <BYOK>
                                       ▼
                       ┌──────────────────────────────────┐
   Cloudflare Worker   │ src/index.ts: 路由 + CORS        │
   lifemanga-worker.   │ src/do.ts: JobRunner DO          │
   myzwilpan.workers   │   ├─ start: 排 alarm 100ms       │
   .dev                │   ├─ alarm(): 调 OpenAI/SF       │
                       │   │  (90~300s 在边缘后台跑)       │
                       │   ├─ 24h cleanup alarm           │
                       │   └─ chunked storage 1.5MB cell  │
                       │ src/providers/                   │
                       │   ├─ openai.ts  (multipart)      │
                       │   ├─ siliconflow.ts (JSON)       │
                       │   └─ chat.ts (vision)            │
                       └──────────────┬───────────────────┘
                                      │ HTTPS multipart / JSON
                                      ▼
                       ┌──────────────────────────────────┐
                       │ OpenAI / SF / FreeModel          │
                       │  /v1/images/edits  (gpt-image-2) │
                       │  /v1/images/generations (Qwen)   │
                       │  /v1/chat/completions (vision)   │
                       └──────────────────────────────────┘
```

**长任务在边缘活下来的核心**：
- 客户端 POST → 服务端 sub-second 返回 jobId
- DO `alarm()` 在边缘后台独立调 OpenAI（不依赖客户端 HTTP 连接）
- 客户端轮询 GET /jobs/:id 拿状态
- 即使关浏览器、刷新、锁屏，DO 在边缘照样跑完
- Active job 持久化在 localStorage，刷新后自动续轮询

---

## 目录结构

```
web/
├── public/
│   ├── _redirects              SPA fallback (Cloudflare Pages)
│   ├── icon-source.svg         PWA 图标源
│   ├── pwa-{64,192,512}.png    生成的图标
│   └── apple-touch-icon-180x180.png
├── src/
│   ├── main.ts                 入口, 装 pinia + router
│   ├── App.vue                 全局背景 + RouterView + BottomTabBar
│   ├── style.css               Tailwind 4 主题 + spinner 动画
│   ├── components/
│   │   ├── BottomTabBar.vue    底部 4 tab (创作/角色/历史/设置)
│   │   └── StyleSwatch.vue     8 风格 SVG 视觉预览
│   ├── models/
│   │   ├── MangaStyle.ts       8 风格 + effectivePrompt + buildRenderPrompt
│   │   ├── CharacterArtStyle.ts 9 角色风格
│   │   ├── CharacterPoses.ts   31 个 pose (5 大类)
│   │   ├── CharacterPrompts.ts 角色设定稿/动作集 prompt
│   │   ├── MangaItem.ts        所有数据模型 (Project/MangaItem/Character/...)
│   │   └── JobOptions.ts       BYOK + 生成参数 + 故事配置 持久化
│   ├── services/
│   │   ├── api.ts              Worker HTTP client (submitJob/pollJob/...)
│   │   └── db.ts               dexie schema v2 + 各种 helper
│   ├── utils/
│   │   └── errorMessages.ts    8 类 errorCategory → 友好文案
│   ├── router/index.ts         4 个路由
│   └── views/
│       ├── HomeView.vue        创作页 (含故事模式 + 角色 picker)
│       ├── CharactersView.vue  角色库 (设定稿/动作集)
│       ├── HistoryView.vue     历史 + 详情 modal
│       └── SettingsView.vue    BYOK + 参数 + 数据
├── pwa-assets.config.ts        PWA 图标生成器配置
├── vite.config.ts              Vite + Tailwind + VitePWA
├── tsconfig.json
└── package.json
```

---

## 用户数据 / 隐私

所有数据**仅存在本机浏览器**：

- BYOK API Key: `localStorage.lifemanga.api_key.<provider>`
- 工程 / 作品 / 角色 / 图片 Blob: IndexedDB `LifeMangaDB` (dexie)
- 后端 Worker **不持久化任何用户数据**，DO storage 在任务完成后 24 小时自动 deleteAll

唯一会经过第三方的：
- 你提交的图 + prompt 会发到 Worker → 转发到你选的 Provider (OpenAI/SF/FM)
- Provider 是否 retain 数据看他们的政策

---

## 添加新的漫画风格

打开 `src/models/MangaStyle.ts`：

1. `MangaStyleId` type union 加一个 id（如 `'cyberpunk'`）
2. `MANGA_STYLES` 常量里加一项，填 displayName / subtitle / swatchClass / basePrompt / allowsDenseInk
3. `src/components/StyleSwatch.vue` 加对应 `<g v-else-if="style === 'cyberpunk'">` 内联 SVG 视觉预览

UI（HomeView 风格九宫格、HistoryView 缩略图 fallback）自动出现新风格。

---

## 跑 GitHub Actions 自动部署需要的 secret

仓库根 `README.md` 有完整指南。简短版：

1. https://dash.cloudflare.com → My Profile → API Tokens → Create Token (用 "Edit Cloudflare Workers" template)
2. 复制 token 到 GitHub repo Settings → Secrets and variables → Actions → New repository secret，名字 `CLOUDFLARE_API_TOKEN`
3. 同样把 Account ID（dashboard 右栏）存为 `CLOUDFLARE_ACCOUNT_ID`
4. push 一次 main 就触发部署

---

## License

MIT，跟 iOS 端一致。`web/` 跟 `worker/` 都开源，随便 fork 改商用。
