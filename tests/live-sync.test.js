import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  parseStatusEntries,
  shouldIgnoreWatchPath,
  syncWorkingCopyState,
} from "../server/lib/live-sync.js";

function git(dir, args) {
  return execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
}

function initRepo(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vercio-live-sync-"));
  git(dir, ["init", "-b", "main"]);
  git(dir, ["config", "user.email", "test@vercio.local"]);
  git(dir, ["config", "user.name", "Vercio Test"]);
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), content);
  }
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-m", "initial"]);
  return dir;
}

function makeWorktree(repoDir) {
  return fs.mkdtempSync(path.join(os.tmpdir(), "vercio-live-worktree-"));
}

test("parseStatusEntries understands rename records from porcelain -z", () => {
  const entries = parseStatusEntries(
    " M a.txt\0R  c.txt\0b.txt\0?? new.txt\0 D gone.txt\0"
  );
  assert.deepEqual(entries, [
    { status: " M", path: "a.txt" },
    { status: "R ", path: "c.txt", from: "b.txt" },
    { status: "??", path: "new.txt" },
    { status: " D", path: "gone.txt" },
  ]);
});

test("shouldIgnoreWatchPath filters bookkeeping and build output", () => {
  assert.equal(shouldIgnoreWatchPath("node_modules/pkg/index.js"), true);
  assert.equal(shouldIgnoreWatchPath(".git/HEAD"), true);
  assert.equal(shouldIgnoreWatchPath("dist/app.js"), true);
  assert.equal(shouldIgnoreWatchPath("src/main.tsx"), false);
  assert.equal(shouldIgnoreWatchPath(null), false);
});

test("syncWorkingCopyState mirrors edits, renames, deletes and restores", (t) => {
  const repo = initRepo({ "a.txt": "one", "b.txt": "two", "keep.txt": "keep" });
  const worktree = makeWorktree();
  t.after(() => {
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(worktree, { recursive: true, force: true });
  });
  for (const name of ["a.txt", "b.txt", "keep.txt"]) {
    fs.writeFileSync(path.join(worktree, name), fs.readFileSync(path.join(repo, name)));
  }
  const state = { syncedPaths: new Set(), fileHashes: new Map(), envHashes: new Map() };

  fs.writeFileSync(path.join(repo, "a.txt"), "one edited");
  git(repo, ["mv", "b.txt", "c.txt"]);
  fs.writeFileSync(path.join(repo, "new.txt"), "brand new");
  fs.writeFileSync(path.join(repo, ".env.local"), "VITE_X=1\n");
  fs.writeFileSync(path.join(repo, ".env.example"), "VITE_X=\n");

  return syncWorkingCopyState({ repoDir: repo, worktreeDir: worktree, state }).then((result) => {
    assert.equal(result.ok, true);
    assert.equal(fs.readFileSync(path.join(worktree, "a.txt"), "utf8"), "one edited");
    assert.equal(fs.readFileSync(path.join(worktree, "c.txt"), "utf8"), "two");
    assert.equal(fs.existsSync(path.join(worktree, "b.txt")), false);
    assert.equal(fs.readFileSync(path.join(worktree, "new.txt"), "utf8"), "brand new");
    assert.equal(fs.readFileSync(path.join(worktree, ".env.local"), "utf8"), "VITE_X=1\n");
    assert.equal(fs.existsSync(path.join(worktree, ".env.example")), false);
    assert.ok(state.syncedPaths.has("a.txt"));
    assert.ok(state.syncedPaths.has("new.txt"));

    // Reverting an edit restores the committed content in the worktree.
    fs.writeFileSync(path.join(repo, "a.txt"), "one");
    git(repo, ["add", "a.txt"]); // staged revert -> clean working tree content
    return syncWorkingCopyState({ repoDir: repo, worktreeDir: worktree, state }).then((second) => {
      assert.equal(second.ok, true);
      assert.equal(fs.readFileSync(path.join(worktree, "a.txt"), "utf8"), "one");
      assert.ok(!state.syncedPaths.has("a.txt"));
    });
  });
});

test("syncWorkingCopyState never copies node_modules or git internals", (t) => {
  const repo = initRepo({ "index.js": "console.log(1);\n" });
  const worktree = makeWorktree();
  t.after(() => {
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(worktree, { recursive: true, force: true });
  });
  fs.mkdirSync(path.join(repo, "node_modules", "pkg"), { recursive: true });
  fs.writeFileSync(path.join(repo, "node_modules", "pkg", "index.js"), "module.exports = 1;\n");
  fs.writeFileSync(path.join(repo, ".git", "config"), "# touched\n", { flag: "a" });
  const state = { syncedPaths: new Set(), fileHashes: new Map(), envHashes: new Map() };
  return syncWorkingCopyState({ repoDir: repo, worktreeDir: worktree, state }).then((result) => {
    assert.equal(result.ok, true);
    assert.equal(fs.existsSync(path.join(worktree, "node_modules")), false);
    assert.equal(state.syncedPaths.size, 0);
  });
});
