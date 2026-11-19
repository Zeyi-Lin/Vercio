import { execFile } from "node:child_process";
import os from "node:os";
import QRCode from "qrcode";

// Interfaces that never carry the Wi-Fi/LAN address we want to share. `utun`
// and friends are VPN/tunnel devices: advertising their fake IPs (Clash uses
// 198.18.0.0/15, Tailscale 100.64.0.0/10) sends phones to an address they can
// never reach.
const VIRTUAL_INTERFACE = /^(utun|llw|awdl|bridge|vmnet|ap|tap|tun|gif|stf|p2p|veth|docker|br-|anpi)/i;
const TUNNEL_INTERFACE = /^(utun|tun\d|tap\d|wg\d|tailscale|clash|mihomo|zerotier|ipsec)/i;

const PHYSICAL_INTERFACE = /^(en\d+|eth\d+|wlan\d+|wlp\w*|wl\w+)$/i;
const PREFERRED_INTERFACE = /^(en0|en1|wlan0|wlp\w*|wi-?fi)$/i;

const LINK_LOCAL = /^169\.254\./;
// 198.18.0.0/15 is reserved for benchmarking and is what Clash/sing-box use for
// their fake-IP DNS answers. Never a real LAN address.
const BENCHMARK_RANGE = /^198\.(?:18|19)\./;
// 100.64.0.0/10 (carrier-grade NAT) is Tailscale's address space.
const SHARED_RANGE = /^100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./;

export function isLoopbackAddress(value) {
  return value === "127.0.0.1" || value === "::1" || value === "localhost";
}

export function isWildcardHost(value) {
  return value === "" || value === "0.0.0.0" || value === "::" || value === "*";
}

export function isLoopbackHost(host) {
  const value = String(host || "").trim();
  if (!value || value === "localhost") return true;
  if (isLoopbackAddress(value)) return true;
  return /^127\./.test(value);
}

/**
 * True when an IPv4 address is worth sharing with other devices. Self-assigned
 * link-local addresses (169.254/16), Clash fake-IPs and Tailscale CGNAT
 * addresses all look like "a LAN address" to os.networkInterfaces() but are
 * unreachable from a phone on the same Wi-Fi.
 */
export function isUsableLanAddress(address) {
  if (!address || typeof address !== "string") return false;
  if (isLoopbackAddress(address) || address === "0.0.0.0") return false;
  if (LINK_LOCAL.test(address)) return false;
  if (BENCHMARK_RANGE.test(address)) return false;
  if (SHARED_RANGE.test(address)) return false;
  return true;
}

/**
 * Lower is better: private ranges first, then Wi-Fi/Ethernet style names, then
 * interface name so the output is stable across calls.
 */
