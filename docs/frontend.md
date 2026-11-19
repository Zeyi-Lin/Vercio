# 前端参考

前端在 `web/`，React 19 + TypeScript（strict）+ Vite。没有 React Router、Redux/Zustand、Tailwind、CSS Modules；路由、状态、样式都是手写的轻量方案。

## 1. 构建与运行

| 项 | 说明 |
| --- | --- |
| 入口 | `web/index.html` → `web/src/main.tsx` |
| 根组件 | `web/src/App.tsx` 的 `App` |
| 构建 | `vite build`，root=`web/`，outDir=`dist/`，`emptyOutDir`，无 sourcemap |
| 开发 | Vite 5173，代理 `/api`、`/preview` → `http://127.0.0.1:4000` |
| 类型检查 | `tsc --noEmit`，只覆盖 `web/src` 与 `vite.config.ts` |
| 字体 | `@fontsource-variable/geist`、`geist-mono`，本地打包，无外部请求 |
| 图标 | `lucide-react` |
| Markdown | `marked` + `dompurify` |
| 其他 | `qrcode` 只在服务端用；前端没有路由/状态/样式库 |

`web/index.html` 里有一段内联脚本，在 React 挂载前从 `localStorage("vercio:theme")` 或 `prefers-color-scheme` 设置 `<html data-theme>`，避免主题闪烁。这段脚本与 `ThemeProvider` 的检测逻辑必须保持一致。

## 2. 目录

```text
web/src/
├── main.tsx          # 字体、CSS、ReactDOM
├── App.tsx           # Provider 组合、路由、全局快捷键、全局模态框
├── pages/
│   ├── Dashboard.tsx
│   ├── ProjectPage.tsx       # 项目壳：默认 tab 全屏工作区；其余 tab 头部 + tab
│   ├── ProjectOverview.tsx   # brief + README + 仓库信息
│   ├── ProjectPreviews.tsx   # 分支预览/对比/讨论总控
│   ├── ProjectNotes.tsx
│   ├── ProjectSettings.tsx
│   └── NotFound.tsx
├── components/
│   ├── ui.tsx                # Button/Modal/StatusPill/... 原子组件
│   ├── TopNav.tsx, Logo.tsx, icons.tsx
│   ├── Toast.tsx
│   ├── CommandPalette.tsx
│   ├── AddProjectModal.tsx
│   ├── DirectoryPickerModal.tsx
│   ├── ShareModal.tsx, ShareCard.tsx
│   ├── ProfileModal.tsx, LanguageSwitcher.tsx, ThemeToggle.tsx
│   ├── ProjectCard.tsx, DeploymentList.tsx
│   ├── BranchPanel.tsx
│   ├── PreviewPane.tsx       # PreviewState + BrowserFrame
│   ├── CommentsPanel.tsx
│   ├── Markdown.tsx, TerminalLog.tsx
│   └── ...
├── context/AppContext.tsx
├── lib/
│   ├── api.ts        # fetch 封装 + 所有 API 方法
│   ├── types.ts      # 服务端 DTO 的 TS 镜像
│   ├── router.tsx    # history 路由 + Link
│   ├── hooks.ts      # useEventStream/useDebouncedCallback/useInterval/...
│   ├── format.ts     # 相对时间/日期/initials/copy/状态文案
│   ├── framework.ts  # 框架标签的 i18n 映射
│   └── markdown.ts   # marked + DOMPurify
├── i18n/
│   ├── dictionary.ts # en（源）+ zh（完整）
│   └── index.tsx     # Provider + t()
├── theme/index.tsx
└── styles/
    ├── base.css          # 变量、reset、排版、布局原语
    ├── components.css    # 顶栏、卡片、按钮、模态框、toast 等
    ├── pages.css         # 页面布局、预览器、响应式
    └── theme-light.css   # 亮色覆盖
```

## 3. 入口、Provider 与全局壳

Provider 顺序（外 → 内）：

```text
RouterProvider
 └ ThemeProvider
    └ I18nProvider
       └ ToastProvider
          └ AppProvider
             └ AppShell
```

- `RouterProvider`：监听 `popstate`，提供 `path/query/navigate`。
- `ThemeProvider`：`theme`、`data-theme`、`vercio:theme`。
- `I18nProvider`：语言、`t()`、`document.lang/title`、`format` 的 locale。
- `ToastProvider`：全局 toast 队列。
- `AppProvider`：overview/system/settings/stats、加载/错误、模态框、作者名、SSE。

