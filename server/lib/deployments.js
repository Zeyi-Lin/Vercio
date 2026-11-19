import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { slugify } from "./config.js";
import { HttpError, serveStaticDir } from "./http.js";
import { newId } from "./ids.js";
import {
  addWorktree,
  checkoutWorktree,
  commitMeta,
  currentBranch,
  diffNames,
  resolveBranch,
  resolveBranchTip,
  removeWorktree,
} from "./git.js";
import {
  dependencyFingerprint,
  detectProject,
  devCommand,
  devInstallPlan,
  devScriptCommand,
} from "./frameworks.js";
import { findFreePort, isPortResponding, releasePort, waitForHttp } from "./ports.js";
import {
  linkedNodeModulesDir,
  supportsViteConfigOverlay,
  writeViteConfigOverlay,
} from "./vite-overlay.js";
import {
  createSyncState,
  resetSyncState,
  shouldIgnoreWatchPath,
  syncWorkingCopyState,
} from "./live-sync.js";
import { listSources, sourceForBranch, toPublicSource } from "./sources.js";

const ANSI_RE = /\u001b\[[0-9;]*[A-Za-z]/g;
const MAX_LOG_LINES = 4000;
// Vite (and most dev servers) load `.env`, `.env.local`, `.env.<mode>` and
// `.env.<mode>.local` from the project root. They are usually gitignored, so a
// fresh worktree never contains them - and a preview that needs e.g.
// VITE_API_BASE_URL fails before React mounts. Copy the developer's local env
// files into the worktree unless the branch itself tracks that file.
const ENV_FILE_RE = /^\.env(?:\.[A-Za-z0-9_-]+)*$/;
const ENV_FILE_SKIP_RE = /\.(?:example|sample|template|schema)$/i;
const MAX_ENV_FILE_BYTES = 512 * 1024;
const FOLLOWABLE_STATUSES = new Set(["preparing", "installing", "starting", "ready"]);
// Files whose change means the installed dependencies no longer match the tree.
const DEPENDENCY_FILES = new Set([
  "package.json",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
]);
const BUSY_STATUSES = new Set(["queued", "preparing", "installing", "starting", "ready"]);
const ERROR_HINT_RE =
  /(error|failed|failure|fatal|exception|eaddrinuse|eacces|econnrefused|already in use|not found|cannot|can't|unable|denied|missing|invalid)/i;

function nowIso() {
  return new Date().toISOString();
}

function safeText(value) {
  return String(value || "").replace(ANSI_RE, "").replace(/\r/g, "");
}

/**
 * Resolves when `promise` settles or after `timeoutMs`, whichever comes first.
 * Used to give a terminated child process a brief moment to flush its stdio
 * before the failure is recorded, so the error state always carries the full
 * dev-server output.
 */
function settleWithin(promise, timeoutMs) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    if (typeof timer.unref === "function") timer.unref();
    Promise.resolve(promise).catch(() => {}).then(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

export class DeploymentManager {
  constructor({ store, events, config }) {
    this.store = store;
    this.events = events;
    this.config = config;
    this.children = new Map();
    this.installChildren = new Map();
    this.staticServers = new Map();
    this.logs = new Map();
    this.runners = new Map();
    this.stopping = new Set();
    this.followers = new Map();
    this.sourceCache = new Map();
    this.restartingDeployments = new Set();
    this.recoverInterrupted();
  }

  recoverInterrupted() {
    const state = this.store.get();
    let changed = false;
    for (const deployment of state.deployments) {
      if (["queued", "preparing", "installing", "starting"].includes(deployment.status)) {
        deployment.status = "error";
        deployment.error = "Preview was interrupted by a server restart";
        deployment.finishedAt = nowIso();
        this.clearSourceBinding(deployment);
        changed = true;
      } else if (deployment.status === "ready") {
        deployment.status = "stopped";
        deployment.error = "Server restarted - redeploy to view this branch";
        deployment.stoppedAt = nowIso();
        this.clearSourceBinding(deployment);
        changed = true;
      }
    }
    if (changed) this.store.markDirty();
  }

  emitProject(projectId) {
    this.events.emit("project.updated", { projectId });
  }

  emitDeployment(deployment) {
    this.events.emit("deployment.updated", {
      projectId: deployment.projectId,
      deploymentId: deployment.id,
      status: deployment.status,
    });
  }

  getDeployment(id) {
    const found = this.store.get().deployments.find((item) => item.id === id);
    if (!found) throw new HttpError(404, "Deployment not found");
    return found;
  }

  toPublic(deployment) {
    return {
      id: deployment.id,
      projectId: deployment.projectId,
      branch: deployment.branch,
      status: deployment.status,
      mode: deployment.mode || deployment.requestedMode || "auto",
      requestedMode: deployment.requestedMode || "auto",
      port: deployment.status === "ready" ? deployment.port : null,
      urlPath: deployment.status === "ready" && deployment.mode === "static" ? "/preview/" + deployment.id + "/" : null,
      commit: deployment.commit,
      shortSha: deployment.shortSha,
      commitMessage: deployment.commitMessage,
      author: deployment.author,
      framework: deployment.framework || null,
      error: deployment.error || null,
      createdAt: deployment.createdAt,
      readyAt: deployment.readyAt || null,
      stoppedAt: deployment.stoppedAt || null,
      devCommand: deployment.devCommand || null,
      live: Boolean(deployment.live),
      liveState: deployment.liveState || (deployment.live ? "following" : "snapshot"),
      sourceKind: deployment.sourceKind || null,
      isProduction: Boolean(deployment.isProduction),
    };
  }

  latestByBranch(projectId) {
    const map = new Map();
    for (const deployment of this.store.get().deployments) {
      if (deployment.projectId !== projectId) continue;
      const existing = map.get(deployment.branch);
      if (!existing || deployment.createdAt > existing.createdAt) map.set(deployment.branch, deployment);
    }
    return map;
  }

  async getBranches(project, gitModule) {
    const [{ branches, defaultBranch, currentBranch }, sources] = await Promise.all([
      gitModule.listBranches(project.repoPath),
      this.getSources(project).catch(() => []),
    ]);
    const latest = this.latestByBranch(project.id);
    return {
      defaultBranch,
      currentBranch,
      sources: sources.map((source) => toPublicSource(source)),
      branches: branches.map((branch) => {
        const deployment = latest.get(branch.name);
        return {
          ...branch,
          deployment: deployment ? this.toPublic(deployment) : null,
        };
      }),
    };
  }

  activePorts() {
    const used = new Set();
    for (const deployment of this.store.get().deployments) {
      if (deployment.status === "ready" && deployment.port) used.add(deployment.port);
    }
    return used;
  }

  async startStaticServer(deployment, worktreePath, staticDir) {
    const port = await findFreePort(this.config.previewPortRange, this.activePorts());
    deployment.port = port;
    const rootDir = path.resolve(worktreePath, staticDir || ".");
    const server = http.createServer((req, res) => {
      serveStaticDir(req, res, rootDir, { spaFallback: true }).catch((error) => {
        try {
          res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("Preview error: " + error.message);
        } catch {}
      });
    });
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "0.0.0.0", resolve);
    });
    server.unref?.();
    this.staticServers.set(deployment.id, server);
    this.log(deployment, "Static preview server listening on port " + port);
  }

  previewPort(id) {
    const deployment = this.getDeployment(id);
    if (deployment.status !== "ready" || !deployment.port) return null;
    return deployment.port;
  }

  async create(project, branch, options = {}) {
    if (project.status !== "ready") throw new HttpError(409, "Project is not ready yet");
    const { mode = "auto" } = options;
    if (!["auto", "server", "static"].includes(mode)) throw new HttpError(400, "Invalid preview mode");
    const refInfo = await resolveBranch(project.repoPath, branch);
    const meta = await commitMeta(project.repoPath, refInfo.sha);
    const state = this.store.get();
    // A preview is one per branch: it follows the tip and mirrors the branch's
    // editing source (the working copy or any worktree that has it checked out).
    await this.refreshCheckedOutBranch(project);
    const sources = await this.getSources(project, { force: true }).catch(() => []);
    const source = sourceForBranch(sources, branch);

    const existing = state.deployments.find(
      (deployment) =>
        deployment.projectId === project.id &&
        deployment.branch === branch &&
        deployment.status === "ready" &&
        (mode === "auto" || deployment.mode === mode)
    );
    if (existing) {
      const usable = existing.mode === "static" || (await isPortResponding(existing.port));
      if (usable) {
        const controller = this.followers.get(existing.id);
        if (controller) await this.runFollow(controller, { forceSource: true });
        else this.requestFollow(existing.id);
        return { deployment: this.toPublic(existing), reused: true };
      }
      existing.status = "stopped";
      existing.stoppedAt = nowIso();
      releasePort(existing.port);
    }

    const deployment = {
      id: newId("dpl"),
      projectId: project.id,
      branch,
      ref: refInfo.ref,
      commit: refInfo.sha,
      shortSha: refInfo.sha.slice(0, 7),
      commitMessage: meta?.message || "",
      author: meta?.author || "",
      requestedMode: mode,
      mode: mode === "static" ? "static" : "server",
      status: "queued",
      port: null,
      urlPath: null,
      worktreePath: null,
      staticDir: null,
      framework: null,
      error: null,
      createdAt: nowIso(),
      readyAt: null,
      stoppedAt: null,
      lastViewedAt: nowIso(),
      sourcePath: source ? source.path : null,
      sourceKind: source ? source.kind : null,
      followSource: true,
      live: Boolean(source),
      liveState: source ? "following" : "snapshot",
    };
    state.deployments.unshift(deployment);
    this.pruneHistory(project.id);
    this.store.markDirty();
    this.events.emit("deployment.created", { projectId: project.id, deploymentId: deployment.id });
    this.emitDeployment(deployment);

    const runner = this.run(deployment, project).catch((error) => {
      console.error("[vercio] deployment runner crashed", error);
    }).finally(() => this.runners.delete(deployment.id));
    this.runners.set(deployment.id, runner);

    return { deployment: this.toPublic(deployment), reused: false };
  }

  pruneLogs(deploymentId) {
    const log = this.logs.get(deploymentId);
    if (log && log.length > MAX_LOG_LINES) log.splice(0, log.length - MAX_LOG_LINES);
  }

  appendLog(deployment, chunk) {
    const text = safeText(chunk);
    if (!text) return;
    const lines = text.split("\n").map((line) => line.slice(0, 4000));
    const buffer = this.logs.get(deployment.id) || [];
    for (const line of lines) {
      if (!line.trim()) continue;
      buffer.push(line);
    }
    this.logs.set(deployment.id, buffer);
    this.pruneLogs(deployment.id);
    try {
      fs.mkdirSync(this.config.dirs.logs, { recursive: true });
      fs.appendFileSync(path.join(this.config.dirs.logs, deployment.id + ".log"), text);
    } catch {}
  }

  log(deployment, message) {
    const line = "[" + new Date().toLocaleTimeString("en-US", { hour12: false }) + "] " + message;
    this.appendLog(deployment, line + "\n");
  }

  getLog(id) {
    const deployment = this.getDeployment(id);
    const buffer = this.logs.get(id);
    if (buffer) return { log: buffer.join("\n"), status: deployment.status };
    try {
      const raw = fs.readFileSync(path.join(this.config.dirs.logs, id + ".log"), "utf8");
      return { log: raw.split("\n").slice(-600).join("\n"), status: deployment.status };
    } catch {
      return { log: "", status: deployment.status };
    }
  }

  /**
   * Pulls the most useful line out of the captured dev-server output so the
   * failure panel can say *why* the preview died instead of only "exited".
   * Walks the buffer backwards and ignores Vercio's own step lines, package
   * manager echoes, stack frames and npm lifecycle noise.
   */
  failureHint(deploymentId) {
    const buffer = this.logs.get(deploymentId);
    if (!buffer || !buffer.length) return "";
    for (let index = buffer.length - 1; index >= 0; index -= 1) {
      const line = safeText(buffer[index]).trim();
      if (!line) continue;
      if (/^\[\d{1,2}:\d{2}:\d{2}\]/.test(line)) continue;
      if (/^(?:\$|>)\s/.test(line) || /^[\u203a»]\s/.test(line)) continue;
      if (/^\s*at\s/.test(line)) continue;
      if (/^\s*(?:ELIFECYCLE|npm ERR!)/.test(line)) continue;
      if (!ERROR_HINT_RE.test(line)) continue;
      return line.replace(/^(?:error|fatal):\s*/i, "").slice(0, 240);
    }
    return "";
  }

  setStatus(deployment, status) {
    if (deployment.status === status) return;
    deployment.status = status;
    this.store.markDirty();
    this.emitDeployment(deployment);
  }

  fail(deployment, message) {
    const cleaned = safeText(message).trim().slice(0, 2000);
    this.clearSourceBinding(deployment);
    deployment.status = "error";
    deployment.error = cleaned || "Preview failed";
    deployment.finishedAt = nowIso();
    this.log(deployment, "Error: " + deployment.error);
    this.store.markDirty();
    this.emitDeployment(deployment);
  }

  async copyLocalEnvFiles(deployment, project, worktreePath, sourcePath) {
    // The branch may be checked out in another worktree with its own local env
    // files; fall back to the main working copy (historical behaviour).
    const envRoot = sourcePath || project.repoPath;
    let entries = [];
    try {
      entries = await fs.promises.readdir(envRoot);
    } catch {
      return;
    }
    const copied = [];
    for (const name of entries) {
      if (!name.startsWith(".env")) continue;
      if (!ENV_FILE_RE.test(name) || ENV_FILE_SKIP_RE.test(name)) continue;
      const source = path.join(envRoot, name);
      const target = path.join(worktreePath, name);
      try {
        const info = await fs.promises.stat(source);
        if (!info.isFile() || info.size > MAX_ENV_FILE_BYTES) continue;
        // Never override a file the previewed branch commits on purpose.
        if (fs.existsSync(target)) continue;
        await fs.promises.copyFile(source, target);
        copied.push(name);
      } catch {}
    }
    if (copied.length) {
      this.log(deployment, "Copied local env files into the worktree: " + copied.join(", "));
    }
  }

  async cleanupBranchWorktrees(project, branchSlug, keepPath) {
    const dir = path.join(this.config.dirs.worktrees, project.id);
    let entries = [];
    try {
      entries = await fs.promises.readdir(dir);
    } catch {
      return;
    }
    const protectedPaths = new Set(
      this.store
        .get()
        .deployments.filter(
          (deployment) =>
            deployment.worktreePath &&
            (BUSY_STATUSES.has(deployment.status) || this.followers.has(deployment.id))
        )
        .map((deployment) => path.resolve(deployment.worktreePath))
    );
    for (const entry of entries) {
      if (!entry.startsWith(branchSlug + "-")) continue;
      const target = path.join(dir, entry);
      const resolved = path.resolve(target);
      if (keepPath && resolved === path.resolve(keepPath)) continue;
      // A preview may still be serving this directory (a newer commit deployed
      // for the same branch): removing it would leave a zombie preview.
      if (protectedPaths.has(resolved)) continue;
      await removeWorktree(project.repoPath, target);
    }
  }

  async installDependencies(deployment, project, worktreePath, detection) {
    const plan = devInstallPlan(detection, worktreePath);
    if (!plan) {
      this.log(deployment, "Dependencies already present — skipping install");
      return;
    }
    const fingerprint = dependencyFingerprint(worktreePath);
    const [command, args] = plan;
    const label = command + " " + args.join(" ");
    if (fingerprint) {
      const rootModules = path.join(project.repoPath, "node_modules");
      const rootFingerprint = dependencyFingerprint(project.repoPath);
      if (rootFingerprint && rootFingerprint === fingerprint && fs.existsSync(rootModules)) {
        try {
          await fs.promises.symlink(rootModules, path.join(worktreePath, "node_modules"), "dir");
          this.log(deployment, "Reusing node_modules from the working copy");
          return;
        } catch (error) {
          this.log(deployment, "Could not reuse working copy dependencies: " + error.message);
        }
      }
      const cacheModules = path.join(this.config.dirs.deps, project.id, fingerprint, "node_modules");
      if (fs.existsSync(cacheModules)) {
        const linkTarget = path.relative(worktreePath, cacheModules);
        try {
          await fs.promises.symlink(linkTarget, path.join(worktreePath, "node_modules"), "dir");
          this.log(deployment, "Using cached dependencies (" + fingerprint + ")");
          return;
        } catch (error) {
          this.log(deployment, "Could not link dependency cache: " + error.message);
        }
      }
    }
    this.setStatus(deployment, "installing");
    this.log(deployment, "$ " + label);
    const child = spawn(command, args, {
      cwd: worktreePath,
      env: { ...process.env, PORT: "", HOST: "", BROWSER: "none", CI: "false", FORCE_COLOR: "0" },
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.installChildren.set(deployment.id, child);
    child.stdout.on("data", (chunk) => this.appendLog(deployment, chunk.toString()));
    child.stderr.on("data", (chunk) => this.appendLog(deployment, chunk.toString()));
    const exitCode = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        try { process.kill(-child.pid, "SIGKILL"); } catch {}
        resolve(-1);
      }, this.config.installTimeoutMs);
      if (typeof timeout.unref === "function") timeout.unref();
      child.on("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.on("exit", (code) => {
        clearTimeout(timeout);
        resolve(code);
      });
    });
    this.installChildren.delete(deployment.id);
    if (deployment.status === "error") throw new Error("Install cancelled");
    if (exitCode !== 0) {
      throw new Error("Dependency install failed (exit code " + exitCode + "). Check the logs above.");
    }
    if (fingerprint) {
      try {
        const cacheModules = path.join(this.config.dirs.deps, project.id, fingerprint, "node_modules");
        await fs.promises.mkdir(path.dirname(cacheModules), { recursive: true });
        await fs.promises.rename(path.join(worktreePath, "node_modules"), cacheModules);
        const linkTarget = path.relative(worktreePath, cacheModules);
        await fs.promises.symlink(linkTarget, path.join(worktreePath, "node_modules"), "dir");
        this.log(deployment, "Cached dependencies for future branches (" + fingerprint + ")");
      } catch (error) {
        this.log(deployment, "Dependency cache skipped: " + error.message);
      }
    }
  }

  async refreshCheckedOutBranch(project) {
    const branch = await currentBranch(project.repoPath).catch(() => "");
    if (branch && project.currentBranch !== branch) {
      project.currentBranch = branch;
      project.updatedAt = nowIso();
      this.store.markDirty();
      this.events.emit("project.updated", { projectId: project.id });
    }
    return branch;
  }

  requestFollow(deploymentId) {
    const controller = this.followers.get(deploymentId);
    if (!controller) return;
    this.scheduleFollow(controller);
  }

  /**
   * Cached `git worktree list` for a project. Previews poll it to discover a
   * newly created editing worktree; the TTL keeps that cheap when several
   * previews of the same project run side by side.
   */
  async getSources(project, { force = false } = {}) {
    const cached = this.sourceCache.get(project.id);
    const now = Date.now();
    if (!force && cached && now - cached.at < 1200) return cached.sources;
    const sources = await listSources(project, this.config).catch(() => []);
    this.sourceCache.set(project.id, { at: now, sources });
    return sources;
  }

  applySource(deployment, source, { lost = false } = {}) {
    deployment.sourcePath = source ? source.path : null;
    deployment.sourceKind = source ? source.kind : null;
    deployment.live = Boolean(source);
    deployment.liveState = source ? "following" : lost ? "detached" : "snapshot";
  }

  /** A terminal deployment cannot be following anything anymore. */
  clearSourceBinding(deployment) {
    deployment.sourcePath = null;
    deployment.sourceKind = null;
    deployment.live = false;
    deployment.liveState = "snapshot";
  }

  sourceLabel(source) {
    return source.kind === "working-copy" ? "working copy" : "git worktree";
  }

  /**
   * Every running preview gets a follower: it fast-forwards the preview worktree
   * to the branch tip and mirrors the uncommitted state of whichever worktree
   * currently has that branch checked out (the developer's main copy or a
   * parallel agent's worktree). A preview never stops because its source moved.
   */
  async startFollower(deployment, project, worktreePath) {
    this.stopFollower(deployment.id);
    const controller = {
      deploymentId: deployment.id,
      repoPath: project.repoPath,
      worktreePath,
      branch: deployment.branch,
      state: createSyncState(),
      source: null,
      bound: false,
      watcher: null,
      watcherPath: null,
      debounceTimer: null,
      interval: null,
      busy: false,
      pending: false,
      lastLogAt: 0,
      lastSourceScan: 0,
      lastTipLogAt: 0,
      lostWarned: false,
      restarting: false,
      restartPending: false,
    };
    this.followers.set(deployment.id, controller);
    await this.refreshFollow(controller, deployment, project, {
      initial: true,
      forceSource: true,
    });
    if (!this.followers.has(deployment.id)) return;
    if (!controller.source) {
      this.log(
        deployment,
        "Preview follows " + deployment.branch +
          " commits only (no worktree has it checked out yet; create one to see live edits)"
      );
    }
    this.startFollowLoop(controller);
  }

  startFollowLoop(controller) {
    this.ensureWatch(controller);
    // fs.watch is not recursive on Linux and editors can write through temp
    // files, so the interval is both the tip poll and the fallback sync.
    controller.interval = setInterval(() => this.scheduleFollow(controller), 2000);
    controller.interval.unref?.();
  }

  ensureWatch(controller) {
    const target = controller.source?.path || null;
    if (controller.watcherPath === target) return;
    try {
      controller.watcher?.close();
    } catch {}
    controller.watcher = null;
    controller.watcherPath = null;
    if (!target) return;
    try {
      controller.watcher = fs.watch(target, { recursive: true }, (_event, filename) => {
        if (shouldIgnoreWatchPath(filename)) return;
        this.scheduleFollow(controller);
      });
      controller.watcher.on?.("error", () => {});
      controller.watcherPath = target;
    } catch {}
  }

  scheduleFollow(controller) {
    if (controller.debounceTimer) return;
    controller.debounceTimer = setTimeout(() => {
      controller.debounceTimer = null;
      this.runFollow(controller).catch(() => {});
    }, 120);
    controller.debounceTimer.unref?.();
  }

  async runFollow(controller, options = {}) {
    if (controller.restarting) return;
    if (controller.busy) {
      controller.pending = true;
      return;
    }
    controller.busy = true;
    try {
      const state = this.store.get();
      const deployment = state.deployments.find((item) => item.id === controller.deploymentId);
      const project = deployment
        ? state.projects.find((item) => item.id === deployment.projectId)
        : null;
      if (!deployment || !project || !FOLLOWABLE_STATUSES.has(deployment.status)) {
        this.stopFollower(controller.deploymentId);
        return;
      }
      await this.refreshFollow(controller, deployment, project, options);
    } finally {
      controller.busy = false;
      if (controller.pending) {
        controller.pending = false;
        this.scheduleFollow(controller);
      }
    }
  }

  async refreshFollow(controller, deployment, project, options = {}) {
    const now = Date.now();
    // 1. Follow the branch tip, so new commits show up without a redeploy.
    const tip = await resolveBranchTip(project.repoPath, deployment.branch).catch(() => null);
    if (tip && tip !== deployment.commit) {
      try {
        const previousCommit = deployment.commit;
        await checkoutWorktree(controller.worktreePath, tip);
        resetSyncState(controller.state);
        const changed = await diffNames(project.repoPath, previousCommit, tip).catch(() => []);
        if (changed.some((file) => DEPENDENCY_FILES.has(file))) {
          controller.restartPending = true;
        }
        const meta = await commitMeta(project.repoPath, tip).catch(() => null);
        deployment.commit = tip;
        deployment.shortSha = tip.slice(0, 7);
        if (meta) {
          deployment.commitMessage = meta.message || "";
          deployment.author = meta.author || "";
        }
        this.store.markDirty();
        this.emitDeployment(deployment);
        this.log(deployment, "Following " + deployment.branch + " to " + deployment.shortSha);
      } catch (error) {
        if (now - controller.lastTipLogAt > 15000) {
          controller.lastTipLogAt = now;
          this.log(
            deployment,
            "Could not follow the new commit of " + deployment.branch + ": " +
              safeText(error.message).slice(0, 240)
          );
        }
      }
    }

    // 2. Re-bind the editing source. Branches without a worktree stay snapshots,
    // but still follow their tip; a source that disappears detaches without
    // killing the preview.
    if (
      deployment.followSource !== false &&
      (options.forceSource || options.initial || !controller.source || now - controller.lastSourceScan > 2000)
    ) {
      controller.lastSourceScan = now;
      const sources = await this.getSources(project);
      const source = sourceForBranch(sources, deployment.branch);
      if (source) {
        if (controller.source?.path !== source.path) {
          this.log(
            deployment,
            (options.initial || !controller.bound ? "Live preview: following the " : "Live edits reattached to the ") +
              this.sourceLabel(source) + " of " + deployment.branch +
              (options.initial || !controller.bound ? " (commits + uncommitted edits)" : "")
          );
        }
        controller.source = source;
        controller.bound = true;
        controller.lostWarned = false;
        if (deployment.liveState !== "following" || deployment.sourcePath !== source.path) {
          this.applySource(deployment, source);
          this.store.markDirty();
          this.emitDeployment(deployment);
        }
      } else {
        const hadSource = Boolean(controller.bound || deployment.sourcePath);
        controller.source = null;
        if (hadSource) {
          this.applySource(deployment, null, { lost: true });
          this.store.markDirty();
          this.emitDeployment(deployment);
          controller.bound = false;
          if (!controller.lostWarned) {
            controller.lostWarned = true;
            this.log(
              deployment,
              "Live edits detached: no worktree has " + deployment.branch +
                " checked out anymore. The preview keeps following commits; create a worktree for this branch to resume live edits."
            );
          }
        }
      }
      this.ensureWatch(controller);
    }

    // 3. Mirror uncommitted edits from the source into the preview worktree.
    if (!controller.source) {
      this.maybeRestart(controller, deployment, project);
      return;
    }
    const result = await syncWorkingCopyState({
      sourceDir: controller.source.path,
      worktreeDir: controller.worktreePath,
      state: controller.state,
    }).catch(() => ({ ok: false, changed: [], env: [] }));
    this.maybeRestart(controller, deployment, project);
    if (!result.ok) return;
    const count = result.changed.length + result.env.length;
    if (!count) return;
    if (options.initial || now - controller.lastLogAt > 1500) {
      controller.lastLogAt = now;
      const sample = result.changed
        .slice(0, 4)
        .map((item) => item.replace(/ \((?:deleted|restored|removed)\)$/, ""));
      this.log(
        deployment,
        "Live sync: " + count + " change" + (count === 1 ? "" : "s") +
          (sample.length ? " (" + sample.join(", ") + (result.changed.length > 4 ? ", …" : "") + ")" : "")
      );
    }
  }

  maybeRestart(controller, deployment, project) {
    if (!controller.restartPending) return;
    if (deployment.mode !== "server") {
      controller.restartPending = false;
      return;
    }
    // A commit can land while the preview is still installing/starting; keep
    // the flag so the restart runs as soon as the preview is ready.
    if (deployment.status !== "ready" || controller.restarting) return;
    controller.restartPending = false;
    this.restartPreview(controller, deployment, project).catch((error) => {
      controller.restarting = false;
      if (this.stopping.has(deployment.id)) return;
      this.fail(
        deployment,
        "Restart after dependency change failed: " + safeText(error.message).slice(0, 400)
      );
      if (deployment.port) {
        releasePort(deployment.port);
        deployment.port = null;
      }
      this.killChild(deployment.id);
    });
  }

  /**
   * A commit that touches package.json or a lockfile invalidates the shared
   * node_modules tree. Restart the same preview (same port, same worktree)
   * after reinstalling instead of making the user redeploy the branch.
   */
  async restartPreview(controller, deployment, project) {
    if (controller.restarting) return;
    controller.restarting = true;
    this.restartingDeployments.add(deployment.id);
    try {
      const worktreePath = deployment.worktreePath;
      if (!worktreePath) return;
      this.log(deployment, "Dependencies changed; restarting the preview in place");
      const child = this.children.get(deployment.id);
      this.killChild(deployment.id);
      if (child) {
        await settleWithin(new Promise((resolve) => child.once("close", resolve)), 3000);
      }
      this.children.delete(deployment.id);
      if (deployment.status !== "ready" || this.stopping.has(deployment.id)) return;

      this.setStatus(deployment, "installing");
      const detection = detectProject(worktreePath);
      deployment.framework = {
        label: detection.label,
        type: detection.type,
        kind: detection.kind,
        packageManager: detection.packageManager,
      };
      // Drop the linked/cached tree so installDependencies re-plans against the
      // new lockfile; the shared cache itself is never modified.
      try {
        fs.rmSync(path.join(worktreePath, "node_modules"), { recursive: true, force: true });
      } catch {}
      await this.installDependencies(deployment, project, worktreePath, detection);
      if (deployment.status === "error" || this.stopping.has(deployment.id)) return;

      const port = deployment.port || (await findFreePort(this.config.previewPortRange, this.activePorts()));
      deployment.port = port;
      const command = devCommand(detection, port, worktreePath);
      this.setStatus(deployment, "starting");
      const attempts = this.devServerAttempts(deployment, detection, worktreePath, command);
      let child2 = null;
      for (let index = 0; index < attempts.length; index += 1) {
        const attempt = attempts[index];
        deployment.devCommand = [attempt.command, ...attempt.args].join(" ");
        this.log(
          deployment,
          "$ " + deployment.devCommand + "  (port " + port + ")" + (index > 0 ? "  (fallback)" : "")
        );
        try {
          child2 = await this.startDevServerChild(deployment, worktreePath, attempt, port);
          break;
        } catch (error) {
          if (index === attempts.length - 1) throw error;
          this.log(
            deployment,
            "Vite config overlay failed; retrying with the project's dev command: " +
              safeText(error.message).slice(0, 240)
          );
        }
      }
      if (!child2) throw new Error("Could not restart the dev server");
      if (deployment.status === "error" || deployment.status === "stopped") return;
      deployment.status = "ready";
      deployment.readyAt = nowIso();
      deployment.error = null;
      this.log(deployment, "Preview restarted on port " + port);
      this.store.markDirty();
      this.emitDeployment(deployment);
    } finally {
      controller.restarting = false;
      this.restartingDeployments.delete(deployment.id);
    }
  }

  stopFollower(deploymentId) {
    const controller = this.followers.get(deploymentId);
    if (!controller) return;
    this.followers.delete(deploymentId);
    if (controller.debounceTimer) clearTimeout(controller.debounceTimer);
    if (controller.interval) clearInterval(controller.interval);
    try {
      controller.watcher?.close();
    } catch {}
    controller.watcher = null;
    controller.watcherPath = null;
    controller.source = null;
  }

  devServerAttempts(deployment, detection, worktreePath, command) {
    const attempts = [{ command: command.command, args: command.args, env: command.env }];
    if (detection.kind !== "vite") return attempts;
    // Vite cannot serve files outside its fs.allow roots. With reused (linked)
    // node_modules every package asset resolves outside the worktree and 403s,
    // so try an overlay config that widens the allow list; the plain command is
    // always kept as a fallback for projects whose config cannot be wrapped.
    const linkedDir = linkedNodeModulesDir(worktreePath);
    if (!linkedDir) return attempts;
    const script = devScriptCommand(detection, worktreePath);
    if (!supportsViteConfigOverlay(script)) return attempts;
    try {
      const overlay = writeViteConfigOverlay(worktreePath, [linkedDir]);
      attempts.unshift({
        command: command.command,
        args: [...command.args, "--config", overlay],
        env: command.env,
      });
      this.log(
        deployment,
        "Linked node_modules detected; using a Vite config overlay so dependency assets can be served"
      );
    } catch (error) {
      this.log(deployment, "Could not create a Vite config overlay: " + error.message);
    }
    return attempts;
  }

  async startDevServerChild(deployment, worktreePath, attempt, port) {
    const child = spawn(attempt.command, attempt.args, {
      cwd: worktreePath,
      env: { ...process.env, ...attempt.env },
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.children.set(deployment.id, child);
    const childClosed = new Promise((resolve) => child.once("close", resolve));

    let exited = null;
    child.stdout.on("data", (chunk) => this.appendLog(deployment, chunk.toString()));
    child.stderr.on("data", (chunk) => this.appendLog(deployment, chunk.toString()));
    child.on("error", (error) => {
      exited = { code: -1, signal: null, error };
      this.log(deployment, "Failed to start dev server: " + error.message);
    });
    child.on("exit", (code, signal) => {
      if (this.children.get(deployment.id) === child) this.children.delete(deployment.id);
      if (this.stopping.has(deployment.id) || this.restartingDeployments.has(deployment.id)) return;
      if (deployment.status === "ready") {
        deployment.status = "stopped";
        deployment.stoppedAt = nowIso();
        deployment.error = "Dev server exited " + (signal || "with code " + code);
        releasePort(deployment.port);
        this.store.markDirty();
        this.emitDeployment(deployment);
      } else {
        exited = { code, signal };
        this.log(deployment, "Dev server exited early (" + (signal || "code " + code) + ")");
      }
    });

    const controller = new AbortController();
    child.on("exit", () => controller.abort());
    this.log(deployment, "Waiting for the dev server to come up...");
    try {
      await waitForHttp(port, {
        timeoutMs: this.config.devServerTimeoutMs,
        signal: controller.signal,
      });
    } catch (error) {
      // Give the child a moment to flush its stdio so the failure carries the
      // complete output even when we are about to retry with another command.
      if (child.exitCode === null && child.signalCode === null) {
        this.killChild(deployment.id);
      }
      await settleWithin(childClosed, 750);
      const detail = this.failureHint(deployment.id);
      if (exited) {
        const cause = exited.signal || "code " + exited.code;
        if (detail) {
          throw new Error("Dev server exited before it became ready (" + cause + "): " + detail);
        }
        throw new Error(
          "Dev server exited before it became ready (" + cause + "). Check the command and logs above."
        );
      }
      if (detail) throw new Error(error.message + ": " + detail);
      throw error;
    }
    return child;
  }

  async run(deployment, project) {
    let child = null;
    try {
      this.setStatus(deployment, "preparing");
      if (!fs.existsSync(path.join(project.repoPath, ".git"))) {
        throw new Error("Repository is missing at " + project.repoPath);
      }
      const refInfo = await resolveBranch(project.repoPath, deployment.branch);
      deployment.commit = refInfo.sha;
      deployment.shortSha = refInfo.sha.slice(0, 7);
      await this.refreshCheckedOutBranch(project);
      const sources = await this.getSources(project, { force: true }).catch(() => []);
      this.applySource(deployment, sourceForBranch(sources, deployment.branch));
      const branchSlug = slugify(deployment.branch);
      const worktreeRoot = path.join(this.config.dirs.worktrees, project.id);
      const worktreePath = path.join(worktreeRoot, branchSlug + "-" + deployment.commit.slice(0, 8));
      deployment.worktreePath = worktreePath;
      this.store.markDirty();

      this.log(deployment, "Creating isolated worktree for " + deployment.branch + " @ " + deployment.shortSha);
      await this.cleanupBranchWorktrees(project, branchSlug, worktreePath);
      await addWorktree(project.repoPath, deployment.commit, worktreePath);
      await this.copyLocalEnvFiles(deployment, project, worktreePath, deployment.sourcePath);
      await this.startFollower(deployment, project, worktreePath);

      const detection = detectProject(worktreePath);
      deployment.framework = {
        label: detection.label,
        type: detection.type,
        kind: detection.kind,
        packageManager: detection.packageManager,
      };
      if (!project.framework || project.framework.label !== detection.label) {
        project.framework = { ...deployment.framework };
        project.updatedAt = new Date().toISOString();
        this.events.emit("project.updated", { projectId: project.id });
      }
      this.store.markDirty();
      this.log(deployment, "Detected " + detection.label + " project (" + detection.packageManager + ")");

      let mode = deployment.requestedMode;
      if (mode === "auto") mode = detection.type === "server" ? "server" : "static";
      if (mode === "server" && detection.type !== "server") {
        throw new Error("This branch has no dev server script. Preview it as a static site instead.");
      }
      deployment.mode = mode;
      this.store.markDirty();

      if (mode === "static") {
        if (!detection.staticEntry) {
          throw new Error("No index.html was found to serve as a static preview");
        }
        deployment.staticDir = detection.staticEntry.relativeDir || ".";
        await this.startStaticServer(deployment, worktreePath, deployment.staticDir);
        deployment.status = "ready";
        deployment.readyAt = nowIso();
        this.log(deployment, "Static preview ready at /preview/" + deployment.id + "/");
        this.store.markDirty();
        this.afterReady(project, deployment);
        return;
      }

      await this.installDependencies(deployment, project, worktreePath, detection);

      const port = await findFreePort(this.config.previewPortRange, this.activePorts());
      deployment.port = port;
      const command = devCommand(detection, port, worktreePath);
      this.setStatus(deployment, "starting");
      const attempts = this.devServerAttempts(deployment, detection, worktreePath, command);
      for (let index = 0; index < attempts.length; index += 1) {
        const attempt = attempts[index];
        deployment.devCommand = [attempt.command, ...attempt.args].join(" ");
        this.log(
          deployment,
          "$ " + deployment.devCommand + "  (port " + port + ")" + (index > 0 ? "  (fallback)" : "")
        );
        try {
          child = await this.startDevServerChild(deployment, worktreePath, attempt, port);
          break;
        } catch (error) {
          if (index === attempts.length - 1) throw error;
          this.log(
            deployment,
            "Vite config overlay failed; retrying with the project's dev command: " +
              safeText(error.message).slice(0, 240)
          );
        }
      }
      if (!child) throw new Error("Could not start the dev server");
      if (deployment.status === "error" || deployment.status === "stopped") {
        throw new Error("Preview cancelled");
      }

      deployment.status = "ready";
      deployment.readyAt = nowIso();
      deployment.error = null;
      this.log(deployment, "Preview ready on port " + port);
      this.store.markDirty();
      this.afterReady(project, deployment);
    } catch (error) {
      if (this.stopping.has(deployment.id) && deployment.status === "stopped") return;
      this.stopFollower(deployment.id);
      // Wait for the dev server to finish dying so its remaining stdio is in
      // the log before we snapshot the failure (the UI renders that snapshot).
      if (child) {
        if (child.exitCode === null && child.signalCode === null) {
          this.killChild(deployment.id);
        }
        await settleWithin(new Promise((resolve) => child.once("close", resolve)), 750);
      }
      this.fail(deployment, error.message || "Preview failed");
      if (deployment.port) {
        releasePort(deployment.port);
        deployment.port = null;
      }
      this.killChild(deployment.id);
    } finally {
      this.store.markDirty();
      this.emitDeployment(deployment);
    }
  }

  afterReady(project, deployment) {
    this.emitDeployment(deployment);
    this.requestFollow(deployment.id);
    const others = this.store.get().deployments.filter(
      (item) =>
        item.projectId === project.id &&
        item.branch === deployment.branch &&
        item.id !== deployment.id &&
        item.status === "ready"
    );
    for (const other of others) {
      this.stop(other, { reason: "superseded" });
    }
    this.enforceMaxRunning(deployment.id);
  }

  enforceMaxRunning(keepId) {
    const ready = this.store
      .get()
      .deployments.filter((item) => item.status === "ready" && item.mode === "server" && item.port)
      .sort((a, b) => (a.readyAt || "").localeCompare(b.readyAt || ""));
    const limit = this.config.maxRunningDevServers;
    while (ready.length > limit) {
      const victim = ready[0];
      if (victim.id === keepId) break;
      this.stop(victim, { reason: "max previews running" });
      ready.shift();
    }
  }

  killChild(deploymentId, signal = "SIGTERM") {
    const child = this.children.get(deploymentId) || this.installChildren.get(deploymentId);
    if (!child || !child.pid) return;
    try {
      process.kill(-child.pid, signal);
    } catch {
      try { child.kill(signal); } catch {}
    }
    if (signal === "SIGTERM") {
      setTimeout(() => {
        try { process.kill(-child.pid, "SIGKILL"); } catch {}
      }, 4000).unref?.();
    }
  }

  stop(deployment, options = {}) {
    if (!deployment) return;
    if (!["ready", "starting", "installing", "queued", "preparing"].includes(deployment.status)) return;
    this.stopping.add(deployment.id);
    this.stopFollower(deployment.id);
    const staticServer = this.staticServers.get(deployment.id);
    if (staticServer) {
      this.staticServers.delete(deployment.id);
      try { staticServer.close(); } catch {}
    }
    this.killChild(deployment.id);
    this.children.delete(deployment.id);
    const previousStatus = deployment.status;
    this.clearSourceBinding(deployment);
    deployment.status = "stopped";
    deployment.stoppedAt = nowIso();
    if (previousStatus === "ready") deployment.error = null;
    if (options.error) deployment.error = options.error;
    if (deployment.port) releasePort(deployment.port);
    this.log(deployment, "Preview stopped" + (options.reason ? " (" + options.reason + ")" : ""));
    this.store.markDirty();
    this.emitDeployment(deployment);
    setTimeout(() => this.stopping.delete(deployment.id), 6000).unref?.();
  }

  /**
   * Re-binds the branch's editing source on demand (the banner's "reattach"
   * action). Keeps the same preview and port; only the live overlay resumes.
   */
  async followById(id) {
    const deployment = this.getDeployment(id);
    if (!BUSY_STATUSES.has(deployment.status)) {
      throw new HttpError(409, "Preview is not running");
    }
    const project = this.store.get().projects.find((item) => item.id === deployment.projectId);
    if (!project) throw new HttpError(404, "Project not found");
    deployment.followSource = true;
    const controller = this.followers.get(id);
    if (controller) {
      await this.runFollow(controller, { forceSource: true });
    } else if (deployment.worktreePath) {
      await this.startFollower(deployment, project, deployment.worktreePath);
    }
    this.store.markDirty();
    this.emitDeployment(deployment);
    return this.toPublic(deployment);
  }

  /** Stops mirroring uncommitted edits but keeps following the branch tip. */
  unfollowById(id) {
    const deployment = this.getDeployment(id);
    deployment.followSource = false;
    this.applySource(deployment, null);
    const controller = this.followers.get(id);
    if (controller) {
      controller.source = null;
      controller.bound = false;
      try {
        controller.watcher?.close();
      } catch {}
      controller.watcher = null;
      controller.watcherPath = null;
    }
    this.store.markDirty();
    this.emitDeployment(deployment);
    return this.toPublic(deployment);
  }

  stopById(id) {
    const deployment = this.getDeployment(id);
    if (deployment.status !== "ready" && deployment.status !== "starting") {
      throw new HttpError(409, "Preview is not running");
    }
    this.stop(deployment);
    return this.toPublic(deployment);
  }

  stopProject(projectId) {
    for (const deployment of this.store.get().deployments) {
      if (deployment.projectId === projectId && ["ready", "starting", "installing", "queued", "preparing"].includes(deployment.status)) {
        this.stop(deployment, { reason: "project removed" });
      }
    }
  }

  async removeProject(project) {
    this.stopProject(project.id);
    for (const deployment of this.store.get().deployments.filter((item) => item.projectId === project.id)) {
      this.stopFollower(deployment.id);
    }
    for (const deployment of this.store.get().deployments.filter((item) => item.projectId === project.id)) {
      const server = this.staticServers.get(deployment.id);
      if (server) {
        this.staticServers.delete(deployment.id);
        try { server.close(); } catch {}
      }
    }
    const deployments = this.store.get().deployments.filter((item) => item.projectId === project.id);
    for (const deployment of deployments) {
      if (deployment.worktreePath) {
        await removeWorktree(project.repoPath, deployment.worktreePath).catch(() => {});
      }
    }
    this.sourceCache.delete(project.id);
    try {
      await fs.promises.rm(path.join(this.config.dirs.worktrees, project.id), { recursive: true, force: true });
    } catch {}
    try {
      await fs.promises.rm(path.join(this.config.dirs.deps, project.id), { recursive: true, force: true });
    } catch {}
    this.store.get().deployments = this.store.get().deployments.filter((item) => item.projectId !== project.id);
    this.store.markDirty();
  }

  pruneHistory(projectId) {
    const state = this.store.get();
    const forProject = state.deployments.filter((item) => item.projectId === projectId);
    if (forProject.length <= 60) return;
    const keep = new Set(forProject.slice(0, 60).map((item) => item.id));
    state.deployments = state.deployments.filter(
      (item) => item.projectId !== projectId || keep.has(item.id)
    );
  }

  stopAll() {
    for (const deployment of this.store.get().deployments) {
      if (["ready", "starting", "installing", "queued", "preparing"].includes(deployment.status)) {
        this.stop(deployment, { reason: "server shutting down" });
      }
    }
    for (const [id, server] of this.staticServers) {
      try { server.close(); } catch {}
      this.staticServers.delete(id);
    }
    for (const id of [...this.followers.keys()]) this.stopFollower(id);
    this.store.flush();
  }
}
