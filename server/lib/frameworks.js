import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { HttpError } from "./http.js";

const PM_FILES = [
  { file: "pnpm-lock.yaml", name: "pnpm" },
  { file: "yarn.lock", name: "yarn" },
  { file: "bun.lockb", name: "bun" },
  { file: "bun.lock", name: "bun" },
  { file: "package-lock.json", name: "npm" },
  { file: "npm-shrinkwrap.json", name: "npm" },
];

const INSTALL_COMMANDS = {
  npm: ["npm", ["install"]],
  pnpm: ["pnpm", ["install"]],
  yarn: ["yarn", ["install"]],
  bun: ["bun", ["install"]],
};

const FRAMEWORKS = [
  { keys: ["next"], label: "Next.js", marker: /^next\.config\.(js|mjs|ts|cjs)$/, kind: "next" },
  { keys: ["nuxt"], label: "Nuxt", marker: /^nuxt\.config\.(js|mjs|ts)$/, kind: "nuxt" },
  { keys: ["astro"], label: "Astro", marker: /^astro\.config\.(js|mjs|ts)$/, kind: "astro" },
  { keys: ["@sveltejs/kit"], label: "SvelteKit", marker: /^svelte\.config\.(js|mjs|ts)$/, kind: "vite" },
  { keys: ["@remix-run/react"], label: "Remix", marker: /^vite\.config\.(js|mjs|ts)$/, kind: "vite" },
  { keys: ["gatsby"], label: "Gatsby", marker: /^gatsby-config\.(js|mjs|ts)$/, kind: "gatsby" },
  { keys: ["react-scripts"], label: "Create React App", marker: null, kind: "cra" },
  { keys: ["@vue/cli-service"], label: "Vue CLI", marker: null, kind: "vue-cli" },
  { keys: ["vite"], label: "Vite", marker: /^vite\.config\.(js|mjs|ts|cjs|mts|cts)$/, kind: "vite" },
  { keys: ["react"], label: "React", marker: null, kind: "generic" },
];

const STATIC_CANDIDATES = [".", "dist", "build", "out", "public", "docs", "_site", "site"];

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

export function detectPackageManager(dir) {
  for (const entry of PM_FILES) {
    if (fs.existsSync(path.join(dir, entry.file))) return entry.name;
  }
  return "npm";
}

export function dependencyFingerprint(dir) {
  const pm = detectPackageManager(dir);
  const lockName = PM_FILES.find((entry) => entry.name === pm)?.file;
  const hash = createHash("sha256");
  let found = false;
  for (const file of ["package.json", lockName].filter(Boolean)) {
    try {
      hash.update(String(file) + "\u0000");
      hash.update(fs.readFileSync(path.join(dir, file)));
      found = true;
    } catch {}
  }
  if (!found) return null;
  return hash.digest("hex").slice(0, 16);
}

export function detectStaticEntry(dir) {
  for (const candidate of STATIC_CANDIDATES) {
    const indexFile = path.join(dir, candidate === "." ? "" : candidate, "index.html");
    if (fs.existsSync(indexFile) && fs.statSync(indexFile).isFile()) {
      return { dir: candidate === "." ? dir : path.join(dir, candidate), relativeDir: candidate === "." ? "" : candidate };
    }
  }
  return null;
}

function detectScriptKind(pkg, dir) {
  const deps = { ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}) };
  let best = null;
  for (const candidate of FRAMEWORKS) {
    if (!candidate.keys.some((key) => deps[key])) continue;
    const markerPresent =
      !candidate.marker ||
      (() => {
        try {
          return fs.readdirSync(dir).some((name) => candidate.marker.test(name));
        } catch {
          return false;
        }
      })();
    // Dependencies are authoritative; a config file just makes the match more certain.
    if (!best) best = candidate;
    if (markerPresent) {
      best = candidate;
      break;
    }
  }
  return best;
}

