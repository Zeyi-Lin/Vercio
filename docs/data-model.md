# 数据模型与磁盘布局

Vercio 没有数据库。全部状态在内存里是一个普通对象，落盘为 `<dataDir>/db.json`；其余目录存放仓库、worktree、依赖缓存与日志。

## 1. 总览

```text
db.json
├── version: 1
├── settings
├── projects[] ──────────────┐
├── deployments[] ───────────┼── projectId 关联项目
├── notes[] ─────────────────┤
└── comments[] ──────────────┘
```

- 所有实体都是普通 JSON 对象，没有外键约束、没有级联删除（由代码手动维护）。
- 时间统一 ISO 字符串；排序也直接用字符串比较（ISO 8601 可按字典序比较）。
- ID 前缀：`prj_`、`dpl_`、`note_`、`cmt_`，随机 12 位 base36。

## 2. 顶层结构

```jsonc
{
  "version": 1,
  "settings": { "userName": "", "defaultAuthor": "" },
  "projects": [],
  "deployments": [],
  "notes": [],
  "comments": []
}
```

`Store.load()` 只做浅合并；`projects/deployments/notes/comments` 若不是数组会被重置为空。`version` 目前**没有迁移逻辑**，只记录为 1。

## 3. Project

| 字段 | 类型 | 写入点 | 语义 / 限制 |
| --- | --- | --- | --- |
| `id` | string | `create` | `prj_` + 12 位 |
| `name` | string | create/update | 更新时截断 300；创建时没有显式截断（UI 限制 80） |
| `source` | object | create | `{ kind: "git" \| "path" \| "demo", input?, url?, path? }` |
| `repoPath` | string | create | 本机绝对路径；克隆项目在 `<dataDir>/repos/` 下 |
| `description` | string | create/update | Markdown brief；更新上限 20000 |
| `tagline` | string | create/update | 上限 300 |
| `links` | array | update | 最多 8 条 `{label(80), url(500)}` |
| `status` | string | create/import/retry | `ready` / `importing` / `error` |
| `error` | string \| null | import/retry | 导入失败原因 |
| `isDemo` | boolean | demo | 当前前端用于展示 demo 徽章 |
| `createdAt` | ISO | create | |
| `updatedAt` | ISO | 多处 | 列表排序依据 |
| `defaultBranch` | string | `updateGitMeta` | `origin/HEAD` → 当前分支 → main |
| `currentBranch` | string | `updateGitMeta` | 用户工作副本当前分支（只读观察，不切换） |
| `originUrl` | string | `updateGitMeta` | 远端 URL，可能为空 |
| `dirtyCount` | number | `updateGitMeta` | 工作副本未提交文件数（`git status --porcelain`） |
| `branchCount` | number | `updateGitMeta` | 本地+远程分支去重后的数量 |
| `pinnedBranch` | string \| null | update | 分支列表置顶的分支名，最多一个；`null`/空串取消；PATCH 时用 `listBranches` 校验存在性，不存在返回 422 |
| `latestCommit` | object \| null | `updateGitMeta` | 默认分支最新提交 `{shortSha,message,author,date,timestamp,branch}` |
| `framework` | object \| null | 部署检测时 | `{label,type,kind,packageManager}`，随预览更新 |
| `importLog` | string[] | `startImport` | **内部字段**，最多 100 行，不对外暴露 |

创建路径项目的初始字段：`status=ready`、`error=null`，并立即 `updateGitMeta`。Git 项目先以 `status=importing` 落库，clone 完成后补元数据。

## 4. Deployment