`AppShell` 职责：

- 渲染 `TopNav`、`<main><AppRoutes/></main>`、`Footer`。
- 根据 `matchRoute(path)` 判定「项目工作区」路由（`/p/:id` 或 `/p/:id/previews`）：这类路由给 shell 加 `app-shell-workspace`，隐藏 `Footer`，`<main>` 高度锁定为视口减去顶栏，工作区自己吞掉滚动；其他路由保持普通文档流。
- 挂载四个全局模态框：`ShareModal`、`AddProjectModal`、`ProfileModal`、`CommandPalette`。
- 全局快捷键：
  - `Cmd/Ctrl+K`：打开/关闭命令面板；
  - `Escape`：关闭当前激活的模态框；
  - `/`（非输入框内）：打开命令面板。

`AppRoutes` 用 `matchRoute(path)` 决定页面；`ProjectPage` 以 `projectId` 作为 `key`，切项目时强制重置内部状态。

## 4. 路由与 URL

| 路径 | 页面 | 说明 |
| --- | --- | --- |
| `/` | Dashboard | 空状态引导或项目工作台 |
| `/p/:projectId` | ProjectPage | tab 缺省为 `previews`，渲染全屏预览工作区 |
| `/p/:projectId/overview` | ProjectPage | brief + README（沿用项目头部 + tabs） |
| `/p/:projectId/previews` | ProjectPage | 全屏分支预览工作区（默认） |
| `/p/:projectId/notes` | ProjectPage | 笔记 |
| `/p/:projectId/settings` | ProjectPage | 项目设置 |
| 其他 | NotFound | |

- `matchRoute` 接受任意 tab 字符串；`ProjectPage` 用 `TABS` 校验，非法值回退 `previews`。
- 查询参数：
  - `previews?branch=<name>&compare=<name>`：初始分支与对比分支；选中变化后用 `history.replaceState` 同步 URL。
  - `notes?note=<id>`：初始打开的笔记；切换笔记后同样 `replaceState`。
- 这些 `replaceState` 不经过 Router，所以 Router 的 `path/query` 不会立刻更新；由于只改 query、path 不变，路由匹配不受影响。但浏览器后退到不同 query 时，页面不会重新读取 query（`ProjectPreviews`/`ProjectNotes` 只在挂载时读一次）。
- `Link` 只拦截普通左键（无 meta/ctrl/shift、button=0）；`target=_blank` 等场景用原生 `<a>`。

## 5. 数据流

### 5.1 三层来源

```text
AppContext（全局）
  ├─ GET /api/overview + /api/system（同时）
  ├─ SSE /api/events → 防抖 refresh + window "vercio:event"
  └─ 模态框/作者/设置

页面局部 state（各自 fetch）
  ├─ ProjectPage: GET /api/projects/:id
  ├─ ProjectOverview: /readme, /notes
  ├─ ProjectPreviews: /branches, /deployments, /logs, /changes, /comments, /notes
  ├─ ProjectNotes: /notes, /branches
  └─ CommentsPanel: /comments

高频轮询
  └─ ProjectPreviews: 未就绪部署每 1.1s 拉 deployment + logs
```

没有全局缓存/失效库；每次事件后各页面自行重新请求。

### 5.2 AppContext

```ts
{
  overview, systemInfo, settings, stats, loading, error,
  refresh(), saveSettings(patch),
  openModal(name), closeModal(), activeModal,
  authorName
}
```

- 初始 `refresh()` 并行请求 overview + system；loading 只在第一次完成后置 false。
- `authorName`：先读 `localStorage("vercio:author")`，`settings.userName` 变化时覆盖。
- `saveSettings` 成功后更新 settings、author、localStorage，并 toast。
- SSE 处理：除 `settings.updated` 外的所有事件触发 260ms 防抖 `refresh()`，并把 `{type,data}` 作为 `CustomEvent("vercio:event")` 派发到 `window`，供页面监听。
- `activeModal`：`"add-project" | "share" | "profile" | "palette" | null`。

### 5.3 SSE 监听

`useEventStream(onEvent)` 在 `lib/hooks.ts` 里写死事件名列表：

```text
project.created / project.updated / project.deleted
deployment.created / deployment.updated
note.changed / comment.changed / settings.updated
```

