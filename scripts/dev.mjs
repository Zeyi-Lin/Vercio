import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = { ...process.env, VERCIO_PORT: process.env.VERCIO_PORT || "4000" };
const children = [];

function launch(name, command, args, extraEnv = {}) {
  const child = spawn(command, args, {
    cwd: root,
    env: { ...env, ...extraEnv },
    stdio: "inherit",
  });
  child.on("exit", (code) => {
    if (code !== 0 && code !== null) {
      console.error("[dev] " + name + " exited with code " + code);
    }
    shutdown(code || 0);
  });
  children.push(child);
  return child;
}

let stopping = false;
function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    try { child.kill("SIGTERM"); } catch {}
  }
  setTimeout(() => process.exit(code), 400);
  setTimeout(() => process.exit(code), 1500).unref?.();
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

console.log("\n  Starting Vercio in development mode...\n");
launch("api", process.execPath, ["server/index.js"]);
setTimeout(() => {
  launch("web", process.execPath, [path.join(root, "node_modules", "vite", "bin", "vite.js")]);
}, 250);
