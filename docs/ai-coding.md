# AI Coding 指南

这份文档是给 **AI Coding agent** 的操作手册：怎么快速定位、改哪些文件、哪些不变量不能破、改完怎么证明没坏。人类工程师也可以按同样流程走。

> 工作方式：先读本页的“不变量”和“改动地图”，再读目标领域的文档；以代码为准，以文档为地图；改完全部按“验证协议”执行。

## 1. 五分钟定向

```text
┌ 浏览器（React SPA，web/）
│   /                 Dashboard
│   /p/:id            分支预览工作区（旧 /overview|/notes|/settings 会重定向）
│   /preview/:dpl/*   302 → 预览端口（41xx）
│
├ 主服务（Node，server/）:4000
│   API + SSE + SPA + 预览重定向
│
├ 每个部署（DeploymentManager）
│   worktree + 可选依赖缓存 + dev server/static server（41xx）
│
└ 数据（.vercio/）
    db.json + repos/ + worktrees/ + deps/ + logs/
```

必知命令：

```bash
npm install
npm run dev          # API 4000 + Vite 5173
npm test             # 集成测试（真进程/真端口）
npm run typecheck
npm run build
```

推荐顺序：本页（任务地图）→ [architecture.md](architecture.md)（不变量与流水线）→ [backend.md](backend.md) / [frontend.md](frontend.md) → [api.md](api.md) / [data-model.md](data-model.md) 查表。

## 2. 不变量（改任何代码前先记住）

