import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { makeRepo } from "./helpers.js";
import {
  listSources,
  parseWorktreeList,
  sourceForBranch,
  toPublicSource,
} from "../server/lib/sources.js";

function git(dir, args) {
  return execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
}

test("parseWorktreeList understands main, linked and detached worktrees", () => {
  const entries = parseWorktreeList(
    [
      "worktree /repo",
      "HEAD 1111111111111111111111111111111111111111",
      "branch refs/heads/main",
      "",
      "worktree /repo-wt/feat-a",
      "HEAD 2222222222222222222222222222222222222222",
      "branch refs/heads/feat/a",
      "",
      "worktree /repo-wt/detached",
      "HEAD 3333333333333333333333333333333333333333",
      "detached",
      "",
      "worktree /bare.git",
      "bare",
      "",
    ].join("\n")
  );
  assert.equal(entries.length, 4);
  assert.deepEqual(
    entries.map((entry) => [entry.path, entry.branch, entry.detached, entry.bare]),
    [
      ["/repo", "main", false, false],
      ["/repo-wt/feat-a", "feat/a", false, false],
      ["/repo-wt/detached", null, true, false],
      ["/bare.git", null, false, true],
    ]
  );
});

test("listSources finds external worktrees and excludes Vercio preview worktrees", async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "vercio-sources-data-"));
  const repo = makeRepo("sources-fixture", {
    files: { "index.html": "<h1>main</h1>" },
    branches: [{ name: "feat/a", files: { "index.html": "<h1>a</h1>" } }],
  });
  const config = {
    dataDir,
    dirs: {
      worktrees: path.join(dataDir, "worktrees"),
      deps: path.join(dataDir, "deps"),
    },
  };
  const previewWorktree = path.join(config.dirs.worktrees, "prj_test", "feat-a-12345678");
  const externalWorktree = path.join(dataDir, "agent-worktrees", "feat-a");
  fs.mkdirSync(path.dirname(previewWorktree), { recursive: true });
  fs.mkdirSync(path.dirname(externalWorktree), { recursive: true });
  t.after(() => {
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  git(repo, ["worktree", "add", "--detach", previewWorktree, "HEAD"]);
  git(repo, ["worktree", "add", externalWorktree, "feat/a"]);

  const sources = await listSources({ repoPath: repo }, config);
  const paths = sources.map((source) => source.path);
  // git reports real paths; macOS resolves /var to /private/var.
  assert.deepEqual(paths, [fs.realpathSync(repo), fs.realpathSync(externalWorktree)]);
  assert.equal(sources[0].kind, "working-copy");
  assert.equal(sources[0].main, true);
  assert.equal(sources[1].kind, "worktree");
  assert.equal(sources[1].branch, "feat/a");
  assert.equal(sources[1].head.length, 40);

  assert.equal(sourceForBranch(sources, "feat/a").path, fs.realpathSync(externalWorktree));
  assert.equal(sourceForBranch(sources, "feat/missing"), null);

  const publicSource = toPublicSource(sources[1]);
  assert.equal(publicSource.kind, "worktree");
  assert.equal(publicSource.branch, "feat/a");
  assert.equal(publicSource.shortSha.length, 7);
  assert.equal("path" in publicSource, false);
});
