import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { deployBranch, makeRepo, request, startApp, staticPage } from "./helpers.js";

test("project, notes, comments, LAN info and static preview lifecycle", { timeout: 120000 }, async (t) => {
  const ctx = await startApp();
  t.after(ctx.cleanup);

  const repo = makeRepo("static-site", {
    files: {
      "index.html": staticPage("Production branch"),
      "README.md": "# Static fixture\n\nA tiny static site.",
    },
    branches: [
      {
        name: "feat/blue",
        files: {
          "index.html": staticPage("Blue feature branch"),
          "README.md": "# Static fixture\n\nA tiny static site.",
        },
        message: "feat: blue page",
      },
    ],
  });
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));

  const created = await request(ctx.base, "POST", "/api/projects", { source: repo });
  assert.equal(created.status, 201);
  const project = created.json.project;
  assert.equal(project.status, "ready");
  assert.equal(project.branchCount, 2);
  assert.equal(project.defaultBranch, "main");

  const patched = await request(ctx.base, "PATCH", "/api/projects/" + project.id, {
    description: "## Product brief\n\nThis is the brief.",
    tagline: "A tiny static site",
  });
  assert.equal(patched.status, 200);
  assert.match(patched.json.project.description, /Product brief/);

  // Only one branch can be pinned; it persists on the project record.
  const pinned = await request(ctx.base, "PATCH", "/api/projects/" + project.id, {
    pinnedBranch: "feat/blue",
  });
  assert.equal(pinned.status, 200);
  assert.equal(pinned.json.project.pinnedBranch, "feat/blue");
  const pinnedReload = await request(ctx.base, "GET", "/api/projects/" + project.id);
  assert.equal(pinnedReload.json.project.pinnedBranch, "feat/blue");

  const missingBranch = await request(ctx.base, "PATCH", "/api/projects/" + project.id, {
    pinnedBranch: "no/such-branch",
  });
  assert.equal(missingBranch.status, 422);
  const badPinType = await request(ctx.base, "PATCH", "/api/projects/" + project.id, {
    pinnedBranch: 42,
  });
  assert.equal(badPinType.status, 400);
  const stillPinned = await request(ctx.base, "GET", "/api/projects/" + project.id);
  assert.equal(stillPinned.json.project.pinnedBranch, "feat/blue");

  const unpinned = await request(ctx.base, "PATCH", "/api/projects/" + project.id, {
    pinnedBranch: null,
  });
  assert.equal(unpinned.status, 200);
  assert.equal(unpinned.json.project.pinnedBranch, null);

  const branches = await request(ctx.base, "GET", "/api/projects/" + project.id + "/branches");
  assert.equal(branches.status, 200);
  assert.equal(branches.json.branches.length, 2);
  assert.equal(branches.json.branches[0].name, "main");

  const changes = await request(
    ctx.base,
    "GET",
    "/api/projects/" + project.id + "/changes?branch=feat%2Fblue"
  );
  assert.equal(changes.status, 200);
  assert.equal(changes.json.fileCount, 1);
  assert.equal(changes.json.files[0].path, "index.html");

  const readme = await request(ctx.base, "GET", "/api/projects/" + project.id + "/readme");
  assert.equal(readme.status, 200);
  assert.equal(readme.json.readme.name, "README.md");
  assert.match(readme.json.readme.markdown, /Static fixture/);

  // Static previews run on their own port and redirect through a stable URL.
  const { created: deploymentResponse, deployment } = await deployBranch(
    ctx.base,
    project.id,
    "feat/blue"
  );
  assert.equal(deploymentResponse.status, 202);
  assert.equal(deployment.status, "ready");
  assert.equal(deployment.mode, "static");
  assert.ok(Number.isInteger(deployment.port));
  assert.ok(deployment.port > 0);

  const redirect = await fetch(ctx.base + "/preview/" + deployment.id + "/", {
    redirect: "manual",
  });
  assert.equal(redirect.status, 302);
  const location = redirect.headers.get("location");
  assert.match(location, /^http:\/\/127\.0\.0\.1:\d+\/$/);
  const page = await fetch(location);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Blue feature branch/);

  const logs = await request(ctx.base, "GET", "/api/deployments/" + deployment.id + "/logs");
  assert.equal(logs.status, 200);
  assert.equal(logs.json.status, "ready");
  assert.match(logs.json.log, /Static preview ready/);

  // Notes
  const note = await request(ctx.base, "POST", "/api/projects/" + project.id + "/notes", {
    title: "Launch checklist",
    body: "## Checklist\n\n- [x] Ship it",
    tags: ["launch"],
    pinned: true,
  });
  assert.equal(note.status, 201);
  const notes = await request(ctx.base, "GET", "/api/projects/" + project.id + "/notes");
  assert.equal(notes.json.notes.length, 1);
  assert.equal(notes.json.notes[0].pinned, true);
  const noteUpdate = await request(ctx.base, "PATCH", "/api/notes/" + note.json.note.id, {
    title: "Renamed note",
  });
  assert.equal(noteUpdate.json.note.title, "Renamed note");
  const noteDelete = await request(ctx.base, "DELETE", "/api/notes/" + note.json.note.id);
  assert.equal(noteDelete.status, 200);

  // Comments
  const comment = await request(ctx.base, "POST", "/api/projects/" + project.id + "/comments", {
    branch: "feat/blue",
    author: "Maya",
    body: "Looks great",
    clientId: "client-a",
  });
  assert.equal(comment.status, 201);
  const commentList = await request(
    ctx.base,
    "GET",
    "/api/projects/" + project.id + "/comments?branch=feat%2Fblue"
  );
  assert.equal(commentList.json.comments.length, 1);
  const forbidden = await request(
    ctx.base,
    "DELETE",
    "/api/comments/" + comment.json.comment.id + "?clientId=other-client"
  );
  assert.equal(forbidden.status, 403);
  const deleted = await request(
    ctx.base,
    "DELETE",
    "/api/comments/" + comment.json.comment.id + "?clientId=client-a"
  );
  assert.equal(deleted.status, 200);

  // System + overview
  const system = await request(ctx.base, "GET", "/api/system");
  assert.equal(system.status, 200);
  assert.ok(Array.isArray(system.json.system.lanUrls));
  assert.match(system.json.system.qrDataUrl, /^data:image\/png;base64,/);
  assert.equal(system.json.stats.projects, 1);

  const overview = await request(ctx.base, "GET", "/api/overview");
  assert.equal(overview.status, 200);
  assert.equal(overview.json.projects.length, 1);
  assert.ok(overview.json.deployments.length >= 1);
  assert.equal(overview.json.deployments[0].projectName, "static-site");

  // Stopping a preview
  const stopped = await request(ctx.base, "POST", "/api/deployments/" + deployment.id + "/stop");
  assert.equal(stopped.status, 200);
  assert.equal(stopped.json.deployment.status, "stopped");

  // Settings
  const settings = await request(ctx.base, "PATCH", "/api/settings", { userName: "Maya Chen" });
  assert.equal(settings.status, 200);
  assert.equal(settings.json.settings.userName, "Maya Chen");

  // Deleting the project removes notes, comments and deployments.
  const removed = await request(ctx.base, "DELETE", "/api/projects/" + project.id);
  assert.equal(removed.status, 200);
  const overviewAfter = await request(ctx.base, "GET", "/api/overview");
  assert.equal(overviewAfter.json.projects.length, 0);
  assert.equal(overviewAfter.json.deployments.length, 0);
});