EventSource 自动重连；服务端的 `hello` 没有监听，也没有断线补偿刷新。新增事件必须加进这个列表。

### 5.4 页面级刷新

- `ProjectPage`：挂载时 `api.project`；监听 `vercio:event`，事件带 `projectId` 且匹配（或没有 projectId）时静默 reload。
- `ProjectPreviews`：监听事件 → `loadBranches(true)`；部署状态另有自己的轮询。
- `ProjectNotes`：监听事件 → 重拉 notes 列表（不覆盖正在编辑的 draft）。
- `CommentsPanel`：监听**所有** `vercio:event` → 重拉当前分支评论（没有过滤项目/分支，属于低效但安全）。
- `ProjectOverview` 不监听事件；刷新依赖进入页面或父级 reload。
- `ProjectSettings` 不监听事件；保存后手动 `onReload`。

### 5.5 部署状态管理（ProjectPreviews）

```text
branches: BranchList | null
selected: string
compare: boolean
compareBranch: string
device: "desktop" | "tablet" | "mobile"
deployments: Record<branch, Deployment>
logs: Record<deploymentId, string>
reloads: Record<branch, number>
changes: BranchChanges | null
commentCount: number
notes: Note[]（给讨论面板的关联笔记）
focus: boolean（浏览器视口内的沉浸预览模式）
inflight: ref<Set<branch>>（防重复请求）
```

`ensureDeployment(branch, force)`：

- 已有 `ready` 或未就绪（queued/preparing/installing/starting）的部署 → 直接复用；
- `force=true`（重试）→ 重新 POST；
- 同分支请求在 `inflight` 中 → 不重复发；
- 成功后写入 `deployments[branch]`；未就绪则拉一次日志。

**本地服务的启动必须由用户明确触发**：页面加载、深链、切换分支、切换 compare 分支都不会调用 `api.deploy`；只有两种入口会真正启动：

1. 预览舞台的 idle / stopped 状态里的「启动预览」按钮（切换分支本身不会启动服务）；
2. 失败状态的「重试预览」（`ensureDeployment(branch, true)`）。

初始分支：URL `?branch=` 命中分支列表则用它，否则 `defaultBranch`；只同步已有部署快照，不自动启动。若 `?compare=` 命中且不等于初始分支，则自动打开对比（同样不自动启动第二个 pane）。

轮询：所有 pending 部署每 1.1s 并发拉 `GET /deployments/:id` + `/logs`；任一进入终态 → 重新拉分支列表，并立即拉一次该部署日志、600ms 后再补一次（捕获退出时刷出的尾部输出）。

**实时预览**：`Deployment.live === true` 表示该部署的分支就是工作副本当前 checked-out 分支，服务端会把未提交改动同步进 worktree（见 [architecture.md §8.8](architecture.md)），前端不需要额外轮询——HMR 会自己更新 iframe。工具栏在 ready 且 live 时显示带绿点的 `LIVE` 徽标（`t("preview.live")`，tooltip 为 `preview.liveHint`）；其它分支保持提交快照。`live` 只是展示性状态，停止/失败时徽标随之消失。

### 5.6 笔记保存

`ProjectNotes` 用 `draft`（title/body/tags 字符串/pinned/branch）驱动编辑：

- 切换选中笔记、创建笔记时把 `skipNextSave` 置 true，避免刚加载就保存。
- `draft` 变化后 700ms 防抖 PATCH；`Cmd/Ctrl+S` 立即保存。
- 保存状态 `idle/saving/saved/error` 显示在编辑器顶部。
- SSE 只更新左侧列表，不会把远端变更合并进当前 draft（避免覆盖输入）。
- 标签输入是逗号分隔字符串，提交时 split/trim/限 8。

## 6. API 客户端

`web/src/lib/api.ts`：

- `request<T>(path, options)`：统一 `fetch`，自动加 `Content-Type`（有 body 时），解析 JSON，非 2xx 抛 `ApiError(message, status, details)`。
- `pickFolder(path?, prompt?)`：`POST /api/fs/pick-folder`，返回 `FolderPickResult = { path?: string; cancelled?: boolean }`。这是一个可能挂起数分钟的长请求，调用方要处理 `504/501/500`。
- `browseDirectory(...)`：页内目录浏览；系统文件夹窗口不可用时由 `AddProjectModal` 回退到这里。
- `ApiError` 的 message 取自 `{error.message}`，没有则 `Request failed (status)`。
- `api` 对象按资源分组；所有路径用相对路径 + `encodeURIComponent`。
- 类型来自 `lib/types.ts`；这些类型是服务端 DTO 的手写镜像，**改服务端字段必须同步这里**。

