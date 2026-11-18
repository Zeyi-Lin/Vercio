# HTTP API 与 SSE 契约

所有接口都在主服务（默认 `http://localhost:4000`）上。前端通过同源相对路径访问；没有 CORS 配置、没有鉴权头、没有版本前缀。

## 1. 通用约定

| 项目 | 约定 |
| --- | --- |
| 请求体 | JSON；`Content-Type: application/json`；上限 2MB（413） |
| 响应体 | 成功为 JSON；`/preview/*` 为 302/HTML；SPA 为 HTML；未知非 API 路径为文本 |
| 错误体 | `{ "error": { "status": 400, "message": "...", "details"?: {...} } }` |
| 缓存 | API 与预览重定向 `Cache-Control: no-store`；SPA 资源 60s |
| 鉴权 | 无。局域网内任何人可调用 |
| 编码 | 路径参数用 `encodeURIComponent`；分支名常含 `/`，必须编码 |
| 时间 | ISO 8601 字符串（`new Date().toISOString()`） |
| ID | 稳定，带前缀：`prj_`、`dpl_`、`note_`、`cmt_` |
| 排序 | 见各接口；不要依赖“插入顺序”以外的隐含顺序 |

服务端错误 `message` 是英文、面向用户/开发者的原始字符串。前端 toast 多数直接展示它，因此改错误文案会影响 UI。

## 2. 数据对象

### Project

```ts
{
  id: string;
  name: string;
  source: { kind: "git" | "path" | "demo"; input?: string; url?: string; path?: string };
  repoPath: string;          // 本机绝对路径（会暴露给局域网）
  defaultBranch: string;
  currentBranch: string;
  originUrl: string;
  dirtyCount: number;        // 工作副本未提交文件数
  branchCount: number;
  framework: { label: string; type: "server" | "static"; kind: string; packageManager: string } | null;
  description: string;       // Markdown product brief
  tagline: string;
  links: { label: string; url: string }[];
  status: "ready" | "importing" | "error";
  error: string | null;
  isDemo: boolean;
  createdAt: string;
  updatedAt: string;
  latestCommit: {
    shortSha: string; message: string; author: string;
    date: string; timestamp: number; branch: string;
  } | null;
}
```

### Branch（`GET /api/projects/:id/branches` 的数组项）

```ts
{
  name: string;
  ref: string;               // refs/heads/... 或 refs/remotes/...
  sha: string;
  shortSha: string;          // 7 位
  date: string;              // committer date ISO
  timestamp: number;         // ms
  author: string;
  subject: string;
  isDefault: boolean;
  isCurrent: boolean;
  remoteOnly: boolean;
  deployment: Deployment | null;  // 该分支最新一次部署（任意状态）
}
```

### Deployment

```ts
{
  id: string;
  projectId: string;
  branch: string;
  status: "queued" | "preparing" | "installing" | "starting" | "ready" | "error" | "stopped";
  mode: "auto" | "server" | "static";       // 解析结果；旧记录可能回退为 auto
  requestedMode: "auto" | "server" | "static";
  port: number | null;                      // 仅 ready 时非空
  urlPath: string | null;                   // 仅静态 ready 时为 /preview/<id>/，前端不依赖
  commit: string;                           // 40 位 sha
  shortSha: string;                         // 7 位
  commitMessage: string;
  author: string;
  framework: { label: string; type: "server" | "static"; kind: string; packageManager: string } | null;
  error: string | null;
  createdAt: string;
  readyAt: string | null;
  stoppedAt: string | null;
  devCommand: string | null;                // 实际执行的命令（含参数）
  live: boolean;                            // true = 分支即工作副本当前分支，预览实时同步未提交改动
  isProduction: boolean;                    // 当前恒为 false（未实现）
  projectName?: string;                     // 仅 /api/overview 注入
}
```

### Note

```ts
{
  id: string; projectId: string; title: string; body: string;
  tags: string[]; pinned: boolean; branch: string | null;
  createdAt: string; updatedAt: string;
}
```

### Comment

```ts
{
  id: string; projectId: string; branch: string | null;
  author: string; body: string; clientId?: string; createdAt: string;
}
```

