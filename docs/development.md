# 开发与验证

## 1. 前置条件

- Node.js `^20.19.0 || >=22.12.0`（`.nvmrc` 为 22；README 记录在 Node 25 验证）。
- Git（预览本身也要求系统 `git` 在 PATH 中）。
- macOS 或 Linux。Windows 有系统文件夹窗口实现，但预览相关的目录 symlink、进程组、Wi-Fi 检测均未验证。
- 可选：pnpm / yarn / bun（预览使用对应 lockfile 的项目时需要）。

## 2. 首次启动

```bash
npm install

# 开发：API 4000 + Vite 5173
npm run dev
# 打开 http://localhost:5173

# 生产：构建后由 Node 单服务托管
npm run build
npm start
# 打开 http://localhost:4000
```

`npm run dev` 会先启动 `server/index.js`，250ms 后启动 Vite；任一子进程退出会杀掉另一个。Vite 把 `/api`、`/preview` 代理到**固定的** `http://127.0.0.1:4000`。

## 3. 命令表

| 命令 | 作用 | 备注 |
| --- | --- | --- |
| `npm run dev` | 开发模式（API + Vite） | API 端口来自 `VERCIO_PORT`，默认 4000；Vite 代理不跟随 |
| `npm run build` | `vite build` → `dist/` | `web/` 为 root，无 sourcemap |
| `npm start` / `npm run server` | 启动主服务 | 需要 `dist/` 才有 UI；否则返回提示文本 |
| `npm run start:open` | 启动并打开浏览器 | macOS/Linux/Windows 分别用 open/xdg-open/start |
| `npm test` | `node --test --test-concurrency=1 tests/*.test.js` | 集成/单元测试，会真跑 git/dev server；文件串行执行 |
| `npm run typecheck` | `tsc --noEmit` | 只检查 `web/src` 与 `vite.config.ts` |
| `npm run demo` | 在数据目录生成 demo 项目 | 不启动服务；复用已有 Lumen 仓库 |
| `node server/index.js --port 4001 --host 127.0.0.1 --data-dir ~/.vercio --open` | 手动指定配置 | `--port/-p`、`--host`、`--data-dir`、`--open/-o` |

单独跑一个测试文件：

```bash
node --test tests/api.test.js
node --test --test-name-pattern="static preview" tests/api.test.js
```

## 4. 开发模式 vs 生产模式

| 项 | 开发 | 生产 |
| --- | --- | --- |
| 前端来源 | Vite 5173（HMR） | `dist/`（`npm run build`） |
| 访问地址 | `http://localhost:5173` | `http://localhost:4000` |
| API 来源 | Vite 代理到 4000 | 同源 4000 |
| SPA fallback | Vite 自带 | `routes.js` 对无扩展名路径回 index.html |
| 预览 iframe | `/preview/...` 经 Vite 代理到 API，再 302 到预览端口 | 主服务直接 302 |
| 端口改动 | 改 `VERCIO_PORT` 后需同步改 `vite.config.ts` 代理 | 直接生效 |

开发时局域网访问：Vite 默认只监听 localhost；需要 `--host` 才能从手机访问，但即使访问 5173，预览重定向后的 41xx 仍可直接访问。

## 5. 测试架构

`tests/` 使用 Node 内置 `node:test`，没有测试框架依赖。

| 文件 | 覆盖 |
| --- | --- |
| `api.test.js` | 项目创建/更新、分支、diff、README、静态预览生命周期与 302、笔记、评论（含 403）、system/overview、设置、删除 |
| `deployments.test.js` | 自定义 dev server 预览（启动/日志/停止/停止后的状态页）、无 dev script 时显式 server 模式失败、并发 worktree 隔离 |
| `preview.test.js` | pnpm/Vite 参数转发（不能出现多余的 `--`）、失败预览的 error 摘要与完整日志（含退出时刷出的尾部）、worktree 继承本地 `.env*`、Vite fs.allow overlay 的启用与回退 |
| `vite-overlay.test.js` | overlay 只对纯 `vite` 脚本生效、生成内容包含项目 config 与 `fs.allow`、无 config 时的兜底、软链 node_modules 检测 |
| `live-sync.test.js` | `git status -z` 解析（含重命名）、watcher 忽略目录、工作副本改动/删除/恢复镜像、node_modules/.git 不被同步 |
| `frameworks.test.js` | `devCommand` 的包管理器差异（npm 保留 `--`，pnpm/yarn/bun 不加）、Next/vite 端口参数、安装计划跳过 |
| `folder-dialog.test.js` | 起始目录解析、macOS argv 安全、Linux zenity→kdialog 回退、取消/不可用/非法路径、API 委托与参数校验 |
| `git.test.js` | 默认分支、分支列表、ref 解析、README、diffStat、仓库信息、错误分支 |
| `browse.test.js` | 目录浏览、隐藏目录、Git 标记、`~`、根目录、缺失/非目录错误、非 GET 方法 |
| `demo.test.js` | demo 生成、4 分支、种子笔记/评论、两条分支内容不同、重复载入复用、diff |

