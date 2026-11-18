import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import test from "node:test";
import { deployBranch, devServerSource, makeRepo, request, startApp } from "./helpers.js";


// The port a preview app would use if it ignored Vercio's CLI overrides, e.g.
// the port baked into the project's vite.config.ts. The test keeps it busy so a
// dev server that silently falls back to it fails fast instead of hanging.
const BAKED_PORT = 5199;

function hasBinary(command) {
  try {
    execFileSync(command, ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function occupyLocalPort(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(null));
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

// Mimics how Vite's CLI parser treats arguments: everything after a bare `--`
// is positional, so the `--port`/`--host` overrides are ignored. The fallback
// port represents `server.port` from the project's vite config.
function argvDevServer(configPort, heading = "argv fixture") {
  return [
    'import http from "node:http";',
    "const argv = process.argv.slice(2);",
    'console.log("ARGV " + JSON.stringify(argv));',
    "let port = " + configPort + ";",
    'let host = "127.0.0.1";',
    "for (let index = 0; index < argv.length; index += 1) {",
    "  const arg = argv[index];",
    '  if (arg === "--") break;',
    '  if (arg === "--port") port = Number(argv[++index]);',
    '  else if (arg === "--host") host = argv[++index];',
    "}",
    "const server = http.createServer((req, res) => {",
    '  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });',
    '  res.end("<!doctype html><html><body><h1>' +
      heading +
      '</h1><p>port " + port + "</p></body></html>");',
    "});",
    'server.on("error", () => {',
    '  console.error("error when starting dev server:");',
    '  console.error("Error: Port " + port + " is already in use");',
    "  process.exit(1);",
    "});",
    'server.listen(port, host, () => console.log("ready on " + host + ":" + port));',
    "",
  ].join("\n");
}

function failingDevServer() {
  return [
    'console.error("error when starting dev server:");',
    'console.error("Error: Port ' + BAKED_PORT + ' is already in use");',
    "process.exit(1);",
    "",
  ].join("\n");
}

// Vercio skips `install` when node_modules already exists. Track a marker file
// so fixtures that need to look like Vite projects (a real dependency, so the
// framework detector picks the Vite code path) never hit the network.
function commitNodeModulesMarker(repo) {
  fs.mkdirSync(path.join(repo, "node_modules"), { recursive: true });
  fs.writeFileSync(path.join(repo, "node_modules", ".keep"), "");
  execFileSync("git", ["add", "-f", "node_modules/.keep"], { cwd: repo });
  execFileSync("git", ["commit", "-m", "test: node_modules marker"], { cwd: repo });
}

// Another process can grab the port between Vercio's free-port probe and the
// dev server binding it; the preview then briefly turns ready (the foreign
// listener answers the health check) and immediately stops when our child
// exits. That is an environment race, not a regression: redeploy on a fresh
// port. Real failures (bad arguments, crashes) land in `error` and are surfaced
// without retrying.
async function deployReadyPreview(ctx, projectId, branch = "main") {
  let last = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { deployment } = await deployBranch(ctx.base, projectId, branch);
    last = deployment;
    if (deployment.status === "ready") return deployment;
    const lostPortRace =
      deployment.status === "stopped" &&
      /Dev server exited .*(code|signal)/.test(deployment.error || "");
    if (!lostPortRace) return deployment;
  }
  return last;
}

test("pnpm previews use the assigned port instead of the project's own port", { timeout: 120000 }, async (t) => {
  if (!hasBinary("pnpm")) {
    t.skip("pnpm is not installed");
    return;
  }
  const blocker = await occupyLocalPort(BAKED_PORT);
  if (blocker) t.after(() => blocker.close());

  const repo = makeRepo("pnpm-vite-argv", {
    files: {
      "package.json": JSON.stringify(
        {
          name: "pnpm-vite-argv",
          private: true,
          scripts: { dev: "node dev-server.mjs" },
          devDependencies: { vite: "8.3.0" },
        },
        null,
        2
      ),
      "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
      "vite.config.mjs": "export default {};\n",
      "dev-server.mjs": argvDevServer(BAKED_PORT),
    },
  });
  commitNodeModulesMarker(repo);
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));

  const ctx = await startApp();
  t.after(() => ctx.cleanup());

  const created = await request(ctx.base, "POST", "/api/projects", { source: repo });
  assert.equal(created.status, 201);
  const project = created.json.project;

  const deployment = await deployReadyPreview(ctx, project.id);
  assert.equal(deployment.status, "ready", deployment.error || "preview did not start");
  assert.equal(deployment.mode, "server");
  assert.equal(deployment.framework?.kind, "vite");
  assert.equal(deployment.framework?.packageManager, "pnpm");
  assert.ok(Number.isInteger(deployment.port), "preview should expose the actual port");
  assert.notEqual(deployment.port, BAKED_PORT);
  // Regression guard: no `--` separator may leak into the Vite invocation.
  assert.match(
    deployment.devCommand,
    /^pnpm run dev --port \d+ --host 0\.0\.0\.0 --strictPort$/
  );

  const page = await fetch("http://127.0.0.1:" + deployment.port + "/");
  assert.equal(page.status, 200);
  assert.match(await page.text(), /argv fixture/);

  const logs = await request(ctx.base, "GET", "/api/deployments/" + deployment.id + "/logs");
  assert.match(logs.json.log, /ARGV \["--port","\d+","--host","0\.0\.0\.0","--strictPort"\]/);
  assert.doesNotMatch(logs.json.log, /ARGV \["--",/);
});

test("failed previews expose the dev-server error and the complete log", { timeout: 120000 }, async (t) => {
  const repo = makeRepo("crashy-dev-server", {
    files: {
      "package.json": JSON.stringify(
        { name: "crashy-dev-server", private: true, scripts: { dev: "node fail-dev.mjs" } },
        null,
        2
      ),
      "fail-dev.mjs": failingDevServer(),
    },
  });
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));

  const ctx = await startApp();
  t.after(() => ctx.cleanup());

  const created = await request(ctx.base, "POST", "/api/projects", { source: repo });
  assert.equal(created.status, 201);
  const project = created.json.project;

  const { deployment } = await deployBranch(ctx.base, project.id, "main");
  assert.equal(deployment.status, "error");
  assert.match(deployment.error, /Dev server exited before it became ready \(code 1\)/);
  // The failure panel should name the actual cause instead of only "exited".
  assert.match(deployment.error, new RegExp("Port " + BAKED_PORT + " is already in use"));

  const logs = await request(ctx.base, "GET", "/api/deployments/" + deployment.id + "/logs");
  assert.match(logs.json.log, /error when starting dev server:/);
  assert.match(logs.json.log, new RegExp("Port " + BAKED_PORT + " is already in use"));
  // Output flushed while the process exits must be in the snapshot too.
  assert.match(logs.json.log, /Dev server exited early \(code 1\)/);
});

