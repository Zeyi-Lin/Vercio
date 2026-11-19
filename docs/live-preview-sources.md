# 实时预览改造：分支 tip + 编辑源

> 状态：**P1 + P1.5 已实现**（2026-11-19）。实现与本文的差异：同分支复用、tip 前滚、源发现、断源降级、依赖变化原地重启均已落地；P2（就地 attach）未做。代码入口 `server/lib/sources.js`、`server/lib/deployments.js`、`server/routes.js`。

## 0. TL;DR

把预览的语义从「某个 commit 的隔离快照 + 被检出分支的脏文件」改成：

```text
preview(branch) = refs/heads/<branch> 的最新 commit（一直跟随）
                + 该分支编辑源 worktree 的未提交改动（可选叠加）
```

分支的编辑源通过 `git worktree list` 自动发现（主工作副本、harness 会话的 worktree 都算），不再假定只有一个「工作副本」。主副本切分支不再停预览；新提交自动前滚；没有编辑源时仍然跟随 tip，只是纯快照。

## 1. 现象（本机实测）

目标工作流：多个 harness 会话在不同分支上并行改代码，Vercio 里每个分支都能实时看到结果。

Trio-UI 项目的实际数据：

- 25 个历史部署里只有 6 个 `live=true`；当前 3 个运行中的预览（`feat/instance`、`feat/docs-changelog-notifications`、`feat/batch`）**全部是快照**。
- 日志里 5 次 `Preview stopped (working copy switched to …)`：每次切主工作副本分支，上一个分支的实时预览被停掉。
- 截图里的 `feat/instance` 预览 `dpl_4vm54dvm69` 创建于 12:51，`live=false`，worktree 固定检出 `f7d6582`；此后该分支的任何改动都不会进来。

## 2. 根因（按影响排序）

1. **实时只有一个源**：旧 `create()` 拿主工作副本的当前分支决定 `live`，`run()` 里再算一次；同步只读 `project.repoPath`（[live-sync.js](../server/lib/live-sync.js)）。harness 在别的 worktree 里改的分支，Vercio 完全看不见。
2. **切分支就杀预览**：旧 `syncLiveWorkingCopy()` 每次同步前校验分支，不匹配直接 `stop`。多会话并行时这是常态而不是异常。
3. **预览不跟随新提交**：worktree 被 `--detach` 到部署那一刻的 commit，分支 tip 前进后不会动。再点一次分支，旧 `create()` 因为 `commit` 不同而不复用，于是新建一个部署、新占一个端口，旧的还在跑。
4. **同分支新部署会删旧 worktree**：旧 `cleanupBranchWorktrees()` 只按分支 slug 匹配，不看旧部署是否还 ready → 僵尸预览。
5. **UI 不区分实时与快照**：只有 `live` 才显示「实时」徽标（[ProjectPreviews.tsx:634](../web/src/pages/ProjectPreviews.tsx)），快照看起来和实时一模一样，问题被藏起来了。
6. 次要：只镜像 `git status` 里的脏文件（gitignored 产物、submodule、>32MB 文件看不到）；watcher 挂在仓库根目录，成本随仓库增长；Linux 靠 2s 轮询兜底。

## 3. 目标与非目标

**目标**

- 任何分支，只要在本机有一个检出它的 worktree（包括 harness 会话），Vercio 都能实时预览：跟随新提交 + 叠加未提交改动。
- 一个分支只有一个「当前预览」；切分支、断源都不再杀死正在运行的预览。
- 保持隔离不变量：对源只读，只写 Vercio 自己的 worktree 与缓存。

**非目标**

- 多人/多租户、云端部署、自动 CI、在预览里执行生产 build。
- 预览 gitignored 的生成物（P2 的就地模式才考虑）。

## 4. 方案

### 4.1 核心模型

```text
preview(branch) = tip(branch) + overlay(source(branch))
```

- **tip**：`refs/heads/<branch>`（没有本地分支时回退 `refs/remotes/origin/<branch>`），每 2s 以及每次用户操作时解析。
- **overlay**：该分支被检出的那个 worktree 的未提交改动（复用现有 `syncWorkingCopyState()`）。
- **source**：`git worktree list --porcelain` 里 `branch` 与部署分支相同的那一条；git 保证一个分支最多被一个 worktree 检出，所以 branch → source 天然一一映射。
- 没有 source 不是错误：预览仍然跟随 tip，只是没有未提交层（`liveState = "snapshot"`）。

### 4.2 源发现

`listSources(project)`：

```js
git worktree list --porcelain
```

解析 `worktree <path>` / `HEAD <sha>` / `branch refs/heads/<name>` / `detached` / `bare`，排除：

