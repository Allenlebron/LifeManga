# LifeManga Worker · 边缘后端

Cloudflare Worker + Durable Object，给 LifeManga Web 前端做后端。**核心价值**：把 90~300 秒的 OpenAI / SiliconFlow 长任务在无状态的边缘环境里跑活。

production: https://lifemanga-worker.myzwilpan.workers.dev

---

## 它解决什么问题

Web 浏览器里直接调 OpenAI 有三个硬障碍：

1. **API Key 暴露**：BYOK 放浏览器代码里就是给所有 JS 看
2. **CORS**：OpenAI 没开放给浏览器跨域
3. **长任务**：gpt-image-2 单图 30~300 秒，浏览器关 tab / 锁屏 / 切 App 就丢请求

Worker 把上面三件事一次解决：
- Worker 转发请求，key 只过 server side（不存 disk）
- CORS 白名单 pin 到前端域名
- 用 Durable Object alarm() 把 OpenAI 调用扔后台跑，前端只负责轮询拿状态

---

## 路由

| Method | Path | 说明 |
|---|---|---|
| `OPTIONS` | `*` | CORS preflight, 204 + Allow-Origin |
| `POST` | `/jobs` | 提交图像生成任务（multipart）, 立刻返回 `{id, status: pending}` |
| `GET` | `/jobs/:id` | 拿任务状态 (sanitized JSON, 含 elapsedSeconds 等) |
| `GET` | `/jobs/:id/output/:idx` | 拿生成结果图二进制 (image/png) |
| `POST` | `/story` | 故事编剧 (vision chat, 同步 5~30s 返回 JSON) |

`POST /jobs` multipart 字段：

```
provider     openai | siliconflow | freemodel  (默认 siliconflow)
baseUrl      可选, 覆盖 provider 默认 base URL
model        默认按 provider 不同 (gpt-image-2 / Qwen/Qwen-Image-Edit)
prompt       完整 prompt (前端拼好 effectivePrompt 后传)
n            1~10
size         "auto" / "1024x1024" / "1024x1536" / "1536x1024"
quality      仅 OpenAI: "low" | "medium" | "high"
image[]      1~10 张图 (binary, multipart File)
```

`POST /story` multipart 字段：

```
provider, baseUrl     同上
scriptModel           vision-capable model (gpt-4o-mini / Qwen/Qwen2.5-VL-72B-Instruct)
systemPrompt          system message, 前端 buildStoryPrompts 拼好
userText              user message, 前端 buildStoryPrompts 拼好
image[]               1~5 张参考图
```

返回 `{script: MangaStoryScript}` 或 `{error, errorCategory}`。

---

## bindings (wrangler.toml)

| 类型 | 名称 | 用途 |
|---|---|---|
| Durable Object | `JOBS` (class JobRunner) | 一个 jobId 一个实例, 持有 alarm + 输出图分片 |
| Vars | `ALLOWED_ORIGIN` | CORS 白名单, 逗号分隔 |

新版 SQLite-backed DO（`new_sqlite_classes = ["JobRunner"]`），不是旧版 KV-backed。

---

## 长任务架构

```
client POST /jobs     ┌─────────────┐ stub.fetch /start
   │  multipart       │ Worker      │  ──────────────────┐
   │  ──────────────▶ │ index.ts    │                    │
   │ 0ms              │ + CORS      │                    ▼
   │                  │ + multipart │              ┌─────────────┐
   │                  │ parse       │              │ Durable Obj │
   │                  └─────────────┘              │ JobRunner   │
   │ ◀─{id, pending}                               │             │
   │ sub-second                                    │ /start:     │
   │                                               │  写 state   │
   │                                               │  排 alarm   │
   │                                               │  (100 ms)   │
   │                                               │             │
   │                                               │ alarm():    │
   │                                               │  调 OpenAI  │
   │                                               │  90~300s    │
   │                                               │  分片存 img │
   │                                               │  排 cleanup │
   │                                               │  (24h)      │
   │                                               │             │
   │ poll GET /jobs/:id (每 4s)                     │             │
   │ ◀──────────── {status:running, elapsed:42s}   │             │
   │ ◀──────────── {status:done, outputCount:1}    │             │
   │                                               │             │
   │ GET /jobs/:id/output/0                        │ /output/0:  │
   │ ◀──── image/png 重组分片 ────────────────────  │  读 chunks  │
   │                                               │             │
   │ ... 24h 后 cleanup alarm 触发                 │  deleteAll()│
   │                                               └─────────────┘
```