### Stats / Settings / System

```ts
Stats = { projects: number; branches: number; running: number; notes: number; comments: number };
Settings = { userName: string; defaultAuthor: string };

SystemInfo = {
  hostname: string; platform: string; release: string;
  port: number; node: string; version: string;
  localUrl: string;                                  // http://localhost:<port>
  lanUrls: { name: string; address: string; url: string }[];
  primaryUrl: string;                                // 第一个 LAN URL，否则 localhost
  wifiName: string;
  qrDataUrl: string | null;                          // data:image/png;base64,...
  dataDir: string;
  projectCount: number; runningCount: number; noteCount: number;
  maxPreviews: number;
};
```

### BranchChanges

```ts
{
  branch: string;
  base: string;              // production 分支名
  files: { path: string; additions: number; deletions: number }[];  // 最多 40，按改动量降序
  fileCount: number;         // 总文件数（不是 files.length）
  additions: number;
  deletions: number;
}
```

### BrowseListing

```ts
{
  path: string; name: string; parent: string | null;
  isGitRepo: boolean; isHome: boolean;
  breadcrumbs: { label: string; path: string }[];
  roots: { kind: "home" | "desktop" | "documents" | "downloads"; path: string }[];
  entries: { name: string; path: string; hidden: boolean; isGitRepo: boolean }[];
  hiddenCount: number; showHidden: boolean;
}
```

### FolderPickResult

```ts
{
  path?: string;        // 选中的绝对目录
  cancelled?: boolean;  // 用户取消
}
```

## 3. 接口总表

| 方法 | 路径 | 用途 | 成功码 |
| --- | --- | --- | --- |
| GET | `/api/health` | 健康检查 | 200 |
| GET | `/api/system` | 系统信息、LAN、二维码、设置、统计 | 200 |
| GET | `/api/overview` | 工作台聚合数据 | 200 |
| PATCH | `/api/settings` | 更新本地偏好 | 200 |
| GET | `/api/fs/browse` | 浏览本机目录 | 200 |
| POST | `/api/fs/pick-folder` | 在服务器机器上打开系统文件夹窗口 | 200 |
| GET | `/api/events` | SSE 事件流 | 200（stream） |
| GET | `/api/projects` | 项目列表 | 200 |
| POST | `/api/projects` | 添加 GitHub/本地项目 | 201 |
| POST | `/api/projects/demo` | 载入/复用 demo | 201 |
| GET | `/api/projects/:id` | 项目详情 + 部署 + 计数 | 200 |
| PATCH | `/api/projects/:id` | 更新名称/标语/描述/链接 | 200 |
| DELETE | `/api/projects/:id` | 删除项目 | 200 |
| POST | `/api/projects/:id/refresh` | git fetch + 刷新元数据 | 200 |
| POST | `/api/projects/:id/retry` | 重试失败的导入 | 202 |
| GET | `/api/projects/:id/branches` | 分支列表 + 每分支最新部署 | 200 |
| GET | `/api/projects/:id/readme` | production 分支 README | 200 |
| GET | `/api/projects/:id/changes` | 相对 production 的 diff | 200 |
| GET | `/api/projects/:id/deployments` | 项目部署历史 | 200 |
| POST | `/api/projects/:id/deployments` | 创建预览 | 200（复用）/202（新建） |
| GET | `/api/deployments/:id` | 单个部署 | 200 |
| GET | `/api/deployments/:id/logs` | 部署日志 | 200 |
| POST | `/api/deployments/:id/stop` | 停止预览 | 200 |
| GET | `/api/projects/:id/notes` | 笔记列表 | 200 |
| POST | `/api/projects/:id/notes` | 新建笔记 | 201 |
| PATCH | `/api/notes/:id` | 更新笔记 | 200 |
| DELETE | `/api/notes/:id` | 删除笔记 | 200 |
| GET | `/api/projects/:id/comments` | 评论列表（可按分支） | 200 |
| POST | `/api/projects/:id/comments` | 发表评论 | 201 |
| DELETE | `/api/comments/:id` | 删除评论 | 200 |
| GET | `/preview/:deploymentId/*` | 预览入口（302/状态页） | 302 / 200 / 404 |
| GET | `/*`（非 API） | SPA 与静态资源 | 200 |