新增 API 调用：在 `api` 加方法 → 在页面使用 → 若需要错误分支（如目录浏览的 `details.code`、系统对话框的 501/504），用 `instanceof ApiError` 判断。

## 7. 页面地图

### Dashboard（`pages/Dashboard.tsx`）

- 无项目：hero + 两个 CTA（Add project / Load demo）+ 三张特性卡 + 产品 mock。
- 有项目：标题/统计条（projects/branches/live/notes+comments）、项目卡网格、最近部署列表、ShareCard、本地优先说明。
- 数据全部来自 `AppContext`；`Load demo` 调 `POST /api/projects/demo` 后刷新并跳转。
- 空状态与加载骨架是两套 JSX。

### ProjectPage（`pages/ProjectPage.tsx`）

两种布局，由 `activeTab` 决定：

- **`previews`（默认）**：全屏工作区 `.project-workspace`，不再渲染项目头部、tagline、操作按钮和 tab 条。直接渲染 `ProjectPreviews`；项目上下文（mark、名称、仓库路径、分支数、默认分支、未提交警告）由 `TopNav` 展示。加载/导入中/导入失败/未找到各自有工作区内的状态位。
- **`overview` / `notes` / `settings`**：沿用旧的项目头部（mark、名称、tagline、Refresh/Share/Preview、元信息、tabs）+ `container` 页面布局；tabs 仍可切回预览。

- 项目详情由本页加载，tab 子页面通过 props 拿 `project`。
- `importing`：状态卡（无日志，只有 spinner）；`error`：错误 + 重试导入。
- 「刷新仓库」入口：工作区里在左侧分支栏底部的 `…` 菜单中（`onRefreshRepo` 传回本页）；其他 tab 仍在头部按钮。

### ProjectOverview（`pages/ProjectOverview.tsx`）

- Product brief：Markdown 预览 / textarea 编辑（显式 Save，PATCH description）。
- README：`GET /readme`，默认截断，可展开；用 `Markdown` 渲染。
- 右侧：仓库信息（来源/默认分支/分支数/路径/最新提交/脏文件）、部署列表（前 5）、笔记（前 4）、ShareCard。
- 存在刷新按钮（调用 `refreshProject` + 父级 reload）。

### ProjectPreviews（`pages/ProjectPreviews.tsx`）

全屏两栏（`.previews`，`grid-template-columns: 200px 1fr`，无卡片边框/圆角，高度吃满 `.project-workspace`）：

- 左 `BranchPanel`：分支标题 + 计数 + 收起/刷新、搜索、分支卡（选中高亮）、底部提示 + `…` 菜单（Compare、Overview、Notes、刷新仓库）。
- 右键分支卡弹出上下文菜单：置顶 / 取消置顶（`Project.pinnedBranch`，同一时间最多一个）。置顶分支排到列表最前并显示 pin 图标；动作乐观更新并 PATCH `/api/projects/:id`，失败回滚 + toast。底部提示被窄栏截断时，完整文案放在 `title` tooltip 里。
- 分支栏可折叠成 44px 竖排窄条（`.previews-branches-collapsed`，只留展开/刷新按钮与分支数）；折叠状态存 `localStorage` 的 `vercio:branch-panel-collapsed`，≤860px 堆叠布局下强制展开并隐藏收起按钮。
- 中 `preview-stage`：工具栏（分支名/状态/LIVE 徽标/mode/prod 标签 + 设备切换 + Discussion + Settings）、1 或 2 个 `BrowserFrame`、底部状态条（sha/提交信息/作者/时间、diff 统计、框架、Stop、部署 id、「分享预览」分支局域网链接）。
- 「设置」按钮跳 `/p/:id/settings`；「概览 / 笔记」在左侧底部 `…` 菜单里。
- 点击分支只切换视图；未运行的分支显示 idle 状态和「启动预览」按钮，不弹确认框。任何自动路径都不会 POST deploy。
- 浏览器框右上角有「全屏预览」按钮：给 `.preview-frame-wrap` 加 `.is-focus`（`position: fixed; inset: 0`），只铺满**浏览器视口**，浏览器标签页和地址栏仍可见（不调用原生 Fullscreen API，不会占满显示器）。进入后只显示 iframe 页面，底部居中浮层 `退出全屏 Esc`；父页面监听 `keydown` 处理 Esc（点击 iframe 内部后焦点进入跨源文档、Esc 不再冒泡，此时用浮层按钮退出）。预览状态变为非 ready 时自动退出。
- 设备切换在 compare 时禁用；compare 的第二个 pane 用 `<select>` 选分支；未运行的分支在 pane 里直接给「启动预览」按钮。
- 讨论面板（`previews-with-discussion`）展开为第三栏，打开时隐藏 compare 与底部左侧提交信息。
- 空分支/加载/错误各有独立状态；宽度 ≤860px 时工作区改为上下堆叠并允许页面滚动。

