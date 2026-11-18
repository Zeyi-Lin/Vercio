# Vercio 技术文档

这套文档写给**要改 Vercio 代码的人**，尤其是 AI Coding agent。根目录 [README.md](../README.md) 讲“怎么用 Vercio”，这里讲“Vercio 内部怎么运转、改一处要动哪些文件、改完怎么验证”。AI agent 的入口是根目录 [AGENTS.md](../AGENTS.md)。

> 基准：`package.json` v0.1.0，2026-11-18 工作树（含系统文件夹选择器与预览失败日志增强）。
> 代码是唯一事实来源。文档里的函数名、文件路径、字段名优先于行号；不要相信任何过期的行号。

## 先读什么

| 你的身份 | 建议顺序 |
| --- | --- |
| AI Coding agent（第一次接手） | [ai-coding.md](ai-coding.md) → [architecture.md](architecture.md) → 对应领域文档 → [api.md](api.md) / [data-model.md](data-model.md) 查表 |
| 新加入的人类工程师 | [architecture.md](architecture.md) → [development.md](development.md) → [frontend.md](frontend.md) 或 [backend.md](backend.md) |
| 只调 API / 写集成 | [api.md](api.md) → [data-model.md](data-model.md) |
| 排查线上/本地故障 | [development.md](development.md) 的调试与故障表 → [architecture.md](architecture.md) 的部署流水线 |

## 文档地图

| 文档 | 内容 | 什么时候读 |
| --- | --- | --- |
| [architecture.md](architecture.md) | 运行拓扑、进程/端口、请求管线、部署状态机、依赖缓存、SSE、安全边界、**关键不变量**、已知技术债 | 理解全局或做跨层改动前 |
| [backend.md](backend.md) | `server/` 每个模块的职责、核心类方法、Git/框架/端口/静态服务细节、服务端扩展点 | 改 API、部署引擎、Git、导入、数据持久化 |
| [api.md](api.md) | HTTP API 与 SSE 的完整契约：请求、响应、状态码、错误、字段、curl 示例 | 改接口、写脚本、对齐前后端 |
| [frontend.md](frontend.md) | React 结构、Provider、路由、数据流、页面/组件地图、i18n、主题、CSS、iframe 细节 | 改界面、交互、样式、前端数据获取 |
| [data-model.md](data-model.md) | `db.json` schema、实体字段、DTO 投影、`.vercio/` 目录、排序/限额、删除语义、迁移 | 加字段、排查数据、改持久化 |
| [development.md](development.md) | 环境、命令、测试架构、curl 验证、调试 recipe、代码约定、故障排查 | 本地跑起来、写测试、提交前 |
| [ai-coding.md](ai-coding.md) | 改动地图、13 个典型任务配方、验证协议、15 个高频坑、Do Not、Done 清单 | **动第一行代码之前** |

## 30 秒掌握

- **是什么**：本地优先的前端分支预览器。给定 Git 仓库，每个分支检出到独立 `git worktree`，起 dev server 或静态服务器，浏览器里一键切换/并排对比，并通过局域网分享。
- **技术栈**：Node.js ESM（`server/`，无 Web 框架，唯一外部依赖 `qrcode`）+ React 19 / TypeScript / Vite（`web/`）+ `node:test` 集成测试。
- **进程模型**：一个主 HTTP 服务（默认 `0.0.0.0:4000`）托管 SPA、API、SSE 和 `/preview/*` 重定向；每个就绪预览另起一个 dev server 子进程，或一个主进程内的静态监听器，占用 `4100–4999` 中的一个端口并绑定 `0.0.0.0`。
- **稳定预览 URL**：`/preview/<deploymentId>/<path>` 由主服务 302 到 `http://<请求的 Host>:<预览端口>/<path>`，保留路径；因此绝对路径资源、Vite HMR、静态构建产物都能工作。
- **数据**：全部在本机 `.vercio/`（`db.json`、`repos/`、`worktrees/`、`deps/`、`logs/`）。没有数据库、没有云、没有登录。
- **本地项目选择**：点「浏览」优先在**运行 Vercio 的机器**上弹出系统文件夹窗口；无图形界面/无对话框工具（5xx，504 超时除外）时回退到页面内目录浏览。
- **核心状态机**：`queued → preparing → [installing] → starting → ready`，任意阶段可失败为 `error`，运行中的可被 `stopped`；静态预览跳过 `installing/starting`（`preparing → ready`）。
- **安全模型**：只面向本机与可信局域网。无鉴权、无 CSRF、无 TLS；预览会执行仓库里的代码。不要暴露公网。
- **常用命令**：`npm run dev`（API 4000 + Vite 5173）、`npm run build && npm start`（生产单服务）、`npm test`、`npm run typecheck`。

