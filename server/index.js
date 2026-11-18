import { execFile } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensureDirs, resolveConfig } from "./lib/config.js";
import { DeploymentManager } from "./lib/deployments.js";
import { EventHub } from "./lib/events.js";
import { pickFolder } from "./lib/folder-dialog.js";
import { getLanAddresses } from "./lib/lan.js";
import { ProjectsManager } from "./lib/projects.js";
import { Store } from "./lib/store.js";
import { createRequestHandler } from "./routes.js";

const here = fileURLToPath(import.meta.url);

function dim(text) {
  return "\u001b[2m" + text + "\u001b[0m";
}
function bold(text) {
  return "\u001b[1m" + text + "\u001b[0m";
}
function cyan(text) {
  return "\u001b[36m" + text + "\u001b[0m";
}
function green(text) {
  return "\u001b[32m" + text + "\u001b[0m";
}
function gray(text) {
  return "\u001b[90m" + text + "\u001b[0m";
}

export async function createVercioApp(options = {}) {
  const config = resolveConfig(options);
  ensureDirs(config);
  if (config.dirs.repos) fs.mkdirSync(config.dirs.repos, { recursive: true });

  const store = new Store(config.dbFile);
  const events = new EventHub();
  const deployments = new DeploymentManager({ store, events, config });
  const projects = new ProjectsManager({ store, events, config, deployments });
  const runtime = { port: config.port, host: config.host };
  const handler = createRequestHandler({
    store,
    events,
    config,
    projects,
    deployments,
    runtime,
    folderDialog: options.folderDialog || pickFolder,
  });
  const server = http.createServer((req, res) => {
    handler(req, res).catch((error) => {
      console.error("[vercio] unhandled request error", error);
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: { status: 500, message: "Internal server error" } }));
      } else {
        try { res.end(); } catch {}
      }
    });
  });
  server.on("clientError", (error, socket) => {
    try {
      socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
    } catch {}
  });

  function listen() {
    return new Promise((resolve, reject) => {
      const onError = (error) => {
        server.off("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        server.off("error", onError);
        const address = server.address();
        if (address && typeof address === "object") {
          runtime.port = address.port;
          config.port = address.port;
        }
        resolve(runtime);
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(config.port, config.host);
    });
  }

  async function close() {
    events.closeAll();
    deployments.stopAll();
    store.flush();
    await new Promise((resolve) => server.close(() => resolve()));
  }

  return { server, config, store, events, projects, deployments, runtime, listen, close };
}

export async function startServer(options = {}) {
  const app = await createVercioApp(options);
  const { config, runtime } = app;
  try {
    await app.listen();
  } catch (error) {
    if (error.code === "EADDRINUSE") {
      console.error(
        "\n  Port " + config.port + " is already in use. Try: VERCIO_PORT=4001 npm start\n"
      );
      process.exit(1);
    }
    throw error;
  }
  const lan = getLanAddresses();
  const lanUrl = lan[0] ? "http://" + lan[0].address + ":" + runtime.port : null;
  console.log("");
  console.log("  " + bold("▲") + " " + bold("Vercio") + " " + dim(config.version) + "  " + gray("local-first frontend collaboration"));
  console.log("");
  console.log("  " + green("●") + "  Local    " + cyan("http://localhost:" + runtime.port));
  if (lanUrl) console.log("  " + green("●") + "  Network  " + cyan(lanUrl) + "  " + dim("(share on your Wi-Fi)"));
  else console.log("  " + gray("○") + "  Network  " + gray("no LAN address found"));
  console.log("  " + gray("○") + "  Data     " + gray(config.dataDir));
  console.log("");
  console.log("  " + dim("Press Ctrl+C to stop all previews."));
  console.log("");

  if (options.open) {
    try {
      if (process.platform === "darwin") execFile("open", ["http://localhost:" + runtime.port]);
      else if (process.platform === "win32") execFile("cmd", ["/c", "start", "", "http://localhost:" + runtime.port]);
      else execFile("xdg-open", ["http://localhost:" + runtime.port]);
    } catch {}
  }

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log("\n  " + gray("Stopping previews and saving state..."));
    const force = setTimeout(() => process.exit(0), 5000);
    force.unref?.();
    try {
      await app.close();
    } catch {}
    process.exit(0);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("uncaughtException", (error) => {
    console.error("[vercio] uncaught exception", error);
  });
  return app;
}

function parseCliArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--port" || arg === "-p") options.port = Number(argv[++index]);
    else if (arg === "--host") options.host = argv[++index];
    else if (arg === "--data-dir") options.dataDir = argv[++index];
    else if (arg === "--open" || arg === "-o") options.open = true;
  }
  return options;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(here);
if (isMain) {
  startServer(parseCliArgs(process.argv.slice(2))).catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
