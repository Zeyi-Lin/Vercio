import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { HttpError } from "./http.js";

const HOME = os.homedir();

function expandHome(input) {
  const raw = String(input || "").trim();
  if (!raw) return HOME;
  if (raw === "~") return HOME;
  if (raw.startsWith("~/") || raw.startsWith("~\\")) return path.join(HOME, raw.slice(2));
  return raw;
}

async function statSafe(target) {
  try {
    return await fs.promises.stat(target);
  } catch {
    return null;
  }
}

async function isGitDir(dir) {
  const gitPath = path.join(dir, ".git");
  const stat = await statSafe(gitPath);
  return Boolean(stat && (stat.isDirectory() || stat.isFile()));
}

function quickRoots() {
  const candidates = [
    { kind: "home", path: HOME },
    { kind: "desktop", path: path.join(HOME, "Desktop") },
    { kind: "documents", path: path.join(HOME, "Documents") },
    { kind: "downloads", path: path.join(HOME, "Downloads") },
  ];
  const seen = new Set();
  return candidates.filter((root) => {
    if (seen.has(root.path)) return false;
    seen.add(root.path);
    try {
      return fs.statSync(root.path).isDirectory();
    } catch {
      return false;
    }
  });
}

function breadcrumbsFor(target) {
  const root = path.parse(target).root;
  const parts = target.slice(root.length).split(path.sep).filter(Boolean);
  const crumbs = [{ label: root.replace(/[\\/]+$/, "") || root, path: root }];
  let current = root;
  for (const part of parts) {
    current = path.join(current, part);
    crumbs.push({ label: part, path: current });
  }
  return crumbs;
}

/**
 * Lists the sub-directories of a folder on the machine that runs Vercio.
 * Only directory names and whether they are Git repositories are exposed;
 * files and their contents are never returned.
 */
export async function browseDirectory(input, options = {}) {
  const showHidden = Boolean(options.showHidden);
  const target = path.resolve(expandHome(input));

  let stat;
  try {
    stat = await fs.promises.stat(target);
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") {
      throw new HttpError(404, "That folder does not exist", { code: "missing" });
    }
    if (error.code === "EACCES" || error.code === "EPERM") {
      throw new HttpError(403, "You do not have permission to read that folder", { code: "denied" });
    }
    throw new HttpError(400, "Could not open that folder", { code: "unreadable" });
  }
  if (!stat.isDirectory()) {
    throw new HttpError(400, "That path is not a folder", { code: "not-directory" });
  }

  let dirents;
  try {
    dirents = await fs.promises.readdir(target, { withFileTypes: true });
  } catch (error) {
    if (error.code === "EACCES" || error.code === "EPERM") {
      throw new HttpError(403, "You do not have permission to read that folder", { code: "denied" });
    }
    throw new HttpError(400, "Could not read that folder", { code: "unreadable" });
  }

  const entries = [];
  let hiddenCount = 0;
  await Promise.all(
    dirents.map(async (dirent) => {
      const hidden = dirent.name.startsWith(".");
      const entryPath = path.join(target, dirent.name);
      let directory = dirent.isDirectory();
      if (!directory && dirent.isSymbolicLink()) {
        const linkStat = await statSafe(entryPath);
        directory = Boolean(linkStat && linkStat.isDirectory());
      }
      if (!directory) return;
      if (hidden) hiddenCount += 1;
      if (hidden && !showHidden) return;
      entries.push({
        name: dirent.name,
        path: entryPath,
        hidden,
        isGitRepo: await isGitDir(entryPath),
      });
    })
  );
  entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));

  const root = path.parse(target).root;
  return {
    path: target,
    name: path.basename(target) || target,
    parent: target === root ? null : path.dirname(target),
    isGitRepo: await isGitDir(target),
    isHome: target === HOME,
    breadcrumbs: breadcrumbsFor(target),
    roots: quickRoots(),
    entries,
    hiddenCount,
    showHidden,
  };
}
