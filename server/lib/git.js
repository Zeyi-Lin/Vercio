import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { HttpError } from "./http.js";

const MAX_BUFFER = 32 * 1024 * 1024;

export function runGit(args, cwd, options = {}) {
  const { allowFail = false, timeoutMs = 60000, env = {} } = options;
  return new Promise((resolve) => {
    execFile(
      "git",
      args,
      {
        cwd,
        timeout: timeoutMs,
        maxBuffer: MAX_BUFFER,
        encoding: "utf8",
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0", ...env },
      },
      (error, stdout, stderr) => {
        const result = {
          code: error ? (typeof error.code === "number" ? error.code : 1) : 0,
          stdout: stdout || "",
          stderr: stderr || "",
          error,
        };
        if (result.code !== 0 && !allowFail) {
          const detail = (result.stderr || result.stdout || error?.message || "").trim();
          const err = new Error("git " + args.join(" ") + " failed: " + detail);
          err.exitCode = result.code;
          err.stderr = result.stderr;
          throw err;
        }
        resolve(result);
      }
    );
  });
}

export async function isGitRepo(dir) {
  try {
    const stat = await fs.promises.stat(path.join(dir, ".git"));
    return stat.isDirectory() || stat.isFile();
  } catch {
    return false;
  }
}

export async function currentBranch(repoDir) {
  const r = await runGit(["branch", "--show-current"], repoDir, { allowFail: true });
  return r.stdout.trim();
}

export async function getDefaultBranch(repoDir) {
  const remote = await runGit(
    ["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"],
    repoDir,
    { allowFail: true }
  );
  if (remote.code === 0 && remote.stdout.trim()) {
    return remote.stdout.trim().replace(/^refs\/remotes\/origin\//, "");
  }
  const local = await currentBranch(repoDir);
  if (local) return local;
  const head = await runGit(["rev-parse", "--short", "HEAD"], repoDir, { allowFail: true });
  return head.code === 0 ? "main" : "main";
}

export async function getRemoteUrl(repoDir) {
  const r = await runGit(["remote", "get-url", "origin"], repoDir, { allowFail: true });
  return r.code === 0 ? r.stdout.trim() : "";
}

export async function headSha(repoDir, ref = "HEAD") {
  const r = await runGit(["rev-parse", ref], repoDir, { allowFail: true });
  return r.code === 0 ? r.stdout.trim() : "";
}

export async function getRepoInfo(repoDir) {
  const [originUrl, branch, defaultBranch, status] = await Promise.all([
    getRemoteUrl(repoDir),
    currentBranch(repoDir),
    getDefaultBranch(repoDir),
    runGit(["status", "--porcelain=v1"], repoDir, { allowFail: true }),
  ]);
  const dirtyFiles = status.stdout.trim() ? status.stdout.trim().split("\n").filter(Boolean) : [];
  return {
    originUrl,
    currentBranch: branch,
    defaultBranch,
    dirtyCount: dirtyFiles.length,
    head: await headSha(repoDir),
  };
}

const REF_FORMAT = [
  "%(refname)",
  "%(objectname)",
  "%(committerdate:iso-strict)",
  "%(committerdate:unix)",
  "%(authorname)",
  "%(subject)",
].join("%00");

function parseRefs(stdout) {
  const rows = [];
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    const [refname, sha, date, ts, author, subject] = line.split("\x00");
    if (!refname || !sha) continue;
    rows.push({
      refname,
      sha,
      date,
      timestamp: Number(ts || 0) * 1000,
      author,
      subject,
      shortSha: sha.slice(0, 7),
    });
  }
  return rows;
}

export async function listBranches(repoDir) {
  const [defaultBranch, current, refsResult] = await Promise.all([
    getDefaultBranch(repoDir),
    currentBranch(repoDir),
    runGit(
      ["for-each-ref", "--format=" + REF_FORMAT, "refs/heads", "refs/remotes"],
      repoDir
    ),
  ]);
  const rows = parseRefs(refsResult.stdout);
  const local = new Map();
  const remote = new Map();
  for (const row of rows) {
    if (row.refname.startsWith("refs/heads/")) {
      local.set(row.refname.slice("refs/heads/".length), row);
    } else if (row.refname.startsWith("refs/remotes/")) {
      const rest = row.refname.slice("refs/remotes/".length);
      const slash = rest.indexOf("/");
      if (slash === -1) continue;
      const remoteName = rest.slice(0, slash);
      const branchName = rest.slice(slash + 1);
      if (branchName === "HEAD") continue;
      if (!remote.has(remoteName + "/" + branchName)) {
        remote.set(branchName, { ...row, remoteName });
      }
    }
  }
  const names = new Set([...local.keys(), ...remote.keys()]);
  const branches = [];
  for (const name of names) {
    const localRef = local.get(name);
    const remoteRef = remote.get(name);
    const source = localRef || remoteRef;
    branches.push({
      name,
      ref: localRef ? "refs/heads/" + name : "refs/remotes/" + (remoteRef.remoteName || "origin") + "/" + name,
      sha: source.sha,
      shortSha: source.shortSha,
      date: source.date,
      timestamp: source.timestamp,
      author: source.author,
      subject: source.subject,
      isDefault: name === defaultBranch,
      isCurrent: name === current,
      remoteOnly: !localRef && Boolean(remoteRef),
    });
  }
  branches.sort((a, b) => {
    if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
    return (b.timestamp || 0) - (a.timestamp || 0);
  });
  return { defaultBranch, currentBranch: current, branches };
}