### ProjectNotes（`pages/ProjectNotes.tsx`）

- 左：搜索、笔记列表（置顶、摘要、分支、相对时间）、新建。
- 右：标题、pin、删除、保存状态、字数、编辑时间、分支关联、Write/Preview 切换、标签、正文。
- 删除有 ConfirmDialog；空列表有空状态。

### ProjectSettings（`pages/ProjectSettings.tsx`）

- 项目详情（name/tagline/links）、仓库信息（来源/路径/默认/当前/脏文件）、本地资料（displayName，全局 settings）、危险区（输入项目名确认删除）。
- 右侧：ShareCard + 工作台信息（网络地址、数据目录、版本、最大预览数、复制链接）。
- 删除时对本地路径项目传 `deleteRepo=false`。

### NotFound

简单 404 + 回首页。

### 添加项目的浏览流程

1. 本地 tab 点「浏览」→ `browsing=true`，按钮显示「正在打开…」。
2. `api.pickFolder(source.trim(), t("add.pickPrompt"))` → 服务端在**运行 Vercio 的机器**上弹系统窗口。
3. 成功：`result.path` 写入路径输入框；`cancelled` 则什么都不做。
4. `ApiError.status >= 500 && status !== 504`（501/500 等）：toast `add.dialogFallback`，打开 `DirectoryPickerModal` 作为回退。
5. `504`：显示 `add.dialogTimeout`，不自动回退。
6. 其他错误（400/403 等）：显示错误信息。
7. 页内选择器只能选中 Git 仓库；系统窗口可以选任意目录，提交时由 `POST /api/projects` 再校验。

## 8. 组件地图

| 组件 | 职责 | 关键点 |
| --- | --- | --- |
| `ui.tsx` | Button/Spinner/StatusPill/Badge/Modal/ConfirmDialog/Field/TextInput/TextArea/Skeleton/CopyButton/EmptyState/Kbd | `Modal` 用 portal、Escape、锁 body 滚动；无 focus trap；`ConfirmDialog` 可要求输入确认文本；`StatusPill` 依赖 `format.statusTone` 与 `status.*` 文案 |
| `Toast.tsx` | 全局 toast | 最多保留 4 条；error 6.5s，其余 3.8s；`useToast().pushToast` |
| `TopNav.tsx` | 顶栏 | 搜索入口、Share、头像（语言/主题在「本地资料」弹窗里）；项目路由下显示 `项目 ›` + 项目 mark/名称/仓库路径/分支数/默认分支/未提交警告（窄屏逐级隐藏，数据来自 overview 里的 Project）；点项目名称弹出切换菜单（列出所有项目，保留当前 tab，Escape/外部点击关闭）；Dashboard 只显示「项目」 |
| `CommandPalette.tsx` | 命令面板 | 项目跳转 + 添加/演示/分享/复制地址/刷新；↑↓/Enter/Esc；分组 |
| `AddProjectModal.tsx` | 添加项目 | GitHub/本地两个 tab；「浏览」先调系统文件夹窗口，成功填入路径；5xx（504 除外）时 toast 并回退到页内目录选择器；创建后跳项目页 |
| `DirectoryPickerModal.tsx` | 页内目录选择器（系统窗口回退） | 只列目录、Git 标记、面包屑、快捷根、显示隐藏、请求序号防竞态；Escape 捕获阶段 `stopImmediatePropagation` 避免连带关闭父模态框；只能选 Git 仓库 |
| `ShareModal.tsx` / `ShareCard.tsx` | 分享 | 二维码 data URL、LAN 地址列表、复制；无 LAN 时提示；从预览页打开时通过 `shareTarget` 分享当前分支的局域网深链（`/p/:id/previews?branch=<encoded>`），其余入口仍分享工作台地址 |
| `ProfileModal.tsx` | 本地资料 | 显示名保存到服务端 settings；语言/主题切换 |
| `LanguageSwitcher.tsx` | EN/中文 | 即点即生效并持久化 |
| `ThemeToggle.tsx` | 亮/暗 | 顶栏不再放置；主题切换在「本地资料」弹窗的 segmented 控件（`useTheme`） |
| `ProjectCard.tsx` | 项目卡 | `ProjectMark` 按名称哈希色相；导入/失败/未部署状态；最新提交 |
| `DeploymentList.tsx` | 部署列表 | 表格与紧凑两种；链接到 `?branch=` |
| `BranchPanel.tsx` | 分支列表 | 过滤 name/subject/author；每分支部署状态；prod 标签 |
| `PreviewPane.tsx` | 预览核心 | `PENDING_STATUSES`/`isPendingStatus`、`PreviewState`（构建步骤/错误/停止/日志）、`BrowserFrame`（设备框、iframe、复制、新标签、刷新） |
| `CommentsPanel.tsx` | 分支讨论 | 关联笔记（`note.branch === branch`）、发评论、仅删除自己 client 的评论、Cmd/Ctrl+Enter |
| `Markdown.tsx` | Markdown 渲染 | memo + `renderMarkdown` |
| `TerminalLog.tsx` | 日志 | 自动滚到底、行数统计 |
| `Logo.tsx` / `icons.tsx` | 品牌/图标 | 内联 SVG |

