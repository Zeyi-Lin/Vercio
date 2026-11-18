import net from "node:net";

const reserved = new Set();

function canListen(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once("error", () => resolve(false));
    server.listen({ port, host: "0.0.0.0" }, () => {
      server.close(() => resolve(true));
    });
  });
}

export async function findFreePort(range = [4100, 4999], used = new Set()) {
  const [start, end] = range;
  for (let port = start; port <= end; port += 1) {
    if (reserved.has(port) || used.has(port)) continue;
    // eslint-disable-next-line no-await-in-loop
    if (await canListen(port)) {
      reserved.add(port);
      return port;
    }
  }
  throw new Error("No free preview port available between " + start + " and " + end);
}

export function reservePort(port) {
  if (port) reserved.add(port);
}

export function releasePort(port) {
  if (port) reserved.delete(port);
}

export function resetPortPool() {
  reserved.clear();
}

export function waitForHttp(port, { timeoutMs = 120000, intervalMs = 350, host = "127.0.0.1", signal } = {}) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    let finished = false;
    const poll = async () => {
      if (finished) return;
      if (signal?.aborted) {
        finished = true;
        reject(new Error("Preview cancelled"));
        return;
      }
      let responded = false;
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 1500);
        const response = await fetch("http://" + host + ":" + port + "/", {
          signal: controller.signal,
          redirect: "manual",
        });
        clearTimeout(timer);
        responded = Boolean(response.status);
        try { await response.body?.cancel(); } catch {}
      } catch {
        responded = false;
      }
      if (responded) {
        finished = true;
        resolve(true);
        return;
      }
      if (Date.now() - started > timeoutMs) {
        finished = true;
        reject(new Error("Timed out waiting for the dev server on port " + port));
        return;
      }
      setTimeout(poll, intervalMs);
    };
    poll();
  });
}

export async function isPortResponding(port) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1200);
    const response = await fetch("http://127.0.0.1:" + port + "/", {
      signal: controller.signal,
      redirect: "manual",
    });
    clearTimeout(timer);
    try { await response.body?.cancel(); } catch {}
    return true;
  } catch {
    return false;
  }
}
