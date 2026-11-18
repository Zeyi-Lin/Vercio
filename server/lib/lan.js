import { execFile } from "node:child_process";
import os from "node:os";
import QRCode from "qrcode";

const VIRTUAL_INTERFACE = /^(utun|llw|awdl|bridge|vmnet|ap|tap|tun|gif|stf|p2p|veth|docker|br-|anpi)/i;

export function getLanAddresses() {
  const interfaces = os.networkInterfaces();
  const result = [];
  for (const [name, addresses] of Object.entries(interfaces)) {
    if (VIRTUAL_INTERFACE.test(name)) continue;
    for (const address of addresses || []) {
      if (address.family !== "IPv4" && address.family !== 4) continue;
      if (address.internal) continue;
      result.push({ name, address: address.address });
    }
  }
  const score = (entry) => {
    const wifi = /^(en0|en1|wlan0|wlp|Wi-Fi)/i.test(entry.name) ? 0 : 1;
    return wifi;
  };
  result.sort((a, b) => score(a) - score(b) || a.name.localeCompare(b.name));
  return result;
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
  const urls = lan.map((entry) => ({
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
