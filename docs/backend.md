# 服务端参考

服务端在 `server/`，纯 Node ESM，无 TypeScript、无框架、无 ORM。所有业务状态集中在一个 `Store.state` 对象里。

## 1. 模块总表

| 文件 | 职责 | 关键导出/入口 |
| --- | --- | --- |
| `server/index.js` | 组合根、启动/关闭、CLI、打开浏览器 | `createVercioApp`, `startServer` |
| `server/routes.js` | 单函数 HTTP 处理器：预览托管、SPA、全部 API、错误映射 | `createRequestHandler` |
| `server/lib/config.js` | 配置解析、目录、版本、slug | `resolveConfig`, `ensureDirs`, `slugify`, `APP_ROOT` |
| `server/lib/store.js` | JSON 状态与原子持久化 | `Store` |
| `server/lib/events.js` | SSE 事件广播 | `EventHub` |
| `server/lib/projects.js` | 项目导入/刷新/更新/删除、demo 项目与种子内容 | `ProjectsManager` |
| `server/lib/deployments.js` | 部署引擎：worktree、依赖、进程、端口、日志、状态 | `DeploymentManager` |
| `server/lib/git.js` | git 命令与分支/diff/readme/normalize | 多个函数，见 §7 |
| `server/lib/frameworks.js` | 框架/包管理器检测、dev 命令、依赖指纹 | `detectProject`, `devCommand`, `dependencyFingerprint`, `devInstallPlan` |
| `server/lib/ports.js` | 预览端口池与 HTTP 探测 | `findFreePort`, `releasePort`, `waitForHttp`, `isPortResponding` |
| `server/lib/http.js` | `HttpError`、JSON/错误发送、Body 读取、MIME、静态文件/目录 | `HttpError`, `sendJSON`, `sendError`, `readJSONBody`, `serveStaticFile`, `serveStaticDir`, `isInside` |
| `server/lib/browse.js` | 页内目录浏览 | `browseDirectory` |
| `server/lib/folder-dialog.js` | 系统文件夹窗口（macOS/Windows/Linux）与结果解析 | `pickFolder`, `folderDialogCandidates`, `parseDialogResult`, `resolveDialogStartFolder` |
| `server/lib/lan.js` | 局域网地址、Wi-Fi 名、二维码、系统信息 | `getLanAddresses`, `getSystemInfo` |
| `server/lib/demo.js` | 从 `examples/demo` 生成 Lumen 仓库 | `seedDemoRepo` |
| `server/lib/ids.js` | 带前缀随机 ID | `newId`, `shortId` |

## 2. 组合根与配置

### `createVercioApp(options)`

```js
const app = await createVercioApp({ dataDir?, port?, host?, folderDialog? });
await app.listen();
app.runtime.port;   // 实际监听端口（支持 port: 0）
await app.close();
```

返回对象包含：`server, config, store, events, projects, deployments, runtime, listen, close`。测试用 `port: 0` + 临时 `dataDir` 隔离；`folderDialog` 可注入一个假的对话框函数（测试 `/api/fs/pick-folder` 时用），生产默认 `pickFolder`。

`listen()` 会监听 `config.host/config.port`，成功后把实际端口回填到 `runtime.port` 与 `config.port`。

### `startServer(options)`

在 `createVercioApp` 之上：监听、打印地址、处理 `EADDRINUSE`（提示换端口并退出）、可选 `--open`、注册信号处理。`server/index.js` 被直接执行时才调用（`isMain` 判断）。

### 配置字段

| 字段 | 来源 | 说明 |
| --- | --- | --- |
| `dataDir` | options / `VERCIO_DATA_DIR` / `<repo>/.vercio` | 绝对路径 |
| `dirs.repos/worktrees/logs/deps/tmp` | dataDir 派生 | `tmp` 目前未使用 |
| `dbFile` | dataDir 派生 | `<dataDir>/db.json` |
| `webDist` | `<APP_ROOT>/dist` | 生产前端构建产物 |
| `examplesDir` | `<APP_ROOT>/examples` | demo 资产 |
| `version` | 读根 `package.json` | 失败回退 `0.1.0` |
| `port` | options / env / 4000 | `NaN` 或负数回退 4000 |
| `host` | options / env / `0.0.0.0` | |
| `previewPortRange` | 固定 | `[4100, 4999]` |
| `maxRunningDevServers` | `Number(VERCIO_MAX_PREVIEWS)`，未设置时为 8 | 注意：非法字符串会得到 `NaN`，比较永远为 false，等于关闭限额 |
| `devServerTimeoutMs` | 固定 | `120000` |
| `installTimeoutMs` | 固定 | `600000` |
| `idleStopMs` | 固定 | `0`，未使用 |

### 关闭与信号

- `close()`：`events.closeAll()` → `deployments.stopAll()` → `store.flush()` → `server.close()`。
- `SIGINT/SIGTERM`：最多等 5 秒，然后 `process.exit(0)`。
- `uncaughtException`：只打印，不退出。
- HTTP `clientError`：直接回 `400 Bad Request` 并断开。