## 9. i18n

- `dictionary.ts` 先定义 `en` 对象字面量，再 `export type TranslationKey = keyof typeof en`，最后 `zh: Record<TranslationKey, string>`。**`en` 是源**；给 `en` 加 key 后，若 `zh` 缺同名字符串，`tsc` 会报错。
- `t(key, vars?)`：当前语言 → 缺失回退 `en` → 再缺失回退 key 本身；`{name}` 占位符替换。
- 语言检测：`localStorage("vercio:language")` → 浏览器语言以 `zh` 开头则中文，否则英文。
- 切换语言会更新 `<html lang>` 和 `document.title`；页面内 `document.title` 没有按路由定制（`useDocumentTitle` 未被使用）。
- `format.ts` 的相对时间/日期通过 `setFormatLocale` 跟随语言；不是 React 响应式，语言切换后由重渲染更新。
- 项目内容（分支名、README、brief、笔记、评论、错误详情）不翻译。
- **新增固定文案**：加到 `en` 与 `zh` 同一位置附近，命名 `domain.camelCase`；在组件里用 `useT()`；跑 `npm run typecheck`。系统文件夹窗口相关文案在 `add.*`（`add.openingDialog`、`add.browseHint`、`add.pickPrompt`、`add.dialogFallback`、`add.dialogTimeout` 等）。
- 新增语言：扩展 `Language` 类型、`translations` 映射、`LanguageSwitcher`，并提供完整字典；`Record` 会强制完整性。

## 10. 主题与 CSS

### 主题

- `ThemeProvider`：默认读 `localStorage("vercio:theme")`，否则 `prefers-color-scheme: light` → light，否则 dark。
- 写入 `<html data-theme="light|dark">`，并更新 `<meta name="theme-color">`（light `#fafafa`，dark `#000000`）。
- `web/index.html` 的内联脚本做首屏防闪烁；**改 key 或默认值时要同时改这里**。
- 亮色覆盖集中在 `theme-light.css`，通过 `[data-theme="light"]` 选择器；terminal 与 hero 产品 mock 刻意保持深色。

### CSS 架构

| 文件 | 内容 |
| --- | --- |
| `base.css` | `:root` 设计变量（颜色/圆角/字体/阴影/缓动）、reset、排版、`.container`、`.prose`、滚动条、动画 |
| `components.css` | 顶栏、按钮、卡片、badge、status、modal、toast、palette、部署列表等跨页面组件 |
| `pages.css` | Dashboard、项目页、预览器、笔记、设置、响应式；约 3600 行，是主要布局文件 |
| `theme-light.css` | 亮色变量与逐组件覆盖 |

约定：