## 4. 系统与工作台

### `GET /api/health`

```json
{ "ok": true, "version": "0.1.0", "port": 4000, "uptime": 123 }
```

### `GET /api/system`

```json
{
  "system": { "...": "SystemInfo" },
  "settings": { "userName": "", "defaultAuthor": "" },
  "stats": { "projects": 1, "branches": 4, "running": 2, "notes": 3, "comments": 1 }
}
```

`running` 统计 `status=ready` 的部署；`branches` 是各项目 `branchCount` 之和。

### `GET /api/overview`

```json
{
  "projects": ["Project..."],
  "deployments": ["Deployment...（全局最新 40 条，带 projectName）"],
  "settings": { "...": "" },
  "stats": { "...": 0 }
}
```

项目按 `updatedAt` 倒序；部署按创建时间倒序（数组头部最新）。

### `PATCH /api/settings`

请求：`{ "userName"?: string, "defaultAuthor"?: string }`（各截断 60）。
响应：`{ "settings": {...} }`。副作用：广播 `settings.updated`。
当前 UI 只使用 `userName`；`defaultAuthor` 是预留字段。

## 5. 目录浏览

### `GET /api/fs/browse?path=<abs|~>&showHidden=1`

- 无 `path` 时浏览 home。
- 只返回目录（名称与完整路径）；每个条目标记是否 Git 仓库。
- `showHidden` 只接受字符串 `"1"`。
- 响应：`{ "listing": BrowseListing }`。

错误：

| 状态 | `details.code` | 场景 |
| --- | --- | --- |
| 404 | `missing` | 路径不存在 |
| 403 | `denied` | 无权限 |
| 400 | `not-directory` | 指向文件 |
| 400 | `unreadable` | 其他读取失败 |

非 GET 方法不会返回 405，而是落到 API 404。

### `POST /api/fs/pick-folder`

在**运行 Vercio 的机器**上打开操作系统自带的文件夹选择器。这是一个可能阻塞数分钟的长请求：浏览器关闭/断开时服务端会 abort 对话框。

请求：

```json
{ "path": "~/code", "prompt": "为 Vercio 选择 Git 仓库文件夹" }
```

两个字段都可选，且必须是字符串：

- `path`：起始目录提示。存在则从它开始；不存在/指向文件则尝试其父目录；最后回退 home。
- `prompt`：对话框标题（换行/制表符压成空格，截断 160 字符）。

响应（200）：

```json
{ "path": "/Users/me/code/acme-site" }
```

或用户取消：

```json
{ "cancelled": true }
```

错误：

| 状态 | `details.code` | 场景 |
| --- | --- | --- |
| 400 | `not-directory` | 选中的路径不是已存在目录 |
| 400 | — | `path`/`prompt` 不是字符串（`path must be a string`） |
| 500 | `dialog-failed` | 对话框进程启动失败/退出码异常 |
| 501 | `unavailable` | 无 GUI、无 zenity/kdialog、macOS 无自动化权限等 |
| 504 | `timeout` | 5 分钟未操作 |

说明：

- 只校验“目录存在”，**不校验 Git 仓库**；项目创建时才会校验 `.git` 与 commit。
- 没有服务端回退；**前端**在 5xx（504 除外）时回退到 `GET /api/fs/browse` 的页内浏览器。
- 局域网客户端也能触发，但窗口出现在服务器机器上；`prompt` 由客户端提供。

## 6. 项目

### `GET /api/projects`

`{ "projects": Project[] }`，按 `updatedAt` 倒序。

### `POST /api/projects`

请求：

```json
{ "source": "owner/repo | https://... | /abs/path | ~/code/site", "name": "optional" }
```

响应 201：`{ "project": Project }`。

- 本地路径：同步校验并立即 `ready`；分支数/默认分支等元数据已填好。
- Git 来源：立即返回，`status="importing"`；clone 在后台，完成后 SSE `project.updated`。
- `name` 缺省时用路径 basename 或仓库名。

错误：400（空来源/路径不存在/不是目录/非法 JSON）、422（不是 git 仓库/没有 commit）。