- `config.dirs.worktrees/<projectId>/…` 下 Vercio 自己的预览 worktree（它们是产物，不是编辑面）；
- `bare`、不可访问、以及 `.vercio` 数据目录内的路径；
- 可选：路径段命中忽略集合（`node_modules` 等）的条目。

返回 `{ path, branch, head, detached, main }`，主工作副本标 `main: true` 并优先。

刷新时机：预览页打开/轮询、创建部署、同步失败后。解析成本很低（一次 git 调用），可以每次预览页轮询都带上。

### 4.3 同步循环

每个部署一个 controller：`fs.watch(sourcePath, { recursive: true })` + 120ms 去抖，外加 2s tick 兜底。

```text
tick():
  tip = git -C repo rev-parse refs/heads/<branch>   # 失败则回退 origin/<branch>
  if tip && tip != deployment.commit:
      git -C <previewWorktree> checkout -f --detach <tip>
      resetSyncState(controller)          # 基线变了，旧哈希全部作废
      deployment.commit = tip; shortSha/commitMessage/author 更新
      emit deployment.updated
  source = bindSource(deployment)         # 可能为 null
  if source && source.branch == deployment.branch:
      mirrorDirty(source.path -> previewWorktree, controller.state)
      liveState = "following"
  else if liveState != "snapshot":
      liveState = "detached"              # 不 stop，预览继续服务最后状态
```

细节：

- `checkout -f --detach` 只作用在 Vercio 自己的 worktree；它对 tracked 文件生效，不会动 `node_modules` symlink 或生成的 overlay 文件。
- dev server 不重启：Vite/Next 的 watcher 看到 worktree 文件变化即 HMR。只有 `package.json` / lockfile 变化时需要重启（P1.5：检测到就 stop → install/cache → start，同一部署同一端口）。
- source 消失（worktree 被删）或切到别的分支：解绑、日志、`liveState = "detached"`，预览保留。
- 静态模式同样跟随 tip（checkout 后静态目录内容自然更新），overlay 照旧。
- 前滚失败（例如分支被删除）：保持旧 commit，`liveState = "detached"`，日志记录原因。

### 4.4 生命周期与去重

- `create()`：同 branch 已有 ready 部署 → 直接复用并请求一次同步，不再比对 commit（tip 由同步循环负责前滚）；否则新建。
- 分支切换不再 `stop`；只有用户显式停止、项目删除、源与 tip 都不可用且用户要求时才停。
- `cleanupBranchWorktrees()` 增加保护：只清理没有被任何 ready 部署引用的 worktree 目录。
- 停止/删除/项目删除的端口与进程组回收路径保持不变。

### 4.5 数据模型与 API

内部字段（不进 `toPublic()`）：`sourcePath`、`sourceKind`、`sourceHead`、`follow`。

公开字段：保留 `live`（兼容旧前端），新增

```ts
liveState: "following" | "snapshot" | "detached";
sourceKind: "working-copy" | "worktree" | null;   // 不暴露路径
```