- 颜色/边框/阴影/字体一律用 `var(--...)`；新增颜色先加变量，再在亮色主题给对应值。
- 类名是全局的，没有 CSS Modules；新页面用独特前缀（如 `.myfeature-*`），避免和现有 `.card/.preview-*` 冲突。
- 布局：`.container` 全宽 + `clamp()` 边距；预览页用 grid（分支栏 / 舞台 / 讨论）；页面级响应式断点 1180/1000/860/620；预览舞台还有 `@container stage` 查询。
- 设备框：`.device-desktop/.device-tablet/.device-mobile` 控制 iframe 宽度。
- 状态色：`.status-ready/.status-pending/.status-error/.status-idle` 与 `--green/--amber/--red`。
- 动画：`--ease/--ease-out`；`.spin` 用于 spinner。

### 新增样式放哪

- 只属于某个页面 → `pages.css` 对应区块；
- 跨页面复用 → `components.css`；
- 新设计 token → `base.css` + `theme-light.css` 两处；
- 不要内联颜色（除非一次性动态色相，如 `ProjectMark` 的 `--mark-hue`）。

## 11. Markdown 安全

`lib/markdown.ts`：

```ts
marked.setOptions({ gfm: true, breaks: false });
renderMarkdown = (src) => DOMPurify.sanitize(marked.parse(src), { ADD_ATTR: ["target", "rel"] });
```

- 所有最终渲染为 HTML 的用户内容（brief、README、笔记）都在渲染前经过 DOMPurify；`Markdown` 组件用 `dangerouslySetInnerHTML`。
- 评论是纯文本 `{comment.body}`，不渲染 Markdown；笔记预览与 brief/README 渲染 Markdown。
- `marked` 默认不生成 `target`，`ADD_ATTR` 只是允许作者写 HTML 时保留；没有强制外链 `rel="noreferrer"`。若要加固，在 `renderMarkdown` 后处理链接。
- 服务端不渲染 Markdown，因此不存在服务端模板注入（状态页除外，见架构文档）。

## 12. 关键交互细节

- **全局模态框**：同一时间只有一个 `activeModal`；`Escape` 由 AppShell 与 `Modal` 各自监听，重复关闭无害；目录选择器用捕获阶段阻止父级 Escape。
- **命令面板**：`Cmd/Ctrl+K` 切换；输入框内 `/` 不触发；项目项与动作项统一过滤 label/hint。
- **复制**：优先 `navigator.clipboard.writeText`，失败回退 textarea + `execCommand`；按钮 1.6s 反馈。
- **Toast**：最多 4 条；错误停留更久。
- **iframe**：`src="/preview/<id>/"`；`key = deployment.id + ":" + reloadKey` 强制重载；未 ready 时渲染 `PreviewState`；`allow="clipboard-read; clipboard-write"`；加载 1.4s 后显示“首次加载可能较慢”提示。
- **跨源限制**：iframe 的 origin 是 `http://host:41xx`，与父页面不同源。父页面不能读取/修改预览 DOM，也没有注入脚本；要做元素级评论必须新增 postMessage 协议或代理方案。
- **Compare**：只在至少 2 个分支时可用；第二个 pane 的分支选择会排除当前主分支；两 pane 共享 device；讨论与 compare 互斥。
- **重试**：`ensureDeployment(branch, true)` 新建部署；不会复用 error/stopped 记录。
- **不自动启动本地服务**：分支点击、初始加载、深链 `?branch=`/`?compare=`、切换 compare 分支都只切换视图，不弹确认框、不 POST deploy；启动只能通过显式的「启动预览」/「重试预览」按钮。分支已有 ready/pending 部署时直接复用，不算启动。
- **分支分享**：预览页底部的「分享预览」调用 `openModal("share", { projectId, branch })`；`ShareModal` 用 `systemInfo.primaryUrl + /p/:id/previews?branch=<encodeURIComponent(branch)>` 生成局域网链接，LAN 地址行和「本机」行都带同样的分支路径；分支模式不显示二维码（二维码只编码工作台地址）。关掉模态框会清空 `shareTarget`，顶部 Share 仍是工作台分享。
- **全屏预览**：`focus` 状态给包装层加 `.is-focus`，`position: fixed; inset: 0` 只覆盖浏览器视口，标签栏/地址栏保留；不调用原生 Fullscreen API。Esc 由父页面 `keydown` 处理；iframe 跨源，焦点进入预览后键盘事件不冒泡，此时用底部浮层按钮退出；预览非 ready 时自动退出。
- **停止**：调用 stop API 后更新本地 map；如果服务端返回 409（已停），toast 错误。
- **笔记深链**：`/notes?note=<id>` 只在挂载时读取；从讨论面板点关联笔记会走 `Link` 导航，ProjectPage 不重新挂载（同一路由 tab 变化），但 `ProjectNotes` 监听 `project.id` 而非 query，**切换 note query 不一定切换选中笔记**。这是已知行为，改深链时要一起处理。
- **相对时间**：`relativeTime()` 在渲染时计算，没有定时器；页面不重渲染时不会自动“变旧”。