export async function resolveBranch(repoDir, branchName) {
  if (!branchName || typeof branchName !== "string") {
    throw new HttpError(400, "A branch name is required");
  }
  const candidates = [];
  if (!branchName.includes(":")) {
    candidates.push("refs/heads/" + branchName);
    candidates.push("refs/remotes/origin/" + branchName);
    candidates.push(branchName);
  }
  for (const ref of candidates) {
    const r = await runGit(
      ["rev-parse", "--verify", "--quiet", ref + "^{commit}"],
      repoDir,
      { allowFail: true }
    );
    if (r.code === 0 && r.stdout.trim()) {
      const sha = r.stdout.trim();
      return { ref, sha, shortSha: sha.slice(0, 7) };
    }
  }
  throw new HttpError(404, "Branch not found: " + branchName);
}

export async function commitMeta(repoDir, sha) {
  const r = await runGit(
    ["show", "-s", "--format=%H%x00%h%x00%an%x00%aI%x00%s", sha],
    repoDir,
    { allowFail: true }
  );
  if (r.code !== 0) return null;
  const [full, short, author, date, subject] = r.stdout.trim().split("\x00");
  return { sha: full, shortSha: short, author, date, message: subject };
}

export async function readReadme(repoDir, ref = "HEAD") {
  const tree = await runGit(["ls-tree", "--name-only", ref], repoDir, { allowFail: true });
  if (tree.code !== 0) return null;
  const names = tree.stdout.split("\n").filter(Boolean);
  const candidates = names.filter((n) => /^readme(\.[a-z0-9]+)?$/i.test(n));
  if (!candidates.length) return null;
  const preferred = candidates.sort((a, b) => {
    const score = (n) => (/^readme\.md$/i.test(n) ? 0 : /^readme\.markdown$/i.test(n) ? 1 : 2);
    return score(a) - score(b);
  })[0];
  const content = await runGit(["show", ref + ":" + preferred], repoDir, { allowFail: true });
  if (content.code !== 0) return null;
  return { name: preferred, markdown: content.stdout };
}

export async function diffStat(repoDir, baseRef, headRef) {
  const attempts = [baseRef + "..." + headRef, baseRef + ".." + headRef];
  for (const range of attempts) {
    const r = await runGit(
      ["diff", "--numstat", "--no-color", "--find-renames", range],
      repoDir,
      { allowFail: true }
    );
    if (r.code !== 0) continue;
    const files = [];
    let additions = 0;
    let deletions = 0;
    for (const line of r.stdout.split("\n")) {
      if (!line.trim()) continue;
      const [add, del, ...rest] = line.split("\t");
      const file = rest.join("\t");
      if (!file) continue;
      const a = add === "-" ? 0 : Number(add) || 0;
      const d = del === "-" ? 0 : Number(del) || 0;
      additions += a;
      deletions += d;
      files.push({ path: file, additions: a, deletions: d });
    }
    files.sort((a, b) => b.additions + b.deletions - (a.additions + a.deletions));
    return { files: files.slice(0, 40), fileCount: files.length, additions, deletions };
  }
  return { files: [], fileCount: 0, additions: 0, deletions: 0 };
}

/**
 * Current tip of a branch, local first then origin. Returns null when the
 * branch disappeared (deleted / never existed), which the preview handles by
 * keeping its last commit instead of failing.
 */
export async function resolveBranchTip(repoDir, branchName) {
  if (!branchName) return null;
  for (const ref of ["refs/heads/" + branchName, "refs/remotes/origin/" + branchName]) {
    const result = await runGit(
      ["rev-parse", "--verify", "--quiet", ref + "^{commit}"],
      repoDir,
      { allowFail: true }
    );
    if (result.code === 0 && result.stdout.trim()) return result.stdout.trim();
  }
  return null;
}

