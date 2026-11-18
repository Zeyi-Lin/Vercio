import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createVercioApp } from "../server/index.js";

export function writeFiles(dir, files) {
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, content] of Object.entries(files || {})) {
    const target = path.join(dir, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
}

function clearExceptGit(dir) {
  for (const entry of fs.readdirSync(dir)) {
    if (entry === ".git") continue;
    fs.rmSync(path.join(dir, entry), { recursive: true, force: true });
  }
}

/**
 * Creates a throwaway git repository with a main branch and optional feature branches.
 * Each branch can replace the working tree with its own files.
 */
export function makeRepo(name, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vercio-fixture-"));
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  const git = (args, env = {}) =>
    execFileSync("git", args, {
      cwd: dir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      env: { ...process.env, ...env },
    });
  git(["init", "-b", "main"]);
  git(["config", "user.email", "test@vercio.local"]);
  git(["config", "user.name", "Vercio Test"]);
  writeFiles(dir, options.files);
  git(["add", "-A"]);
  git(["commit", "-m", "Initial commit"]);
  for (const branch of options.branches || []) {
    git(["checkout", "-b", branch.name]);
    clearExceptGit(dir);
    writeFiles(dir, branch.files || options.files);
    git(["add", "-A"]);
    git(["commit", "-m", branch.message || "feat: " + branch.name]);
    git(["checkout", "main"]);
  }
  return dir;
}

export function devServerSource(heading) {
  return [
    'import http from "node:http";',
    "const port = Number(process.env.PORT || 4399);",
    'const host = process.env.HOST || "0.0.0.0";',
    "const html = '<!doctype html><html><head><meta charset=\"utf-8\"><title>Dev fixture</title></head>' +",
    "  '<body style=\"font-family:system-ui;background:#111;color:#fff\"><h1>' + " +
      JSON.stringify(heading) +
      " + '</h1><p>port ' + port + '</p></body></html>';",
    "http.createServer((req, res) => {",
    '  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });',
    "  res.end(html);",
    '}).listen(port, host, () => console.log("dev fixture ready on " + port));',
    "",
  ].join("\n");
}

export function staticPage(heading) {
  return (
    "<!doctype html><html><head><meta charset=\"utf-8\"><title>" +
    heading +
    "</title></head><body><h1>" +
    heading +
    "</h1></body></html>"
  );
}

export async function startApp(overrides = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "vercio-data-"));
  const app = await createVercioApp({ dataDir, port: 0, host: "127.0.0.1", ...overrides });
  await app.listen();
  const base = "http://127.0.0.1:" + app.runtime.port;
  return {
    app,
    base,
    dataDir,
    async cleanup() {
      try {
        await app.close();
      } catch {}
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

export async function request(base, method, route, body) {
  const response = await fetch(base + route, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await response.json();
  } catch {}
  return { status: response.status, json, headers: response.headers };
}

export async function waitForDeployment(base, id, timeoutMs = 90000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const result = await request(base, "GET", "/api/deployments/" + id);
    const deployment = result.json?.deployment;
    if (deployment && ["ready", "error", "stopped"].includes(deployment.status)) return deployment;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error("Timed out waiting for deployment " + id);
}

export async function deployBranch(base, projectId, branch, mode = "auto") {
  const created = await request(base, "POST", "/api/projects/" + projectId + "/deployments", {
    branch,
    mode,
  });
  if (!created.json?.deployment) {
    throw new Error("Could not create deployment: " + JSON.stringify(created.json));
  }
  const deployment = await waitForDeployment(base, created.json.deployment.id);
  return { created, deployment };
}