**关键不变量**：
- alarm() 跟 client HTTP 连接完全独立。客户端关浏览器、刷新、断网、锁屏，alarm 在边缘照样跑
- alarm() 重入（DO 实例驱逐重建）：用 startedAt > 600s 判定是否 stuck
- 不自动重试。失败转 failed，让用户决定。**为什么**：gpt-image-2 是长 GPU 任务，超时后无法判断 OpenAI 端是否还在跑，自动重试有重复扣费风险（跟 iOS 端策略一致）

---

## 错误分类

`worker/src/errorCategory.ts` 把 ProviderError 按 status + 关键词分到 8 类，存进 state.errorCategory，前端 `web/src/utils/errorMessages.ts` 按类别显示不同友好文案：

| Category | 触发 | 用户文案 |
|---|---|---|
| `auth` | HTTP 401 | API Key 无效 |
| `org_verify` | HTTP 403 + verify/organization | OpenAI 需要组织验证 |
| `quota` | HTTP 429 / quota / billing | Provider 配额耗尽 |
| `safety` | HTTP 400 + safety/moderation | 内容安全系统拒绝 |
| `server` | HTTP 5xx (非网关) | Provider 服务器内部错误 |
| `gateway` | 502/503/504/524 | 网关错误 |
| `timeout` | wallclock 截止 | 任务超时 |
| `unknown` | 其它 | 通用 |

---

## 跑起来

### 本地 dev

```bash
cd worker
npm install
npm run dev    # wrangler dev, 监听 localhost:8787
```

⚠️ wrangler 本地 dev DO 跟 prod 不通用 storage（隔离的）。第一次本地需要：

```bash
npx wrangler login    # 浏览器 OAuth 一次
```

在前端 `lifemanga-web` 的设置 → 高级 → Worker URL 覆盖填 `http://localhost:8787`，用本地后端调试。

### 手动部署

```bash
cd worker
npm run deploy    # = wrangler deploy
```

或者用 GitHub Actions 自动部署（push 到 main 触发，见仓库 `.github/workflows/deploy-worker.yml`）。

### 看运行时日志

```bash
cd worker
npm run tail
```

或者去 dashboard → Workers & Pages → lifemanga-worker → Logs（observability 已经在 wrangler.toml 启了）。

---

## 加新 Provider

iOS 端的 SiliconFlow / FreeModel 协议是 OpenAI 兼容的，所以跨 provider 我们走两类实现：

1. **OpenAI 派** (`/v1/images/edits`, multipart) — `src/providers/openai.ts`
2. **SF/FM 派** (`/v1/images/generations`, JSON) — `src/providers/siliconflow.ts`

加新 provider 步骤：

- 如果 API 跟某一派兼容（OpenAI 或 SF），最快：把 base URL 加到 `PROVIDER_DEFAULT_BASE_URL` 然后 dispatch 路由到对应实现
- 如果协议不一样：写新文件 `src/providers/<name>.ts`，在 `src/providers/index.ts` 的 `callProvider()` 里 dispatch
- types.ts 的 `Provider` union 加新值
- web 的 `src/models/JobOptions.ts` 加默认配置

如果只是换 OpenAI 兼容反代（比如 api2d）：
- 不改代码
- 在前端设置 → 高级 → Provider Base URL 覆盖填新地址，前端会把 `baseUrl` 字段一路传到 Worker，Worker 优先用它而不是默认

---

## 安全考量（学习项目语境）

- BYOK 走 `Authorization: Bearer ...` header，不进 URL 不存 disk
- DO 完成/失败时 storage 里的 apiKey 字段被清掉
- 但 alarm 跑期间 (启动后到完成前的 90~300s) key 在 DO storage 里
- CORS Allow-Origin pin 到 `lifemanga-web.pages.dev` + `localhost:5173`
- 不做 rate limit (学习项目假设作者本人就是用户)
- baseUrl 字段无 allowlist (学习项目 trust 自己, 通用化时要加)

生产化要做的：
- Rate limit per IP / 每用户 quota
- BYOK 不入 storage，仅 in-memory 持有
- baseUrl allowlist

---

## License

MIT
