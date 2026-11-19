import fs from "node:fs";
import path from "node:path";
import { runGit } from "./git.js";

/**
 * A "source" is a git worktree of the project repository that a developer (or a
 * coding agent) is actually editing: the main working copy, or any extra
 * worktree created for a parallel branch. Vercio previews a branch from its own
 * isolated worktree, but the uncommitted edits only exist in the source, so the
 * live preview mirrors them from there.
 *
 * The source itself is read-only for Vercio: only `git worktree list`,
 * `git status`, `rev-parse` and file reads are allowed.
 */

export function parseWorktreeList(stdout) {
  const entries = [];
  let current = null;
  const flush = () => {
    if (!current) return;
    if (current.path) entries.push(current);
    current = null;
  };
  for (const rawLine of String(stdout || "").split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    if (!line.trim()) {
      flush();
      continue;
    }
    const space = line.indexOf(" ");
    const key = space === -1 ? line : line.slice(0, space);
    const value = space === -1 ? "" : line.slice(space + 1);
    if (key === "worktree") {
      flush();
      current = { path: value, head: "", branch: null, detached: false, bare: false };
      continue;
    }
    if (!current) continue;
    if (key === "HEAD") current.head = value;
    else if (key === "branch") {
      current.branch = value.startsWith("refs/heads/") ? value.slice("refs/heads/".length) : value;
    } else if (key === "detached") current.detached = true;
    else if (key === "bare") current.bare = true;
  }
  flush();
  return entries;
}

export async function listWorktrees(repoDir) {
  const result = await runGit(["worktree", "list", "--porcelain"], repoDir, { allowFail: true });
  if (result.code !== 0) return [];
  return parseWorktreeList(result.stdout);
}

function realPath(target) {
  try {
    return fs.realpathSync(target);
  } catch {
    return path.resolve(target);
  }
}

function isInside(candidate, parent) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/**
 * Lists editable sources for a project, including worktrees created outside the
 * repository (the recommended layout for parallel coding agents). Vercio's own
 * preview worktrees and dependency caches are excluded: they are build output,
 * not an editing surface.
 */
export async function listSources(project, config) {
  const worktrees = await listWorktrees(project.repoPath);
  const repoPath = realPath(project.repoPath);
  const excluded = [config.dirs.worktrees, config.dirs.deps]
    .filter(Boolean)
    .map((dir) => realPath(dir));
  const sources = [];
  for (const worktree of worktrees) {
    if (!worktree.path || worktree.bare) continue;
    const resolved = realPath(worktree.path);
    if (excluded.some((dir) => isInside(resolved, dir))) continue;
    try {
      if (!fs.statSync(resolved).isDirectory()) continue;
    } catch {
      continue;
    }
    const main = resolved === repoPath;
    sources.push({
      path: resolved,
      branch: worktree.branch,
      head: worktree.head,
      detached: Boolean(worktree.detached),
      main,
      kind: main ? "working-copy" : "worktree",
    });
  }
  // The main working copy wins when (impossibly) two worktrees claim a branch.
  sources.sort((a, b) => Number(b.main) - Number(a.main));
  return sources;
}

export function sourceForBranch(sources, branch) {
  if (!branch) return null;
  return sources.find((source) => source.branch === branch) || null;
}

/** Public DTO: identifies the source without leaking filesystem paths. */
export function toPublicSource(source) {
  if (!source) return null;
  return {
    kind: source.kind,
    branch: source.branch,
    head: source.head,
    shortSha: String(source.head || "").slice(0, 7),
    main: Boolean(source.main),
    detached: Boolean(source.detached),
  };
}