| 字段 | 类型 | 写入点 | 语义 / 限制 |
| --- | --- | --- | --- |
| `id` | string | create | `dpl_` + 12 位 |
| `projectId` | string | create | 关联 Project |
| `branch` | string | create | 原始分支名（含 `/` 等） |
| `ref` | string | create | 解析到的 git ref |
| `commit` | string | create/run | 40 位 sha；run 开始时会重新解析 |
| `shortSha` | string | create/run | 前 7 位 |
| `commitMessage` | string | create | 提交标题 |
| `author` | string | create | 提交作者名 |
| `requestedMode` | string | create | 请求的 `auto/server/static` |
| `mode` | string | run | 解析后的 `server/static`（旧记录可能没有） |
| `status` | string | 状态机 | 见下 |
| `port` | number \| null | 分配/停止 | 预览监听端口；`fail` 会释放并置 null，`stop` 只释放端口但保留旧值；public 仅 ready 时输出 |
| `urlPath` | string \| null | create（恒 null） | DB 中始终 null；public DTO 对静态 ready 计算 `/preview/<id>/`；前端未消费 |
| `worktreePath` | string | run | 本 commit 的隔离目录 |
| `staticDir` | string \| null | run | 静态根目录（相对 worktree），`.` 或 `dist` 等 |
| `framework` | object \| null | run | 检测结果快照 |
| `error` | string \| null | fail/stop | 失败原因；`stop` 不写停止原因（ready 时清空），截断 2000 |
| `createdAt` | ISO | create | |
| `readyAt` | ISO \| null | ready | |
| `stoppedAt` | ISO \| null | stop/recover | |
| `lastViewedAt` | ISO | create | **只写不读**，预留 |
| `devCommand` | string \| null | run | 实际命令 + 参数，供 UI 显示 |
| `live` | boolean | create/run | true：部署分支 == 工作副本当前分支，worktree 会实时同步未提交改动；public DTO 输出 |
| `finishedAt` | ISO \| null | fail | 内部；不在 public DTO |

### 状态

```text
queued → preparing → [installing] → starting → ready → stopped
                 └───────────── error
```

- 静态：`queued → preparing → ready`。
- `error` / `stopped` 是终态；再次预览新建记录。
- 状态字符串是自由文本字段，没有数据库约束；合法性靠代码与前端类型。

### 部署记录保留

- 每次新建部署 `unshift` 到数组头。
- `pruneHistory` 在创建后执行：每个项目只保留数组前 60 条。
- 项目删除时删除其全部部署记录。
- 部署记录不级联删除日志文件。

## 5. Note

| 字段 | 类型 | 写入点 | 语义 / 限制 |
| --- | --- | --- | --- |
| `id` | string | create | `note_` |
| `projectId` | string | create | |
| `title` | string | create/update | 默认 `Untitled note`；截断 160 |
| `body` | string | create/update | Markdown；上限 100000 |
| `tags` | string[] | create/update | 最多 8 个；去空；单个标签不额外限长 |
| `pinned` | boolean | create/update | 列表置顶 |
| `branch` | string \| null | create/update | 可关联分支；空串归一为 null |
| `createdAt` | ISO | create | |
| `updatedAt` | ISO | create/update | 每次 PATCH 更新 |

服务端 GET 排序：pinned 优先，然后 `updatedAt` 倒序。前端会再排一次相同规则。

## 6. Comment

| 字段 | 类型 | 写入点 | 语义 / 限制 |
| --- | --- | --- | --- |
| `id` | string | create | `cmt_` |
| `projectId` | string | create | |
| `branch` | string \| null | create | 分支讨论；空串归一为 null |
| `author` | string | create | 默认 `Anonymous`；上限 60 |
| `body` | string | create | 纯文本；上限 5000；trim 后不能为空 |
| `clientId` | string | create | 浏览器本地标识；上限 80；旧 demo 评论可能没有 |
| `createdAt` | ISO | create | 升序展示 |

## 7. 磁盘布局

```text
<dataDir>/                         # 默认 <repo>/.vercio
├── db.json                        # 唯一状态文件
├── db.json.tmp                    # 原子写临时文件（瞬时）
├── db.json.corrupt-<timestamp>    # 损坏备份
├── repos/
│   ├── <repoSlug>-<shortId6>/     # GitHub clone
│   └── lumen-demo/                # 内置演示仓库
├── worktrees/
│   └── <projectId>/
│       └── <branchSlug>-<sha8>/   # git worktree，--detach
├── deps/
│   └── <projectId>/
│       └── <fingerprint>/node_modules/
├── logs/
│   └── <deploymentId>.log         # 追加写，不轮转
└── tmp/                           # 已创建，当前未使用
```

