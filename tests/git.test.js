import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  diffStat,
  getDefaultBranch,
  getRepoInfo,
  listBranches,
  readReadme,
  resolveBranch,
} from "../server/lib/git.js";
import { makeRepo } from "./helpers.js";

test("git layer lists branches, resolves refs and diffs", async (t) => {
  const repo = makeRepo("git-fixture", {
    files: {
      "README.md": "# Fixture\n\nHello from the fixture.",
      "index.html": "<h1>Main branch</h1>",
    },
    branches: [
      {
        name: "feat/bright",
        files: {
          "README.md": "# Fixture\n\nHello from the fixture.",
          "index.html": "<h1>Bright feature branch</h1>",
        },
        message: "feat: bright homepage",
      },
    ],
  });
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));

  const defaultBranch = await getDefaultBranch(repo);
  assert.equal(defaultBranch, "main");

  const branchInfo = await listBranches(repo);
  assert.equal(branchInfo.defaultBranch, "main");
  assert.deepEqual(
    branchInfo.branches.map((branch) => branch.name).sort(),
    ["feat/bright", "main"]
  );
  const main = branchInfo.branches.find((branch) => branch.name === "main");
  assert.equal(main.isDefault, true);
  assert.equal(main.subject, "Initial commit");

  const resolved = await resolveBranch(repo, "feat/bright");
  assert.match(resolved.sha, /^[0-9a-f]{40}$/);
  assert.equal(resolved.ref, "refs/heads/feat/bright");

  const readme = await readReadme(repo, "refs/heads/main");
  assert.equal(readme.name, "README.md");
  assert.match(readme.markdown, /Hello from the fixture/);

  const stat = await diffStat(repo, "refs/heads/main", "refs/heads/feat/bright");
  assert.equal(stat.fileCount, 1);
  assert.equal(stat.files[0].path, "index.html");
  assert.equal(stat.additions, 1);
  assert.equal(stat.deletions, 1);

  const info = await getRepoInfo(repo);
  assert.equal(info.defaultBranch, "main");
  assert.equal(info.currentBranch, "main");
  assert.equal(info.dirtyCount, 0);

  await assert.rejects(() => resolveBranch(repo, "does-not-exist"), /Branch not found/);
});