新增接口：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/projects/:id/sources` | 列出源（含未被任何预览绑定的分支），给 UI 提示「这个分支有编辑源」 |
| `POST` | `/api/deployments/:id/follow` | 重新绑定/恢复跟随（body 可选 `{ branch }`） |
| `DELETE` | `/api/deployments/:id/follow` | 断开跟随，保持服务 |

复用现有 `deployment.updated` SSE，不新增事件。

搜索并替换的消费点：`web/src/lib/types.ts` 的 `Deployment`、`ProjectPreviews.tsx` 的徽标与 banner、`i18n/dictionary.ts` 的 en/zh。

### 4.6 UI

- 分支行：`● 实时` / `○ 快照` / `◌ 未运行`；快照的 tooltip 写明「该分支没有被任何 worktree 检出，预览停在 `<sha>`」。
- 预览工具栏：`实时` 徽标旁显示源类型（工作副本 / worktree）；快照显示 `快照 · f7d6582`。
- 断开 banner：`实时同步已断开：主工作副本切到了 feat/x` + [重新绑定] + [重新部署]。
- 空态：分支没有源时给一条可复制的 `git worktree add …` 命令，把「怎么让预览实时」做成可发现的产品文案。
- 所有文案 en/zh 同时加。

### 4.7 分阶段

| 阶段 | 内容 | 解决的问题 | 风险 |
| --- | --- | --- | --- |
| P0（0 代码） | 会话 worktree 约定 + 提示词（见 [harness-preview-workflow.md](harness-preview-workflow.md)） | 多会话不再抢主副本 | 无 |
| P1 ✅ | tip 跟随 + 源发现 + 切分支不 stop + 状态 UI/API | 90% 的「看不到实时改动」 | 前滚瞬间的 HMR 抖动；依赖变化 |
| P1.5 ✅ | 锁文件变化自动重启；清理保护 | 提交后依赖变化、僵尸预览 | 重启窗口 |
| P2 | 就地 attach：dev server 直接跑在源 worktree | 零拷贝；gitignored 产物也能预览 | 要写源目录缓存，破坏「只写 worktree」不变量 |
| P3 | 新 worktree 出现 → 自动建预览 | 少点几次 | 端口/资源上限 |

P2 只在 P1 实测仍有明显缺口时做，默认关闭，设置项显式开启。

### 4.8 备选与取舍

- **就地 attach（P2）**：最接近零延迟，但要往用户/harness 的目录写 overlay、依赖缓存，与现有隔离不变量冲突，所以不放 P1。
- **持续整目录复制**：绕过 git，但删除/重命名/二进制/大量文件难处理，且无法跟随提交。
- **让 harness 直接改 Vercio 的预览 worktree**：预览 worktree 会被清理重建、还是 detached HEAD，不能当编辑面。

## 5. 不变量与风险

- **源只读**：只允许 `rev-parse`、`worktree list`、`status`、读文件；禁止在源里 `checkout/reset/clean/worktree add|remove`。
- 前滚只在自己的 worktree 里 `checkout -f --detach`；前滚后必须清空 `state.fileHashes`，否则会把新内容当成「已同步」跳过。
- 端口/进程组回收路径不变；停止后端口必须释放。
- `toPublic()` 不加路径字段，只加状态字段。
- watch 成本：只 watch 绑定的源目录，不再 watch 整个仓库；忽略集合补 `.worktrees`、`.vercio`。
- 文件限制：>32MB、submodule、gitignored 生成物仍然镜像不到；用 `detached` 文案说明，必要时 P2。

## 6. 验收与测试

- 单测：`worktree list --porcelain` 解析、排除 Vercio 自己的预览 worktree、主副本优先。
- 集成（扩展 `tests/preview.test.js`）：
  1. 两个分支各一个 worktree，同时预览；只在 A 的 worktree 里改文件 → A 变、B 不变；
  2. 在 B 的 worktree 里 commit → B 的预览前滚到新 commit，端口不变；
  3. 主副本切到第三个分支 → A/B 预览仍 ready，`liveState` 变 `detached`（不是 stopped）；
  4. 同分支再次 `create` → 返回同一个部署 id；
  5. 停止后端口释放（现有用例回归）。
- 手工：demo 项目 → 两个分支 → 两个会话同时改 → 两个预览都实时。
- 现有 `live` 断言（[preview.test.js](../tests/preview.test.js) 的 "preview worktrees inherit…" / "checked-out branch previews…"）按新语义调整，并补 `liveState` 断言。

## 7. 文档同步

实现时一起改：`backend.md` 8.8、`architecture.md` 8.8 与第 5 节状态机、`api.md` 的 Deployment 对象与接口总表、`data-model.md` 的部署字段、`frontend.md` 的预览页状态。

## 8. 改动地图（P1 实现清单）

| 文件 | 改动 |
| --- | --- |
| `server/lib/sources.js`（新增） | `listSources(project, config)`：解析 `git worktree list --porcelain`、排除预览 worktree、主副本优先 |
| `server/lib/git.js` | `listWorktrees(repoDir)` 薄封装（可并入 sources） |
| `server/lib/deployments.js` | 绑定/解绑 source；tip 轮询与前滚；`create()` 按 branch 去重；切分支不 stop；`cleanupBranchWorktrees` 保护；`toPublic` 加 `liveState`/`sourceKind` |
| `server/lib/live-sync.js` | `syncWorkingCopyState({ sourceDir, worktreeDir, state })` 参数化（现在写死 repoDir 语义）；新增 `resetSyncState()` |
| `server/routes.js` | `GET /api/projects/:id/sources`、`POST/DELETE /api/deployments/:id/follow` |
| `web/src/lib/types.ts`、`api.ts` | `Deployment.liveState` / `sourceKind`；sources、follow 调用 |
| `web/src/pages/ProjectPreviews.tsx` | 分支行与工具栏状态、断开 banner、空态命令 |
| `web/src/i18n/dictionary.ts` | en/zh 文案 |
| `tests/live-sync.test.js`、`tests/preview.test.js` | 源参数化、tip 前滚、切分支不停、同分支复用 |

规模估计：P1 约 400–500 行改动（含测试），主要风险集中在「前滚瞬间 dev server 的稳定性」与「同分支复用后的清理语义」。

## 9. 决策记录

1. 快照分支也自动跟随 tip —— 已实现。
2. 断开源后保留预览继续服务，降级 `detached` —— 已实现。
3. P2 就地模式未做，默认不做；等 P1 实测仍有明显缺口（gitignored 生成物、submodule、超大文件）再评估。
4. 对外只暴露 `liveState`/`sourceKind`，`sourcePath`/`worktreePath` 保持内部字段 —— 已实现。
