import assert from "node:assert/strict";
import test from "node:test";
import {
  collectLanAddresses,
  compareLanAddresses,
  getTunnelInterfaces,
  isLoopbackHost,
  isLoopbackRemote,
  isUsableLanAddress,
  isWildcardHost,
  normalizeRemoteAddress,
  rankLanAddress,
} from "../server/lib/lan.js";

function iface(address, family = "IPv4", internal = false) {
  return {
    address,
    family,
    internal,
    netmask: family === "IPv4" || family === 4 ? "255.255.255.0" : "ffff:ffff:ffff:ffff::",
    mac: "00:00:00:00:00:00",
  };
}

test("usable LAN addresses exclude loopback, link-local, fake-IP and CGNAT ranges", () => {
  for (const address of ["192.168.9.153", "10.1.2.3", "172.20.10.1", "203.0.113.5", "198.20.0.1", "100.128.0.0"]) {
    assert.equal(isUsableLanAddress(address), true, address);
  }
  for (const address of [
    "127.0.0.1",
    "0.0.0.0",
    "169.254.10.1",
    "198.18.0.0",
    "198.19.255.255",
    "100.64.0.1",
    "100.127.255.255",
    "",
    null,
    undefined,
  ]) {
    assert.equal(isUsableLanAddress(address), false, String(address));
  }
});

test("LAN address ranking prefers private Wi-Fi addresses over tunnels and public IPs", () => {
  assert.equal(rankLanAddress({ name: "en0", address: "192.168.9.153" }), 0);
  assert.equal(rankLanAddress({ name: "wlan0", address: "10.0.0.5" }), 0);
  assert.equal(rankLanAddress({ name: "en5", address: "10.0.0.5" }), 1);
  assert.equal(rankLanAddress({ name: "en0", address: "203.0.113.5" }), 10);
  assert.ok(
    compareLanAddresses(
      { name: "en0", address: "192.168.9.153" },
      { name: "en5", address: "10.0.0.5" }
    ) < 0
  );
});

test("address collection skips virtual interfaces and sorts real candidates", () => {
  const addresses = collectLanAddresses({
    lo0: [iface("127.0.0.1", "IPv4", true)],
    utun4: [iface("198.18.0.0")],
    docker0: [iface("172.17.0.1")],
    en5: [iface("10.0.0.5")],
    en9: [iface("169.254.3.2")],
    en0: [iface("fe80::1", "IPv6"), iface("192.168.9.153")],
  });
  assert.deepEqual(addresses, [
    { name: "en0", address: "192.168.9.153" },
    { name: "en5", address: "10.0.0.5" },
  ]);
});

test("VPN/TUN detection only reports tunnel devices with a routable IPv4 address", () => {
  const tunnels = getTunnelInterfaces({
    en0: [iface("192.168.9.153")],
    utun3: [],
    utun4: [iface("198.18.0.0")],
    Clash: [iface("198.18.0.0")],
    tun0: [iface("100.64.0.1")],
  });
  assert.deepEqual(tunnels, [
    { name: "utun4", address: "198.18.0.0" },
    { name: "Clash", address: "198.18.0.0" },
    { name: "tun0", address: "100.64.0.1" },
  ]);
});

test("remote addresses are normalised for the LAN client log", () => {
  assert.equal(normalizeRemoteAddress("::ffff:192.168.9.150"), "192.168.9.150");
  assert.equal(normalizeRemoteAddress("::FFFF:192.168.9.150"), "192.168.9.150");
  assert.equal(normalizeRemoteAddress("fe80::1%en0"), "fe80::1");
  assert.equal(normalizeRemoteAddress("192.168.9.150"), "192.168.9.150");
  assert.equal(isLoopbackRemote("::ffff:127.0.0.1"), true);
  assert.equal(isLoopbackRemote("::1"), true);
  assert.equal(isLoopbackRemote("192.168.9.150"), false);
  assert.equal(isLoopbackRemote(""), true);
});

test("host helpers tell wildcard, loopback and specific binds apart", () => {
  assert.equal(isWildcardHost("0.0.0.0"), true);
  assert.equal(isWildcardHost("::"), true);
  assert.equal(isWildcardHost(""), true);
  assert.equal(isWildcardHost("192.168.9.153"), false);
  assert.equal(isWildcardHost("127.0.0.1"), false);

  assert.equal(isLoopbackHost("127.0.0.1"), true);
  assert.equal(isLoopbackHost("localhost"), true);
  assert.equal(isLoopbackHost("127.0.1.1"), true);
  assert.equal(isLoopbackHost(""), true);
  assert.equal(isLoopbackHost("0.0.0.0"), false);
  assert.equal(isLoopbackHost("192.168.9.153"), false);
});