### helpers

`tests/helpers.js`：

- `makeRepo(name, {files, branches})`：在系统临时目录创建真实 git 仓库与分支，每个分支可替换文件。
- `writeFiles(dir, files)`：递归写文件。
- `devServerSource(heading)`：生成读取 `PORT/HOST` 的最小 Node dev server 源码。
- `staticPage(heading)`：生成静态 HTML。
- `startApp(overrides)`：用临时 dataDir + `port: 0` + `127.0.0.1` 启动，返回 `{app, base, dataDir, cleanup}`；`overrides.folderDialog` 可注入假对话框。
- `request(base, method, route, body)`：JSON 请求，返回 `{status, json, headers}`。
- `waitForDeployment(base, id, timeout=90s)`：轮询到终态。
- `deployBranch(base, projectId, branch, mode)`：创建部署并等待终态。

### 运行特征

- `package.json` 固定 `--test-concurrency=1`：**测试文件串行执行**，因为多个文件都会真实启动 dev server、抢 4100–4999 端口。每个文件仍是独立 Node 进程。
- 即使串行，两个同时运行的 `npm test`（或另一个正在跑的 Vercio）仍可能抢端口；失败信息里出现 `Port 4100 is already in use` 时先查残留进程。
- 每个 `startApp` 用独立临时目录与随机主端口；结束后删除临时目录。
- 测试会真实启动 dev server 子进程、占用 4100–4999 端口；**不要**在测试里假设固定端口。
- 超时：部署/预览相关 120s，browse/folder-dialog 30–60s，demo 180s；纯函数测试不设超时。
- 全量通常十几秒到 1 分钟；首次生成 demo 或真实安装依赖会更久。
- `demo.test.js` 在 `examples/demo/manifest.json` 不存在时 skip。
- `preview.test.js` 的 pnpm 用例在未安装 pnpm 时 skip（`hasBinary("pnpm")`）。
- 测试**不要**读写仓库根 `.vercio/`（那是开发者的真实数据）；`startApp` 已隔离。
- 系统文件夹窗口测试**不会启动真实对话框**：纯函数验证命令构造/解析，注入 runner 覆盖流程，API 测试注入 `folderDialog`；Windows/Linux 的真实桌面行为未自动化。

### 写新测试

1. 复用 `startApp` + `makeRepo`；不要在测试里依赖本机已安装的 pnpm/yarn。
2. 需要 dev server 时用 `devServerSource`，或写成读取 `process.env.PORT` 的最小脚本。
3. 断言 HTTP 状态 + 关键字段；对预览内容用 `fetch(location)` 跟随 302。
4. 所有创建的临时目录用 `t.after` 清理。
5. 慢测试用 `{ timeout: 120000 }` 显式声明。
6. 端口/进程相关测试不要并行共享资源；依赖 `port: 0` 与临时目录。

### 测试缺口（改动时要靠手工补）

- 没有 React 组件/交互测试；没有入库的浏览器 e2e。
- 系统文件夹窗口没有真实 GUI 测试：只用注入 runner 验证命令构造、解析与错误映射；Windows 命令没有单测，Windows/Linux 实际桌面行为未验证。
- 没有 Windows 的 worktree/进程组/预览测试。
- 没有鉴权/安全测试（本来也没有鉴权）。
- 没有大仓库、二进制 diff、子模块、LFS 测试。
- 没有依赖安装成功的测试（测试 fixture 都是零依赖、node_modules 标记或手工 node 脚本）。
- pnpm 预览回归测试在未安装 pnpm 的机器上 skip。
- 没有 SSE 重连/事件顺序测试。
- 没有 schema 迁移测试。

