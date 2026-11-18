import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  deployBranch,
  devServerSource,
  makeRepo,
  request,
  startApp,
  staticPage,
  writeFiles,
} from "./helpers.js";

test("dev server preview runs, redirects and stops", { timeout: 120000 }, async (t) => {
  const ctx = await startApp();
  t.after(ctx.cleanup);

  const repo = makeRepo("dev-app", {
    files: {
      "package.json": JSON.stringify({
        name: "dev-fixture",
        private: true,
        type: "module",
        scripts: { dev: "node dev.mjs" },
      }),
      "dev.mjs": devServerSource("Dev server: main"),
    },
    branches: [
      {
        name: "feat/purple",
        files: {
          "package.json": JSON.stringify({
            name: "dev-fixture",
            private: true,
            type: "module",
            scripts: { dev: "node dev.mjs" },
          }),
          "dev.mjs": devServerSource("Dev server: purple feature"),
        },
        message: "feat: purple page",
      },
    ],
  });
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));

  const projectResponse = await request(ctx.base, "POST", "/api/projects", { source: repo });
  assert.equal(projectResponse.status, 201);
  const project = projectResponse.json.project;

  const { deployment } = await deployBranch(ctx.base, project.id, "feat/purple");
  assert.equal(deployment.status, "ready");
  assert.equal(deployment.mode, "server");
  assert.equal(deployment.framework.label, "Custom dev server");
  assert.equal(deployment.framework.type, "server");
  assert.ok(Number.isInteger(deployment.port));

  const redirect = await fetch(ctx.base + "/preview/" + deployment.id + "/", {
    redirect: "manual",
  });
  assert.equal(redirect.status, 302);
  const location = redirect.headers.get("location");
  assert.ok(location.includes(":" + deployment.port + "/"));
  const page = await fetch(location);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /purple feature/);

  const logs = await request(ctx.base, "GET", "/api/deployments/" + deployment.id + "/logs");
  assert.match(logs.json.log, /dev fixture ready/);
  assert.match(logs.json.log, /Preview ready on port/);

  const branchDeployments = await request(
    ctx.base,
    "GET",
    "/api/projects/" + project.id + "/deployments"
  );
  assert.equal(branchDeployments.json.deployments.length, 1);
  assert.equal(branchDeployments.json.deployments[0].status, "ready");

  const stopped = await request(ctx.base, "POST", "/api/deployments/" + deployment.id + "/stop");
  assert.equal(stopped.status, 200);
  assert.equal(stopped.json.deployment.status, "stopped");

  const afterStop = await fetch(ctx.base + "/preview/" + deployment.id + "/", {
    redirect: "manual",
  });
  assert.equal(afterStop.status, 200);
  assert.match(await afterStop.text(), /Preview stopped/);

  // A project without a dev script cannot start a server preview.
  const staticRepo = makeRepo("plain-static", {
    files: { "index.html": staticPage("Plain static") },
  });
  t.after(() => fs.rmSync(staticRepo, { recursive: true, force: true }));
  const staticProject = (
    await request(ctx.base, "POST", "/api/projects", { source: staticRepo })
  ).json.project;
  const { deployment: failed } = await deployBranch(
    ctx.base,
    staticProject.id,
    "main",
    "server"
  );
  assert.equal(failed.status, "error");
  assert.match(failed.error, /no dev server script/i);
});

test("branch worktrees are isolated from the working copy", { timeout: 120000 }, async (t) => {
  const ctx = await startApp();
  t.after(ctx.cleanup);
  const repo = makeRepo("isolation-fixture", {
    files: { "index.html": staticPage("Main"), "README.md": "# Isolation" },
    branches: [
      {
        name: "feat/second",
        files: { "index.html": staticPage("Second"), "README.md": "# Isolation" },
        message: "feat: second page",
      },
    ],
  });
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  const project = (
    await request(ctx.base, "POST", "/api/projects", { source: repo })
  ).json.project;
  await deployBranch(ctx.base, project.id, "main");
  await deployBranch(ctx.base, project.id, "feat/second");

  // Both previews should be running at the same time in different worktrees.
  const branches = await request(ctx.base, "GET", "/api/projects/" + project.id + "/branches");
  const ready = branches.json.branches.filter((branch) => branch.deployment?.status === "ready");
  assert.equal(ready.length, 2);
  assert.notEqual(ready[0].deployment.port, ready[1].deployment.port);

  // The user's working copy is still on main with an untouched index.html.
  assert.match(fs.readFileSync(repo + "/index.html", "utf8"), /Main/);
});
