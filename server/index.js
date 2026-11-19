import { execFile } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensureDirs, resolveConfig } from "./lib/config.js";
import { DeploymentManager } from "./lib/deployments.js";
import { EventHub } from "./lib/events.js";
import { pickFolder } from "./lib/folder-dialog.js";
import {
  getLanAddresses,
  getTunnelInterfaces,
  isLoopbackHost,
  isLoopbackRemote,
  isWildcardHost,
  normalizeRemoteAddress,
} from "./lib/lan.js";
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
    logLanClient(req);
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

  // Seeing this line means another device really did reach the server. If a
  // phone on the same Wi-Fi shows a spinner and this never appears, the
  // request is being dropped before it gets here (router isolation, a VPN/TUN
  // on either side, or a client without local-network permission).
  const seenLanClients = new Set();
  function logLanClient(req) {
    const remote = normalizeRemoteAddress(req.socket && req.socket.remoteAddress);
    if (!remote || isLoopbackRemote(remote) || seenLanClients.has(remote)) return;
    seenLanClients.add(remote);
    console.log(
      "  " + green("●") + "  " + dim("LAN client") + " " + cyan(remote) +
        "  " + gray((req.method || "GET") + " " + (req.url || "/"))
    );
  }

  function bindOnce(host, options) {
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
      server.listen({ port: config.port, host, ...options });
    });
  }

  function canConnect(host, port) {
    return new Promise((resolve) => {
      const socket = net.connect({ host, port });
      const done = (ok) => {
        socket.destroy();
        resolve(ok);
      };
      socket.setTimeout(750, () => done(false));
      socket.once("connect", () => done(true));
      socket.once("error", () => done(false));
    });
  }

  async function listen() {
    const host = config.host || "0.0.0.0";
    if (!isWildcardHost(host)) return bindOnce(host);
    // Dual-stack: one socket for IPv4 and IPv6. macOS also resolves `.local`
    // hostnames to IPv6 link-local addresses, which an IPv4-only listener
    // silently refuses.
    try {
      const result = await bindOnce("::", { ipv6Only: false });
      if (await canConnect("127.0.0.1", result.port)) return result;
      // The OS accepted the IPv6 wildcard but is not mapping IPv4 onto it.
      await new Promise((resolve) => server.close(() => resolve()));
    } catch (error) {
      if (!["EAFNOSUPPORT", "EADDRNOTAVAIL", "EPROTONOSUPPORT", "EINVAL"].includes(error.code)) {
        throw error;
      }
    }
    return bindOnce("0.0.0.0");
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
  const loopbackOnly = isLoopbackHost(config.host) && !isWildcardHost(config.host);
  console.log("");
  console.log("  " + bold("▲") + " " + bold("Vercio") + " " + dim(config.version) + "  " + gray("local-first frontend collaboration"));
  console.log("");
  console.log("  " + green("●") + "  Local    " + cyan("http://localhost:" + runtime.port));
  if (loopbackOnly) {
    console.log("  " + gray("○") + "  Network  " + gray("disabled — bound to " + config.host));
    console.log("  " + dim("     Restart with --host 0.0.0.0 (or VERCIO_HOST=0.0.0.0) to share on your Wi-Fi."));
  } else if (lan.length) {
    for (const entry of lan) {
      console.log(
        "  " + green("●") + "  Network  " + cyan("http://" + entry.address + ":" + runtime.port) +
          "  " + dim("(" + entry.name + ")")
      );
    }
  } else {
    console.log("  " + gray("○") + "  Network  " + gray("no LAN address found"));
  }
  if (lan.length && !loopbackOnly) {
    const tunnels = getTunnelInterfaces();
    if (tunnels.length) {
      console.log("");
      console.log(
        "  " + gray("!") + "  " +
          dim("VPN/TUN detected: " + tunnels.map((entry) => entry.name + " " + entry.address).join(", "))
      );
      console.log("  " + dim("     If a phone on the same Wi-Fi cannot open a Network URL above:"));
      console.log("  " + dim("     - exclude 192.168.0.0/16 (10.0.0.0/8, 172.16.0.0/12) from the tunnel,"));
      console.log("  " + dim("     - turn off strict routing, or quit the proxy and retry."));
    }
  }
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