/** Files that differ between two commits (used to detect dependency changes). */
export async function diffNames(repoDir, from, to) {
  const result = await runGit(
    ["diff", "--name-only", "--no-renames", from, to],
    repoDir,
    { allowFail: true, timeoutMs: 60000 }
  );
  if (result.code !== 0) return [];
  return result.stdout.split("\n").map((line) => line.trim()).filter(Boolean);
}

/** Fast-forwards a Vercio-owned preview worktree to a new commit. */
export async function checkoutWorktree(worktreeDir, commitSha) {
  const result = await runGit(
    ["checkout", "--force", "--detach", commitSha],
    worktreeDir,
    { allowFail: true, timeoutMs: 120000 }
  );
  if (result.code !== 0) {
    const detail = (result.stderr || result.stdout || "").trim();
    throw new Error("Could not check out " + commitSha + ": " + detail);
  }
}

export async function addWorktree(repoDir, commitSha, destDir) {
  await fs.promises.mkdir(path.dirname(destDir), { recursive: true });
  await fs.promises.rm(destDir, { recursive: true, force: true });
  await runGit(
    ["worktree", "add", "--detach", "--force", destDir, commitSha],
    repoDir,
    { timeoutMs: 120000 }
  );
  return destDir;
}

export async function removeWorktree(repoDir, destDir) {
  await runGit(["worktree", "remove", "--force", destDir], repoDir, { allowFail: true });
  await fs.promises.rm(destDir, { recursive: true, force: true });
  await runGit(["worktree", "prune"], repoDir, { allowFail: true });
}

export async function fetchRepo(repoDir) {
  const remote = await getRemoteUrl(repoDir);
  if (!remote) return { ok: false, message: "No git remote configured" };
  const r = await runGit(["fetch", "--all", "--prune", "--quiet"], repoDir, {
    allowFail: true,
    timeoutMs: 120000,
  });
  return {
    ok: r.code === 0,
    message: r.code === 0 ? "Fetched latest from origin" : (r.stderr || "git fetch failed").trim(),
  };
}

export async function cloneRepo(url, destDir, onLine) {
  await fs.promises.mkdir(path.dirname(destDir), { recursive: true });
  await fs.promises.rm(destDir, { recursive: true, force: true });
  return new Promise((resolve, reject) => {
    const child = spawn("git", ["clone", "--progress", "--", url, destDir], {
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderrTail = "";
    const emit = (chunk) => {
      const text = chunk.toString();
      stderrTail = (stderrTail + text).slice(-4000);
      for (const line of text.split(/[\r\n]+/)) {
        if (line.trim() && onLine) onLine(line.trim());
      }
    };
    child.stdout.on("data", emit);
    child.stderr.on("data", emit);
    const timeout = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch {}
      reject(new Error("git clone timed out after 10 minutes"));
    }, 10 * 60 * 1000);
    if (typeof timeout.unref === "function") timeout.unref();
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve({ url });
      else reject(new Error("git clone failed (exit " + code + "): " + stderrTail.trim().split(/\r?\n/).slice(-6).join(" ")));
    });
  });
}

export function repoNameFromUrl(value) {
  const raw = String(value || "").trim().replace(/\/+$/, "");
  const base = raw.split(/[\/:]/).pop() || "repository";
  return base.replace(/\.git$/i, "") || "repository";
}

export function normalizeSource(input) {
  const raw = String(input || "").trim();
  if (!raw) throw new HttpError(400, "Enter a GitHub URL or a local repository path");
  if (raw.startsWith("-")) throw new HttpError(400, "Invalid repository source");
  const expanded = raw === "~" ? process.env.HOME : raw.replace(/^~\//, (process.env.HOME || "~") + "/");
  const abs = path.resolve(expanded);
  try {
    const stat = fs.statSync(abs);
    if (stat.isDirectory()) {
      return { kind: "path", path: abs, name: path.basename(abs) || "repository" };
    }
  } catch {}
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) || /^[\w.-]+@[\w.-]+:/.test(raw)) {
    return { kind: "git", url: raw, name: repoNameFromUrl(raw) };
  }
  if (/^[\w.-]+\/[\w.-]+$/.test(raw) && !raw.includes("..")) {
    return { kind: "git", url: "https://github.com/" + raw, name: repoNameFromUrl(raw) };
  }
  return { kind: "path", path: abs, name: path.basename(abs) || "repository" };
}