## 6. 类型检查与构建

```bash
npm run typecheck   # 必须通过
npm run build       # 必须通过
```

- `tsc` 只覆盖 `web/src` 与 `vite.config.ts`；`server/` 是 JS，没有类型检查。
- 构建失败常见原因：i18n 字典缺 key（`zh: Record<TranslationKey,string>` 会报）、DTO 类型不匹配、未使用的导入（TS 配置未开 noUnusedLocals，通常不报）。
- 构建产物在 `dist/`，被 `.gitignore` 忽略；不要提交。

## 7. 手工验证 recipe

### 7.1 API 冒烟（无需浏览器）

```bash
npm run build && npm start &
BASE=http://127.0.0.1:4000

curl -s "$BASE/api/health"

# 用一个临时 git 仓库
TMP=$(mktemp -d)
git -C "$TMP" init -b main
printf '<h1>hello</h1>' > "$TMP/index.html"
git -C "$TMP" add -A
git -C "$TMP" -c user.email=t@t -c user.name=t commit -m init

curl -s -X POST "$BASE/api/projects" -H 'content-type: application/json' \
  -d "{\"source\":\"$TMP\"}"

# 记下返回的 project.id，创建部署并记下 deployment.id
curl -s -X POST "$BASE/api/projects/<prj>/deployments" \
  -H 'content-type: application/json' -d '{"branch":"main"}'

# 循环直到 status=ready
curl -s "$BASE/api/deployments/<dpl>"

# 应看到 302，然后跟随后能看到 hello
curl -si "$BASE/preview/<dpl>/" | head -n 10
curl -sL "$BASE/preview/<dpl>/" | head
```

更完整的接口与错误码见 [api.md](api.md)。

### 7.2 UI 手工清单（改动前端/状态时）

1. `npm run dev`，打开 5173。
2. 空状态 → Load demo → 进入项目 Previews。
3. 切分支：首次出现构建步骤/日志，最终 iframe 显示页面。
4. Compare：选另一个分支，两 pane 独立；切 device；stop 一个预览。
5. Discussion：发评论、删除自己的评论、关联笔记跳转。
6. Notes：新建、自动保存、切分支关联、pin、删除、刷新后仍在。
7. Overview：编辑 brief 保存；README 展开；git refresh。
8. Settings：改名称/标语/链接、删除项目（输入名称确认）。
9. 顶栏：EN/中文、亮/暗、刷新后保持；Share 二维码/LAN 地址。
10. 添加项目：本地 tab 点「浏览」应弹出**主机**的系统文件夹窗口；取消不报错；无 GUI 环境应回退页内浏览器。
11. 手机宽度（DevTools）走一遍 Dashboard/Previews；确认无横向溢出。
12. 浏览器 console 无报错；Network 里无失败的 API。

### 7.3 预览链路专项

- 预览未就绪时直接访问 `/preview/<id>/`：应看到状态页并自动刷新。
- 就绪后：`curl -si` 应 302 到 `http://<host>:<port>/<rest>`。
- 停止后：访问 `/preview/<id>/` 应 200 显示 Preview stopped。
- 重启服务：ready 部署应变 stopped；再次点分支应新建部署并成功。
- 局域网设备：用手机打开 `http://<LAN IP>:4000`，预览应重定向到 `LAN IP:41xx`，不是 localhost。

## 8. 调试 recipe

### 看日志

```bash
ls -lt .vercio/logs | head
tail -f .vercio/logs/dpl_xxx.log
```

前端轮询的是 `/api/deployments/:id/logs`；内存日志与文件日志可能不同（内存最多 4000 行，重启后只有文件）。

### 看数据库

```bash
node -e 'const s=require("./.vercio/db.json"); console.log(s.projects.map(p=>({id:p.id,name:p.name,status:p.status,repo:p.repoPath})))'
node -e 'const s=require("./.vercio/db.json"); console.log(s.deployments.map(d=>({id:d.id,b:d.branch,st:d.status,port:d.port,mode:d.mode,err:d.error})))'
```

注意 `markDirty` 有 80ms 防抖；刚操作完看到的可能是旧文件。

### 看 worktree 与端口

