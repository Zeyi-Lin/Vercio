# 多会话并行改分支时的 worktree 约定

配合 [live-preview-sources.md](live-preview-sources.md) 使用。目标：多个 harness 会话各改一个分支，Vercio 里每个分支都能实时预览，互不踩踏。

## 1. 一条铁律

**一个会话 = 一个分支 = 一个 worktree。**

不要让两个会话共用一个目录，也不要让会话去 `git switch` 主工作副本。Vercio 的实时预览只认「分支被哪个 worktree 检出」，主副本被切来切去正是现在实时预览消失的主要原因（日志里 5 次 `working copy switched to …`）。

## 2. 开工前（终端，每个分支一次）

```bash
REPO="$HOME/Documents/外置大脑/SwanLab-Docs/未命名/Trio-UI"
WT="$HOME/worktrees/Trio-UI/feat-instance"

# 新分支：从 main 拉出来并检出（-b 新建；分支已存在时去掉 -b 和起点）
git -C "$REPO" worktree add -b feat/instance "$WT" origin/main

# 已存在的分支
git -C "$REPO" worktree add "$WT" feat/instance

git -C "$REPO" worktree list
```

约定：

- worktree 放在**仓库外**（`~/worktrees/<repo>/<slug>`），不要放进仓库内被 git 跟踪的目录，也不要放进 `.vercio/`。
- **会话的 workspace 选这个 worktree 目录**。DSH 的写权限按会话 workspace 授予，从主仓库启动的会话写不进同级 worktree。
- 分支名和目录名保持一一对应；Vercio 按分支名显示预览。
- 如果确实只能把 worktree 建在仓库内（沙箱限制），同时把它加进本地 exclude，否则主副本会变脏、实时同步会把整个 worktree 当成改动复制：
  ```bash
  printf '.worktrees/\n' >> "$REPO/.git/info/exclude"   # 只影响本地，不产生提交
  ```

## 3. 每次给 harness 的提示词（可直接复制）

```text
本项目由多个会话并行改不同分支。你只在这个 worktree 里工作：
  分支：feat/instance
  目录：/Users/<you>/worktrees/Trio-UI/feat-instance

规则：
1. 不要 git switch / checkout / reset / clean 主工作副本，也不要动别的 worktree。
2. 不要自己起 dev server，端口留给 Vercio。
3. 每完成一个可验收的小步就 commit（Vercio 跟随分支 tip，提交越勤预览越新）。
4. 改完告诉我：分支名、worktree 绝对路径、最新 commit、是否还有未提交改动。
```

如果会话会自己新建 worktree（workspace 是仓库父目录时才行）：

```text
开工前先为你的分支建独立 worktree，不要用主工作副本：
  git -C "$REPO" worktree add -b <branch> "$HOME/worktrees/<repo>/<slug>" origin/main
之后所有读写都限制在这个目录内。
```

## 4. 收工

```bash
git -C "$WT" status --short
git -C "$WT" log --oneline -3
```

分支合入主分支后清理：

```bash
git -C "$REPO" worktree remove "$WT"
git -C "$REPO" worktree prune
```

## 5. 现在能做到什么

| 场景 | 行为 |
| --- | --- |
| 主副本检出的分支 | 实时（提交 + 未提交改动） |
| 别的 worktree 里的分支 | 实时：预览自动发现该 worktree，跟随提交与未提交改动 |
| 预览启动后才新建的 worktree | 2 秒内自动绑定，无需重新部署 |
| 主副本切分支 | 预览保留；若该分支还有别的 worktree，继续实时；否则变 `detached`（继续跟随提交） |
| 同分支新提交 | 原地前滚，端口和 deployment id 都不变 |
| `package.json`/lockfile 变化 | 同端口自动重启一次 |
| worktree 被删除 | 降级为快照，点「重新绑定改动」可在新 worktree 出现后恢复 |

所以现在不需要"先 commit 才能看"；只有 **gitignored 的生成物、submodule、>32MB 文件**仍然不会出现在预览里。分支没被任何 worktree 检出时，预览会显示 `快照` 徽标并停在最近一次提交。

## 6. 常见错误

- 两个会话共用一个 worktree → 改动互相覆盖，预览只会看到最后一次写入。
- 仍然建议不要在多个会话里 `git switch` 同一个主副本：分支的编辑源虽然能跟着换，但会话之间的工作区会互相覆盖。
- 在 worktree 里 `git commit --amend` / `rebase` → tip 变了会整页刷新，属正常，不是预览坏了。
- worktree 建在仓库内且没进 `.git/info/exclude` → 主副本 `git status` 变脏、改动计数失真（同步本身会跳过 `.worktrees/`）。
- 会话自己 `pnpm dev` → 抢端口/两份 HMR，预览可能连到错误的进程。

## 7. 自查

```bash
# 这个分支有没有编辑源
git -C "$REPO" worktree list | grep -F "[feat/instance]"

# 这个分支的编辑源
curl -s localhost:4000/api/projects/<projectId>/sources

# 某个预览是不是实时（看日志里有没有 Live preview / Live sync）
tail -50 "$VERCIO_DATA_DIR/logs/<deploymentId>.log"    # 默认 .vercio/logs/

# 当前实时预览数
curl -s localhost:4000/api/projects/<projectId>/deployments | grep -o '"live":true' | wc -l
```