test("preview worktrees inherit the developer's local env files", { timeout: 120000 }, async (t) => {
  const repo = makeRepo("env-fixture", {
    files: {
      "package.json": JSON.stringify(
        { name: "env-fixture", private: true, scripts: { dev: "node dev.mjs" } },
        null,
        2
      ),
      "dev.mjs": devServerSource("env fixture"),
      ".env": "FROM_BRANCH=1\n",
    },
  });
  // Local-only env files are not committed: they only exist in the working copy.
  fs.writeFileSync(path.join(repo, ".env"), "FROM_BRANCH=modified-locally\n");
  fs.writeFileSync(path.join(repo, ".env.local"), "VITE_API_BASE_URL=http://127.0.0.1:9999\n");
  fs.writeFileSync(path.join(repo, ".env.development.local"), "DEV_ONLY=1\n");
  fs.writeFileSync(path.join(repo, ".env.example"), "EXAMPLE=1\n");
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));

  const ctx = await startApp();
  t.after(() => ctx.cleanup());

  const created = await request(ctx.base, "POST", "/api/projects", { source: repo });
  assert.equal(created.status, 201);
  const project = created.json.project;

  const deployment = await deployReadyPreview(ctx, project.id);
  assert.equal(deployment.status, "ready", deployment.error || "preview did not start");

  const worktreeRoot = path.join(ctx.dataDir, "worktrees", project.id);
  const worktreePath = path.join(worktreeRoot, fs.readdirSync(worktreeRoot)[0]);
  // The branch's committed .env wins; gitignored local files are copied in.
  assert.equal(fs.readFileSync(path.join(worktreePath, ".env"), "utf8"), "FROM_BRANCH=1\n");
  assert.equal(
    fs.readFileSync(path.join(worktreePath, ".env.local"), "utf8"),
    "VITE_API_BASE_URL=http://127.0.0.1:9999\n"
  );
  assert.equal(
    fs.readFileSync(path.join(worktreePath, ".env.development.local"), "utf8"),
    "DEV_ONLY=1\n"
  );

  const logs = await request(ctx.base, "GET", "/api/deployments/" + deployment.id + "/logs");
  assert.match(logs.json.log, /Copied local env files into the worktree:/);
  assert.match(logs.json.log, /\.env\.local/);
  assert.match(logs.json.log, /\.env\.development\.local/);
});

