import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { runGit } from "./git.js";

const MAX_SYNC_FILE_BYTES = 32 * 1024 * 1024;
const MAX_ENV_FILE_BYTES = 512 * 1024;
// Never copy these into a preview worktree (git/Vercio bookkeeping + dependencies).
const SKIP_SEGMENTS = new Set([".git", ".vercio", "node_modules"]);
// Working-copy writes in these directories are noise for the live watcher.
const IGNORED_WATCH_DIRS = new Set([
  ".git",
  ".vercio",
  "node_modules",
  "dist",
  "build",
  "out",
  "coverage",
  ".next",
  ".cache",
  ".turbo",
  ".vite",
  ".dsh-tmp",
  "playwright-report",
  "test-results",
]);
const ENV_FILE_RE = /^\.env(?:\.[A-Za-z0-9_-]+)*$/;
const ENV_FILE_SKIP_RE = /\.(?:example|sample|template|schema)$/i;

export function shouldIgnoreWatchPath(filename) {
  if (!filename) return false;
  const top = String(filename).split(/[\\/]/)[0];
  return IGNORED_WATCH_DIRS.has(top);
}

/**
 * Parses `git status --porcelain=v1 -z` output.
 * Renames/copies carry the original path in the next NUL-separated chunk.
 */
export function parseStatusEntries(stdout) {
  const chunks = String(stdout || "").split("\0");
  const entries = [];
  for (let index = 0; index < chunks.length; index += 1) {
    const record = chunks[index];
    if (!record || record.length < 4) continue;
    const status = record.slice(0, 2);
    const filePath = record.slice(3);
    if (!filePath) continue;
    const entry = { status, path: filePath };
    if (/[RC]/.test(status)) {
      const original = chunks[index + 1];
      if (original) {
        entry.from = original;
        index += 1;
      }
    }
    entries.push(entry);
  }
  return entries;
}

function isEnvTemplate(relativePath) {
  const base = path.basename(relativePath);
  return ENV_FILE_RE.test(base) && ENV_FILE_SKIP_RE.test(base);
}

function safeRepoPath(relativePath) {
  const value = String(relativePath || "");
  if (!value || path.isAbsolute(value)) return null;
  const normalized = path.normalize(value);
  if (normalized === "." || normalized.startsWith("..")) return null;
  const segments = normalized.split(path.sep);
  if (segments.some((segment) => SKIP_SEGMENTS.has(segment))) return null;
  return normalized;
}

function syncFingerprint(dir, relativePath) {
  const source = path.join(dir, relativePath);
  const info = fs.lstatSync(source);
  if (info.isSymbolicLink()) return "link:" + fs.readlinkSync(source);
  if (!info.isFile() || info.size > MAX_SYNC_FILE_BYTES) return null;
  return crypto.createHash("sha1").update(fs.readFileSync(source)).digest("hex");
}

function copyIntoWorktree(repoDir, worktreeDir, relativePath) {
  const source = path.join(repoDir, relativePath);
  const target = path.join(worktreeDir, relativePath);
  const info = fs.lstatSync(source);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (info.isSymbolicLink()) {
    const link = fs.readlinkSync(source);
    fs.rmSync(target, { force: true });
    fs.symlinkSync(link, target);
    return true;
  }
  if (!info.isFile() || info.size > MAX_SYNC_FILE_BYTES) return false;
  fs.copyFileSync(source, target);
  fs.chmodSync(target, info.mode & 0o777);
  return true;
}

function removeFromWorktree(worktreeDir, relativePath) {
  try {
    fs.rmSync(path.join(worktreeDir, relativePath), { force: true });
  } catch {}
}

function fileKind(dir, relativePath) {
  try {
    return fs.lstatSync(path.join(dir, relativePath));
  } catch {
    return null;
  }
}

function syncEnvFiles(repoDir, worktreeDir, envHashes) {
  const applied = [];
  let names = [];
  try {
    names = fs.readdirSync(repoDir);
  } catch {
    return applied;
  }
  for (const name of names) {
    if (!ENV_FILE_RE.test(name) || ENV_FILE_SKIP_RE.test(name)) continue;
    const source = path.join(repoDir, name);
    try {
      const info = fs.statSync(source);
      if (!info.isFile() || info.size > MAX_ENV_FILE_BYTES) continue;
      const content = fs.readFileSync(source);
      const hash = crypto.createHash("sha1").update(content).digest("hex");
      if (envHashes.get(name) === hash) continue;
      envHashes.set(name, hash);
      fs.copyFileSync(source, path.join(worktreeDir, name));
      applied.push(name);
    } catch {}
  }
  return applied;
}

/**
 * Mirrors the working copy's uncommitted state (modified, deleted, renamed and
 * untracked-but-not-ignored files, plus root .env files) into the preview
 * worktree. The dev server's file watcher then triggers HMR as if the edit had
 * happened inside the preview itself.
 *
 * `state` is mutated and kept between calls: { syncedPaths:Set, fileHashes:Map, envHashes:Map }.
 */
export async function syncWorkingCopyState({ repoDir, worktreeDir, state }) {
  const status = await runGit(
    ["-c", "core.quotepath=false", "status", "--porcelain=v1", "-z", "--untracked-files=all"],
    repoDir,
    { allowFail: true }
  );
  if (status.code !== 0) return { ok: false, changed: [], env: [] };

  const changed = [];
  const dirty = new Set();
  for (const entry of parseStatusEntries(status.stdout)) {
    if (entry.from) {
      const from = safeRepoPath(entry.from);
      if (from) {
        removeFromWorktree(worktreeDir, from);
        state.syncedPaths.delete(from);
        state.fileHashes.delete(from);
      }
    }
    const relativePath = safeRepoPath(entry.path);
    if (!relativePath || isEnvTemplate(relativePath)) continue;
    dirty.add(relativePath);
    const info = fileKind(repoDir, relativePath);
    if (!info) {
      removeFromWorktree(worktreeDir, relativePath);
      state.syncedPaths.delete(relativePath);
      state.fileHashes.delete(relativePath);
      changed.push(relativePath + " (deleted)");
      continue;
    }
    try {
      const fingerprint = syncFingerprint(repoDir, relativePath);
      // Already mirrored this exact content: don't rewrite the worktree file,
      // otherwise every poll would retrigger HMR/reloads.
      if (fingerprint && state.fileHashes.get(relativePath) === fingerprint) {
        state.syncedPaths.add(relativePath);
        continue;
      }
      if (copyIntoWorktree(repoDir, worktreeDir, relativePath)) {
        state.syncedPaths.add(relativePath);
        state.fileHashes.set(relativePath, fingerprint);
        changed.push(relativePath);
      }
    } catch {}
  }

  // Edits that were reverted (or committed) must not linger in the worktree.
  for (const relativePath of [...state.syncedPaths]) {
    if (dirty.has(relativePath)) continue;
    state.syncedPaths.delete(relativePath);
    state.fileHashes.delete(relativePath);
    try {
      if (fileKind(repoDir, relativePath)) {
        copyIntoWorktree(repoDir, worktreeDir, relativePath);
        changed.push(relativePath + " (restored)");
      } else {
        removeFromWorktree(worktreeDir, relativePath);
        changed.push(relativePath + " (removed)");
      }
    } catch {}
  }

  const env = syncEnvFiles(repoDir, worktreeDir, state.envHashes);
  return { ok: true, changed, env };
}