```bash
git -C /path/to/repo worktree list
lsof -nP -iTCP:4100-4999 -sTCP:LISTEN
ps -axo pid,pgid,command | grep -E "vite|next|node.*dev" | grep -v grep
```

### 看 SSE

```bash
curl -N http://127.0.0.1:4000/api/events
```

在另一个终端点分支/发评论，观察事件名与 payload。

### 临时隔离环境

不要拿真实 `.vercio/` 做危险实验：

```bash
TMP_DATA=$(mktemp -d)
VERCIO_DATA_DIR="$TMP_DATA" VERCIO_PORT=3000 npm start
```

预览端口仍用 4100–4999，与主服务端口无关。

### 重置 demo

```bash
rm -rf .vercio/repos/lumen-demo
npm run demo
```

会重新生成 4 分支；已有项目记录会复用同 `repoPath`。

### 清理孤儿进程

先确认再杀，避免误杀其它 Node 项目：

```bash
ps -axo pid,ppid,pgid,command | grep -E "worktrees/.*(vite|next|node)" | grep -v grep
kill -TERM <pgid>   # 已验证是该预览进程组时
```

预览子进程是独立进程组；主服务被 SIGKILL 后它们可能继续运行，端口也不会自动释放。

## 9. 代码约定

### 服务端

- ESM，`import ... from "node:..."`，双引号、分号、2 空格；无 TypeScript、无 JSDoc 强制。
- 业务错误抛 `HttpError(status, message)`；不要在每个 route 里手写 `res.writeHead`。
- 路由保持单函数 `if` 链；新增路由注意顺序，静态路径放通用 `/:id` 前。
- 状态修改：改 `store.get()` 对象 → `markDirty()` → 必要时 `events.emit()`。
- 不新增服务端运行时依赖（除非有充分理由）；文件 IO 用 `fs.promises` 或现有同步模式保持一致。
- git 操作走 `git.js`，不要到处 `spawn("git")`；注意 `GIT_TERMINAL_PROMPT=0`。
- 子进程要 `detached: true` 才能按进程组回收；新增长生命周期进程必须纳入 `stopAll`。

### 前端

- TypeScript strict；函数组件 + hooks；类型放 `lib/types.ts`；避免 `any`（必要时 `unknown` + 收窄）。
- 所有用户可见文案走 `t()`；`en` 与 `zh` 同时加 key。
- 颜色/间距用 CSS 变量；新样式放对文件；类名加页面前缀。
- API 调用只通过 `lib/api.ts`；不要在组件里裸 `fetch`。
- 服务端 DTO 变更时同步 `lib/types.ts`，否则运行时不报错但显示会错。
- 图标用 `lucide-react`；不要引入第二套 UI 库。
- 交互要覆盖加载/空/错误三态（现有页面基本都有骨架和空状态）。

### 通用

- 现有代码注释为英文，文档为中文；保持一致。
- 没有 ESLint/Prettier 配置；跟周围风格即可（2 空格、双引号、尾分号、LF）。
- 不要提交：`node_modules/`、`.vercio/`、`dist/`、`*.log`、`.DS_Store`。
- 改动跨层时按 [ai-coding.md](ai-coding.md) 的联动表检查。

## 10. 配置速查

| 环境变量 | 默认 | 说明 |
| --- | --- | --- |
| `VERCIO_PORT` / `PORT` | 4000 | 主服务端口；`PORT` 优先级更低 |
| `VERCIO_HOST` | 0.0.0.0 | 监听地址 |
| `VERCIO_DATA_DIR` | `<repo>/.vercio` | 数据目录 |
| `VERCIO_MAX_PREVIEWS` | 8 | 同时运行的 **server** 预览上限；静态预览不计入 |
| `NODE_ENV` | 未使用 | 服务端不区分环境 |
| `GIT_TERMINAL_PROMPT` | 代码内设为 0 | 禁止 git 交互式凭据提示 |

CLI 覆盖：`--port/-p`、`--host`、`--data-dir`、`--open/-o`。

## 11. 故障排查

