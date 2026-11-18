import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { detectProject, devCommand, devInstallPlan, installCommand } from "../server/lib/frameworks.js";

function makeProject(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vercio-frameworks-"));
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), content);
  }
  return dir;
}

const VITE_PACKAGE = JSON.stringify({
  name: "vite-fixture",
  private: true,
  scripts: { dev: "vite" },
  devDependencies: { vite: "8.3.0" },
});

test("vite dev command forwards the preview flags without a stray -- for pnpm", () => {
  const dir = makeProject({
    "package.json": VITE_PACKAGE,
    "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
  });
  try {
    const detection = detectProject(dir);
    assert.equal(detection.packageManager, "pnpm");
    assert.equal(detection.kind, "vite");
    assert.equal(detection.type, "server");

    const command = devCommand(detection, 4103, dir);
    assert.equal(command.command, "pnpm");
    assert.deepEqual(command.args, [
      "run",
      "dev",
      "--port",
      "4103",
      "--host",
      "0.0.0.0",
      "--strictPort",
    ]);
    // A literal `--` makes Vite treat everything after it as positional args,
    // which silently drops the port override and binds the project's own port.
    assert.ok(!command.args.includes("--"), "pnpm must not receive a -- separator");
    assert.equal(command.env.PORT, "4103");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("npm keeps the -- separator so flags reach the script instead of npm", () => {
  const dir = makeProject({ "package.json": VITE_PACKAGE });
  try {
    const detection = detectProject(dir);
    assert.equal(detection.packageManager, "npm");
    const command = devCommand(detection, 4103, dir);
    assert.equal(command.command, "npm");
    const separator = command.args.indexOf("--");
    assert.equal(separator, 2);
    assert.deepEqual(command.args.slice(separator + 1), [
      "--port",
      "4103",
      "--host",
      "0.0.0.0",
      "--strictPort",
    ]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("yarn and bun receive flags directly, like pnpm", () => {
  for (const lock of ["yarn.lock", "bun.lock"]) {
    const dir = makeProject({ "package.json": VITE_PACKAGE, [lock]: "" });
    try {
      const detection = detectProject(dir);
      const command = devCommand(detection, 4103, dir);
      assert.deepEqual(command.args, [
        "run",
        "dev",
        "--port",
        "4103",
        "--host",
        "0.0.0.0",
        "--strictPort",
      ]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

test("Next.js previews get the port and host flags", () => {
  const dir = makeProject({
    "package.json": JSON.stringify({
      name: "next-fixture",
      scripts: { dev: "next dev" },
      dependencies: { next: "16.0.0" },
    }),
    "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
    "next.config.mjs": "export default {};\n",
  });
  try {
    const detection = detectProject(dir);
    assert.equal(detection.kind, "next");
    const command = devCommand(detection, 4103, dir);
    assert.deepEqual(command.args.slice(-4), ["-p", "4103", "-H", "0.0.0.0"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("dependency install plan is skipped when there is nothing to install", () => {
  const dir = makeProject({
    "package.json": JSON.stringify({ name: "plain", scripts: { dev: "node server.js" } }),
  });
  try {
    const detection = detectProject(dir);
    assert.equal(detection.type, "server");
    assert.equal(detection.label, "Custom dev server");
    assert.equal(devInstallPlan(detection, dir), null);
    assert.deepEqual(installCommand("pnpm"), ["pnpm", ["install"]]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