命名规则：

- `slugify(value)`：小写，非 `a-z0-9._-` 替换为 `-`，去首尾 `-`，截断 60，空则 `branch`。
- 克隆目录：`<slug(repoName)>-<6 位随机>`，避免重名。
- worktree：`<slug(branch)>-<commit 前 8 位>`。
- 指纹：`sha256(package.json + lockfile 内容)` 前 16 位。

`git worktree` 的元数据在源仓库 `.git/worktrees/` 下，由 git 管理；删除项目时 `git worktree remove --force` + `worktree prune`。

### 数据目录可迁移性

- `db.json` 里的 `repoPath`、`worktreePath` 是**绝对路径**；直接移动整个 dataDir 后，克隆项目的 `repoPath` 仍指向旧位置，预览会报 `Repository is missing`。
- 迁移方式：复制 dataDir 后逐个改写 `projects[].repoPath` 与 `deployments[].worktreePath`，或删除 DB 后重新添加项目（本地路径项目不受影响，克隆项目需重新 clone）。
- `deps/` 与 `worktrees/` 是可重建的；`repos/`（克隆仓库）与 `db.json` 是核心数据。

## 8. 删除生命周期

| 操作 | 数据库 | 磁盘 | 进程/端口 | 源仓库 |
| --- | --- | --- | --- | --- |
| 停止部署 | 状态→stopped，stoppedAt；`port` 释放但字段保留旧值（public 隐藏） | 保留 worktree/deps/log | 杀进程组/关静态服务器，释放端口 | 不动 |
| 删除笔记 | 删除记录 | 无 | 无 | 无 |
| 删除评论 | 删除记录 | 无 | 无 | 无 |
| 删除项目 | 删除项目、其部署、笔记、评论 | 删除 `worktrees/<projectId>`、`deps/<projectId>`；**不删 logs**；按规则删克隆仓库 | 先停所有部署、关静态服务器、释放端口 | `path` 项目永不删除；`git/demo` 且位于 `repos/` 下才删 |
| 服务重启 | 活动部署→error，ready→stopped；导入→error | 全部保留 | 内存映射清空；可能有残留 detached 进程 | 不动 |
| 重新载入 demo | 复用同 repoPath 项目，不重复插入 | 若 `repos/lumen-demo` 已存在则复用 | 无 | 不重新生成 |
| 损坏 DB | 原文件备份为 `.corrupt-*`，状态清空 | 其他目录保留 | 无 | 不动 |

`DELETE /api/projects/:id` 的 `deleteRepo` 默认 true；前端对 `source.kind === "path"` 传 false，但服务端无论如何都不删本地路径仓库。

## 9. 排序、上限与保留

| 对象 | 规则 | 上限/位置 |
| --- | --- | --- |
| 项目列表 | `updatedAt` 倒序 | 无 |
| 部署数组 | 新建 `unshift` | 每项目保留最新 60 |
| `/api/overview` 部署 | 全局数组前 40 | 40 |
| 分支列表 | 默认分支优先，其余 commit 时间倒序 | 仓库实际分支数 |
| 笔记列表 | pinned 优先，`updatedAt` 倒序 | 无 |
| 评论 | `createdAt` 升序 | 无 |
| diff 文件 | 改动行数降序 | 返回 40，`fileCount` 为总数 |
| 内存日志 | 追加 | 4000 行；每行 4000 字符 |
| 日志文件 | append | 不轮转 |
| `importLog` | clone 输出逐行追加 | 100 行 |
| SSE `seq` | 进程内递增 | 重启归零 |
| 二维码缓存 | 内存 Map | 8 条 |

其他文本上限：设置项 60、项目 name/tagline（更新时）300、description 20000、链接 label 80/url 500、评论 author 60/body 5000/clientId 80、笔记 title 160/body 100000、请求体 2MB。

## 10. 公开 DTO 与内部字段

API 不直接返回数据库实体，而是经过 `ProjectsManager.toPublic()` / `DeploymentManager.toPublic()` 的显式投影。

### 不对外暴露的 Project 字段

