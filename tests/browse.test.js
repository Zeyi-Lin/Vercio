import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { makeRepo, request, startApp } from "./helpers.js";

test("folder browser lists only directories and flags git repositories", { timeout: 60000 }, async (t) => {
  const ctx = await startApp();
  t.after(ctx.cleanup);

  // makeRepo creates <tmp>/<name>; the parent doubles as a browsable workspace.
  const repo = makeRepo("acme-site", { files: { "index.html": "<h1>hi</h1>" } });
  t.after(() => fs.rmSync(path.dirname(repo), { recursive: true, force: true }));
  const workspace = path.dirname(repo);
  fs.mkdirSync(path.join(workspace, "alpha"), { recursive: true });
  fs.mkdirSync(path.join(workspace, "beta"), { recursive: true });
  fs.mkdirSync(path.join(workspace, ".hidden-repo"), { recursive: true });
  fs.writeFileSync(path.join(workspace, "notes.txt"), "not a folder");

  const workspaceListing = await request(ctx.base, "GET", "/api/fs/browse?path=" + encodeURIComponent(workspace));
  assert.equal(workspaceListing.status, 200);
  const listing = workspaceListing.json.listing;
  assert.equal(listing.path, workspace);
  assert.equal(listing.parent, path.dirname(workspace));
  assert.equal(listing.isGitRepo, false);
  assert.deepEqual(
    listing.entries.map((entry) => entry.name),
    ["acme-site", "alpha", "beta"]
  );
  assert.equal(listing.entries.find((entry) => entry.name === "acme-site").isGitRepo, true);
  assert.equal(listing.entries.find((entry) => entry.name === "alpha").isGitRepo, false);
  assert.equal(listing.hiddenCount, 1);
  assert.equal(listing.showHidden, false);

  const hiddenListing = await request(
    ctx.base,
    "GET",
    "/api/fs/browse?path=" + encodeURIComponent(workspace) + "&showHidden=1"
  );
  assert.equal(hiddenListing.status, 200);
  assert.deepEqual(
    hiddenListing.json.listing.entries.map((entry) => entry.name),
    [".hidden-repo", "acme-site", "alpha", "beta"]
  );
  assert.equal(hiddenListing.json.listing.showHidden, true);

  const repoListing = await request(ctx.base, "GET", "/api/fs/browse?path=" + encodeURIComponent(repo));
  assert.equal(repoListing.status, 200);
  assert.equal(repoListing.json.listing.isGitRepo, true);
  assert.equal(repoListing.json.listing.name, "acme-site");
  assert.equal(repoListing.json.listing.breadcrumbs.at(-1).path, repo);
  assert.equal(repoListing.json.listing.breadcrumbs.at(-1).label, "acme-site");
  assert.ok(repoListing.json.listing.breadcrumbs.length >= 2);
  assert.equal(repoListing.json.listing.roots[0].kind, "home");
});

test("folder browser expands ~ and reports missing or non-directory paths", { timeout: 60000 }, async (t) => {
  const ctx = await startApp();
  t.after(ctx.cleanup);

  const home = await request(ctx.base, "GET", "/api/fs/browse?path=~");
  assert.equal(home.status, 200);
  assert.equal(home.json.listing.path, os.homedir());
  assert.equal(home.json.listing.isHome, true);
  assert.equal(home.json.listing.parent, path.dirname(os.homedir()));
  const defaults = await request(ctx.base, "GET", "/api/fs/browse");
  assert.equal(defaults.status, 200);
  assert.equal(defaults.json.listing.path, os.homedir());

  const rootPath = path.parse(os.homedir()).root;
  const root = await request(ctx.base, "GET", "/api/fs/browse?path=" + encodeURIComponent(rootPath));
  assert.equal(root.status, 200);
  assert.equal(root.json.listing.parent, null);
  assert.equal(root.json.listing.breadcrumbs.length, 1);

  const missing = await request(
    ctx.base,
    "GET",
    "/api/fs/browse?path=" + encodeURIComponent(path.join(os.tmpdir(), "vercio-does-not-exist-42"))
  );
  assert.equal(missing.status, 404);
  assert.equal(missing.json.error.details.code, "missing");

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vercio-browse-file-"));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));
  const file = path.join(tmpDir, "readme.md");
  fs.writeFileSync(file, "hello");
  const notDirectory = await request(ctx.base, "GET", "/api/fs/browse?path=" + encodeURIComponent(file));
  assert.equal(notDirectory.status, 400);
  assert.equal(notDirectory.json.error.details.code, "not-directory");

  const methodNotAllowed = await request(ctx.base, "POST", "/api/fs/browse", { path: tmpDir });
  assert.equal(methodNotAllowed.status, 404);
});