export function detectProject(dir) {
  const pkg = readJson(path.join(dir, "package.json"));
  const packageManager = detectPackageManager(dir);
  const scripts = pkg?.scripts || {};
  const devScript = scripts.dev ? "dev" : scripts.start ? "start" : null;
  const framework = detectScriptKind(pkg, dir);
  const staticEntry = detectStaticEntry(dir);
  const dependencyCount = Object.keys(pkg?.dependencies || {}).length + Object.keys(pkg?.devDependencies || {}).length;

  let type = "static";
  let label = "Static site";
  let kind = "static";
  if (pkg && devScript) {
    type = "server";
    label = framework?.label || "Custom dev server";
    kind = framework?.kind || "generic";
  } else if (pkg && staticEntry) {
    type = "static";
    label = "Static site";
    kind = "static";
  } else if (!pkg && staticEntry) {
    type = "static";
    label = "Static site";
    kind = "static";
  } else if (pkg) {
    type = "static";
    label = "Package project";
    kind = "static";
  } else {
    type = "static";
    label = "Static site";
    kind = "static";
  }

  return {
    type,
    kind,
    label,
    packageManager,
    packageName: pkg?.name || null,
    devScript,
    buildScript: scripts.build ? "build" : null,
    scriptCount: Object.keys(scripts).length,
    dependencyCount,
    needsInstall: packageManager !== "bun" ? dependencyCount > 0 : dependencyCount > 0,
    staticEntry,
    hasPackageJson: Boolean(pkg),
  };
}

export function installCommand(packageManager) {
  return INSTALL_COMMANDS[packageManager] || INSTALL_COMMANDS.npm;
}

/** Latest package.json command for the detected dev script (e.g. "vite"). */
export function devScriptCommand(detection, dir) {
  const pkg = readJson(path.join(dir, "package.json"));
  const script = detection?.devScript;
  if (!script || !pkg?.scripts) return "";
  return typeof pkg.scripts[script] === "string" ? pkg.scripts[script] : "";
}

function scriptInvocation(packageManager, script, extraArgs = []) {
  if (!script) return null;
  const args = ["run", script];
  if (!extraArgs.length) return { command: packageManager, args };
  // Only npm needs the `--` separator: it otherwise interprets flags that follow
  // the script name (e.g. `--port`) as npm's own options. pnpm, yarn and bun
  // forward everything after the script name verbatim, so adding `--` leaks a
  // literal `--` into the dev server - Vite (and other CAC-based CLIs) treat
  // that as "end of options" and silently ignore the port/host overrides.
  if (packageManager === "npm") {
    return { command: "npm", args: [...args, "--", ...extraArgs] };
  }
  return { command: packageManager, args: [...args, ...extraArgs] };
}

/**
 * Build the dev command and environment for a project directory.
 * The process must listen on the provided port and bind to all interfaces.
 */
export function devCommand(detection, port, worktreeDir) {
  const { packageManager, kind, devScript } = detection;
  const baseEnv = {
    PORT: String(port),
    HOST: "0.0.0.0",
    HOSTNAME: "0.0.0.0",
    BROWSER: "none",
    CI: "false",
    FORCE_COLOR: "0",
  };

  if (!devScript) {
    throw new HttpError(422, "This project has no dev script");
  }

  if (kind === "next") {
    return {
      ...scriptInvocation(packageManager, devScript, ["-p", String(port), "-H", "0.0.0.0"]),
      env: { ...baseEnv },
    };
  }
  if (kind === "vite" || kind === "astro") {
    return {
      ...scriptInvocation(packageManager, devScript, ["--port", String(port), "--host", "0.0.0.0", "--strictPort"]),
      env: { ...baseEnv },
    };
  }
  if (kind === "gatsby") {
    return {
      ...scriptInvocation(packageManager, devScript, ["-p", String(port), "-H", "0.0.0.0"]),
      env: { ...baseEnv },
    };
  }
  if (kind === "cra") {
    return {
      ...scriptInvocation(packageManager, devScript),
      env: { ...baseEnv, PORT: String(port), HOST: "0.0.0.0" },
    };
  }
  if (kind === "vue-cli") {
    return {
      ...scriptInvocation(packageManager, devScript),
      env: { ...baseEnv, PORT: String(port) },
    };
  }
  if (kind === "nuxt") {
    return {
      ...scriptInvocation(packageManager, devScript, ["--port", String(port), "--host", "0.0.0.0"]),
      env: { ...baseEnv },
    };
  }
  // Custom servers: expose PORT/HOST and hope the project honors them.
  return {
    ...scriptInvocation(packageManager, devScript),
    env: { ...baseEnv },
  };
}

export function devInstallPlan(detection, dir) {
  if (!detection.needsInstall) return null;
  if (fs.existsSync(path.join(dir, "node_modules"))) return null;
  return installCommand(detection.packageManager);
}