export function rankLanAddress(entry) {
  const name = entry?.name || "";
  const address = entry?.address || "";
  const privateRange = /^(10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(address) ? 0 : 1;
  const physical = PREFERRED_INTERFACE.test(name) ? 0 : PHYSICAL_INTERFACE.test(name) ? 1 : 2;
  return privateRange * 10 + physical;
}

export function compareLanAddresses(a, b) {
  return (
    rankLanAddress(a) - rankLanAddress(b) ||
    String(a.name).localeCompare(String(b.name)) ||
    String(a.address).localeCompare(String(b.address))
  );
}

/** Pure version of getLanAddresses, so the filtering/ranking can be tested. */
export function collectLanAddresses(interfaces) {
  const result = [];
  for (const [name, addresses] of Object.entries(interfaces || {})) {
    if (VIRTUAL_INTERFACE.test(name)) continue;
    for (const address of addresses || []) {
      if (address.family !== "IPv4" && address.family !== 4) continue;
      if (address.internal) continue;
      if (!isUsableLanAddress(address.address)) continue;
      result.push({ name, address: address.address });
    }
  }
  result.sort(compareLanAddresses);
  return result;
}

export function getLanAddresses() {
  return collectLanAddresses(os.networkInterfaces());
}

/**
 * VPN/TUN interfaces that currently carry an IPv4 address. A system-wide TUN
 * proxy can silently swallow LAN traffic, which shows up as "the server is
 * running but my phone on the same Wi-Fi cannot open it".
 */
export function getTunnelInterfaces(interfaces = os.networkInterfaces()) {
  const found = [];
  for (const [name, addresses] of Object.entries(interfaces || {})) {
    if (!TUNNEL_INTERFACE.test(name)) continue;
    for (const address of addresses || []) {
      if (address.family !== "IPv4" && address.family !== 4) continue;
      if (address.internal || !address.address) continue;
      found.push({ name, address: address.address });
    }
  }
  return found;
}

/** Turn `::ffff:192.168.9.150` / `fe80::1%en0` into something human-readable. */
export function normalizeRemoteAddress(value) {
  const raw = String(value || "");
  const withoutZone = raw.split("%")[0];
  if (withoutZone.toLowerCase().startsWith("::ffff:")) return withoutZone.slice(7);
  return withoutZone;
}

export function isLoopbackRemote(value) {
  const address = normalizeRemoteAddress(value);
  if (!address) return true;
  return address === "::1" || address === "127.0.0.1" || /^127\./.test(address);
}

function execWithTimeout(command, args, timeoutMs = 1500) {
  return new Promise((resolve) => {
    execFile(command, args, { timeout: timeoutMs }, (error, stdout) => {
      resolve(error ? "" : String(stdout || "").trim());
    });
  });
}

export async function getWifiName() {
  if (process.platform !== "darwin") return "";
  try {
    const output = await execWithTimeout("networksetup", ["-getairportnetwork", "en0"]);
    const match = output.match(/Current Wi-Fi Network:\s*(.+)/i);
    if (match && !/redacted/i.test(match[1])) return match[1].trim();
    const output2 = await execWithTimeout("ipconfig", ["getsummary", "en0"]);
    const match2 = output2.match(/SSID\s*:\s*(.+)/i);
    if (match2 && !/redacted/i.test(match2[1])) return match2[1].trim();
    return "";
  } catch {
    return "";
  }
}

const qrCache = new Map();

export async function qrDataUrl(url) {
  if (qrCache.has(url)) return qrCache.get(url);
  const dataUrl = await QRCode.toDataURL(url, {
    margin: 1,
    width: 360,
    errorCorrectionLevel: "M",
    color: { dark: "#000000ff", light: "#ffffffff" },
  });
  qrCache.set(url, dataUrl);
  if (qrCache.size > 8) qrCache.delete(qrCache.keys().next().value);
  return dataUrl;
}

export async function getSystemInfo({ config, port, projectCount = 0, runningCount = 0, noteCount = 0 }) {
  const lan = getLanAddresses();
  const host = config?.host || "0.0.0.0";
  // Only advertise addresses the server can actually be reached on. When the
  // server is bound to loopback (or to one specific address), the other LAN
  // addresses are dead links, so show the local URL instead.
  const boundToLoopback = isLoopbackHost(host);
  const boundAddress = boundToLoopback || isWildcardHost(host) ? null : host;
  const reachable = boundToLoopback
    ? []
    : lan.filter((entry) => !boundAddress || entry.address === boundAddress);
  const urls = reachable.map((entry) => ({
    ...entry,
    url: "http://" + entry.address + ":" + port,
  }));
  const primary = urls[0]?.url || "http://localhost:" + port;
  const [wifi, qr] = await Promise.all([
    getWifiName(),
    qrDataUrl(primary).catch(() => null),
  ]);
  return {
    hostname: os.hostname(),
    platform: process.platform,
    release: os.release(),
    port,
    node: process.version,
    version: config.version,
    localUrl: "http://localhost:" + port,
    lanUrls: urls,
    primaryUrl: primary,
    wifiName: wifi,
    qrDataUrl: qr,
    dataDir: config.dataDir,
    projectCount,
    runningCount,
    noteCount,
    maxPreviews: config.maxRunningDevServers,
  };
}