## 术语表

| 术语 | 含义 | 代码位置 |
| --- | --- | --- |
| Project | 一个被接入的 Git 仓库 + 产品空间（brief、notes、comments） | `ProjectsManager`，`state.projects` |
| Branch | 仓库里的分支，UI 上的预览入口 | `git.listBranches()` |
| Deployment | 一次“把某分支某 commit 跑起来”的尝试，有独立 id/端口/worktree/日志 | `DeploymentManager`，`state.deployments` |
| Preview | 就绪的 deployment 对外呈现；通过 `/preview/<dpl_id>/` 访问 | `routes.js` + 预览端口 |
| Production branch | 仓库默认分支（`origin/HEAD` 优先），UI 标记为 prod；diff 的基线 | `getDefaultBranch()` |
| Worktree | 某 commit 的隔离检出目录，位于 `worktrees/<projectId>/<branchSlug>-<sha8>` | `git.addWorktree()` |
| mode | 预览方式：`auto` / `server` / `static`；`requestedMode` 是请求值，`mode` 是解析后的值 | `DeploymentManager.create/run` |
| fingerprint | `package.json + lockfile` 的 sha256 前 16 位，用于依赖缓存 | `frameworks.dependencyFingerprint()` |
| Data dir | 运行数据根目录，默认 `<repo>/.vercio` | `config.resolveConfig()` |

## 代码地图

```text
Vercio/
├── server/                 # Node ESM 服务端（无框架）
│   ├── index.js            # 组合根 createVercioApp / startServer / CLI / 优雅退出
│   ├── routes.js           # 单函数请求处理器：预览重定向、SPA、全部 API
│   └── lib/
│       ├── deployments.js  # 部署引擎：worktree、依赖、进程、端口、日志
│       ├── projects.js     # 项目导入/刷新/删除、demo 项目
│       ├── git.js          # git 命令封装、分支解析、diff
│       ├── frameworks.js   # 框架/包管理器识别、dev 命令
│       ├── ports.js        # 预览端口分配与探测
│       ├── http.js         # HttpError、JSON、静态文件/目录
│       ├── browse.js       # 页内目录浏览（只返回目录）
│       ├── folder-dialog.js # 系统文件夹窗口（macOS/Windows/Linux）
│       ├── lan.js          # 局域网地址、Wi-Fi 名、二维码
│       ├── demo.js         # 从 examples/demo 生成 Lumen 仓库
│       ├── store.js        # JSON 原子持久化
│       ├── events.js       # SSE 事件中心
│       ├── config.js       # 配置/目录/版本
│       └── ids.js          # 带前缀随机 id
├── web/                    # React 19 + TypeScript + Vite
│   └── src/
│       ├── App.tsx         # Provider 组合 + 路由 + 全局快捷键 + 模态框
│       ├── main.tsx        # 入口：字体、CSS、ReactDOM
│       ├── pages/          # Dashboard / ProjectPage 及 4 个 tab 页
│       ├── components/     # 预览、分支、讨论、命令面板、UI 原子组件
│       ├── context/        # AppContext：全局数据 + SSE 扇出
│       ├── lib/            # api / router / hooks / types / format / markdown
│       ├── i18n/           # en/zh 字典、Provider、t()
│       ├── theme/          # light/dark Provider
│       └── styles/         # base / components / pages / theme-light
├── examples/demo/          # Lumen 演示站点：4 个分支快照 + 零依赖 dev server
├── tests/                  # node:test 集成/单元测试（真实进程、临时数据目录）
├── scripts/                # dev 编排、seed-demo
├── docs/                   # 本技术文档 + README 截图
└── dist/                   # vite build 产物（gitignore）
```

## 文档维护约定

1. **符号名优先**：用 `DeploymentManager.create()`、`toPublic`、`state.deployments` 这样可搜索的名字，不写易腐烂的行号。
2. **改动即同步**：[ai-coding.md](ai-coding.md) 末尾有一张“代码改动 → 需同步文档”的表；提交功能改动时按表更新。
3. **不要复制实现**：文档只描述契约、流程、不变量和落点；具体代码以源文件为准。
4. **过期判定**：如果文档与代码冲突，先信代码，再修文档；修完在 PR/提交说明里标注 `docs:`。
5. **语言**：文档用中文，标识符、API、字段名保持英文原名，避免翻译造成检索困难。