- `importLog`（git clone 日志）
- 以及任何未来新增但未加入 `toPublic` 的字段

### 不对外暴露的 Deployment 字段

- `ref`
- `worktreePath`
- `staticDir`
- `finishedAt`
- `lastViewedAt`

### 公开但需注意的字段

| 字段 | 注意 |
| --- | --- |
| `repoPath` | 绝对路径会发给所有局域网访问者 |
| `port` | 只有 ready 时返回；DB 里 stopped 记录可能保留旧端口 |
| `urlPath` | 只有静态 ready 时非空，前端未使用 |
| `isProduction` | 恒 false；真实“是否默认分支”由 Branch.isDefault 表达 |
| `mode` | 旧记录可能回退为 `auto` |
| `projectName` | 仅 overview 注入 |
| `framework` | 部署时快照，分支间可能不同；项目上的 framework 是最近一次检测 |

### 派生/计算字段

| 字段 | 来源 |
| --- | --- |
| `project.branchCount` | `listBranches().branches.length` |
| `project.latestCommit` | 默认分支那条 branch 记录 |
| `project.framework` | 最近一次部署检测的 `{label,type,kind,packageManager}` |
| `deployment.port`（public） | DB port，仅 ready 时输出 |
| `deployment.mode`（public） | 依次回退 `deployment.mode` → `requestedMode` → `"auto"` |
| `stats` | 每次请求实时统计 |
| `running` | `status=ready` 的部署数 |
| `notesCount/commentsCount` | 项目详情接口实时过滤 |

## 11. 一致性与恢复

- **单写者**：唯一 `Store` 实例；所有修改共享同一对象引用。
- **防抖写盘**：`markDirty()` 后 80ms 写临时文件并 `rename`；正常关闭 `flush()`。
- **无事务**：多步修改中途抛错会留下部分内存变更；下一次防抖仍会写盘。
- **无 fsync**：断电可能丢最近的写；文件系统层面仍保证 rename 原子性。
- **无并发控制**：两个进程写同一 dataDir 会互相覆盖。
- **恢复**：启动时把中断状态改写为终态；不自动重建预览。
- **孤儿进程**：detached 子进程不随主进程死亡；SIGKILL/断电后需要手工清理（见 development.md）。

## 12. Schema 演进

当前没有迁移框架，`version: 1` 只是占位。改 schema 时：

1. **新增可选字段**：在创建处给默认值；读取处用 `??`/类型可选；`toPublic` 决定是否暴露；同步 `web/src/lib/types.ts`。
2. **新增集合**：必须同时改 `DEFAULT_STATE`、`Store.load` 的数组规范化列表（目前硬编码四个），否则缺省值不会补。
3. **重命名/改类型**：属于破坏性变更；在 `Store.load` 后加幂等迁移函数，迁移前备份 `db.json`，并提升 `version`。
4. **删除字段**：先确认没有 `toPublic`/前端/测试引用；旧数据字段可留在文件里，不必强制清理。
5. **测试**：至少覆盖“旧形状数据能加载并正常工作”的用例；当前测试没有迁移用例，需要新增。

推荐的迁移位置（若将来引入）：

```text
Store.load()
  → parse
  → migrate(state)（幂等，按 version 分支）
  → normalize arrays/settings
  → 返回
```

## 13. 未使用/易误解字段

| 字段/函数 | 现状 |
| --- | --- |
| `settings.defaultAuthor` | API 可写，UI 未使用 |
| `deployment.isProduction` | public DTO 恒 false，未实现 |
| `deployment.urlPath` | DB 恒 null；DTO 对静态 ready 计算 `/preview/<id>/`，前端未读 |
| `deployment.lastViewedAt` | 只在创建时写 |
| `deployment.finishedAt` | 失败时写，不公开 |
| `config.idleStopMs` | 固定 0，未使用 |
| `ports.reservePort/resetPortPool` | 导出但无业务调用 |
| `http.streamToString` / `Readable` | 未使用 |
| `DeploymentManager.emitProject` | 定义但未调用 |
| `serveStaticDir` 的 `notFoundPage` | 无调用方 |