| 症状 | 可能原因 | 排查/修复 |
| --- | --- | --- |
| `Port 4000 is already in use` | 另一个 Vercio/进程占用 | `lsof -nP -iTCP:4000 -sTCP:LISTEN`；`VERCIO_PORT=4001 npm start` |
| 打开 4000 只有一行提示 | 没有 `dist/` | `npm run build`，或开发模式用 5173 |
| 开发时 API 404 / 代理失败 | API 不在 4000 | 改回 4000，或同步改 `vite.config.ts` 代理 |
| 分支预览一直 preparing | 依赖安装慢/网络差 | 看 `/logs`；安装超时 10 分钟 |
| `Timed out waiting for the dev server` | 命令没读 PORT/HOST，或启动失败 | 看日志；确认脚本绑定 `0.0.0.0` 且监听 `PORT` |
| 预览 404/空白 | 静态项目没有 index.html，或入口目录不对 | 检查根/dist/build/out/public/docs/_site/site |
| `No free preview port` | 4100–4999 被占满/泄漏 | `lsof` 查端口，杀残留，重启 |
| `Port 4100 is already in use`（测试里） | 另一个 `npm test`/Vercio 残留进程占端口 | 确认没有并行测试；`lsof -nP -iTCP:4100-4999 -sTCP:LISTEN`；杀残留后重跑 |
| `Repository is missing` | repoPath 被移动/删除 | 重新添加项目；检查 dataDir 是否迁移 |
| 依赖缓存导致奇怪错误 | 共享 node_modules/.vite、平台差异 | 删 `deps/<projectId>/<fingerprint>` 后重试 |
| 刷新后笔记丢失 | 自动保存还在 700ms 防抖中 | 等 “Saved”；Cmd/Ctrl+S 立即保存 |
| SSE 不更新 | 代理/防火墙缓冲、断线 | `curl -N` 验证；刷新页面 |
| 手机打不开 | 防火墙/不同 Wi-Fi/绑定了 127.0.0.1 | 确认 `0.0.0.0` 与同一网段 |
| 点「浏览」没有窗口 | 在远程/无头机器上运行；无 zenity/kdialog；macOS 自动化权限 | 看服务端日志与 HTTP 501；会自动回退页内浏览器；勿期待窗口出现在访问者电脑 |
| 系统文件夹窗口一直不返回 | 用户在主机上未操作 | 最长 5 分钟；关闭浏览器会 abort；可在主机上完成/取消 |
| 重启后预览全 stopped | 设计如此 | 重新点分支；不会自动恢复 |
| 删除项目后磁盘仍有日志 | 日志不随项目删除 | 手动清 `.vercio/logs` |
| `npm test` 很慢/超时 | 串行跑真实 dev server、首次 demo、端口竞争 | 单独跑文件；增大 timeout；确认无端口泄漏 |
| 预览状态 ready 但页面全白 | worktree 缺少工作副本里被 gitignore 的 `.env*`，前端启动即抛错（如 `Missing VITE_API_BASE_URL`） | 确认 `.env*` 在项目根目录；部署日志应有 `Copied local env files into the worktree`。可打开预览端口看浏览器 console |
| Vite 预览里依赖包的字体/图片 403（`/@fs/...`） | 软链 node_modules 的真实路径超出 Vite `server.fs.allow` | 纯 `vite` dev script 会自动套 `.vercio.vite.config.mjs` overlay；自定义/框架封装脚本需自行在项目 config 里加 `server.fs.allow` |
| 改了本地代码预览不更新 | 预览的分支不是工作副本当前 checked-out 分支（live 只对当前分支生效），或 live 已被暂停 | 看预览工具栏是否有 LIVE 标记；切换分支后重新点该分支部署。`git branch --show-current` 确认当前分支 |
| 预览每 2 秒自动刷新一次 | 早期 live sync 无内容去重导致重复写文件 | 已用内容哈希去重；若仍出现看 `Live sync:` 日志里是否反复出现同一文件 |

## 12. 提交前 checklist

```bash
npm run typecheck
npm test
npm run build
```

- [ ] 新/改 API 已更新 [api.md](api.md) 与前端类型。
- [ ] 新状态/字段已全链路同步（DB、DTO、TS、UI、SSE、文档、测试）。
- [ ] 涉及数据/磁盘/端口的路径在失败分支也会清理。
- [ ] 用户可见文案 en/zh 都有。
- [ ] 亮/暗主题、手机宽度、局域网访问没有明显回归。
- [ ] 没有提交 `.vercio/`、`dist/`、日志或临时仓库。
- [ ] 文档改动与代码在同一提交或注明 `docs:`。