## 13. 新增功能的落点

| 需求 | 主要文件 | 联动 |
| --- | --- | --- |
| 新项目 tab | `ProjectPage.tsx` 的 `TABS` + 条件渲染；新建页面组件 | 字典 `project.tab.*`、`pages.css`、`matchRoute` 不需要改（任意 tab 都接受）；若要默认 tab 改 `matchRoute` |
| 新顶层页面 | `lib/router.tsx` 的 `RouteMatch/page` 与 `matchRoute`；`App.tsx` 的 `AppRoutes` | `TopNav` 面包屑、字典、样式 |
| 新全局模态框 | `AppContext` 的 `ModalName`；`App.tsx` 挂载 | 打开入口、Escape 行为、样式 |
| 新 API 调用 | `lib/api.ts` + `types.ts` | 页面 state/错误处理、文档 api.md |
| 新 SSE 事件 | `lib/hooks.ts` 监听列表 | 服务端 emit、AppContext 转发、页面监听 |
| 新状态 | `types.ts`、`ui.tsx`、`format.ts`、`dictionary.ts`、CSS、`PreviewPane.tsx` | 服务端状态机、状态页、测试（见 ai-coding） |
| 新文案 | `i18n/dictionary.ts` 的 `en`+`zh` | 组件 `t()`；typecheck |
| 新语言 | `i18n/index.tsx`、`dictionary.ts`、`LanguageSwitcher` | 全部 key 的翻译 |
| 新主题 | `base.css` 变量 + `theme-light.css` + `theme/index.tsx` + `index.html` 内联脚本 | `web/index.html` meta |
| 新 Markdown 能力 | `lib/markdown.ts` / `Markdown.tsx` | XSS 审查、样式 `.prose` |

## 14. 已知限制与坑（前端）

- **无 focus trap / focus restore**：模态框打开后 Tab 可以跑出去；做可访问性改造时注意 `aria-modal` 已有但行为不完整。
- **无 code splitting**：所有页面静态 import，首包包含整个应用；要优化需改 `AppRoutes` 为 `lazy` + `Suspense`。
- **样式全局**：新增通用类名可能影响其它页面；`pages.css` 已有大量选择器。
- **query 状态不完整**：`replaceState` 绕过 Router；浏览器前进/后退到不同 query 时页面不会重新读取初始参数。
- **SSE 断线不补偿**：没有 `hello` 刷新、没有 `Last-Event-ID`；长时间断网后 UI 可能陈旧。
- **评论面板过度刷新**：监听所有事件，未按项目/分支过滤。
- **笔记 draft 不合并远端变更**：多人同时编辑同一笔记时后保存者覆盖。
- **错误文案**：服务端英文错误直接 toast，未翻译。
- **`useDocumentTitle`、`useMediaQuery`、`useLocalStorage`、`useClickOutside`、`TextArea`** 当前未使用（或仅定义），不要误以为已有对应行为。
- **构建后需刷新**：生产模式服务端读 `dist/`；重新 build 后浏览器需刷新，静态资源缓存 60s。
- **`window.location.origin` 复制预览链接**：在局域网访问时 origin 即 LAN 地址，行为正确；但通过反向代理/自定义 host 访问时以浏览器地址为准。
- **系统文件夹窗口是远程的**：对话框在运行 Vercio 的机器上弹出，不是访问者的浏览器；局域网设备点「浏览」也会让主机弹窗。请求可能挂起数分钟，浏览器关闭时服务端 abort。无 GUI 的机器会走 501 → 页内浏览器回退。
- **无前端测试**：改 UI 逻辑只能靠 typecheck + 手工/浏览器验证；注意回归。
