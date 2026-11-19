# 架构

## 1. 定位与边界

Vercio 是一个**本地优先**的前端分支预览与协作工具：把 Git 仓库的每个分支检出为隔离 worktree，启动该分支的 dev server（或托管它的静态文件），在同一个 Web 工作台里切换、并排对比、讨论和做笔记。

它**不是**：CI/CD、生产构建器、云端部署平台、多租户服务、Git 托管服务。理解这一点能避免很多方向性错误：验证目标是“本地/局域网能打开”，不是“构建产物可发布”。

当前边界：

- 只完整验证 macOS / Linux；Windows 虽有系统文件夹窗口实现，但路径、symlink、进程组仍未验证。
- 预览以 **dev server** 为主，不执行生产 `build`；静态分支只托管仓库里**已经存在**的静态文件。
- 无登录、无权限模型、无多用户隔离；所有访问者共享同一份数据与操作能力。
- 单进程、单数据目录；不支持同一数据目录跑多个实例。

## 2. 技术栈与硬约束

| 层 | 选型 | 约束/后果 |
| --- | --- | --- |
| 服务端 | Node.js ESM + `node:http`，无框架 | 只有 `qrcode` 一个运行时外部依赖；路由是一个大 `if` 链；无中间件体系 |
| 前端 | React 19 + TypeScript strict + Vite 8 | 无 React Router、无状态库、无 Tailwind；自写 history 路由与 Context |
| 样式 | 全局 CSS + CSS 变量 + `data-theme` | 无 CSS Modules；类名是全局的，新增页面需自己加前缀避免冲突 |
| 持久化 | 单个 `db.json` + 原子写 | 无事务、无锁、无查询；写入 80ms 防抖；只适合单进程 |
| 测试 | `node:test` 集成/单元测试 | 真启进程、真占端口、真跑 git；没有 React 单测，也没有浏览器 e2e 脚本入库 |
| 预览 | `git worktree` + dev server 子进程 / 静态监听器 + 独立端口 | 预览进程与本机同权限；`stop` 必须回收进程组与端口 |

**Node 版本**：`package.json` 要求 `^20.19.0 || >=22.12.0`，`.nvmrc` 为 `22`。README 记录在 Node 25 上验证过。

## 3. 运行时拓扑

### 3.1 生产模式（`npm run build && npm start`）

```text
 浏览器 / 手机 / 同事电脑（同一 Wi-Fi）
     │  http://<host>:4000
     ▼
┌────────────────────────────────────────────────────────────┐
│ 主 HTTP 服务  server/index.js  (默认 0.0.0.0:4000)          │
│                                                            │
│  GET /                    → dist/index.html + 静态资源      │
│  GET /p/:id/:tab          → SPA fallback（无扩展名）        │
│  /api/*                   → JSON API + SSE                 │
│  GET /preview/:dplId/...  → 302 到预览端口（保留 rest 路径）│
└───────────────┬────────────────────────────────────────────┘
                │ 每个 deployment 一个隔离 worktree
                ▼
      .vercio/worktrees/<projectId>/<branchSlug>-<sha8>
                │
       ┌────────┴─────────┐
       ▼                  ▼
  dev server         static server
  (Next/Vite/...)    (serveStaticDir)
  0.0.0.0:41xx       0.0.0.0:41xx
```

关键点：**主服务不代理预览流量**。它只做 302，让浏览器直接连预览端口。这样：

- 预览页面里的绝对路径资源（`/assets/x.js`）会落在预览端口上，而不是主服务；
- Vite/Next 的 HMR WebSocket 能直连正确的 host:port；
- 每个预览的 URL 稳定、可单独分享；
- 代价是预览端口对整个局域网可见，且 iframe 与父页面**跨源**（端口不同）。

### 3.2 开发模式（`npm run dev`）

```text
 浏览器 ──► Vite dev server 127.0.0.1:5173
              │ 代理 /api、/preview → http://127.0.0.1:4000
              ▼
            主 HTTP 服务 4000 ──► 预览端口 41xx
```

`vite.config.ts` 把 `/api` 与 `/preview` 代理到**硬编码的** `127.0.0.1:4000`。`scripts/dev.mjs` 也用 `VERCIO_PORT=4000` 启动 API。因此开发时改主服务端口会导致代理失效（见 [development.md](development.md)）。

### 3.3 端口分配

| 端口 | 用途 | 绑定 | 谁决定 |
| --- | --- | --- | --- |
| `VERCIO_PORT` / `PORT`（默认 4000） | 主服务：UI、API、SSE、预览重定向 | 通配地址，IPv4 + IPv6 双栈 | 配置/CLI |
| `4100–4999` | 每个就绪预览的 dev server 或 static server | `0.0.0.0` | `ports.findFreePort()` |
| 5173（仅开发） | Vite 前端 | Vite 默认 localhost | `vite.config.ts` |

