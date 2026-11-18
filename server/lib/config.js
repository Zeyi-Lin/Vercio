import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const APP_ROOT = path.resolve(here, "../..");

function readVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(APP_ROOT, "package.json"), "utf8"));
    return pkg.version || "0.1.0";
  } catch {
    return "0.1.0";
  }
}

export function resolveConfig(overrides = {}) {
  const env = process.env;
  const dataDir = path.resolve(
    overrides.dataDir || env.VERCIO_DATA_DIR || path.join(APP_ROOT, ".vercio")
  );
  const rawPort = Number(overrides.port ?? env.VERCIO_PORT ?? env.PORT ?? 4000);
  const port = Number.isFinite(rawPort) && rawPort >= 0 ? rawPort : 4000;
  const dirs = {
    repos: path.join(dataDir, "repos"),
    worktrees: path.join(dataDir, "worktrees"),
    logs: path.join(dataDir, "logs"),
    deps: path.join(dataDir, "deps"),
    tmp: path.join(dataDir, "tmp"),
  };
  return {
    root: APP_ROOT,
    version: readVersion(),
    dataDir,
    dirs,
    dbFile: path.join(dataDir, "db.json"),
    webDist: path.join(APP_ROOT, "dist"),
    examplesDir: path.join(APP_ROOT, "examples"),
    host: overrides.host || env.VERCIO_HOST || "0.0.0.0",
    port,
    previewPortRange: [4100, 4999],
    maxRunningDevServers: Number(env.VERCIO_MAX_PREVIEWS || 8),
    devServerTimeoutMs: 120000,
    installTimeoutMs: 10 * 60 * 1000,
    idleStopMs: 0,
    dataDirEnv: Boolean(env.VERCIO_DATA_DIR),
  };
}

export function ensureDirs(config) {
  for (const dir of Object.values(config.dirs)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.mkdirSync(config.dataDir, { recursive: true });
}

export function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "branch";
}
