import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { slugify } from "./config.js";
import { HttpError, serveStaticDir } from "./http.js";
import { newId } from "./ids.js";
import {
  addWorktree,
  commitMeta,
  resolveBranch,
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
        changed = true;
      } else if (deployment.status === "ready") {
        deployment.status = "stopped";
        deployment.error = "Server restarted - redeploy to view this branch";
        deployment.stoppedAt = nowIso();
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
    const { branches, defaultBranch, currentBranch } = await gitModule.listBranches(project.repoPath);
    const latest = this.latestByBranch(project.id);
    return {
      defaultBranch,
      currentBranch,
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

    const existing = state.deployments.find(
      (deployment) =>
        deployment.projectId === project.id &&
        deployment.branch === branch &&
        deployment.commit === refInfo.sha &&
        deployment.status === "ready" &&
        (mode === "auto" || deployment.mode === mode)
    );
    if (existing) {
      if (existing.mode === "static") return { deployment: this.toPublic(existing), reused: true };
      if (await isPortResponding(existing.port)) {
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
    deployment.status = "error";
    deployment.error = cleaned || "Preview failed";
    deployment.finishedAt = nowIso();
    this.log(deployment, "Error: " + deployment.error);
    this.store.markDirty();
    this.emitDeployment(deployment);
  }

  async copyLocalEnvFiles(deployment, project, worktreePath) {
    let entries = [];
    try {
      entries = await fs.promises.readdir(project.repoPath);
    } catch {
      return;
    }
    const copied = [];
    for (const name of entries) {
      if (!name.startsWith(".env")) continue;
      if (!ENV_FILE_RE.test(name) || ENV_FILE_SKIP_RE.test(name)) continue;
      const source = path.join(project.repoPath, name);
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
    for (const entry of entries) {
      if (!entry.startsWith(branchSlug + "-")) continue;
      const target = path.join(dir, entry);
      if (keepPath && path.resolve(target) === path.resolve(keepPath)) continue;
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
      if (this.stopping.has(deployment.id)) return;
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
      const branchSlug = slugify(deployment.branch);
      const worktreeRoot = path.join(this.config.dirs.worktrees, project.id);
      const worktreePath = path.join(worktreeRoot, branchSlug + "-" + deployment.commit.slice(0, 8));
      deployment.worktreePath = worktreePath;
      this.store.markDirty();

      this.log(deployment, "Creating isolated worktree for " + deployment.branch + " @ " + deployment.shortSha);
      await this.cleanupBranchWorktrees(project, branchSlug, worktreePath);
      await addWorktree(project.repoPath, deployment.commit, worktreePath);
      await this.copyLocalEnvFiles(deployment, project, worktreePath);

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
      if (deployment.status === "error") throw new Error("Preview cancelled");

      deployment.status = "ready";
      deployment.readyAt = nowIso();
      deployment.error = null;
      this.log(deployment, "Preview ready on port " + port);
      this.store.markDirty();
      this.afterReady(project, deployment);
    } catch (error) {
      if (this.stopping.has(deployment.id) && deployment.status === "stopped") return;
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
    const staticServer = this.staticServers.get(deployment.id);
    if (staticServer) {
      this.staticServers.delete(deployment.id);
      try { staticServer.close(); } catch {}
    }
    this.killChild(deployment.id);
    this.children.delete(deployment.id);
    const previousStatus = deployment.status;
    deployment.status = "stopped";
    deployment.stoppedAt = nowIso();
    if (previousStatus === "ready") deployment.error = null;
    if (deployment.port) releasePort(deployment.port);
    this.log(deployment, "Preview stopped" + (options.reason ? " (" + options.reason + ")" : ""));
    this.store.markDirty();
    this.emitDeployment(deployment);
    setTimeout(() => this.stopping.delete(deployment.id), 6000).unref?.();
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
    this.store.flush();
  }
}