预览端口由模块级 `reserved` 集合 + 数据库里 `ready` 部署的端口共同避让；释放发生在 `stop()`、部署失败、以及进程退出时（进程退出由操作系统回收）。**进程被 `SIGKILL` 或断电时，`reserved` 与内存中的子进程表全部丢失，可能留下孤儿 dev server 占着端口。**

局域网可访问性最终取决于**项目自己的 dev server**：Vercio 注入 `HOST=0.0.0.0`/`--host 0.0.0.0`，但自定义 server 若忽略它、仍绑 `127.0.0.1`，局域网设备重定向到 `LAN IP:41xx` 会连不上。静态预览由 Vercio 自己的服务器绑定 `0.0.0.0`，不受此影响。

主服务在 `config.host` 为通配地址（`0.0.0.0`/`::`）时用 `listen("::", { ipv6Only: false })` 双栈监听，并对 IPv4 回落做自检；绑定到具体地址/loopback 时只监听该地址。`getLanAddresses()` 会过滤掉 loopback、`169.254/16`、Clash fake-IP（`198.18/15`）和 Tailscale CGNAT（`100.64/10`），并按「私有网段 → 物理网卡」排序，避免把不可达地址印进二维码/分享链接。

启动时会打印每个可达的 `Network` 地址；检测到带 IPv4 的 TUN/VPN 时会额外提示——这类系统级代理（`auto-route` + `strict-route`）可能让「其它设备 → 本机」的请求直接超时，而本机访问自己的 LAN IP 仍然正常。服务端还会为每个首次出现的非 loopback 客户端打印一行 `LAN client <ip>`：有这行说明请求已到达，没有则是网络层拦截（见 [development.md §12](development.md#12-局域网打不开的分层排查)）。

## 4. 进程内组合

`server/index.js` 的 `createVercioApp(options)` 是唯一组合根：

```text
createVercioApp(options)
 ├─ resolveConfig(options)          // 环境变量/CLI 优先级
 ├─ ensureDirs(config)              // dataDir/repos/worktrees/logs/deps/tmp
 ├─ new Store(config.dbFile)        // 读 db.json；损坏则备份并从空状态启动
 ├─ new EventHub()                  // SSE 客户端集合
 ├─ new DeploymentManager(...)      // 构造时 recoverInterrupted()
 ├─ new ProjectsManager(...)        // 构造时 recoverInterrupted()
 ├─ createRequestHandler({...})     // 闭包持有 store/events/config/projects/deployments/runtime
 │                                  // + folderDialog（默认 pickFolder，可注入用于测试）
 └─ http.createServer(handler)
```

依赖方向是单向的：

```text
index.js → routes.js → { projects, deployments, store, events, config, lib/* }
projects.js → deployments.js（删除项目时清理部署）
deployments.js → git.js / frameworks.js / ports.js / http.js
routes.js → browse.js / folder-dialog.js / lan.js / git.js
git.js / frameworks.js / ports.js / http.js / folder-dialog.js 互不依赖业务状态
```

`runtime.port` 在 `listen()` 成功后回填，因此测试可以传 `port: 0` 让系统分配临时端口。

## 5. 启动与关闭

### 启动序列

1. `resolveConfig`：数据目录、端口、host、限额、固定超时。
2. `ensureDirs`：创建 `dataDir` 及五个子目录。
3. `Store.load`：读 `db.json`；`ENOENT` 静默用默认状态；JSON 损坏则把原文件复制成 `db.json.corrupt-<timestamp>` 后从默认状态启动。
4. `DeploymentManager` 构造：把上次中断的 `queued/preparing/installing/starting` 改成 `error`；把 `ready` 改成 `stopped`（原因“Server restarted - redeploy”）。**不会**自动重启预览。
5. `ProjectsManager` 构造：把 `importing` 改成 `error`。
6. `startServer` 监听、打印 Local/Network/Data 三行地址、可选打开浏览器。
7. 注册 `SIGINT`/`SIGTERM`：`close()` → 关闭 SSE、停止所有预览、`store.flush()`、关 HTTP；5 秒兜底强退。
8. 注册 `uncaughtException`：只打印，不退出（避免一个请求异常拖垮所有预览）。

### `close()` 顺序

```text
events.closeAll()      // 先断 SSE，避免前端继续收到“正在停止”
deployments.stopAll()  // 停子进程/静态服务器，释放端口，状态写 stopped，flush
store.flush()
server.close()
```

### 数据目录解析优先级

| 配置 | 优先级（高 → 低） | 默认 |
| --- | --- | --- |
| dataDir | `options.dataDir` > `VERCIO_DATA_DIR` > `<APP_ROOT>/.vercio` | 仓库内 `.vercio` |
| port | `options.port` ?? `VERCIO_PORT` ?? `PORT` ?? `4000` | 4000；非法值回退 4000；允许 0 |
| host | `options.host` > `VERCIO_HOST` > `0.0.0.0` | 0.0.0.0 |
| 最大同时预览 | 仅 `VERCIO_MAX_PREVIEWS` | 8 |

CLI：`node server/index.js --port 4001 --host 127.0.0.1 --data-dir ~/.vercio --open`。没有 `--max-previews`。

## 6. 请求管线

`routes.createRequestHandler` 按**固定顺序**处理，顺序本身是契约：

```text
1. /preview/:deploymentId(/rest*)
   ├─ 部署不存在 → 404 HTML 状态页
   ├─ status=ready 且有端口 → 302 Location=http://<req Host>:port<rest>（no-store）
   └─ 其他状态 → 200 HTML 状态页（内联脚本每 1.5s 轮询 /api/deployments/:id，就绪/出错后刷新）

2. 非 /api/ 且 GET/HEAD
   ├─ dist/index.html 存在
   │   ├─ 命中真实文件 → 200，Cache-Control: public, max-age=60
   │   ├─ 无扩展名（如 /p/xxx/previews）→ dist/index.html，no-store
   │   └─ 有扩展名但文件不存在 → 落到第 3 步的提示文本（不是 404）
   └─ dist 不存在 → 200 text/plain 提示先 npm run build 或 npm run dev

3. API 路由（见 api.md；顺序敏感，/api/projects/demo 必须先于 /api/projects/:id）
   其中 POST /api/fs/pick-folder 会阻塞到用户在运行 Vercio 的机器上选完文件夹或取消
   （最多 5 分钟）；客户端断开时通过 AbortController 终止对话框进程。

4. 其他 /api/* → JSON 404；其他路径 → 文本 404

5. 任意 throw → HttpError 用其 status，否则 500；统一 JSON { error: { status, message, details? } }
```

注意：

- SPA fallback 只对**无扩展名**路径生效；`/foo.js` 不存在不会回 index.html。
- 预览重定向使用请求的 `Host` 头来决定 host（IPv6 会加方括号），因此局域网设备访问时会被重定向到自己可达的地址。
- 预览状态页是服务端拼字符串生成的内联 HTML，**不经过前端构建**，也**不转义** branch/sha/error（见安全边界）。

## 7. 预览托管模型

### 为什么是 302 而不是反向代理

反向代理需要正确重写 Host、Origin、WebSocket、cookie、绝对 URL，还要处理压缩与超时；一个 302 让浏览器“原生地”访问预览服务，复杂度最低。代价是预览端口暴露、iframe 跨源。

### 稳定 URL 的路径规则

```text
/preview/<dpl_id>/            → http://<host>:<port>/
/preview/<dpl_id>/assets/a.js → http://<host>:<port>/assets/a.js
```

`rest` 原样拼接，查询串不转发（重定向只带 path；当前前端不使用查询串）。因此：

- 预览应用内部的绝对路径路由能工作；
- 静态 SPA 的深层链接在预览端口上由 `serveStaticDir(..., { spaFallback: true })` 回退到 `index.html`；
- 预览应用自己的 `/api/*` 会落在它自己的 dev server 上，不会打到 Vercio 主服务（端口不同源）。

### 就绪前的状态页

| 状态 | HTTP 状态 | 展示 | 行为 |
| --- | --- | --- | --- |
| 未知 id | 404 | Preview failed / Deployment not found | 只给回工作台链接 |
| `queued/preparing/installing/starting` | 200 | Building preview + branch/sha/status | 1.5s 轮询 API，进入 `ready/error/stopped` 后刷新 |
| `ready` 但端口探测失效 | 200 | Preview ready | 302 到已死端口，iframe 加载失败（前端不自动重建） |
| `error` | 200 | Preview failed + `deployment.error` | 回工作台 |
| `stopped` | 200 | Preview stopped | 回工作台 |

状态页不参与前端 i18n，固定英文。

## 8. 部署流水线

### 8.1 状态机

```text
                    ┌──────────── error（失败，终态）
                    │
queued ─► preparing ─┼─► installing ─► starting ─► ready ─► stopped
   │          │      │        │            │          │
   └──────────┴──────┴────────┴────────────┴──────────┴──► stopped（被停止/被顶替/关机）
```

- **静态预览**：`queued → preparing → ready`（不安装依赖、不启动 dev server）。
- **dev server 预览**：`queued → preparing → [installing] → starting → ready`。依赖已存在/可复用时跳过 `installing`。
- `error` 与 `stopped` 都是终态；再次预览时，同分支已有 `ready` 部署会复用（见 8.2），否则**新建一个 deployment**（旧记录保留，最多每项目 60 条）。
- 服务重启：活动状态 → `error`，`ready` → `stopped`。

状态枚举同时存在于：数据库、SSE、[web/src/lib/types.ts](../web/src/lib/types.ts)、UI 文案与样式、状态页。**新增状态必须全链路同步**，见 [ai-coding.md](ai-coding.md#recipe-2新增一个部署状态)。

### 8.2 创建与去重

`POST /api/projects/:id/deployments { branch, mode }`：

1. 项目必须 `ready`，否则 409。
2. `mode ∈ {auto, server, static}`，否则 400。
3. `git.resolveBranch`（`refs/heads` → `refs/remotes/origin` → 原始 ref）取 commit；`commitMeta` 取作者/标题。
4. **复用**：同项目、同分支、`status=ready`，且（请求 auto 或 mode 相同）→ 直接返回 200 `{deployment, reused:true}`。不再要求 commit 相同：follower 会把 worktree 前滚到最新 tip（见 8.8）。
   - 静态预览直接复用；
   - dev server 预览会先 `isPortResponding(port)`；端口没响应则把旧部署标 `stopped`、释放端口，再新建。
   - 复用时会同步刷新一次编辑源绑定（`git worktree list`），并触发一次立即同步。
5. 否则插入 `dpl_*` 记录到数组头部、裁剪历史、`markDirty`、发 `deployment.created` 与 `deployment.updated`，**立即返回 202**，runner 在后台异步执行。

因此“创建部署”是**异步任务提交**，不是同步完成；调用方必须轮询 `GET /api/deployments/:id` 或监听 SSE。

### 8.3 `run()` 的完整步骤

```text
setStatus(preparing)
 1. 检查 repoPath/.git 存在，否则 error: Repository is missing
 2. 再次 resolveBranch，回填 commit/shortSha（分支可能在排队期间移动）
 3. worktreePath = worktrees/<projectId>/<slug(branch)>-<commit[0:8]>
 4. cleanupBranchWorktrees：删除同项目、同 branchSlug 前缀、非当前路径、且没有被活动部署/
    follower 引用的旧 worktree（还在服务的旧预览不会被新提交删掉）
 5. git worktree add --detach --force <worktreePath> <commit>
 5b. copyLocalEnvFiles：把编辑源根目录里被 gitignore 的 `.env*` 复制进 worktree
     （分支已提交的同名文件不覆盖；日志只记文件名，不记值）
 5c. listSources + sourceForBranch：绑定该分支的编辑源（主工作副本或任意 worktree），
     deployment.live / liveState / sourceKind 落库；先全量镜像一次未提交改动
 5d. startFollower：watch 编辑源（fs.watch 递归；2s 轮询兜底）+ 2s 轮询分支 tip；
     后续提交前滚、编辑增量同步进 worktree
 6. detectProject(worktree) → framework {label,type,kind,packageManager}
    若与 project.framework.label 不同 → 更新项目并广播 project.updated
 7. 解析 mode：auto → detection.type === "server" ? server : static
    请求 server 但检测为 static → error（"no dev server script"）
 8. 静态：必须找到 staticEntry，否则 error；启动 static server；ready
 9. dev server：
    a. installDependencies（可能跳过）
    b. findFreePort(4100–4999)
    c. devCommand(detection, port) → 命令 + env
    d. 若 node_modules 是软链、dev script 是纯 `vite`：写 `.vercio.vite.config.mjs`
       （import 项目自己的 config，并把软链真实路径加进 `server.fs.allow`），
       命令追加 `--config`；该尝试启动失败时自动回退到不带 overlay 的原命令
    e. spawn(detached:true, stdio:pipe) → 进程组
    f. waitForHttp(port, 120s, child 退出即 abort)
    g. ready → afterReady
10. 启动/检测阶段异常 → 先停止 follower；若 dev server 仍存活则先 kill，等待其 close ≤750ms 让剩余 stdout/stderr 落日志；
    waitForHttp 失败时从日志尾部提取一行“失败提示”（端口占用/权限/命令不存在等）拼进 error；
    fail（status=error, error 截断 2000 字符）→ 释放端口
11. finally → markDirty + 广播 deployment.updated
```

### 8.4 worktree 策略

- 每个 deployment 一个目录；目录名用 `slugify(branch)`（只保留 `a-z0-9._-`，截断 60）+ 创建时 commit 的前 8 位。
- `cleanupBranchWorktrees` 只在建新 worktree 前删除**同一分支 slug** 的旧目录，并跳过仍被活动部署/follower 引用的路径；已经 ready 的预览不会被新提交的清理误删。
- worktree 是 `--detach` 到具体 commit，不是 checkout 分支；因此不会移动分支指针，也不会碰用户工作副本。follower 之后会在同一个 worktree 里 `checkout -f --detach` 前滚；目录名里的旧 commit 后缀不再更新，属于内部细节。
- 创建后会把**编辑源**根目录的 `.env`、`.env.local`、`.env.<mode>`、`.env.<mode>.local` 复制进 worktree（`.example/.sample/.template` 除外；目标已存在则不覆盖；没有绑定源时回退主工作副本）。这些文件通常被 gitignore，不复制的话需要 `VITE_*` 等变量的前端会在启动时直接抛错、页面白屏。
- 删除项目时：先停预览，再对每个 `deployment.worktreePath` 做 `git worktree remove --force`，最后 `rm -rf worktrees/<projectId>`，并刷新 `git worktree prune`。

**已知风险**：分支名 slug 会碰撞（`feat/a` 与 `feat-a` 都变 `feat-a`），清理逻辑可能删掉另一分支的 worktree；并发部署同一分支也没有锁，两个 runner 可能对同一目录执行 `rm -rf` + `worktree add`（见技术债）。

### 8.5 依赖缓存决策树

```text
devInstallPlan:
  needsInstall?  (package.json 依赖数 > 0)
  worktree/node_modules 已存在?  ── 是 → 跳过
  └─ 否
      fingerprint = sha256(package.json + lockfile).hex[0:16]
      │
      ├─ 工作副本 repoPath 的 fingerprint 相同且 repoPath/node_modules 存在
      │     → symlink(repoPath/node_modules, worktree/node_modules)  // 绝对路径
      │
      ├─ deps/<projectId>/<fingerprint>/node_modules 存在
      │     → symlink(相对路径, worktree/node_modules)
      │
      └─ 执行 <npm|pnpm|yarn|bun> install
            cwd=worktree, detached, 10min 超时
            env: PORT/HOST 清空, BROWSER=none, CI=false, FORCE_COLOR=0
            成功后把 node_modules 移到 cache，再 symlink 回 worktree
```

- 指纹只含 `package.json` 与检测到的 lockfile 内容，不含 Node 版本、OS、arch。
- 缓存目录是**可写共享目录**：dev server 往 `node_modules/.vite` 等写缓存时，多个分支会共享同一份。这是速度与隔离的取舍。
- **Vite `fs.allow`**：软链复用 node_modules 时真实路径在工作区之外，Vite 默认只允许服务工作区根目录内的文件，依赖包里的字体/图片/CSS 会 403。部署时会尝试 `.vercio.vite.config.mjs` overlay（import 项目 config + 把软链真实路径加入 `server.fs.allow`）；只对 dev script 是纯 `vite` 的项目生效，overlay 加载失败自动回退原命令（`tests/vite-overlay.test.js`、`tests/preview.test.js`）。
- 安装使用 `npm install` 等，不强制 frozen lockfile。

### 8.6 端口与进程回收

- `findFreePort` 顺序扫 `4100–4999`，先看 `reserved` 与数据库 ready 端口，再实际 `listen` 探测；成功即加入 `reserved`。
- 失败/停止/顶替都会 `releasePort`；静态服务器也在同一端口池。
- 子进程用 `detached: true` 启动，因此成为独立进程组；停止用 `process.kill(-pid, SIGTERM)`，4 秒后 `SIGKILL`。
- 安装子进程单独记录，停止/失败时一并杀。
- `stop()` 接受 `ready/starting/installing/queued/preparing`；`stopById`（API）只接受 `ready/starting`。
- `afterReady` 会：停掉同项目同分支的其它 ready 部署（superseded），然后执行 `enforceMaxRunning`（只统计 `mode=server` 的 ready 部署，超出 8 个停最旧）。静态预览不占限额。

### 8.7 日志

- 每个 deployment 在内存里保留最多 4000 行，每行截断 4000 字符；同时 append 到 `logs/<deploymentId>.log`（文件不轮转）。
- 前端在预览未就绪时每 1.1s 轮询 `GET /api/deployments/:id/logs`；进入终态后停止轮询，但会立即拉一次、并在 600ms 后再拉一次，确保捕获进程退出时刷出的尾部日志。失败面板的简短原因由服务端 `failureHint()` 从日志尾部提取并写入 `deployment.error`，日志面板则展示这份快照。
- 服务重启后内存日志丢失，`getLog` 回退读文件最后 600 行。
- 删除项目不会删除日志文件（已知泄漏点）。

### 8.8 实时预览（分支 tip + 编辑源）

预览对象是分支的隔离 worktree。为了让"保存即渲染"覆盖多会话并行改多个分支的场景，实时模型从「工作副本当前分支」升级为「分支 tip + 编辑源」：

- **tip 跟随**：每个运行中的预览都有一个 follower。每 2s 解析 `refs/heads/<branch>`（回退 `refs/remotes/origin/<branch>`）；tip 前进时在自己的 worktree 里 `git checkout -f --detach <tip>`，清空文件哈希（保留 `.env` 哈希），更新 deployment 的 commit/短 sha/标题/作者并广播 `deployment.updated`。dev server 不重启，Vite/Next 自己热更新。
- **编辑源**：`git worktree list --porcelain` 找"当前检出该分支"的目录——主工作副本，或任意 harness/开发者 worktree（排除 `.vercio/worktrees`、`.vercio/deps` 下的 Vercio 产物）。git 保证一个分支最多被一个 worktree 检出，所以 branch → source 一一映射。绑定后 `live = true`、`liveState = "following"`、`sourceKind = "working-copy" | "worktree"`；用源的 `git status` + 文件内容做未提交镜像。
- **源只在读**：对编辑源只允许 `rev-parse`、`worktree list`、`status` 与文件读取；写入只发生在 Vercio 自己的 worktree。
- **不因源移动而停预览**：源切走/被删除 → `liveState = "detached"`、`live = false`，预览继续跟随 tip 服务最后状态；UI 显示 banner 与「重新绑定」。主工作副本切分支不再是错误路径，也不会 stop 预览。
- **无源也跟随**：没有 worktree 检出该分支时 `liveState = "snapshot"`，预览仍跟随 tip，只是没有未提交层。`live` 字段保留兼容，等价于 `liveState === "following"`；`sourcePath` 不投影到 public DTO。
- **依赖变化自动重启**：tip 前滚的 diff 命中 `package.json` 或 lockfile 时，原地重启同一部署（卸掉 `node_modules` 软链 → 重新 install/复用缓存 → 同端口重启），状态短暂回到 `installing/starting`，端口和 deployment id 不变。
- **失败兜底**：tip 解析失败（分支被删）保持旧 commit 并节流记日志；`checkout -f` 失败只记录，不会让预览崩掉。

`live-sync.js` 的导出：

| 导出 | 作用 |
| --- | --- |
| `parseStatusEntries(stdout)` | 解析 `git status --porcelain=v1 -z`；`R/C` 记录的原路径在下一个 NUL 分片 |
| `syncWorkingCopyState({ sourceDir, worktreeDir, state })` | 把编辑源改动镜像到 worktree；`state = { syncedPaths, fileHashes, envHashes }` 跨调用保存。兼容旧参数名 `repoDir` |
| `resetSyncState(state)` | tip 前滚后清空文件哈希基线（保留 `.env` 哈希），否则新内容会被当成"已同步"跳过 |
| `createSyncState()` | 新建镜像状态 |
| `shouldIgnoreWatchPath(filename)` | 忽略 `.git`/`node_modules`/`dist`/`.worktrees` 等目录的 watch 噪声 |

同步细节：跳过 `.git`、`node_modules`、`.vercio`、`.worktrees`；跳过 `.env.example/sample/template`；单文件上限 32MB；symlink 按原样重建；内容哈希一致则不重复写（否则会每 2s 触发一次 HMR）；被 revert/提交的旧脏文件会从编辑源重新 copy 回 worktree。

**限制**：只镜像 `git status` 里的文件。gitignored 的生成物、submodule、>32MB 文件不会进入预览；需要这些时只能提交或改用未来的就地模式。SSE 事件沿用 `deployment.updated`，没有新增事件名。

## 9. 持久化与事件

- `Store` 持有唯一的 `state` 对象；所有 manager/route 直接改这个对象，然后 `markDirty()`。
- `markDirty` 防抖 80ms 后写临时文件并 `rename`，避免写一半损坏；定时器 `unref`，不阻止进程退出。
- **没有事务**：一个请求中途抛错可能留下部分内存修改，但下一次防抖仍会写盘。改动多步写入时要自己保证顺序。
- `EventHub` 是内存广播：`event: <name>\ndata: <json>\n\n`，附带全局递增 `seq` 与 `at`；每 25s 发 `: ping` 注释保活；`retry: 1500`。
- 事件类型：`project.created/updated/deleted`、`deployment.created/updated`、`note.changed`、`comment.changed`、`settings.updated`，外加连接时的 `hello`。
- SSE **不重放**：断线期间的事件永久丢失；前端靠重连后下一次事件触发刷新，没有 `Last-Event-ID` 补偿。
- 前端 `AppContext` 收到事件后防抖刷新 `/api/overview` + `/api/system`，再向页面转发 `window` 自定义事件 `vercio:event`。

## 10. 失败与恢复

| 场景 | 系统行为 | 人工恢复 |
| --- | --- | --- |
| 服务正常重启 | 活动部署 → `error`；ready → `stopped`；SSE 断开；内存日志丢失 | 重新点分支预览（新建部署） |
| 服务被 SIGKILL/断电 | 数据库可能是 80ms 前的状态；detached 的 dev server/安装子进程可能存活（静态服务器随主进程退出）；端口可能被占 | `lsof`/`ps` 找残留进程并杀；重启后重新预览 |
| `db.json` 损坏 | 备份为 `.corrupt-*`，以空状态启动（项目列表消失） | 从备份恢复；或重新添加仓库 |
| repoPath 被删除/移动 | 预览失败：`Repository is missing` | 重新添加项目；本地路径项目需修正 |
| 依赖安装失败 | 部署 `error`，日志保留完整输出 | 修依赖/网络后重试；必要时删缓存 |
| dev server 启动超时（120s） | `error: Timed out waiting...`，进程被杀 | 看日志确认端口/host 参数 |
| dev server 启动后崩溃 | 若已 ready：标 `stopped` 并记录退出码；若未 ready：`error` | 重试；查日志 |
| 预览端口被外部占用 | `findFreePort` 跳过；池满则 `No free preview port` | 释放端口或扩大范围 |
| SSE 断开 | EventSource 自动重连；期间事件丢失 | 手动刷新页面 |

## 11. 安全与信任边界

**威胁模型：本机 + 可信局域网。** 代码没有鉴权、授权、CSRF、速率限制、TLS、审计。任何能访问 4000 端口的人都能：

- 添加任意 GitHub 仓库或本机路径项目；
- 触发部署，从而让仓库里的 dev server / 安装脚本在本机执行（**设计上的远程代码执行**）；
- 浏览运行 Vercio 的机器上的目录名与完整路径（`/api/fs/browse`，只返回目录，不返回文件内容）；
- 在运行 Vercio 的机器上弹出系统文件夹窗口（`/api/fs/pick-folder`），窗口提示文案由调用方提供；
- 直接访问 4100–4999 上的预览端口，读写项目页面；
- 编辑/删除共享笔记与评论（评论删除只有基于 `clientId` 的软校验）。

其他需要知道的点：

- **不要暴露公网**。若要暴露，必须在反向代理层加认证与 TLS。
- **系统文件夹窗口在服务器机器上弹出**，不是访问者的浏览器：局域网设备点「浏览」也会让主机弹窗。请求会阻塞到用户选择/取消，最长 5 分钟；客户端断开时服务端 abort 对话框进程。`prompt` 来自客户端（截断 160 字符），可被用于显示误导性文案。
- `POST /api/fs/pick-folder` 只校验“选中的是一个存在的目录”，不校验 Git 仓库；是否可作为项目由后续 `POST /api/projects` 校验。
- 预览静态服务器有路径穿越防护：`decodeURIComponent` → `path.resolve` → `isInside(root, file)`，并拒绝 NUL；但**不解析 symlink**，worktree 内指向外部的符号链接可被读取（仓库内容本身可信是前提）。
- `/preview/:id` 的 302 使用请求 `Host` 的 hostname，未做白名单，存在 Host 头驱动的开放重定向（仅影响已存在部署）。
- 预览状态页把 `branch`、`shortSha`、`error` 直接拼进 HTML，未转义；错误可能来自 git/安装命令输出。
- Markdown 在浏览器端用 `marked` + `DOMPurify` 清洗后再渲染；服务端不渲染 Markdown。
- 前端把显示名放在 `localStorage`，服务端 `settings.userName` 也只是本地偏好，不构成身份。
- 数据目录默认继承用户 umask；没有额外加密。仓库代码、笔记、评论都是明文。

## 12. 关键不变量

修改代码时，以下不变量应保持；违反它们通常会造成难以定位的回归。

1. **稳定预览 URL**：`/preview/<deploymentId>/<rest>` 必须 302 到预览端口并保留 `<rest>`；不要把 iframe 改成同源反代或改变 `<deploymentId>` 语义。
2. **隔离**：任何预览相关操作只发生在 worktree/缓存目录，绝不 checkout、reset、clean 用户的工作副本；对用户仓库只允许 `fetch`、`worktree add/remove/prune`、只读查询。实时预览只**读**编辑源（主副本或任意 worktree 的 `git status` + 文件内容），写入只发生在 Vercio 自己的 worktree。
3. **端口生命周期**：每个预览端口必须且只能被一个 deployment 占用；停止、失败、顶替、关机都要释放。新代码路径若分配端口，必须覆盖所有失败分支。
4. **状态机一致性**：状态字符串同时被 DB、API、SSE、TS 类型、文案、CSS、状态页消费；新增/重命名状态必须全链路更新。
5. **`requestedMode` 与 `mode` 分离**：请求值保留在 `requestedMode`，解析结果写 `mode`；`auto` 永远在服务端解析，不由客户端推断。
6. **公开投影**：API 只返回 `toPublic()` 显式列出的字段；`worktreePath`、`ref`、`staticDir`、`importLog` 等内部字段不应意外泄露。
7. **持久化入口**：所有状态变更走 `store.get()` 的内存对象 + `markDirty()`；不要在业务代码里直接读写 `db.json`。
8. **事件契约**：SSE 事件名是稳定契约；新增事件要同时更新前端监听列表，否则页面不会刷新。
9. **错误契约**：`/api/*` 的错误统一 `{ error: { status, message, details? } }`；预览/静态/SPA 返回 HTML 或文本，不要混用。
10. **无鉴权假设**：任何“只有管理员能做”的设计在当前架构里都不成立；加认证必须是全链路（HTTP、SSE、预览端口）的独立项目。
11. **同源假设**：前端所有 API 调用用相对路径，必须在局域网 host 下工作；除 Vite 代理外不得硬编码 `localhost:4000`。
12. **数据目录可迁移**：路径都从 `config.dirs` 派生，不在业务代码里拼 `.vercio`；注意数据库仍保存绝对 `repoPath`（迁移需改库）。
13. **服务端零框架**：新增服务端能力优先用 Node 内置模块；引入运行时依赖需要明确理由。
14. **前端构建可静态托管**：`web/` 必须能 `vite build` 成纯静态资源；不要在构建期依赖 Node 服务。
15. **系统对话框可中止**：`POST /api/fs/pick-folder` 必须在客户端断开时 abort；错误统一 `HttpError`（400/500/501/504），且只在服务器机器上弹窗。

## 13. 已知技术债与边界情况

这些是**现状**，不是待办清单；改到相关区域时要意识到它们。

| 区域 | 现状 | 影响 |
| --- | --- | --- |
| 部署并发 | 没有 per-branch/per-project 锁；`create` 只对 `ready` 去重 | 两个并发 POST 可能同时创建部署，竞争同一 worktree（`rm -rf` + `worktree add`） |
| worktree 清理 | 按 `branchSlug` 前缀删除旧目录 | `feat/a` 与 `feat-a` slug 相同，会互删；也可能删到仍在启动中的部署 |
| 实时预览 | 已支持按分支绑定任意 worktree 的编辑源、tip 前滚、同分支复用；源消失时降级 `detached` 而非停止 | 仍只镜像 `git status` 里的文件（gitignored 生成物/submodule 看不到）；就地 attach 模式尚未实现（见 [live-preview-sources.md](live-preview-sources.md) §4.8） |
| 依赖缓存 | 共享可写 `node_modules`；指纹不含平台/Node 版本 | 分支间可能共享 `.vite` 缓存并互相干扰；跨平台拷贝数据目录会失效 |
| 静态预览限额 | `enforceMaxRunning` 只统计 `mode=server` | 静态预览不受 8 个上限约束，可能占满 4100–4999 端口池 |
| 日志 | 文件不轮转；删除项目不删日志 | `.vercio/logs` 持续增长 |
| 重启恢复 | ready → stopped，不自动拉起 | 用户需重新预览；worktree/cache 保留 |
| SSE | 无重放、无背压、慢客户端只写不读 | 断线期间状态可能陈旧；极端情况下内存缓冲增长 |
| 数据库 | JSON 全量写、无锁、无迁移框架 | 大数据量变慢；多实例会互相覆盖；schema 变更需手写兼容 |
| 就绪判定 | `waitForHttp` 对任意 HTTP 响应（含 5xx）算 ready | dev server 返回错误页也可能被标 ready |
| 跨源 iframe | 预览与主页面端口不同 | 父页面无法读 iframe DOM；“点选元素评论”需要 postMessage/注入方案 |
| Windows | 系统文件夹窗口有 PowerShell 实现，但目录 symlink、进程组、Wi-Fi 名仍未在 Windows 验证 | 仅 macOS/Linux 完整验证；Windows 预览未验证 |
| 系统文件夹窗口 | 依赖 macOS `osascript` / Windows PowerShell / Linux `zenity`/`kdialog`；测试覆盖 macOS/Linux 命令构造与注入 runner，Windows 无测试 | 无 GUI/无工具时返回 501，前端回退页内浏览器；真实桌面行为未自动化 |
| 系统对话框请求 | 一个 HTTP 请求最长挂 5 分钟等待用户操作 | 占用一个连接；浏览器关闭时依赖 close 事件 abort |
| 未使用字段/函数 | `isProduction` 恒 false、`urlPath` 仅静态、`lastViewedAt`/`finishedAt`/`defaultAuthor`/`idleStopMs`/`reservePort`/`streamToString` 等未消费 | 不要把它们当现有功能依赖 |
| 状态页/重定向 | 状态页 HTML 未转义；Host 未校验 | 低风险注入/开放重定向 |
| 前端体积 | 所有页面静态 import，无 code splitting；`pages.css` 3600+ 行 | 首包偏大；样式改动影响面大 |

## 14. 设计取舍备忘

- **dev server 预览而非生产构建**：换来秒级切换与 HMR，代价是每个分支要装依赖、起常驻进程，且不验证生产构建。
- **worktree 而非 stash/checkout**：换来并行隔离与不碰工作副本，代价是磁盘占用、依赖重复、清理逻辑复杂。
- **JSON 文件而非 SQLite**：换来零依赖、易调试、可直接看文件，代价是无查询/事务/并发安全。
- **302 而非代理**：换来实现简单与 HMR 正确，代价是端口暴露与跨源。
- **SSE + 轮询混合**：SSE 负责“有变化”，轮询负责“正在构建”的高频日志/状态，减少 SSE 事件频率。
- **tip 跟随而非固定快照**：换来“点开就是最新提交”，代价是每个运行中预览每 2s 一次 `rev-parse`，以及前滚瞬间的 HMR 抖动。
- **多编辑源而非单一工作副本**：换来多会话/多 worktree 并行，代价是要接受“源消失→快照/断开”的降级语义，以及只镜像 `git status` 的局限。
- **单文件路由链**：换来无框架、可读性强，代价是路由多了以后难维护；新增路由必须注意顺序。