// Minimal stand-in for the Vite CLI so the overlay wiring can be tested without
// installing dependencies: it honours --port/--host, records its argv and can
// deliberately reject the generated `--config` overlay.
function fakeViteShim(rejectOverlay) {
  const lines = [
    "#!/usr/bin/env node",
    'const fs = require("node:fs");',
    'const http = require("node:http");',
    "const argv = process.argv.slice(2);",
    "let port = 5199;",
    'let host = "127.0.0.1";',
    'let config = "";',
    "for (let index = 0; index < argv.length; index += 1) {",
    "  const arg = argv[index];",
    '  if (arg === "--port") port = Number(argv[++index]);',
    '  else if (arg === "--host") host = argv[++index];',
    '  else if (arg === "--config") config = argv[++index];',
    "}",
    'fs.writeFileSync("vite-argv.json", JSON.stringify(argv));',
  ];
  if (rejectOverlay) {
    lines.push('if (config) { console.error("fake vite: cannot load the overlay config"); process.exit(1); }');
  }
  lines.push(
    "const server = http.createServer((req, res) => {",
    '  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });',
    '  res.end("<!doctype html><html><body><h1>fake vite</h1></body></html>");',
    "});",
    'server.listen(port, host, () => console.log("fake vite listening on " + port));',
    ""
  );
  return lines.join("\n");
}

function makeFakeViteRepo(name, { rejectOverlay }) {
  const repo = makeRepo(name, {
    files: {
      "package.json": JSON.stringify(
        { name, private: true, scripts: { dev: "vite" }, devDependencies: { vite: "8.3.0" } },
        null,
        2
      ),
      "vite.config.mjs": "export default {};\n",
    },
  });
  const binDir = path.join(repo, "node_modules", ".bin");
  fs.mkdirSync(binDir, { recursive: true });
  const bin = path.join(binDir, "vite");
  fs.writeFileSync(bin, fakeViteShim(rejectOverlay));
  fs.chmodSync(bin, 0o755);
  return repo;
}

function deployedWorktree(ctx, projectId) {
  const worktreeRoot = path.join(ctx.dataDir, "worktrees", projectId);
  return path.join(worktreeRoot, fs.readdirSync(worktreeRoot)[0]);
}

test("Vite previews fall back to the plain command when the overlay cannot load", { timeout: 120000 }, async (t) => {
  const repo = makeFakeViteRepo("vite-overlay-fallback", { rejectOverlay: true });
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));

  const ctx = await startApp();
  t.after(() => ctx.cleanup());

  const created = await request(ctx.base, "POST", "/api/projects", { source: repo });
  assert.equal(created.status, 201);
  const project = created.json.project;

  const deployment = await deployReadyPreview(ctx, project.id);
  assert.equal(deployment.status, "ready", deployment.error || "preview did not start");
  assert.equal(deployment.framework?.kind, "vite");
  assert.doesNotMatch(deployment.devCommand, /--config/);

  const page = await fetch("http://127.0.0.1:" + deployment.port + "/");
  assert.match(await page.text(), /fake vite/);

  const logs = await request(ctx.base, "GET", "/api/deployments/" + deployment.id + "/logs");
  assert.match(logs.json.log, /Linked node_modules detected; using a Vite config overlay/);
  assert.match(logs.json.log, /Vite config overlay failed; retrying with the project's dev command/);
  assert.match(logs.json.log, /\(fallback\)/);

  // The overlay is only a convenience; falling back must not leave it referenced.
  assert.ok(fs.existsSync(path.join(deployedWorktree(ctx, project.id), ".vercio.vite.config.mjs")));
});

test("Vite previews use the fs.allow overlay when the project config loads", { timeout: 120000 }, async (t) => {
  const repo = makeFakeViteRepo("vite-overlay-applied", { rejectOverlay: false });
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));

  const ctx = await startApp();
  t.after(() => ctx.cleanup());

  const created = await request(ctx.base, "POST", "/api/projects", { source: repo });
  assert.equal(created.status, 201);
  const project = created.json.project;

  const deployment = await deployReadyPreview(ctx, project.id);
  assert.equal(deployment.status, "ready", deployment.error || "preview did not start");
  assert.match(deployment.devCommand, /--config \.vercio\.vite\.config\.mjs/);

  const worktreePath = deployedWorktree(ctx, project.id);
  const argv = JSON.parse(fs.readFileSync(path.join(worktreePath, "vite-argv.json"), "utf8"));
  assert.ok(argv.includes("--config"));
  assert.equal(argv[argv.indexOf("--config") + 1], ".vercio.vite.config.mjs");
});
