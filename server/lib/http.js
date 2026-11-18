import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";

export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".cjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".wasm": "application/wasm",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".pdf": "application/pdf",
};

export function mimeType(file) {
  return MIME[path.extname(file).toLowerCase()] || "application/octet-stream";
}

export function sendJSON(res, status, data, headers = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(body);
}

export function sendError(res, status, message, details) {
  sendJSON(res, status, { error: { status, message, ...(details ? { details } : {}) } });
}

export async function readJSONBody(req, limit = 2 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, "Request body too large");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "Invalid JSON body");
  }
}

export function isInside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export async function serveStaticFile(req, res, filePath, { cacheControl = "no-store" } = {}) {
  let stat;
  try {
    stat = await fs.promises.stat(filePath);
  } catch {
    return false;
  }
  if (stat.isDirectory()) {
    return serveStaticFile(req, res, path.join(filePath, "index.html"), { cacheControl });
  }
  if (!stat.isFile()) return false;
  res.writeHead(200, {
    "Content-Type": mimeType(filePath),
    "Content-Length": stat.size,
    "Cache-Control": cacheControl,
    "X-Content-Type-Options": "nosniff",
  });
  if (req.method === "HEAD") {
    res.end();
    return true;
  }
  await new Promise((resolve) => {
    const stream = fs.createReadStream(filePath);
    stream.on("error", () => {
      try {
        res.destroy();
      } catch {}
      resolve();
    });
    stream.on("close", resolve);
    stream.pipe(res);
  });
  return true;
}

/**
 * Serve a directory with optional SPA fallback. Returns true when a response was sent.
 */
export async function serveStaticDir(req, res, rootDir, options = {}) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    sendError(res, 405, "Method not allowed");
    return true;
  }
  const url = new URL(req.url, "http://localhost");
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    sendError(res, 400, "Bad path");
    return true;
  }
  if (pathname.includes("\0")) {
    sendError(res, 400, "Bad path");
    return true;
  }
  let relative = pathname.replace(/^\/+/, "");
  if (relative === "" || relative.endsWith("/")) relative += "index.html";
  const filePath = path.resolve(rootDir, relative);
  if (!isInside(rootDir, filePath)) {
    sendError(res, 403, "Forbidden");
    return true;
  }
  const handled = await serveStaticFile(req, res, filePath, {
    cacheControl: options.cacheControl || "no-store",
  });
  if (handled) return true;
  if (options.spaFallback && !path.extname(relative)) {
    const fallback = path.join(rootDir, "index.html");
    if (fs.existsSync(fallback)) {
      return serveStaticFile(req, res, fallback, { cacheControl: "no-store" });
    }
  }
  if (options.notFoundPage && fs.existsSync(options.notFoundPage)) {
    const page = await fs.promises.readFile(options.notFoundPage);
    res.writeHead(404, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    res.end(page);
    return true;
  }
  sendError(res, 404, "Not found");
  return true;
}

export function streamToString(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on("data", (c) => chunks.push(c));
    stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    stream.on("error", reject);
  });
}

export { Readable };