## 3. `Store`

```js
const store = new Store(file);
store.get();        // 唯一 state 引用
store.markDirty();  // 标记 + 80ms 防抖写盘
store.flush();      // 取消防抖，立即写
```

- 默认状态：`{ version: 1, settings: { userName, defaultAuthor }, projects: [], deployments: [], notes: [], comments: [] }`。
- `load()` 做浅合并；`settings` 单独补齐；四个集合若不是数组则重置为空。
- 读失败且不是 `ENOENT`：把原文件复制为 `<file>.corrupt-<Date.now()>`，从空状态启动。
- 写入：`JSON.stringify(state, null, 2)` → `db.json.tmp` → `rename`。无 fsync、无锁。
- `markDirty` 的定时器 `unref()`，不阻止进程退出；退出前必须 `flush()`。
- **单进程假设**：两个 Vercio 指向同一 dataDir 会互相覆盖。所有业务代码只通过 `store.get()` 改内存，不要直接写文件。

## 4. `EventHub`

```js
const events = new EventHub();
events.addClient(req, res);       // GET /api/events
events.emit("deployment.updated", { projectId, deploymentId, status });
events.closeAll();
```

- `addClient`：写 SSE 头 → `retry: 1500` → 加客户端 → 发 `hello` → 每 25s `: ping`；`req close` 时移除并清定时器。
- `emit`：全局递增 `seq`，payload 合并 `{ ...data, seq, at }`，广播给所有客户端。
- 写失败被吞掉；没有背压/慢客户端处理。
- 事件清单与 payload 见 [api.md](api.md#10-sse)。

## 5. `ProjectsManager`

构造参数：`{ store, events, config, deployments }`；内部 `importing: Map<projectId, Promise>`；构造时 `recoverInterrupted()` 把 `importing` 改 `error`。

### 方法

| 方法 | 行为 | 错误 |
| --- | --- | --- |
| `list()` | 按 `updatedAt` 倒序返回 public 项目 | — |
| `get(id)` | 取实体 | 404 `Project not found` |
| `toPublic(project)` | 显式投影（见 [data-model.md](data-model.md)） | — |
| `updateGitMeta(project)` | `getRepoInfo` + `listBranches`，写 default/current/origin/dirty/branchCount/latestCommit/updatedAt | git 失败会抛 |
| `create({ source, name })` | 解析来源；本地路径同步校验；Git 仓库先落库再后台 clone | 400/422 |
| `startImport(project)` | 后台 clone、进度写 `importLog`（最多 100 行）、成功后 `updateGitMeta` 并置 `ready`；失败置 `error` | 内部捕获 |
| `retryImport(project)` | 仅 `source.kind === "git"`；已在导入则 409 | 400/409 |
| `createDemo()` | 生成/复用 `.vercio/repos/lumen-demo`，复用同 `repoPath` 的项目；新项目写 demo 描述并种子笔记/评论 | 500（资产缺失） |
| `seedDemoContent(project)` | 没有笔记时插入 3 条；没有评论时插入 1 条（两者独立判断） | — |
| `update(project, patch)` | 仅 `name/description/tagline/links`；description 20k，其余 300；links 最多 8 条，label 80/url 500 | 400 |
| `refresh(project)` | `git fetch --all --prune`（失败不抛，返回 `fetch` 信息）+ `updateGitMeta` + emit | 409 非 ready |
| `remove(project, { deleteRepo })` | 停部署→删 worktree/deps/deployments→删该项目的笔记/评论/项目→可选删克隆仓库 | — |
| `readReadme(project)` | 默认分支根目录 README（优先 `.md`） | 409 非 ready |

### 创建项目的判定

`git.normalizeSource(input)`：

| 输入 | 判定 |
| --- | --- |
| `~`、`~/x` | 展开 `$HOME` 后按路径处理 |
| 存在的目录 | `{ kind: "path", path, name }` |
| `https://`、`ssh://`、`git://`、`git@host:repo` | `{ kind: "git", url }` |
| `owner/repo`（不含 `..`） | `{ kind: "git", url: "https://github.com/owner/repo" }` |
| 其他 | 当作绝对/相对路径 |

本地路径必须是目录、含 `.git`（目录或文件，兼容 worktree）、至少有一个 commit，否则 400/422。Git 来源立即返回状态 `importing` 的项目；clone 在后台进行，完成后 `status=ready`。`importLog` 只存在数据库里，**不在 public DTO 中**，前端看不到导入日志。

### 删除语义

- 总是：停止该项目的部署、删除 worktree、依赖缓存、部署记录、笔记、评论、项目记录。
- `deleteRepo !== false` 且来源是 `git`/`demo` 且路径位于 `<dataDir>/repos/` 下：删除克隆目录。
- `source.kind === "path"`：**永远不删**用户仓库，即使传 `deleteRepo=1`。
- **不删除** `logs/<deploymentId>.log`。

## 6. `DeploymentManager`

构造参数：`{ store, events, config }`。内存映射：`children`（dev server 进程）、`installChildren`、`staticServers`、`logs`（内存日志）、`runners`（运行中的 Promise）、`stopping`（正在停止的 id）。

### 方法与职责

| 方法 | 行为 |
| --- | --- |
| `recoverInterrupted()` | 活动状态→`error`；`ready`→`stopped`；`markDirty` |
| `toPublic(deployment)` | 显式投影；`port` 只在 ready 时返回；`mode` 回退 `requestedMode`；`isProduction` 恒 false |
| `latestByBranch(projectId)` | 每个分支 `createdAt` 最大的部署 |
| `getBranches(project, gitModule)` | `listBranches` + 每分支最新部署 + 默认/当前分支 |
| `create(project, branch, { mode })` | 校验→解析 ref→去重→插入记录→启动后台 runner→返回 `{deployment, reused}` |
| `run(deployment, project)` | 完整流水线（见 [architecture.md](architecture.md#83-run-的完整步骤)） |
| `installDependencies(...)` | 复用工作副本/缓存或安装；成功后写缓存并 symlink |
| `copyLocalEnvFiles(deployment, project, worktreePath)` | 把工作副本根目录被 gitignore 的 `.env*` 复制进 worktree（已跟踪/已存在的不覆盖，跳过 example/sample/template，>512KB 跳过；只记文件名） |
| `devServerAttempts(deployment, detection, worktreePath, command)` | 生成 dev server 启动候选：先尝试 Vite fs.allow overlay 命令，原命令始终作为回退 |
| `startDevServerChild(deployment, worktreePath, attempt, port)` | spawn 一个候选命令、接管 stdout/stderr、等 HTTP 就绪；失败时清理子进程并把日志根因拼进错误 |
| `startStaticServer(...)` | `findFreePort` → `http.createServer(serveStaticDir(spaFallback))` → 绑 `0.0.0.0` |
| `previewPort(id)` | 仅 ready 且有 port 时返回，否则 null |
| `refreshCheckedOutBranch(project)` | `git branch --show-current`，和项目记录不一致时更新 `currentBranch` 并广播 |
| `initLiveSync(deployment, project, worktreePath)` | live 部署：建 controller、首次全量同步、启动 watcher |
| `startLiveWatcher(controller)` | `fs.watch(repoPath,{recursive})` + 2s 轮询兜底；120ms 去抖 |
| `syncLiveWorkingCopy(controller, deployment, initial)` | 校验分支 → `syncWorkingCopyState` → 节流日志；分支变了会停掉 live 预览 |
| `stopLiveSync(id)` / `requestLiveSync(id)` | 清理 watcher/定时器 / 手动触发一次同步 |
| `appendLog(deployment, chunk)` | 去 ANSI/CR，内存最多 4000 行，文件 append |
| `getLog(id)` | 优先内存；否则文件最后 600 行 |
| `failureHint(deploymentId)` | 从日志尾部反向找一行“像错误”的输出（跳过本系统时间戳行、`$`/`>` 回显、堆栈、npm ERR），截断 240，用于拼接 error |
| `fail(deployment, message)` | status=error、error 截断 2000、finishedAt、日志、emit |
| `cleanupBranchWorktrees(project, slug, keepPath)` | 删除同 slug 前缀的旧 worktree |
| `afterReady(project, deployment)` | 停同分支其它 ready 部署；`enforceMaxRunning` |
| `enforceMaxRunning(keepId)` | 只统计 `mode=server && ready && port`，超过 `maxRunningDevServers` 停最旧 |
| `killChild(id)` | 杀进程组：SIGTERM，4s 后 SIGKILL；安装进程也覆盖 |
| `stop(deployment, { reason })` | 允许活动状态；关静态服务器、杀进程、置 stopped、释放端口、日志、emit |
| `stopById(id)` | API 用；仅 ready/starting，否则 409 |
| `stopProject(projectId)` | 停止该项目所有活动部署 |
| `removeProject(project)` | 停部署、关静态服务器、移除 worktree、删 worktrees/deps、删部署记录 |
| `pruneHistory(projectId)` | 每项目只保留最新 60 条（创建时调用） |
| `stopAll()` | 停止所有活动部署、关闭静态服务器、flush |

### 实时同步（live preview）

`create()` 会读取工作副本的当前分支：部署分支与之相同 → `deployment.live = true` 并把 `live` 投影到 public DTO；复用已有 ready 部署时要求 `live` 也一致（旧的非 live 部署会被新部署顶替）。

live 部署在 worktree 建好后先调用 `syncWorkingCopyState()` 全量同步一次，再启动 watcher。watch 事件触发后经 120ms 去抖执行增量同步；Linux 无递归 watch，用 2s 轮询兜底。同步只写 worktree，工作副本仅被读取。分支切换时 live 部署会 stop（error 提示重新部署）。

`live-sync.js` 的导出：

| 导出 | 作用 |
| --- | --- |
| `parseStatusEntries(stdout)` | 解析 `git status --porcelain=v1 -z`；`R/C` 记录的原路径在下一个 NUL 分片 |
| `syncWorkingCopyState({ repoDir, worktreeDir, state })` | 把工作副本改动镜像到 worktree；`state = { syncedPaths, fileHashes, envHashes }` 跨调用保存 |
| `shouldIgnoreWatchPath(filename)` | 忽略 `.git`/`node_modules`/`dist` 等目录的 watch 噪声 |

同步细节：跳过 `.git`、`node_modules`、`.vercio`；跳过 `.env.example/sample/template`；单文件上限 32MB；symlink 按原样重建；内容哈希一致则不重复写（否则会每 2s 触发一次 HMR）；被 revert/提交的旧脏文件会从工作副本重新 copy 回 worktree。

### `create()` 的细节

- 模式只接受 `auto/server/static`。
- 去重只匹配 `status === "ready"` 且同 commit；`mode=auto` 可匹配任意已就绪模式，显式模式必须相等。
- 旧记录被顶替/停止后不会复活；再次预览会新建记录。
- 新记录字段包含 `ref, commit, shortSha, commitMessage, author, requestedMode, mode, status, port, urlPath, worktreePath, staticDir, framework, error, createdAt, readyAt, stoppedAt, lastViewedAt`。
- `urlPath` 持久化值始终为 null；public DTO 在静态 ready 时把它计算成 `/preview/<id>/`，dev server 为 null。前端并不依赖它。
- `lastViewedAt` 只在创建时写一次，之后没有更新逻辑。
- `pruneHistory` 在 `unshift` 后执行，按数组顺序保留前 60 条（最新）。

### 失败处理

`run()` 的 `catch`：

1. 若正在 `stopping` 且已 `stopped`，直接返回（避免把主动停止改成 error）。
2. 若 dev server 仍存活：`killChild()`，然后 `await settleWithin(childClosed, 750)`，给进程最后的机会把 stdout/stderr 刷进日志。
3. `fail()` → `status=error`，写 `error`、`finishedAt`、日志、emit。`run()` 会在 waitForHttp 失败时用 `failureHint()` 把“端口占用/权限/命令不存在”等真实原因拼进 error（例如 `Dev server exited before it became ready (code 1): Port 4100 is already in use`）。
4. 若已分配端口：`releasePort` + `port=null`。

`finally` 总是 `markDirty()` + `emitDeployment()`。

`settleWithin(promise, ms)` 是模块内小工具：最多等待 `ms`，不因 promise 拒绝而抛错；用于确保失败快照包含退出时刷出的日志。

### 并发注意事项（重要）

- **没有锁**：同一分支并发 `create` 可能产生两个 runner，共用同一个 worktree 路径；`addWorktree` 会先 `rm -rf` 目标目录。这是当前最危险的竞态。
- `cleanupBranchWorktrees` 可能在另一个部署仍在使用某 worktree 时删除它（slug 碰撞或旧 commit 清理）。
- 停止与自然退出通过 `stopping` 集合 + 状态判断尽量去重，但 6 秒窗口后就移除标记。

## 7. `git.js`

所有命令通过 `execFile("git", args, { cwd, timeout, maxBuffer, env })`：

- `GIT_TERMINAL_PROMPT=0`：禁止交互式凭据提示。
- 默认 60s 超时、32MB 输出。
- 失败默认抛 `Error("git ... failed: <stderr>")`，并带 `exitCode/stderr`；`allowFail` 时返回 `{code, stdout, stderr, error}`。

| 函数 | 说明 |
| --- | --- |
| `isGitRepo(dir)` | `.git` 是目录或文件（worktree 的 `.git` 是文件） |
| `currentBranch(dir)` | `git branch --show-current` |
| `getDefaultBranch(dir)` | `origin/HEAD` → 当前分支 → `main` |
| `getRemoteUrl(dir)` | `origin` URL，失败空串 |
| `headSha(dir, ref)` | `rev-parse`，失败空串 |
| `getRepoInfo(dir)` | origin/current/default/dirtyCount/head（并行查询） |
| `listBranches(dir)` | `for-each-ref` 本地 + 远程，合并去重，默认分支排最前，其余按时间倒序 |
| `resolveBranch(dir, name)` | `refs/heads/<name>` → `refs/remotes/origin/<name>` → `<name>`；名字含 `:` 时只试原始 ref；404 |
| `commitMeta(dir, sha)` | 作者/ISO 日期/标题；失败 null |
| `readReadme(dir, ref)` | 根目录 `readme.*`，优先 `.md`；返回 `{name, markdown}` |
| `diffStat(dir, base, head)` | `diff --numstat`，先 `base...head` 再 `base..head`；最多返回 40 个文件，汇总 additions/deletions/fileCount |
| `addWorktree(dir, sha, dest)` | 先删 dest，再 `git worktree add --detach --force` |
| `removeWorktree(dir, dest)` | `worktree remove --force` → `rm -rf` → `worktree prune` |
| `fetchRepo(dir)` | `fetch --all --prune --quiet`；返回 `{ok,message}` |
| `cloneRepo(url, dest, onLine)` | 先清空 dest，`git clone --progress`；10 分钟超时；stderr 尾部 4KB 作为错误信息；逐行回调 |
| `normalizeSource(input)` | 见 §5 |
| `repoNameFromUrl(url)` | 取最后一段并去掉 `.git` |

`listBranches` 的远程处理有一个细节：远程 ref 以**分支名**为 key 存入 Map，`if (!remote.has(remoteName + "/" + branchName))` 的判断键与实际 key 不一致，因此实际行为是“后遍历到的远程同名分支覆盖先前的”。本地分支存在时优先用本地。`remoteOnly` 表示“没有本地分支、只有远程”。

## 8. `frameworks.js`

### 包管理器识别

按顺序检查 lockfile：`pnpm-lock.yaml` → `yarn.lock` → `bun.lockb` → `bun.lock` → `package-lock.json` → `npm-shrinkwrap.json`；都没有则 `npm`。

### 框架识别

`FRAMEWORKS` 是有序表，依赖键命中即候选；配置文件（marker）命中会提高确定性。顺序：

`next` → `nuxt` → `astro` → `@sveltejs/kit` → `@remix-run/react` → `gatsby` → `react-scripts` → `@vue/cli-service` → `vite` → `react`。

- `detectScriptKind` 先取第一个依赖命中的候选；之后的候选如果有 marker 命中，则覆盖并 break。因此同时装 `next` 与 `vite` 时通常判为 Next.js。
- `react` 是兜底：任何带 React 依赖的 dev server 项目都会得到 `label="React", kind="generic"`，除非前面更具体的框架命中。
- `astro` 在表里 `kind: "vite"`，所以 `devCommand` 中 `kind === "astro"` 的分支实际不可达（历史遗留）。
- `needsInstall` 的三元表达式两个分支相同，等价于 `dependencyCount > 0`。

### 类型判定

```text
package.json 且有 dev 或 start 脚本  → type = "server"
否则有 index.html（任何候选目录）   → type = "static"
否则有 package.json                 → type = "static", label = "Package project"
否则                                 → type = "static", label = "Static site"
```

静态入口候选顺序：`.`、`dist`、`build`、`out`、`public`、`docs`、`_site`、`site`。根目录 `index.html` 优先于 `dist/`。

### dev 命令矩阵

| kind | 命令参数（npm 在 script 名后多一个 `--`） | 环境变量 |
| --- | --- | --- |
| `next` | `run dev -p PORT -H 0.0.0.0` | PORT/HOST/HOSTNAME/BROWSER/CI/FORCE_COLOR |
| `vite`（含 Astro/SvelteKit/Remix） | `run dev --port PORT --host 0.0.0.0 --strictPort` | 同上 |
| `gatsby` | `run dev -p PORT -H 0.0.0.0` | 同上 |
| `cra` | `run dev` | 同上 + `PORT`（HOST 通过 baseEnv） |
| `vue-cli` | `run dev` | 同上 + `PORT`（`HOST` 已由 baseEnv 注入） |
| `nuxt` | `run dev --port PORT --host 0.0.0.0` | 同上 |
| 其他（`generic`） | `run dev` | 注入 PORT/HOST，需项目自己读取 |

`scriptInvocation`：命令始终是检测到的包管理器（`npm/pnpm/yarn/bun`）。**只有 npm 在额外参数前插入 `--`**；pnpm/yarn/bun 直接追加。原因：pnpm/yarn/bun 会把脚本名后的参数原样转交，而 npm 会把它们当成自己的选项；反过来，给 Vite 传裸 `--` 会让 CAC 解析器把后面的 `--port` 当位置参数，静默忽略端口覆盖（`tests/frameworks.test.js`、`tests/preview.test.js` 都在守这个回归）。

`devScriptCommand(detection, dir)`：读取 worktree `package.json` 里 dev script 的真实命令（如 `"vite"`），供 overlay 判定使用。

### Vite 配置 overlay（`vite-overlay.js`）

当 worktree 通过软链复用 node_modules 时，依赖包文件真实路径在工作区之外，Vite 的 `server.fs.allow` 会拒绝服务（字体/图片/CSS 返回 403）。`run()` 只对“dev script 是纯 `vite`”的项目写一个临时 `.vercio.vite.config.mjs`：import 项目自身 config，`mergeConfig` 后把软链真实路径加进 `server.fs.allow`，并在启动命令后追加 `--config`。

| 导出 | 作用 |
| --- | --- |
| `findViteConfig(dir)` | 按 `vite.config.{ts,mts,js,mjs,cjs,cts}` 找项目配置 |
| `supportsViteConfigOverlay(script)` | 仅 `^vite` 且不含 `--config/-c/--root` 时返回 true；`remix vite:dev`、`astro dev` 等一律跳过 |
| `linkedNodeModulesDir(worktreeDir)` | node_modules 是软链时返回其 realpath，否则 null |
| `writeViteConfigOverlay(worktreeDir, allowedDirs)` | 写 overlay 文件并返回文件名 |

安全网：overlay 命令在 `waitForHttp` 失败时会自动回退到原命令（日志标记 `(fallback)`），因此项目 config 不能被包装时预览仍可启动（`tests/preview.test.js` 的 fake-vite fixture 覆盖了成功与回退两条路径）。

### 依赖指纹与安装计划

- `dependencyFingerprint`：对 `package.json` 与当前包管理器对应的 lockfile 文件名+内容做 sha256，取前 16 位；两者都不存在返回 null。
- `devInstallPlan`：`needsInstall` 为 false 或 worktree 已有 `node_modules` → null；否则返回 `[command, args]`。
- 安装命令：npm/pnpm/yarn/bun 各 `install`。

## 9. `ports.js`

- 模块级 `reserved: Set<number>`，**每个 Node 进程独立**。
- `findFreePort(range, used)`：从 4100 顺序扫；跳过 `reserved` 与 `used`；对每个候选实际 `net.createServer().listen({port, host:"0.0.0.0"})` 探测；成功即 `reserved.add` 并返回；扫完抛错。
- `releasePort(port)`、`reservePort(port)`、`resetPortPool()`（后两者当前无业务调用）。
- `waitForHttp(port, {timeoutMs=120000, intervalMs=350, signal})`：每 350ms `fetch http://127.0.0.1:port/`，单次 1.5s 超时；**任何 HTTP 响应（包括 4xx/5xx）都算就绪**；abort 或超时 reject。
- `isPortResponding(port)`：1.2s 内任一 HTTP 响应即 true。

## 10. `http.js`

| 导出 | 说明 |
| --- | --- |
| `HttpError(status, message, details?)` | 路由 catch 用 `status`；`details` 进 JSON |
| `MIME` / `mimeType(file)` | 常见前端资源类型；未知为 octet-stream |
| `sendJSON(res, status, data, headers?)` | JSON + `Content-Length` + `Cache-Control: no-store` |
| `sendError(res, status, message, details?)` | `{error:{status,message,details?}}` |
| `readJSONBody(req, limit=2MB)` | 空 body → `{}`；超限 413；坏 JSON 400 |
| `isInside(parent, child)` | 相对路径不以 `..` 开头且非绝对 |
| `serveStaticFile(req, res, file, {cacheControl})` | 处理 HEAD、目录递归 index、流式发送；返回 boolean |
| `serveStaticDir(req, res, root, {spaFallback, cacheControl, notFoundPage})` | 只允许 GET/HEAD（否则 405 JSON）；`decodeURIComponent`；拒绝 NUL；解析后 `isInside` 防穿越；无扩展名时 SPA 回退；`notFoundPage` 当前无调用方 |
| `streamToString` / `Readable` | 未被使用 |

注意：`serveStaticDir` 的 405/403/400 都是 JSON 错误体，这是**预览静态服务器**而不是主 API；主 API 的未知方法通常落到 404。

## 11. `browseDirectory(input, { showHidden })`

- 空输入或 `~` → home；`~/x` 展开；其他 `path.resolve`。
- 只返回**目录**：普通目录 + 指向目录的 symlink；文件完全忽略。
- 每个目录项计算 `hidden`（`.` 开头）与 `isGitRepo`（`.git` 目录/文件）。
- 默认隐藏隐藏目录，但 `hiddenCount` 仍统计；`showHidden=1` 时返回。
- 返回 `path/name/parent/isGitRepo/isHome/breadcrumbs/roots/entries/hiddenCount/showHidden`。
- 快捷根：home、Desktop、Documents、Downloads（存在才返回）。
- 错误：ENOENT/ENOTDIR → 404 `details.code="missing"`；EACCES/EPERM → 403 `"denied"`；非目录 → 400 `"not-directory"`；其他读失败 → 400 `"unreadable"`。
- 任何路径都可浏览（这是特性，也是安全边界）。

## 12. `folder-dialog.js`

系统文件夹窗口：在**运行 Vercio 的机器**上打开操作系统的原生目录选择器，返回 `{ path }` 或 `{ cancelled: true }`。

| 导出 | 作用 |
| --- | --- |
| `CANCELLED` | 对话框脚本用来表示“用户取消”的标记串 |
| `expandHomePath(input)` | `~` / `~/x` 展开；空串保持空 |
| `resolveDialogStartFolder(input)` | 起始目录：输入存在则用它；否则用其父目录（存在时）；最后 home |
| `folderDialogCandidates(platform, { defaultPath, prompt })` | 生成按优先级排列的 `{command,args}` 候选 |
| `parseDialogResult({ code, stdout })` | 解析 picked/cancelled/failed；失败抛 500 `dialog-failed` |
| `pickFolder({ platform, runner, defaultPath, prompt, signal })` | 依次尝试候选，统一错误映射；`runner` 可注入用于测试 |

平台实现：

| 平台 | 候选 | 备注 |
| --- | --- | --- |
| macOS | `/usr/bin/osascript -e <script> -- <startFolder> <prompt>` | 用 Standard Additions 的 `choose folder`，**故意不用 Finder**（避免 Automation 权限）；路径/提示通过 argv 传入，不拼进脚本源码 |
| Windows | `powershell.exe -NoProfile -STA -Command <script>` | `System.Windows.Forms.FolderBrowserDialog`；选中路径写 stdout，取消写标记 |
| Linux | `zenity --file-selection --directory ...` → `kdialog --getexistingdirectory ...` | 第一个 ENOENT 时尝试下一个；zenity/kdialog 取消通常是 exit 1 + 空输出 |

行为与错误：

- 超时 5 分钟；超时 → 504 `timeout`。
- 客户端断开 → `AbortController` 触发，向对话框进程发 SIGTERM；路由检测到 `signal.aborted` 后不再写响应（底层可能表现为超时错误，但客户端已离开）。若注入的 `runner` 显式抛 `ABORT_ERR`，`pickFolder` 会原样上抛。
- macOS 未授权自动化 / 无交互 session（stderr 命中 `No user interaction`、`-1713`、`-1743` 等）→ 501 `unavailable`。
- 所有候选都 ENOENT → 501 `unavailable`。
- 其他启动失败 → 500 `dialog-failed`。
- 返回路径必须 `path.resolve` 后仍是已存在目录，否则 400 `not-directory`。
- **不校验 Git 仓库**；选择结果只是路径，项目创建时再校验 `.git` 与 commit。

`prompt` 会把连续换行/制表符压成空格并截断 160 字符；`defaultPath` 会经过起始目录解析。测试通过注入 `runner` 覆盖命令构造、取消、不可用、非法路径；通过 `createVercioApp({ folderDialog })` 覆盖 API 委托，不会真的弹窗。

## 13. `lan.js`

- `getLanAddresses()`：遍历 `os.networkInterfaces()`，跳过虚拟接口（`utun/llw/awdl/bridge/vmnet/ap/tap/tun/gif/stf/p2p/veth/docker/br-/anpi`）、内部地址、非 IPv4；`en0/en1/wlan0/wlp/Wi-Fi` 优先，其余按名字排序。
- `getWifiName()`：仅 macOS，`networksetup -getairportnetwork en0`，回退 `ipconfig getsummary en0`；过滤 redacted；其他平台空串。
- `qrDataUrl(url)`：`qrcode` 生成 360px PNG data URL；内存 LRU（最多 8 条）。
- `getSystemInfo({config, port, ...})`：hostname/platform/release/port/node/version/localUrl/lanUrls/primaryUrl/wifiName/qrDataUrl/dataDir/计数/maxPreviews。`primaryUrl` = 第一个 LAN URL，否则 localhost。

## 14. `demo.js`

`seedDemoRepo(config)`：

- 读 `examples/demo/manifest.json`（数组，至少 2 项）。
- 目标仓库固定 `<dataDir>/repos/lumen-demo`；已有 `.git` 直接返回 `{repoPath, manifest, seeded:false}`。
- 否则 `git init -b main`，按 manifest 顺序：
  - 第一项基于 main；后续每项 `git checkout -B <branch> main`（始终从 main 分叉）；
  - 清空工作区（保留 `.git`）；
  - 复制 `_shared/` 中非 `_` 开头、非 `.DS_Store` 的文件；
  - 复制 `variants/<variant>/` 覆盖；
  - 生成 README 与 `.gitignore`；
  - 按 `daysAgo` 错开提交时间，`AUTHORS` 轮换作者，提交。
- 最后 checkout main。分支数由 manifest 决定（当前 4 个）。
- demo 项目删除后，下次载入会重新生成。

## 15. `routes.js` 结构

`createRequestHandler(deps)` 返回 `async (req,res)`，内部一个大 `try`：

1. `/preview` 正则：`/^\/preview\/([^/]+)(\/.*)?$/`；id 做 `decodeURIComponent`。
2. 非 `/api/` 的 GET/HEAD：dist 静态 + SPA fallback + 提示文本。
3. API 路由按下列顺序匹配。
4. 未命中 `/api/*` → JSON 404；其他 → 文本 404。
5. `catch`：`HttpError` 用其 status，否则 500；`res.headersSent` 时只结束响应。

### `/api/fs/pick-folder` 的特殊处理

- 只接受 `POST`；body 的 `path`/`prompt` 若存在必须是字符串（400）。
- 创建 `AbortController`，监听 `res` 的 `close`：客户端断开时 abort 对话框进程，并**不写响应**。
- 调用 `deps.folderDialog`（默认 `pickFolder`），等待用户操作；成功后 `sendJSON(200, {path}|{cancelled:true})`。
- 错误由 `HttpError` 映射：400 `not-directory`、500 `dialog-failed`、501 `unavailable`、504 `timeout`。
- 它是当前唯一可能挂起数分钟的普通 API；不要在前面加短超时的反向代理。

**顺序敏感点**：`/api/projects/demo` 必须在 `/api/projects/:id` 之前；`/:id/refresh`、`/:id/branches` 等具体子路径也在通用 `/:id` 之前（虽然正则 `^/api/projects/([^/]+)$` 本身不会匹配子路径，但新增静态路径仍建议放在前面）。`/api/fs/pick-folder` 与 `/api/fs/browse` 都是静态路径，不与其他动态路由冲突。

### 路由内校验摘要

| 位置 | 校验 |
| --- | --- |
| `POST /api/fs/pick-folder` | path/prompt 必须是字符串；结果必须是已存在目录；错误码 400/500/501/504 |
| `POST /api/projects` | body.source 必填（`normalizeSource` 抛 400）；本地路径额外校验 |
| `PATCH /api/projects/:id` | 只接受 name/description/tagline/links；类型错误 400 |
| `POST /api/projects/:id/deployments` | branch 必须非空字符串；mode 由 manager 校验 |
| 笔记 | title 默认 `Untitled note`，160 字符；body 100k；tags 最多 8 个；branch 可空 |
| 评论 | body 去空白后不能为空；body 5000；author 默认 Anonymous，60；clientId 80 |
| 评论删除 | `clientId` 查询参数与记录的 `clientId` 都存在且不同 → 403；任一为空则放行 |
| 设置 | userName/defaultAuthor 截断 60 |
| body 大小 | 2MB |

## 16. 服务端扩展点

### 新增一个 API

1. 在 `routes.js` 选好位置（静态路径放在通用 `/:id` 之前）。
2. 用 `readJSONBody`、`projects.get`、`HttpError`；保持 JSON 错误契约。
3. 需要新数据就在 `projects`/`deployments`/`store` 层加方法，不要在 `routes.js` 里直接操作 `db.json`。
4. 加 `web/src/lib/api.ts` 方法与类型（若前端要用）。
5. 加 `tests/api.test.js` 覆盖成功 + 一个失败状态码。
6. 更新 [api.md](api.md)。

### 新增项目来源

`normalizeSource` 返回新的 `kind`，`ProjectsManager.create` 增加分支；同步 `toPublic` 的 `source`、前端 `ProjectSource` 类型、删除语义（是否允许删源目录）、文档。注意 `source.kind` 被前端用于判断是否展示 GitHub 链接、删除提示、demo 标记。

### 新增框架/包管理器

改 `FRAMEWORKS`/`PM_FILES`/`devCommand`，加 `tests/frameworks.test.js` 的纯函数用例，再用 `tests/preview.test.js` 风格的真 dev server 验证端口参数确实生效（尤其 pnpm/yarn/bun 不能多出 `--`）。如果新框架需要特殊参数，在 `devCommand` 加分支；别忘了 `architecture.md` 的命令矩阵。

### 新增预览模式

需要同时改：`DeploymentManager.create` 枚举、`run` 的分支、`toPublic.mode`、前端标签/URL 假设、API 文档、测试。当前 `urlPath` 只对静态有值，新增模式时想清楚是否需要它。

## 17. 已知坑（服务端）

- 端口只在 `stop/fail/close` 释放；新代码若在 `run()` 中途 `return`，检查是否漏了 `releasePort`。
- `markDirty` 是防抖的；测试里马上读 `db.json` 可能读到旧内容，需 `store.flush()` 或等待。
- `stopById` 不允许停止 `installing/queued/preparing`，但 `stop()` 可以；别把两者混用。
- `waitForHttp` 把 500 当就绪；想更严格需改探测逻辑，但会影响所有框架。
- `process.kill(-pid)` 依赖 `detached: true`；非 detached 子进程传负 pid 会失败并被 `child.kill` 兜底。
- `serveStaticDir` 不做 symlink 逃逸防护。
- 项目删除不删日志；清理磁盘要额外处理。
- `projects.refresh` 的 `fetch` 失败不会抛，只体现在返回的 `fetch` 字段；当前前端忽略该字段，统一提示成功。
- 部署状态在服务重启时被改写，但 `port` 字段仍保留旧值；`toPublic` 只在 ready 时返回端口，因此不会误导前端，但数据库里是脏值。
- `event.emit` 的 `seq/at` 是服务端时间；前端未用于排序。
- `/api/fs/pick-folder` 会挂起请求等待用户操作；反向代理/浏览器超时可能先断开，此时服务端会 abort 对话框。无 GUI 的主机应依赖前端回退到 `/api/fs/browse`。
- 系统对话框的“是否回退页内浏览”是**前端策略**（`AddProjectModal` 对 5xx 且非 504 的回退）；API 本身只返回错误码。
- `folder-dialog` 的 macOS/Linux 命令有单元测试（构造 + 解析），Windows 命令没有测试，真实桌面环境也未验证。
- `maxRunningDevServers` 为 NaN 时不限额。