### `POST /api/projects/demo`

无请求体。响应 201：`{ "project": Project }`。

- 首次生成 `.vercio/repos/lumen-demo`（4 分支），写 demo 描述、3 条笔记、1 条评论。
- 已有同 `repoPath` 项目时复用，不重复插入；响应仍是 201。
- 资产缺失/损坏 → 500。

### `GET /api/projects/:id`

```json
{
  "project": Project,
  "deployments": Deployment[],
  "notesCount": 3,
  "commentsCount": 1
}
```

### `PATCH /api/projects/:id`

允许字段：`name`、`description`、`tagline`、`links`。

```json
{
  "name": "Lumen",
  "tagline": "AI meeting notes",
  "description": "## Brief\n...",
  "links": [{ "label": "Docs", "url": "https://..." }]
}
```

- `description` 截断 20000，其余字符串截断 300。
- `links` 最多 8 条；非数组忽略；每项 `label` 80、`url` 500。
- 响应 `{ "project": Project }`；广播 `project.updated`。

### `DELETE /api/projects/:id?deleteRepo=0`

- 默认 `deleteRepo=1`。
- 响应 `{ "ok": true }`；广播 `project.deleted`。
- 删除语义见 [data-model.md](data-model.md#8-删除生命周期)。

### `POST /api/projects/:id/refresh`

- `git fetch --all --prune` + 重算分支/默认分支/脏文件/最新提交。
- 响应：`{ "project": Project, "fetch": { "ok": boolean, "message": string } }`。
- fetch 失败不返回 5xx，`fetch.ok=false`；项目仍可能 `ready`。
- 非 ready 项目 → 409。

### `POST /api/projects/:id/retry`

- 仅 `source.kind="git"`；已在导入 → 409。
- 响应 202：`{ "project": Project }`（status=`importing`）。
- 本地路径项目 → 400。

### `GET /api/projects/:id/branches`

```json
{
  "projectId": "prj_x",
  "defaultBranch": "main",
  "currentBranch": "main",
  "branches": ["Branch..."]
}
```

- 项目非 ready → 409。
- 默认分支排第一，其余按 commit 时间倒序。
- 每项带该分支**最新一次**部署（可能是 error/stopped）。

### `GET /api/projects/:id/readme`

```json
{ "readme": { "name": "README.md", "markdown": "# ..." } }
```

- 读 production 分支根目录；没有 README → `{ "readme": null }`。
- 非 ready → 409。

### `GET /api/projects/:id/changes?branch=<name>`

- 必填 `branch`，缺失 400。
- 与 production（默认分支）比较：`git diff --numstat base...head`，失败回退 `base..head`。
- branch 就是 production → 全 0。
- 响应 `BranchChanges`。
- 非 ready → 409。

## 7. 部署与预览

### `GET /api/projects/:id/deployments`

`{ "deployments": Deployment[] }`，项目全部历史（最多 60 条）。

### `POST /api/projects/:id/deployments`

请求：

```json
{ "branch": "feat/aurora-hero", "mode": "auto" }
```

- `branch` 必填非空字符串；`mode` 可选，默认 `auto`，只接受 `auto|server|static`。
- 命中可复用部署 → **200** `{ "deployment": ..., "reused": true }`。
- 新建 → **202** `{ "deployment": ..., "reused": false }`，后台执行。
- 项目非 ready → 409；分支不存在 → 404；非法 mode → 400。

轮询直到 `status ∈ {ready, error, stopped}`；或监听 SSE `deployment.updated`。

### `GET /api/deployments/:id`

`{ "deployment": Deployment }`。不存在 → 404。

### `GET /api/deployments/:id/logs`

```json
{ "id": "dpl_x", "log": "line1\nline2", "status": "installing" }
```

- 内存日志最多 4000 行；重启后回退文件最后 600 行；无日志为空串。
- 日志含 ANSI 清洗后的安装/dev server 输出与本系统追加的行。

### `POST /api/deployments/:id/stop`

- 只允许 `ready` 或 `starting`；否则 409 `Preview is not running`。
- 响应 `{ "deployment": Deployment }`（status=`stopped`，port=null）。
- 会关静态服务器或杀 dev server 进程组、释放端口、写日志、广播。
- `installing/queued/preparing` 不能通过 API 停止（manager 内部可以）。

### `GET /preview/:deploymentId/*`

| 情况 | 响应 |
| --- | --- |
| 部署不存在 | 404 HTML 状态页 |
| status=ready 且有端口 | 302 `Location: http://<req Host hostname>:<port><rest>`，`no-store` |
| 其他状态 | 200 HTML 状态页，内联脚本每 1.5s 轮询 `/api/deployments/:id` |

- `rest` 缺省为 `/`；查询串不转发。
- IPv6 host 会加 `[]`。
- 状态页固定英文，内联 CSS，不依赖前端构建。

## 8. 笔记

### `GET /api/projects/:id/notes`

`{ "notes": Note[] }`：置顶优先，其后 `updatedAt` 倒序。

### `POST /api/projects/:id/notes`

```json
{ "title": "Launch checklist", "body": "## ...", "tags": ["launch"], "pinned": true, "branch": "main" }
```

- title 默认 `Untitled note`，截断 160；body 100k；tags 最多 8（去空）；branch 可空。
- 响应 201 `{ "note": Note }`；广播 `note.changed`（kind=created）。

### `PATCH /api/notes/:id`

允许部分更新：`title/body/tags/pinned/branch`。响应 `{ "note": Note }`；广播 kind=updated。不存在 404。

### `DELETE /api/notes/:id`

响应 `{ "ok": true }`；广播 kind=deleted。不存在 404。

## 9. 评论

### `GET /api/projects/:id/comments?branch=<name>`

- 不带 `branch`：返回项目所有评论。
- 带 `branch`：精确匹配该分支（`branch=null` 的评论不会出现在分支查询里）。
- 按 `createdAt` 升序。
- `{ "comments": Comment[] }`。

### `POST /api/projects/:id/comments`

```json
{ "branch": "feat/x", "author": "Maya", "body": "Looks good", "clientId": "uuid" }
```

- body 去空白后不能为空（400）；body 上限 5000。
- author 默认 `Anonymous`，上限 60；branch 可空；clientId 上限 80。
- 响应 201 `{ "comment": Comment }`；广播 `comment.changed`。

### `DELETE /api/comments/:id?clientId=<uuid>`

- 记录与查询都带 `clientId` 且不同 → 403。
- 任一为空 → 放行（包括记录没有 clientId 的旧数据）。
- 响应 `{ "ok": true }`；广播 `comment.changed`。

## 10. SSE

### 连接

```http
GET /api/events
Accept: text/event-stream
```

响应头：`Content-Type: text/event-stream`、`Cache-Control: no-store, no-transform`、`Connection: keep-alive`、`X-Accel-Buffering: no`。

帧格式：

```text
retry: 1500

event: hello
data: {"now": 1760000000000}

: ping

event: deployment.updated
data: {"projectId":"prj_x","deploymentId":"dpl_y","status":"ready","seq":12,"at":1760000000123}
```

- 建立连接立即发 `hello`（只有 `now`）。
- 服务端每 25s 发 `: ping` 注释。
- 每条业务事件附带全局递增 `seq` 与毫秒 `at`。
- 断线不重放；EventSource 自动重连，但丢失期间的事件不会补发。

### 事件清单

| 事件 | data（除 seq/at 外） | 触发 |
| --- | --- | --- |
| `hello` | `{ now }` | 连接建立 |
| `project.created` | `{ projectId, status }` | 本地路径项目创建 / Git 项目落库 |
| `project.updated` | `{ projectId, status }` | 导入完成/失败、refresh、PATCH、框架更新 |
| `project.deleted` | `{ projectId }` | 删除项目 |
| `deployment.created` | `{ projectId, deploymentId }` | 新建部署记录 |
| `deployment.updated` | `{ projectId, deploymentId, status }` | 每次状态变化 / runner finally |
| `note.changed` | `{ projectId, noteId, kind: "created" \| "updated" \| "deleted" }` | 笔记增删改 |
| `comment.changed` | `{ projectId, commentId }` | 评论增删 |
| `settings.updated` | `{}` | PATCH 设置 |

前端监听列表定义在 [web/src/lib/hooks.ts](../web/src/lib/hooks.ts) 的 `useEventStream`。新增事件必须同时加到这里，否则页面不会收到刷新信号。

## 11. 状态码与错误

| 状态 | 含义 | 典型场景 |
| --- | --- | --- |
| 200 | 成功 | 查询、停止预览、复用部署 |
| 201 | 已创建 | 项目/笔记/评论创建 |
| 202 | 已接受，异步处理 | 新建部署、重试导入 |
| 400 | 请求不合法 | JSON 坏、缺 branch、非 git 目录、评论空 |
| 403 | 禁止 | 删除他人评论、静态目录越权 |
| 404 | 不存在 | 项目/部署/笔记/评论/分支/未知 API |
| 405 | 方法不允许 | 仅预览静态服务器（主 API 通常返回 404） |
| 409 | 状态冲突 | 项目未 ready、预览未运行、导入进行中 |
| 413 | Body 过大 | 超过 2MB |
| 422 | 无法处理 | 目录不是 git 仓库、仓库无 commit |
| 500 | 服务端错误 | 未捕获异常、系统对话框启动失败；日志有 `[vercio]` 堆栈 |
| 501 | 未实现/环境不支持 | 系统文件夹窗口不可用（无 GUI、无 zenity/kdialog、macOS 自动化权限被拒） |
| 504 | 网关超时 | 系统文件夹窗口 5 分钟未操作 |

## 12. curl cookbook

以下假设 `BASE=http://127.0.0.1:4000`，`jq` 可选。

```bash
BASE=http://127.0.0.1:4000

# 健康检查
curl -s "$BASE/api/health"

# 在服务器机器上打开系统文件夹窗口（无 GUI 时会返回 501）
curl -s -X POST "$BASE/api/fs/pick-folder" \
  -H 'content-type: application/json' \
  -d '{"path":"~/code","prompt":"Choose a Git repository"}'

# 页内目录浏览（系统窗口不可用时的回退）
curl -s "$BASE/api/fs/browse?path=~/code"

# 添加本地仓库（必须是已有 commit 的 git 仓库）
curl -s -X POST "$BASE/api/projects" \
  -H 'content-type: application/json' \
  -d '{"source":"/Users/me/code/my-site"}'

# 分支列表（注意分支名要 URL 编码）
curl -s "$BASE/api/projects/prj_xxx/branches"

# 创建预览（记录返回的 deployment.id）
curl -s -X POST "$BASE/api/projects/prj_xxx/deployments" \
  -H 'content-type: application/json' \
  -d '{"branch":"feat/aurora-hero","mode":"auto"}'

# 轮询状态
curl -s "$BASE/api/deployments/dpl_xxx"

# 看日志
curl -s "$BASE/api/deployments/dpl_xxx/logs"

# 预览入口：应返回 302
curl -si "$BASE/preview/dpl_xxx/" | head -n 12

# 跟随 302 看页面
curl -sL "$BASE/preview/dpl_xxx/" | head -n 20

# 实时事件（Ctrl+C 退出）
curl -N "$BASE/api/events"

# 停止预览
curl -s -X POST "$BASE/api/deployments/dpl_xxx/stop"

# 删除项目（保留克隆仓库：deleteRepo=0）
curl -s -X DELETE "$BASE/api/projects/prj_xxx?deleteRepo=0"
```

## 13. 兼容性规则

- **只做加法**：新增字段安全；改字段类型/语义是破坏性变更，需要同步前端与文档。
- **ID 与 URL 稳定**：`/preview/<deploymentId>/` 是可分享的公开入口，不要改变语义。
- **状态枚举**：前端、CSS、状态页、文档都消费它；新增状态按 [ai-coding.md](ai-coding.md) 的配方全链路改。
- **`mode` 与 `requestedMode`**：客户端只应依赖 `requestedMode` 判断自己请求了什么；实际行为看 `mode`。
- **无 API 版本号**：这是本地单实例应用，前后端同时发布；不要假设旧客户端长期兼容。
- **错误文案**：英文、直接展示；改动前先看前端是否有对应 i18n 回退。