完整版见 [architecture.md §12](architecture.md#12-关键不变量)。速记：

1. **预览 URL** `/preview/<dplId>/<rest>` 必须 302 到预览端口并保留 rest；这是可分享的公开契约。
2. **不碰用户工作副本**：所有预览操作只在 worktree/缓存里；对源仓库只允许 fetch / worktree / 只读查询。
3. **端口必须回收**：每个分配路径（成功、失败、停止、顶替、关机）都要释放。
4. **状态全链路**：DB、DTO、TS、UI 文案/样式、SSE、状态页、测试必须同步。
5. **`requestedMode` 与 `mode` 分离**；`auto` 只在服务端解析。
6. **公开字段显式投影**：只通过 `toPublic()` 暴露；内部字段（worktreePath/ref/staticDir/importLog）不要漏。
7. **写状态必须 `markDirty()`**；不要直接写 `db.json`。
8. **SSE 事件名是契约**：新增事件同步前端监听列表。
9. **API 错误统一 JSON** `{error:{status,message,details?}}`。
10. **没有鉴权**：不要新增“只有管理员能做”的假设；加认证是大工程。
11. **前端同源相对路径**：除 Vite 代理外不要硬编码 localhost。
12. **服务端零框架/唯一依赖 qrcode**；前端不引第二套 UI/状态/路由库。
13. **数据目录可迁移**：路径从 `config.dirs` 派生。
14. **预览可执行代码**：任何改动都不能让未授权网络访问变得更容易。
15. **系统对话框**：只在服务器机器上弹；客户端断开必须 abort；错误码 400/500/501/504 不变。

## 3. 改动地图

| 需求关键词 | 主文件 | 必须联动 | 最小验证 |
| --- | --- | --- | --- |
| 新增/修改 API | `server/routes.js` | `web/src/lib/api.ts`、`types.ts`、`docs/api.md`、`tests/api.test.js` | curl + 测试 |
| 新增项目字段 | `server/lib/projects.js`（create/update/toPublic） | `web/src/lib/types.ts`、UI、`docs/data-model.md` | 创建/读取/旧数据 |
| 新增部署字段 | `server/lib/deployments.js`（create/run/follower/toPublic） | `types.ts`、UI、`docs/data-model.md` | 部署全流程 |
| 改实时预览/编辑源 | `server/lib/sources.js`、`deployments.js` 的 follower、`live-sync.js` | `routes.js`（sources/follow）、`BranchPanel.tsx`/`ProjectPreviews.tsx`、`dictionary.ts`、`api.md`、`architecture.md` §8.8、`tests/preview.test.js` | 多 worktree 同时预览 + 断源 |
| 新增部署状态 | `deployments.js` + `routes.js`（状态页） | `types.ts`、`ui.tsx`、`format.ts`、`dictionary.ts`、CSS、`PreviewPane.tsx`、测试、三份文档 | 状态迁移 + 停止/失败 |
| 新增框架 | `server/lib/frameworks.js` | `devCommand`、测试 fixture、`architecture.md` 命令矩阵 | 真启动一个 fixture |
| 新增包管理器 | `frameworks.js` 的 `PM_FILES`/`INSTALL_COMMANDS` | 指纹、安装命令、测试 | 安装/复用 |
| 新增预览模式 | `deployments.js`（create/run） | `routes.js`、前端 mode 文案、`api.md`、测试 | 静态 + server 各一次 |
| 改预览 URL/端口 | `routes.js`、`config.js`、`ports.js` | `PreviewPane.tsx`、状态页、`api.md`、测试 | 302 + 局域网 Host |
| 新增前端页面 | `lib/router.tsx` + `App.tsx` | `TopNav`、字典、CSS | 直达 URL + 刷新 |
| 新增项目 tab | `pages/ProjectPage.tsx` | 新页面组件、字典、CSS | tab 切换 + 深链 |
| 新增 SSE 事件 | `events.emit` 调用点 | `lib/hooks.ts`、页面监听、`api.md` | `curl -N` + UI |
| 新增文案/语言 | `i18n/dictionary.ts` | 组件 `t()`、`i18n/index.tsx`（新语言） | typecheck + 切换 |
| 改数据 schema | `store.js` + 实体创建/读取 | `toPublic`、TS 类型、迁移、测试 | 旧 db 加载 |
| 改主题/样式 | `base.css` + `theme-light.css` | `components.css`/`pages.css`、`index.html` 内联脚本 | 亮/暗 + 手机 |
| 改 demo | `examples/demo/*` | `projects.js` 种子文案、`tests/demo.test.js` | 重新生成 + 4 分支 |
| 系统文件夹选择器 | `server/lib/folder-dialog.js` + `routes.js` | `index.js` 注入、`AddProjectModal.tsx`、`api.ts`/`types.ts`、字典、`tests/folder-dialog.test.js`、`api.md` | 单测 + 无 GUI 回退 |
| 改删除语义 | `projects.js`、`deployments.js` | `data-model.md` 删除矩阵、测试 | 检查磁盘/端口/数据 |

## 4. 任务配方

### Recipe 1：新增一个 API 端点

1. **选位置**：`server/routes.js` 的单函数 `if` 链。静态路径（如 `/api/projects/demo`）必须放在通用 `/:id` 匹配之前。所有正则用 `^...$` 锚定。
2. **写处理器**：`readJSONBody(req)` 取 body；`projects.get()`/`deployments.*` 取数据；错误抛 `new HttpError(status, message)`；成功 `sendJSON(res, status, data)`。
3. **业务逻辑**：如果涉及多步状态修改，放到对应 manager，不要在 route 里直接拼 SQL 式的操作；改完 `store.markDirty()`，必要时 `events.emit(...)`。
4. **前端**：在 `web/src/lib/api.ts` 加方法；在 `types.ts` 加 DTO；组件里处理加载/错误。
5. **测试**：在 `tests/api.test.js`（或对应文件）加成功 + 一个失败状态码；需要真实部署时用 `deployBranch`。
6. **文档**：[api.md](api.md) 总表 + 详情 + 必要时 curl。

检查点：`/api/*` 未命中必须是 JSON 404；错误体形状不变；不要返回内部字段。

### Recipe 2：新增一个部署状态

这是最容易漏的跨层改动。按顺序：

**服务端**

- [ ] `server/lib/deployments.js`
  - `recoverInterrupted()` 的活动状态数组（重启时如何处理新状态）
  - `stop()` 允许的状态数组
  - `stopById()` 允许的状态
  - `stopProject()` / `stopAll()` 的活动状态数组
  - `enforceMaxRunning()` 的 ready 过滤（如果新状态也算运行）
  - `toPublic()`（通常无需改，但要确认）
- [ ] `server/routes.js` 的 `previewStatusPage()`：`title`、`detail`、`fatal`、内联轮询的终态列表（`ready/error/stopped` 硬编码在脚本里）。
- [ ] 状态写入点：`setStatus`、`fail`、`stop`、`run` 各分支、静态分支。
- [ ] 测试：至少覆盖进入、终止、停止、重启恢复。

**前端**

- [ ] `web/src/lib/types.ts` 的 `DeploymentStatus` 联合类型。
- [ ] `web/src/components/ui.tsx` 的 `STATUS_KEYS`（StatusPill 文案）。
- [ ] `web/src/lib/format.ts` 的 `statusLabel`、`statusTone`。
- [ ] `web/src/i18n/dictionary.ts`：`en` 与 `zh` 的 `status.<new>`。
- [ ] `web/src/styles/*`：`.status-<tone>`（若是新 tone）；必要时分支状态色。
- [ ] `web/src/components/PreviewPane.tsx`：`statusHeadlineKey`、`PENDING_STATUSES`（若是进行态）、`BuildSteps` 的 order（若是新步骤）。
- [ ] `web/src/pages/ProjectPreviews.tsx`：pending 判断/轮询是否覆盖。
- [ ] `web/src/components/BranchPanel.tsx`：分支状态文案映射。
- [ ] `web/src/styles/pages.css` 的 `.branch-state-<status>`（如果颜色单独定义）。

**文档/测试**

- [ ] `docs/architecture.md` 状态机图。
- [ ] `docs/api.md` Deployment.status 枚举 + 状态页表格。
- [ ] `docs/data-model.md` 状态说明。
- [ ] `tests/*` 断言。
- [ ] 手工：状态页、分支列表、停止、重启恢复。

### Recipe 3：新增框架或包管理器

**框架**

1. `FRAMEWORKS` 加 `{ keys, label, marker, kind }`；注意顺序（更具体的放前面）。
2. `devCommand` 为该 `kind` 生成正确的端口/host 参数与环境变量。自定义 server 只能注入 `PORT/HOST`，要写清楚。参数拼接遵循 `scriptInvocation`：只有 npm 在脚本名后加 `--`，pnpm/yarn/bun 直接追加（否则 Vite 会忽略端口覆盖）。
3. `detectStaticEntry` 不适用时确认项目仍有 `dev/start` 脚本才走 server 模式。
4. 测试：用 `makeRepo` 造 `package.json`（带依赖）+ 读取 `PORT` 的最小 dev server，断言：
   - `framework.label`/`type`；
   - 部署 ready；
   - 302 到正确端口；
   - 日志含启动成功。
5. 文档：`docs/architecture.md` 的命令矩阵、根 README 支持表（如果要面向用户）。

**包管理器**

1. `PM_FILES` 加 lockfile（顺序影响识别优先级）。
2. `INSTALL_COMMANDS` 加安装命令。
3. `dependencyFingerprint` 会自动使用检测到的 lockfile；确认新文件名被映射。
4. 测试：至少验证 fixture 能识别 PM；有环境时验证安装/缓存复用。

注意：`kind === "astro"` 在 `devCommand` 中不可达（Astro 的 kind 是 `"vite"`）；不要照抄死分支。

### Recipe 4：新增预览模式

1. `deployments.create()` 的 `mode` 白名单。
2. `run()` 的解析与分支：新模式如何准备、是否安装依赖、是否占端口、如何 ready。
3. `toPublic.mode` 与 `urlPath` 语义（`urlPath` 是 DTO 计算值，不持久化）。
4. 端口/静态服务器/限额/停止路径全部覆盖。
5. 前端 mode 文案（`ProjectPreviews` 工具栏）与 i18n。
6. `docs/api.md`、`docs/architecture.md`、测试（复用/新建/失败/停止）。

### Recipe 5：新增一个持久化字段

以 Project 为例：

1. `projects.create()` 初始化默认值（本地路径与 Git 两条分支都要）。
2. `toPublic()` 决定是否暴露；内部字段不要加。
3. 若可通过 API 更新：`projects.update()` 的 allowed 列表 + 长度/类型校验。
4. `web/src/lib/types.ts` 加字段；UI 显示/编辑。
5. 旧数据兼容：读取时 `?? 默认值`，不要假设字段一定存在。
6. `docs/data-model.md` 字段表；测试创建/读取/更新/删除。
7. 若字段影响排序/统计，检查 `overview`、`system`、列表。

Deployment 字段还要考虑：`create()` 初始化、`run()` 回填、`toPublic()`、前端类型、状态页（如需要）。

### Recipe 6：新增页面或设置项

项目现在只有一个界面（`/p/:id/previews`）；**不要再加项目 tab**，旧 tab 深链会被重定向。项目级设置加在 `components/ProjectSettingsModal.tsx`，工具栏「设置」打开。

**项目设置项**

1. `ProjectSettingsModal.tsx` 加字段与本地 state。
2. 保存时 `api.updateProject`（必要时先扩展 `web/src/lib/api.ts` 的 patch 类型）。
3. `dictionary.ts` 加文案（en+zh）；样式优先复用 `.settings-form` / `.settings-modal-danger`。

**顶层页面**

1. `lib/router.tsx`：`RouteMatch.page` 联合类型 + `matchRoute` 正则。
2. `App.tsx`：`AppRoutes` 渲染。
3. `TopNav` 面包屑/入口（如需要）。
4. 字典、CSS、`notFound` 兜底。

### Recipe 7：新增 SSE 事件

1. 服务端在状态变更处 `events.emit("your.event", { projectId, ... })`；payload 尽量带 `projectId`，前端靠它过滤。
2. `web/src/lib/hooks.ts` 的 `useEventStream` 事件数组加名字（否则永远不会被监听）。
3. `AppContext` 会统一刷新 overview/system 并派发 `vercio:event`；页面按需要监听。
4. 如果需要页面局部刷新，加 `window.addEventListener("vercio:event", ...)` 并判断 `data.projectId`。
5. `docs/api.md` 事件表 + 触发点。
6. 用 `curl -N` 验证帧格式。

### Recipe 8：新增 i18n 文案或语言

**文案**

1. 在 `dictionary.ts` 的 `en` 中加 key（命名 `domain.camelCase`）。
2. 在 `zh` 中加**同名** key；`Record<TranslationKey,string>` 会强制。
3. 组件里 `const t = useT(); t("key")`；插值用 `{name}`。
4. 跑 `npm run typecheck`。

**新语言**

1. `i18n/index.tsx` 的 `Language` 联合类型、`translations` 映射、`detectLanguage`。
2. `dictionary.ts` 新增完整字典（`Record<TranslationKey,string>`）。
3. `LanguageSwitcher` 增加按钮；`ProfileModal` 的语言区自动复用。
4. `format.ts` 的 `FormatLocale` 与相对时间/日期分支。
5. 检查 `index.html` 的 `lang` 初值（运行时会被 Provider 覆盖）。

不要翻译项目内容（分支名、README、brief、笔记、评论）。

### Recipe 9：修改预览 URL 或端口策略

**URL**

- `routes.js`：`/^\/preview\/([^/]+)(\/.*)?$/`、302 的 Location、状态页内的轮询地址。
- `PreviewPane.tsx`：`previewHref`/`displayUrl`/iframe src。
- `api.md`、测试（302 的 Location 断言、stop 后的状态页）。
- 安全：Host 头参与重定向；若改这里，顺手考虑校验/白名单。

**端口**

- `config.previewPortRange`、`ports.findFreePort`、`activePorts`、`startStaticServer`、`run`。
- 所有释放路径：`stop`、`fail`、`afterReady` 顶替、`stopAll`、项目删除。
- `VERCIO_MAX_PREVIEWS` 只统计 server 预览；改限额语义要同步文档。
- 测试：并发两个分支端口不同；停止后端口可被复用。

### Recipe 10：修改 demo 项目

1. `examples/demo/manifest.json`：每项 `{ branch, variant, message, daysAgo }`；至少 2 项。
2. `examples/demo/variants/<variant>/`：完整覆盖文件（index.html/styles.css/script.js）。
3. `examples/demo/_shared/`：所有分支共享的 `package.json`、`dev-server.mjs`；以 `_` 开头的目录/文件不会被复制。
4. `projects.js` 的 `DEMO_DESCRIPTION`/`DEMO_NOTES`/`DEMO_COMMENT` 如需同步改。
5. 删除 `.vercio/repos/lumen-demo` 后重新 `POST /api/projects/demo` 才会重建（已有 .git 会直接复用）。
6. `tests/demo.test.js` 断言分支名、笔记数、页面内容差异。

### Recipe 11：修改主题或页面样式

1. 新颜色先加到 `base.css` 的 `:root`，再在 `theme-light.css` 加 `[data-theme="light"]` 覆盖。
2. 选择器优先复用变量，不硬编码 hex。
3. 布局改动放 `pages.css`；跨页面组件放 `components.css`。
4. 检查 1180/1000/860/620 断点与预览舞台的容器查询。
5. 亮/暗都要看；terminal 与 hero mock 在亮色下刻意保持深色。
6. 手机宽度检查横向溢出。
7. 若改 `vercio:theme` key 或默认值，同时改 `web/index.html` 内联脚本与 `meta theme-color`。

### Recipe 12：修改系统文件夹选择器

涉及文件：

- `server/lib/folder-dialog.js`：平台候选、结果解析、错误映射。
- `server/routes.js`：`POST /api/fs/pick-folder`，请求体校验、AbortController、注入的 `folderDialog`。
- `server/index.js`：`createVercioApp({ folderDialog })` 透传（测试注入用）。
- `web/src/components/AddProjectModal.tsx`：先调原生窗口；5xx（504 除外）回退页内浏览器；`browsing` 状态。
- `web/src/lib/api.ts` / `types.ts`：`pickFolder` 与 `FolderPickResult`。
- `web/src/i18n/dictionary.ts`：`add.pickPrompt`、`add.openingDialog`、`add.dialogFallback`、`add.dialogTimeout` 等。
- `tests/folder-dialog.test.js`：命令构造、取消、ENOENT 回退、不可用、非法路径、API 委托。

必须保持：

- macOS 用 argv 传路径/提示，**不要**把用户文本拼进 AppleScript；Windows 的 PowerShell 字符串要转义单引号；Linux 先 zenity 后 kdialog。
- 对话框在**服务器机器**上弹，不是访问者浏览器；请求最长 5 分钟，客户端断开要 abort。
- 错误码固定：400（参数类型错误或 `not-directory`）、500 `dialog-failed`、501 `unavailable`、504 `timeout`。
- API 只保证“目录存在”，不保证 Git 仓库；项目创建时再校验。
- 前端回退策略在组件里，不要偷偷让 API 自己回退。

验证：

```bash
node --test tests/folder-dialog.test.js
npm run typecheck
```

手工：在有 GUI 的机器点「浏览」并取消/选择；在无 GUI 的 Linux（PATH 中无 zenity/kdialog）确认返回 501 且前端回退到页内浏览器。

### Recipe 13：加鉴权（谨慎）

当前架构**没有**认证，这不是加一个中间件就完事：

- HTTP API：所有路由 + SSE + 预览 302 + 静态资源都要拦截。
- 预览端口 41xx 直接暴露，浏览器 iframe 直连；要么代理预览（架构大改），要么接受端口无鉴权。
- 文件夹浏览、项目删除、部署（会执行代码）都是高风险操作。
- 前端要加登录态、错误处理、SSE 带凭据（EventSource 对 header 支持有限）。
- 数据模型要加用户/令牌；测试要覆盖未授权路径。
- 更现实的方案：保持本地/可信 LAN，在反向代理层加 Basic Auth / OIDC；在文档中明确。

## 5. 验证协议

按改动风险选择层级；**任何代码改动至少 L0 + 相关测试**。

### L0 静态检查

```bash
npm run typecheck
```

通过标准：零错误。服务端没有类型检查，靠测试与人工审查。

### L1 自动化测试

```bash
npm test
```

通过标准：全绿。测试文件由 `--test-concurrency=1` 串行执行，避免真实 dev server 抢端口；两个 `npm test` 同时跑仍可能冲突。若改动涉及：
- API/笔记/评论/项目 → `tests/api.test.js`
- 部署/worktree/进程/端口/失败日志 → `tests/deployments.test.js`、`tests/preview.test.js`
- 框架/包管理器命令 → `tests/frameworks.test.js`
- 系统文件夹窗口 → `tests/folder-dialog.test.js`
- git/分支/diff → `tests/git.test.js`
- 目录浏览 → `tests/browse.test.js`
- demo → `tests/demo.test.js`

全量通常十几秒到 1 分钟（首次 demo/安装依赖除外）；失败先看是否端口/进程残留，尤其是 `Port 4100 is already in use`。

### L2 构建与冒烟

```bash
npm run build
npm start            # 然后另开终端执行下面的 curl
curl -s http://127.0.0.1:4000/api/health
```

通过标准：
- build 成功，`dist/` 生成；
- `/api/health` 返回 `ok:true`；
- 打开 `/` 能加载 SPA（没有 dist 时会看到提示文本）。

### L3 端到端手工（改 UI/部署时必做）

用 [development.md §7.2](development.md#72-ui-手工清单改动前端状态时) 的清单，至少覆盖：

1. Load demo → Previews → 切两个分支 → Compare。
2. 预览未就绪时看日志；ready 后 iframe 正常。
3. Discussion 发/删评论。
4. 工具栏「设置」弹窗改名/改标语并保存；旧 `/overview`、`/notes`、`/settings` 链接会跳到预览。
5. 亮/暗切换 + 刷新持久化；手机宽度无溢出。
6. 停止预览后访问 `/preview/<id>/` 显示 stopped；再点分支能重新建。

### 资源泄漏检查（改部署/端口/删除时）

```bash
# 停止后不应再有该端口
lsof -nP -iTCP:<port> -sTCP:LISTEN

# 项目删除后
ls .vercio/worktrees/<projectId> .vercio/deps/<projectId>   # 应不存在
git -C <repo> worktree list                                  # 不应残留

# 残留进程
ps -axo pid,pgid,command | grep worktrees | grep -v grep
```

### 交付时说明

- 改了哪些文件、为什么；
- 跑了哪些命令、结果；
- 哪些是手工验证（因为仓库没有浏览器 e2e）；
- 已知未覆盖的风险（如 Windows、并发部署）。

## 6. 高频坑

| # | 症状 | 根因 | 修法 |
| --- | --- | --- | --- |
| 1 | 新 API 返回 404 | 路由顺序被通用 `/:id` 抢先，或正则没锚定 | 把静态路径放前面；`^...$` |
| 2 | 改了数据但重启后丢失 | 忘了 `store.markDirty()` | 每次内存修改后标记；退出 `flush` |
| 3 | 新状态在 UI 显示空白/英文 key | 只改了服务端 | 按 Recipe 2 全链路 |
| 4 | 部署失败后端口永久被占 | 漏了失败分支 `releasePort` | 在 catch/finally 统一释放 |
| 5 | 两个分支互相删 worktree | slug 碰撞或并发清理 | 避免并发；改用更唯一目录名（需迁移） |
| 6 | 安装依赖后 Vite 报缓存错 | 共享 `node_modules` 的 `.vite` | 删 deps 缓存；长期方案是 per-worktree cache |
| 7 | 开发时 API 请求 404 | API 不在 4000，Vite 代理写死 | 同步端口或改代理 |
| 8 | 生产打开只有一行提示 | 没 build | `npm run build` |
| 9 | 加了 i18n key 但 typecheck 报错 | `zh` 缺 key | 两个字典都加 |
| 10 | SSE 事件到了但页面不刷新 | `useEventStream` 没监听该事件 | 加进事件数组 |
| 11 | 前端字段 undefined | 服务端 DTO 改了但 `types.ts` 没同步 | 同步类型 + 兼容旧数据 |
| 12 | 深链/后退后选中项不对 | 页面只在挂载时读 query；`replaceState` 绕过 Router | 监听 `popstate` 或统一走 Router |
| 13 | 想从父页面操作预览 DOM 失败 | iframe 跨源（端口不同） | 加 postMessage 协议或代理；不要直接访问 |
| 14 | 重启后端口被占/预览打不开 | 旧 detached 进程存活 | 手工杀进程组；重启后重新预览 |
| 15 | 磁盘越来越大 | 日志不轮转、删除项目不删日志、deps 累计 | 清理 `.vercio/logs`、`deps`；不要假设自动回收 |
| 16 | 预览 ready 但页面白屏/控制台 `Missing VITE_*` | worktree 没有工作副本里被 gitignore 的 `.env*` | 自动复制已实现；确认 `.env*` 在**仓库根目录**，看日志 `Copied local env files`。子目录/自定义 envDir 不在覆盖范围 |
| 17 | Vite 预览中依赖包字体/图片 `@fs/...` 403 | 软链 node_modules 真实路径超出 Vite fs.allow | 纯 `vite` 脚本自动套 overlay 并带回退；`remix vite:dev`/`astro dev` 等不会套，需要在项目 config 里处理 |
| 18 | 本地改代码预览不更新 | 该分支没有任何 worktree 检出（`liveState=snapshot`），或编辑源与预期目录不是同一个（`/sources` 可见）；依赖文件变化触发的重启窗口内也可能短暂 502 | 看工具栏是 `LIVE` 还是 `快照`；`GET /api/projects/:id/sources` 核对绑定；给分支建 worktree 后 2s 内会自动绑定 |
| 19 | 预览反复自动刷新 | live sync 重复写相同内容触发 HMR | 已按内容哈希去重；改 `syncWorkingCopyState` 时不要无条件 `copyFile` |
| 20 | 切分支/删 worktree 后预览停了 | 旧行为；现在应该只降级 `detached` | 检查 `stopFollower`/`refreshFollow` 是否在源缺失分支里误调了 `stop` |

补充：

- **状态页轮询的终态列表**是硬编码的 `ready/error/stopped`；新增终态要改内联脚本。
- **`mode` 的 public 值可能回退为 `auto`**（旧记录），前端不要假设一定 server/static。
- **`isPortResponding` / `waitForHttp` 对任何 HTTP 响应都算成功**，包括 500。
- **Vite 代理只代理 `/api` 和 `/preview`**；新增其它前缀要同步 `vite.config.ts`。
- **服务端错误是英文**，直接 toast；要本地化需在服务端返回 code 或前端映射。
- **评论删除是软校验**：记录/查询任一 `clientId` 为空就放行，不要当权限系统。
- **系统文件夹窗口在服务器机器上弹**，请求可挂 5 分钟；客户端断开要 abort；无 GUI/无 zenity/kdialog 时 501，前端才回退页内浏览。不要假设窗口会出现在访问者浏览器。
- **`npm test` 已固定串行**（`--test-concurrency=1`），但两个测试进程/一个正在运行的 Vercio 仍会抢 4100–4999；端口占用失败先查残留。
- **pnpm/yarn/bun 不能加 `--`**：Vite 的 CAC 解析器会把裸 `--` 之后当位置参数，静默忽略 `--port/--host`；只有 npm 需要分隔符。改 `scriptInvocation` 必须跑 `tests/frameworks.test.js` 与 `tests/preview.test.js`。
- **失败预览的 error 与日志快照**现在会包含退出时刷出的尾部输出；改 `run()` 的 catch 时保留 `settleWithin`/`failureHint` 行为，否则 UI 只剩“exited”。
- **「手机打不开」先分层，不要改页面**：本机 `curl` 自己的 LAN IP 走 loopback，通过也不代表其它设备可达。先看启动输出的 `Network` 行（是否 `disabled — bound to ...`）、`LAN client <ip>` 日志（请求有没有到）、以及 `VPN/TUN detected` 提示；地址探测不能把 `169.254/16`、Clash `198.18/15`、Tailscale `100.64/10` 当成 LAN 地址。改监听时同时验证 `curl 127.0.0.1` 与 `curl [::1]`（通配地址是 IPv4+IPv6 双栈）。

## 7. Do Not

- ❌ 不要 checkout/reset/clean 用户的工作副本，或删除用户仓库。
- ❌ 不要把 `.vercio/`、`dist/`、`node_modules/`、日志提交进 git。
- ❌ 不要在测试里使用仓库根的真实 `.vercio/` 数据。
- ❌ 不要为了“方便”把预览改成同源代理而不处理 HMR/绝对路径/WebSocket。
- ❌ 不要给服务端引入 Web 框架/ORM/构建步骤（除非任务明确要求并接受架构变更）。
- ❌ 不要在前端引入第二套路由/状态/UI/CSS 方案。
- ❌ 不要新增“只有管理员”的功能却不加认证。
- ❌ 不要静默改变状态字符串、API 字段语义、`/preview` URL；它们是契约。
- ❌ 不要翻译用户内容或服务端原始错误。
- ❌ 不要假设 Windows 可用，也不要在 macOS 上引入只有 Windows 能跑的路径。
- ❌ 不要在测试里写死 41xx 端口；用 `port:0`/探测。
- ❌ 不要直接改 `db.json` 作为功能实现。
- ❌ live preview 不要写用户工作副本：只允许读 `git status`/文件内容，所有写入必须落在 worktree。
- ❌ 不要只改前端类型不改服务端 DTO（或反之）。
- ❌ 不要把系统对话框的 `prompt`/路径直接拼进 AppleScript/PowerShell 源码；用 argv 或转义。
- ❌ 不要假设运行环境有 GUI/zenity/kdialog；无对话框能力时要能 501 + 页内回退。
- ❌ 不要在未备份的情况下删除开发者的 `.vercio/`。

## 8. Done 清单

- [ ] 需求行为在真实路径上可用（不只是“代码看起来对”）。
- [ ] `npm run typecheck` 通过。
- [ ] 相关测试新增/更新并通过；`npm test` 全绿（或说明为何只跑子集）。
- [ ] `npm run build` 通过（改前端时）。
- [ ] 新状态/字段/事件/路由已全链路同步（服务端、DTO、TS、UI、SSE、文档、测试）。
- [ ] 端口、进程、worktree、缓存、日志在失败/停止/删除路径都清理。
- [ ] 亮/暗、手机宽度、局域网 Host 没有被破坏（改 UI/预览时）。
- [ ] 文档同步表已检查（见 §9）。
- [ ] 没有提交生成物/数据/日志。

## 9. 文档同步表

| 代码改动 | 需要更新的文档 |
| --- | --- |
| 状态机/部署流程/端口/安全边界 | `architecture.md` |
| 服务端模块/方法/框架/端口/git/系统对话框 | `backend.md` |
| API 路由/字段/状态码/SSE | `api.md` |
| 数据字段/磁盘布局/删除语义/schema | `data-model.md` |
| 页面/组件/路由/数据流/i18n/主题/CSS | `frontend.md` |
| 命令/测试/调试/约定/故障 | `development.md` |
| 改动地图/配方/坑/验证 | `ai-coding.md` |
| 实时预览模型/阶段/取舍 | `live-preview-sources.md`、`architecture.md` §8.8、`backend.md`、`frontend.md` |
| 面向用户的功能/环境/限制 | 根 `README.md` 与 `README.en.md` |

## 10. 常用检索

```bash
# 某个状态/字段在哪些地方被消费
grep -rn "deployment.updated" server web
grep -rn "status === \"ready\"" server web
grep -rn "toPublic" server
grep -rn "VERCIO_" server README.md
grep -rn "vercio:" web/src web/index.html

# 找路由顺序
grep -n "pathname ===" server/routes.js
grep -n "pathname.match" server/routes.js

# 找前端 API 方法
grep -n "async .*(" web/src/lib/api.ts

# 找 CSS 类
grep -rn "\.preview-panes" web/src/styles
```

当文档与代码冲突时：**信代码，修文档**，并在改动说明里标注 `docs:`。
