import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  CANCELLED,
  folderDialogCandidates,
  parseDialogResult,
  pickFolder,
  resolveDialogStartFolder,
} from "../server/lib/folder-dialog.js";
import { request, startApp } from "./helpers.js";

function makeDir(prefix = "vercio-dialog-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test("dialog start folder prefers the current path, then parent, then home", { timeout: 30000 }, () => {
  const dir = makeDir();
  const nested = path.join(dir, "code", "acme-site");
  fs.mkdirSync(nested, { recursive: true });
  assert.equal(resolveDialogStartFolder(nested), nested);
  assert.equal(resolveDialogStartFolder(path.join(nested, "does-not-exist")), nested);
  assert.equal(resolveDialogStartFolder(""), os.homedir());
  assert.equal(resolveDialogStartFolder("~"), os.homedir());
  fs.rmSync(dir, { recursive: true, force: true });
});

test("macOS dialog command uses argv so user text never enters the AppleScript", { timeout: 30000 }, () => {
  const dir = makeDir();
  const prompt = 'Choose "repo" for Vercio';
  const [candidate] = folderDialogCandidates("darwin", { defaultPath: dir, prompt });
  assert.equal(candidate.command, "/usr/bin/osascript");
  assert.equal(candidate.args[0], "-e");
  const script = candidate.args[1];
  assert.match(script, /on run argv/);
  assert.match(script, /choose folder with prompt/);
  // Using Finder would trigger macOS automation permissions; the plain
  // Standard Additions dialog does not.
  assert.doesNotMatch(script, /Finder/);
  const separator = candidate.args.indexOf("--");
  assert.ok(separator > 0);
  assert.equal(candidate.args[separator + 1], dir);
  assert.equal(candidate.args[separator + 2], prompt);
  assert.ok(!script.includes(dir));
  assert.ok(!script.includes(prompt));
  fs.rmSync(dir, { recursive: true, force: true });
});

test("linux dialog commands fall back from zenity to kdialog", { timeout: 30000 }, () => {
  const dir = makeDir();
  const candidates = folderDialogCandidates("linux", { defaultPath: dir, prompt: "Pick a repo" });
  assert.deepEqual(
    candidates.map((candidate) => candidate.command),
    ["zenity", "kdialog"]
  );
  assert.ok(candidates[0].args.includes("--directory"));
  assert.ok(candidates[0].args.includes("--filename=" + dir + path.sep));
  assert.ok(candidates[1].args.includes(dir));
  fs.rmSync(dir, { recursive: true, force: true });
});

test("dialog output parsing handles picked, cancelled and failed results", { timeout: 30000 }, () => {
  const dir = makeDir();
  assert.deepEqual(parseDialogResult({ code: 0, stdout: dir + "\n" }), { path: dir });
  assert.deepEqual(parseDialogResult({ code: 0, stdout: CANCELLED + "\n" }), { cancelled: true });
  assert.deepEqual(parseDialogResult({ code: 1, stdout: "" }), { cancelled: true });
  assert.throws(
    () => parseDialogResult({ code: 2, stdout: "" }),
    (error) => error.status === 500 && error.details.code === "dialog-failed"
  );
  fs.rmSync(dir, { recursive: true, force: true });
});

test("pickFolder returns the chosen folder and treats dismissal as cancelled", { timeout: 30000 }, async () => {
  const dir = makeDir();
  const seen = [];
  const picked = await pickFolder({
    platform: "darwin",
    prompt: "Pick a folder",
    runner: async (candidate) => {
      seen.push(candidate);
      return { code: 0, stdout: dir + path.sep + "\n" };
    },
  });
  assert.equal(picked.path, dir);
  assert.equal(seen.length, 1);

  const cancelled = await pickFolder({
    platform: "darwin",
    runner: async () => ({ code: 0, stdout: CANCELLED }),
  });
  assert.deepEqual(cancelled, { cancelled: true });
  fs.rmSync(dir, { recursive: true, force: true });
});

test("pickFolder falls back to kdialog when zenity is missing", { timeout: 30000 }, async () => {
  const dir = makeDir();
  const commands = [];
  const result = await pickFolder({
    platform: "linux",
    runner: async (candidate) => {
      commands.push(candidate.command);
      if (candidate.command === "zenity") {
        const missing = new Error("spawn zenity ENOENT");
        missing.code = "ENOENT";
        throw missing;
      }
      return { code: 0, stdout: dir };
    },
  });
  assert.equal(result.path, dir);
  assert.deepEqual(commands, ["zenity", "kdialog"]);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("pickFolder reports unavailable or invalid dialogs with useful errors", { timeout: 30000 }, async () => {
  await assert.rejects(
    pickFolder({
      platform: "linux",
      runner: async () => {
        const missing = new Error("spawn zenity ENOENT");
        missing.code = "ENOENT";
        throw missing;
      },
    }),
    (error) => error.status === 501 && error.details.code === "unavailable"
  );

  await assert.rejects(
    pickFolder({
      platform: "darwin",
      runner: async () => {
        const denied = new Error("execution error");
        denied.code = "DIALOG_FAILED";
        denied.stderr = "execution error: No user interaction allowed. (-1713)";
        throw denied;
      },
    }),
    (error) => error.status === 501 && error.details.code === "unavailable"
  );

  const file = path.join(makeDir(), "readme.md");
  fs.writeFileSync(file, "hello");
  await assert.rejects(
    pickFolder({ platform: "darwin", runner: async () => ({ code: 0, stdout: file }) }),
    (error) => error.status === 400 && error.details.code === "not-directory"
  );
  fs.rmSync(path.dirname(file), { recursive: true, force: true });
});

test("pick-folder API delegates to the system dialog", { timeout: 60000 }, async (t) => {
  const calls = [];
  const ctx = await startApp({
    folderDialog: async (input) => {
      calls.push(input);
      if (input.defaultPath === "please-cancel") return { cancelled: true };
      return { path: os.tmpdir() };
    },
  });
  t.after(ctx.cleanup);

  const picked = await request(ctx.base, "POST", "/api/fs/pick-folder", {
    path: "~/code",
    prompt: "选择 Git 仓库",
  });
  assert.equal(picked.status, 200);
  assert.equal(picked.json.path, os.tmpdir());
  assert.equal(calls[0].defaultPath, "~/code");
  assert.equal(calls[0].prompt, "选择 Git 仓库");
  assert.ok(calls[0].signal instanceof AbortSignal);

  const cancelled = await request(ctx.base, "POST", "/api/fs/pick-folder", {
    path: "please-cancel",
  });
  assert.equal(cancelled.status, 200);
  assert.deepEqual(cancelled.json, { cancelled: true });

  const invalid = await request(ctx.base, "POST", "/api/fs/pick-folder", { path: 42 });
  assert.equal(invalid.status, 400);
  assert.equal(calls.length, 2);
});
