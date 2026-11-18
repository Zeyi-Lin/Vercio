import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  VITE_OVERLAY_FILE,
  findViteConfig,
  linkedNodeModulesDir,
  supportsViteConfigOverlay,
  writeViteConfigOverlay,
} from "../server/lib/vite-overlay.js";

function makeDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "vercio-vite-overlay-"));
}

test("overlay is only applied to plain Vite CLI dev scripts", () => {
  assert.equal(supportsViteConfigOverlay("vite"), true);
  assert.equal(supportsViteConfigOverlay("vite dev"), true);
  assert.equal(supportsViteConfigOverlay("vite --mode staging"), true);
  assert.equal(supportsViteConfigOverlay("  vite   "), true);
  assert.equal(supportsViteConfigOverlay("remix vite:dev"), false);
  assert.equal(supportsViteConfigOverlay("astro dev"), false);
  assert.equal(supportsViteConfigOverlay("vite --config custom.ts"), false);
  assert.equal(supportsViteConfigOverlay("vite -c custom.ts"), false);
  assert.equal(supportsViteConfigOverlay("vite --root web"), false);
  assert.equal(supportsViteConfigOverlay(""), false);
  assert.equal(supportsViteConfigOverlay(undefined), false);
});

test("overlay imports the project config and widens server.fs.allow", (t) => {
  const dir = makeDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, "vite.config.ts"), "export default {};\n");
  const allowed = path.join(dir, "linked-node-modules");
  fs.mkdirSync(allowed);

  const overlay = writeViteConfigOverlay(dir, [allowed]);
  assert.equal(overlay, VITE_OVERLAY_FILE);
  const content = fs.readFileSync(path.join(dir, overlay), "utf8");
  assert.match(content, /import baseConfig from "\.\/vite\.config\.ts"/);
  assert.match(content, /mergeConfig\(base/);
  assert.match(content, /fs: \{ allow: \[process\.cwd\(\), \.\.\.allowedDirs\] \}/);
  assert.ok(content.includes(JSON.stringify(path.resolve(allowed))));
});

test("overlay still works when the project has no Vite config file", (t) => {
  const dir = makeDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.equal(findViteConfig(dir), null);

  const overlay = writeViteConfigOverlay(dir, [dir]);
  const content = fs.readFileSync(path.join(dir, overlay), "utf8");
  assert.doesNotMatch(content, /baseConfig from/);
  assert.match(content, /const base = \{\};/);
});

test("linkedNodeModulesDir reports only symlinked node_modules", (t) => {
  const dir = makeDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  fs.mkdirSync(path.join(dir, "node_modules", "real-package"), { recursive: true });
  assert.equal(linkedNodeModulesDir(dir), null);

  fs.rmSync(path.join(dir, "node_modules"), { recursive: true, force: true });
  const realModules = path.join(dir, "shared-node_modules");
  fs.mkdirSync(realModules, { recursive: true });
  fs.symlinkSync(realModules, path.join(dir, "node_modules"), "dir");
  assert.equal(linkedNodeModulesDir(dir), fs.realpathSync(realModules));
});
