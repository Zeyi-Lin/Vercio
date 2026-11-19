# AGENTS.md

Vercio 是一个本地优先的前端分支预览与协作工具：Node ESM 主服务（`server/`）+ React/TypeScript 前端（`web/`）+ `node:test` 集成测试。预览通过每个分支的 `git worktree` 与独立端口（4100–4999）运行，主服务在 `/preview/<deploymentId>/` 做 302 跳转。添加本地项目时优先在服务器机器上打开系统文件夹窗口，不可用时回退页内目录浏览。

## 先读

1. [docs/ai-coding.md](docs/ai-coding.md) — 改动地图、任务配方、验证协议、高频坑、Do Not。
2. [docs/architecture.md](docs/architecture.md) — 运行拓扑、部署状态机、端口/进程、关键不变量。
3. 领域文档：[backend.md](docs/backend.md)、[frontend.md](docs/frontend.md)、[api.md](docs/api.md)、[data-model.md](docs/data-model.md)、[development.md](docs/development.md)。

## 命令

```bash
npm install
npm run dev        # API 4000 + Vite 5173（Vite 代理写死 4000）
npm test           # 集成测试，真启进程/端口，文件串行；通常十几秒到 1 分钟
npm run typecheck  # 只检查 web/src
npm run build      # 生产 dist/
npm start          # 生产单服务 4000
```

## 必须保持的不变量

- 预览 URL `/preview/<id>/<rest>` 必须 302 到预览端口并保留 `<rest>`；不要改成同源代理而不处理 HMR/绝对路径。
- 绝不 checkout/reset/clean 用户工作副本；预览只操作 worktree 与缓存。
- 每个预览端口在成功、失败、停止、关机路径都必须释放；子进程按进程组回收。
- 部署状态字符串同时被 DB、API、SSE、TS 类型、文案、CSS、预览状态页消费；新增状态必须全链路同步。
- `requestedMode` 保留请求值，`mode` 是服务端解析结果；`auto` 只在服务端解析。
- API 只返回 `toPublic()` 显式字段；内部字段（`worktreePath`、`ref`、`staticDir`、`importLog`）不要泄露。
- 所有状态修改走 `store.get()` + `store.markDirty()`；不要直接写 `db.json`。
- SSE 事件名是契约；新增事件同步 `web/src/lib/hooks.ts` 的监听列表。
- 当前**没有鉴权**，只面向可信局域网；不要新增“只有管理员能做”的假设，也不要扩大公网暴露面。
- 服务端保持零框架、唯一运行时依赖 `qrcode`；前端不要引入第二套路由/状态/UI 库。
- 用户可见文案必须同时加 `i18n/dictionary.ts` 的 `en` 与 `zh`；项目内容不翻译。
- 系统文件夹窗口只在**运行 Vercio 的机器**上弹出；请求断开必须 abort，无 GUI 时返回 501 并由前端回退页内浏览。
- 不要提交 `.vercio/`、`dist/`、`node_modules/`、日志。

## 验证

```bash
npm run typecheck
npm test
npm run build            # 改前端时
curl -s localhost:4000/api/health
```

改部署/端口/删除逻辑时额外检查：停止后端口已释放、项目删除后 worktree/deps 已清理、没有残留 detached 进程。仓库没有浏览器 e2e，涉及 UI 的改动需要手工走一遍 demo → 切分支 → compare → 评论 → 设置弹窗 → 停止/重启预览；改「浏览」流程时确认系统窗口与页内回退。

文档与代码冲突时以代码为准，并顺手修文档（`docs:` 标注）。
