#!/usr/bin/env node
/**
 * Lumen demo — zero-dependency static file server.
 *
 * Usage:
 *   node dev-server.mjs            # http://localhost:4321
 *   PORT=5000 node dev-server.mjs  # custom port
 *   HOST=127.0.0.1 node dev-server.mjs
 *
 * Serves files from the directory that contains this file, so the seeder can
 * drop dev-server.mjs + package.json + a variant at the root of a demo repo.
 */
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)));
const PORT = parsePort(process.env.PORT, 4321);
const HOST = process.env.HOST?.trim() || "0.0.0.0";
const VERBOSE = process.env.LUMEN_DEMO_VERBOSE === "1";

const MIME_TYPES = new Map([
  [".html", "text/html; charset=utf-8"],
  [".htm", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".ico", "image/x-icon"],
  [".woff2", "font/woff2"],
  [".woff", "font/woff"],
  [".webp", "image/webp"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".txt", "text/plain; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
]);

const NOT_FOUND_PAGE = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>404 — Lumen demo</title>
  <style>
    :root { color-scheme: light; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      padding: 24px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      background: #fbf9f5;
      color: #17150f;
    }
    main { max-width: 460px; text-align: center; }
    .mark {
      width: 40px; height: 40px; margin: 0 auto 22px;
      display: grid; place-items: center;
      border-radius: 12px;
      background: linear-gradient(135deg, #f59e0b, #f43f5e 55%, #8b5cf6);
      color: #fff; font-weight: 700; font-size: 20px;
    }
    h1 { font-size: 1.9rem; letter-spacing: -0.03em; margin: 0 0 10px; }
    p { color: #6f6a5f; line-height: 1.6; margin: 0 0 26px; }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.85em; background: #f0ebe0; padding: 2px 6px; border-radius: 5px; }
    a {
      display: inline-block; text-decoration: none; color: #fdfbf6;
      background: #17150f; padding: 11px 18px; border-radius: 999px;
      font-size: 14px; font-weight: 600;
    }
    a:hover { background: #2a261c; }
  </style>
</head>
<body>
  <main>
    <div class="mark" aria-hidden="true">L</div>
    <h1>This page doesn't exist.</h1>
    <p>The Lumen demo server couldn't find that file. Check the branch you're on, or head back to the landing page.</p>
    <a href="/">Back to the homepage</a>
    <p style="margin-top:22px"><code>GET 404</code></p>
  </main>
</body>
</html>
`;

function parsePort(raw, fallback) {
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  if (Number.isInteger(value) && value >= 0 && value <= 65535) return value;
  console.warn(`Ignoring invalid PORT=${raw}; using ${fallback}.`);
  return fallback;
}

function isInsideRoot(candidate) {
  return candidate === ROOT || candidate.startsWith(ROOT + sep);
}

function resolveRequestPath(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes("\0")) return null;
  const candidate = resolve(join(ROOT, decoded));
  return isInsideRoot(candidate) ? candidate : null;
}

async function statFile(path) {
  try {
    const stats = await stat(path);
    return stats.isFile() ? { filePath: path, stats } : null;
  } catch {
    return null;
  }
}

async function findFile(candidate) {
  if (!candidate) return null;
  try {
    const stats = await stat(candidate);
    if (stats.isDirectory()) {
      return statFile(join(candidate, "index.html"));
    }
    if (stats.isFile()) return { filePath: candidate, stats };
  } catch {
    // fall through to the extensionless .html fallback below
  }
  if (extname(candidate) === "") {
    return statFile(candidate + ".html");
  }
  return null;
}

function contentTypeFor(filePath) {
  return MIME_TYPES.get(extname(filePath).toLowerCase()) ?? "application/octet-stream";
}

function send(res, status, headers, body) {
  res.writeHead(status, headers);
  res.end(body);
}

function sendNotFound(res, method) {
  send(
    res,
    404,
    {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Length": Buffer.byteLength(NOT_FOUND_PAGE),
      "Cache-Control": "no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
    method === "HEAD" ? undefined : NOT_FOUND_PAGE,
  );
}

const server = createServer(async (req, res) => {
  const startedAt = performance.now();
  const method = req.method ?? "GET";
  const requestUrl = req.url ?? "/";

  if (method !== "GET" && method !== "HEAD") {
    send(
      res,
      405,
      {
        "Content-Type": "text/plain; charset=utf-8",
        Allow: "GET, HEAD",
        "Cache-Control": "no-store, max-age=0",
      },
      "Method Not Allowed\n",
    );
    return;
  }

  try {
    const { pathname } = new URL(requestUrl, `http://${req.headers.host ?? "localhost"}`);
    const file = await findFile(resolveRequestPath(pathname));

    if (!file) {
      if (VERBOSE) console.warn(`  404 ${method} ${pathname}`);
      sendNotFound(res, method);
      return;
    }

    const headers = {
      "Content-Type": contentTypeFor(file.filePath),
      "Content-Length": String(file.stats.size),
      "Cache-Control": "no-store, max-age=0",
      Pragma: "no-cache",
      Expires: "0",
      "X-Content-Type-Options": "nosniff",
    };

    res.writeHead(200, headers);
    if (method === "HEAD") {
      res.end();
      return;
    }

    const stream = createReadStream(file.filePath);
    stream.on("error", (error) => {
      console.error(`Failed to read ${file.filePath}:`, error.message);
      res.destroy(error);
    });
    stream.pipe(res);

    if (VERBOSE) {
      const elapsed = Math.round(performance.now() - startedAt);
      console.log(`  200 ${method} ${requestUrl} ${elapsed}ms`);
    }
  } catch (error) {
    console.error("Request failed:", error);
    if (!res.headersSent) {
      send(
        res,
        500,
        { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
        "Internal Server Error\n",
      );
    } else {
      res.destroy();
    }
  }
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use. Start with PORT=<port> npm run dev to pick another one.`);
  } else {
    console.error("Lumen demo server failed:", error);
  }
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  const address = server.address();
  const actualPort = address && typeof address === "object" ? address.port : PORT;
  console.log(`Lumen demo ready on http://localhost:${actualPort}`);
  if (HOST !== "0.0.0.0") {
    console.log(`  bound to ${HOST}:${actualPort}`);
  }
});

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n${signal} received — shutting down Lumen demo.`);
  server.close(() => process.exit(0));
  // Never hang a watcher/terminal if a keep-alive connection refuses to close.
  setTimeout(() => process.exit(0), 1500).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
