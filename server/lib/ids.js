import { randomBytes } from "node:crypto";

const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";

export function newId(prefix = "id") {
  const bytes = randomBytes(10);
  let out = "";
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return prefix + "_" + out.slice(0, 12);
}

export function shortId(len = 6) {
  const bytes = randomBytes(8);
  let out = "";
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out.slice(0, len);
}
