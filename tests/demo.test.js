import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { deployBranch, request, startApp } from "./helpers.js";

const manifestPath = path.resolve("examples/demo/manifest.json");
const hasDemo = fs.existsSync(manifestPath);

test("bundled demo seeds notes, comments and four previewable branches", { timeout: 180000 }, async (t) => {
  if (!hasDemo) {
    t.skip("bundled demo assets are not present");
    return;
  }
  const ctx = await startApp();
  t.after(ctx.cleanup);

  const created = await request(ctx.base, "POST", "/api/projects/demo");
  assert.equal(created.status, 201);
  const project = created.json.project;
  assert.equal(project.isDemo, true);
  assert.equal(project.branchCount, 4);

  const branches = await request(ctx.base, "GET", "/api/projects/" + project.id + "/branches");
  assert.equal(branches.status, 200);
  const names = branches.json.branches.map((branch) => branch.name);
  assert.deepEqual(names.sort(), ["feat/aurora-hero", "feat/pricing-v2", "fix/mobile-nav", "main"]);
  assert.equal(branches.json.defaultBranch, "main");

  const notes = await request(ctx.base, "GET", "/api/projects/" + project.id + "/notes");
  assert.equal(notes.json.notes.length, 3);
  assert.ok(notes.json.notes.some((note) => note.pinned));

  const comments = await request(
    ctx.base,
    "GET",
    "/api/projects/" + project.id + "/comments?branch=feat%2Faurora-hero"
  );
  assert.equal(comments.json.comments.length, 1);
  assert.equal(comments.json.comments[0].author, "Maya Chen");

  const { deployment: mainDeployment } = await deployBranch(ctx.base, project.id, "main");
  assert.equal(mainDeployment.status, "ready");

  const mainRedirect = await fetch(ctx.base + "/preview/" + mainDeployment.id + "/", {
    redirect: "manual",
  });
  const mainPage = await (await fetch(mainRedirect.headers.get("location"))).text();
  assert.match(mainPage, /Lumen/);

  const { deployment: auroraDeployment } = await deployBranch(
    ctx.base,
    project.id,
    "feat/aurora-hero"
  );
  assert.equal(auroraDeployment.status, "ready");
  const auroraRedirect = await fetch(ctx.base + "/preview/" + auroraDeployment.id + "/", {
    redirect: "manual",
  });
  const auroraPage = await (await fetch(auroraRedirect.headers.get("location"))).text();
  assert.match(auroraPage, /Lumen/);
  assert.notEqual(auroraPage, mainPage);
  assert.notEqual(mainDeployment.port, auroraDeployment.port);

  const changes = await request(
    ctx.base,
    "GET",
    "/api/projects/" + project.id + "/changes?branch=feat%2Faurora-hero"
  );
  assert.ok(changes.json.fileCount > 0);

  // Loading the demo again reuses the same project instead of duplicating it.
  const again = await request(ctx.base, "POST", "/api/projects/demo");
  assert.equal(again.status, 201);
  assert.equal(again.json.project.id, project.id);
  const overview = await request(ctx.base, "GET", "/api/overview");
  assert.equal(overview.json.projects.length, 1);
});
