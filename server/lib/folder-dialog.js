import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { HttpError } from "./http.js";

/** Marker printed by the dialog scripts when the user dismisses the dialog. */
export const CANCELLED = "__VERCIO_CANCELLED__";
const DEFAULT_PROMPT = "Choose a Git repository folder";
const DIALOG_TIMEOUT_MS = 5 * 60 * 1000;
const UNAVAILABLE_PATTERN =
  /not authorized to send apple events|no user interaction|not allowed to send apple events|application isn't running|\(-1743\)|\(-1713\)|\(-600\)/i;

function isDirectory(target) {
  try {
    return fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
}

export function expandHomePath(input) {
  const raw = String(input || "").trim();
  if (!raw) return "";
  if (raw === "~") return os.homedir();
  if (raw.startsWith("~/") || raw.startsWith("~\\")) {
    return path.join(os.homedir(), raw.slice(2));
  }
  return raw;
}

/**
 * The folder the native dialog should open in: the given path when it exists,
 * its parent when the path points at a file or a not-yet-existing location,
 * and the home folder as the final fallback.
 */
export function resolveDialogStartFolder(input) {
  const expanded = expandHomePath(input);
  if (!expanded) return os.homedir();
  const absolute = path.resolve(expanded);
  if (isDirectory(absolute)) return absolute;
  const parent = path.dirname(absolute);
  if (parent !== absolute && isDirectory(parent)) return parent;
  return os.homedir();
}

function powerShellString(value) {
  return "'" + String(value).replace(/'/g, "''") + "'";
}

// Argument-based AppleScript: the path and prompt are passed through argv, so
// no user-controlled text is ever interpolated into the script source.
const MACOS_DIALOG_SCRIPT = [
  "on run argv",
  "set startFolder to POSIX file (item 1 of argv)",
  "set dialogPrompt to item 2 of argv",
  "try",
  "set chosenFolder to choose folder with prompt dialogPrompt default location startFolder",
  "return POSIX path of chosenFolder",
  "on error number -128",
  "return " + JSON.stringify(CANCELLED),
  "end try",
  "end run",
].join("\n");

/**
 * Commands that show the operating system's own folder chooser. The first
 * candidate that can be spawned wins; Linux falls back from zenity to kdialog.
 */
export function folderDialogCandidates(platform, options = {}) {
  const startFolder = resolveDialogStartFolder(options.defaultPath);
  const prompt = String(options.prompt || DEFAULT_PROMPT)
    .replace(/[\r\n\t]+/g, " ")
    .slice(0, 160);

  if (platform === "darwin") {
    return [
      {
        command: "/usr/bin/osascript",
        args: ["-e", MACOS_DIALOG_SCRIPT, "--", startFolder, prompt],
      },
    ];
  }
  if (platform === "win32") {
    const script = [
      "Add-Type -AssemblyName System.Windows.Forms;",
      "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog;",
      "$dialog.Description = " + powerShellString(prompt) + ";",
      "$dialog.SelectedPath = " + powerShellString(startFolder) + ";",
      "$result = $dialog.ShowDialog();",
      "if ($result -eq [System.Windows.Forms.DialogResult]::OK) {",
      "  [Console]::Out.Write($dialog.SelectedPath)",
      "} else {",
      "  [Console]::Out.Write(" + powerShellString(CANCELLED) + ")",
      "}",
    ].join(" ");
    return [
      { command: "powershell.exe", args: ["-NoProfile", "-STA", "-Command", script] },
    ];
  }
  const trailingFolder = startFolder.endsWith(path.sep) ? startFolder : startFolder + path.sep;
  return [
    {
      command: "zenity",
      args: ["--file-selection", "--directory", "--title=" + prompt, "--filename=" + trailingFolder],
    },
    { command: "kdialog", args: ["--getexistingdirectory", startFolder, "--title", prompt] },
  ];
}

function cancelledResult() {
  return { cancelled: true };
}

/** Interprets dialog stdout for a successful chooser run. */
export function parseDialogResult(result) {
  const stdout = String(result?.stdout || "").trim();
  if (stdout === CANCELLED) return cancelledResult();
  if (result?.code === 0 && stdout) return { path: stdout };
  // zenity / kdialog exit with code 1 and no output when cancelled.
  if (result?.code === 1 && !stdout) return cancelledResult();
  throw new HttpError(500, "Could not open the system folder dialog", { code: "dialog-failed" });
}

function runDialogProcess(candidate, options = {}) {
  const { signal } = options;
  return new Promise((resolve, reject) => {
    const child = execFile(
      candidate.command,
      candidate.args,
      { timeout: DIALOG_TIMEOUT_MS, encoding: "utf8", maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        if (signal) signal.removeEventListener("abort", abort);
        if (!error) {
          resolve({ code: 0, stdout, stderr });
          return;
        }
        if (error.killed || error.signal === "SIGTERM") {
          error.code = "ETIMEDOUT";
        } else if (error.code === "ENOENT") {
          // Caller tries the next candidate dialog tool.
        } else if (error.code !== "ABORT_ERR") {
          error.code = "DIALOG_FAILED";
        }
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
      }
    );
    const abort = () => {
      try {
        child.kill("SIGTERM");
      } catch {}
    };
    if (signal) {
      if (signal.aborted) abort();
      else signal.addEventListener("abort", abort, { once: true });
    }
  });
}

/**
 * Opens the operating system's folder chooser on the machine that runs Vercio
 * and resolves with `{ path }` (absolute folder) or `{ cancelled: true }`.
 * `runner` is injectable so the dialog flow can be tested without a GUI.
 */
export async function pickFolder(options = {}) {
  const platform = options.platform || process.platform;
  const runner = options.runner || runDialogProcess;
  const candidates = folderDialogCandidates(platform, {
    defaultPath: options.defaultPath,
    prompt: options.prompt,
  });

  for (const candidate of candidates) {
    let result;
    try {
      result = await runner(candidate, { signal: options.signal });
    } catch (error) {
      if (error?.code === "ENOENT") continue; // Try the next dialog tool.
      if (error?.code === "ABORT_ERR") throw error;
      if (error?.code === "ETIMEDOUT") {
        throw new HttpError(504, "The system folder dialog timed out", { code: "timeout" });
      }
      const stderr = String(error?.stderr || "");
      if (/User canceled|\(-128\)/.test(stderr)) return cancelledResult();
      if (UNAVAILABLE_PATTERN.test(stderr)) {
        throw new HttpError(501, "The system folder dialog is not available on this machine", {
          code: "unavailable",
        });
      }
      throw new HttpError(500, "Could not open the system folder dialog", {
        code: "dialog-failed",
      });
    }

    const parsed = parseDialogResult(result);
    if (parsed.cancelled) return cancelledResult();
    const chosen = path.resolve(parsed.path);
    if (!isDirectory(chosen)) {
      throw new HttpError(400, "The selected path is not a folder", { code: "not-directory" });
    }
    return { path: chosen };
  }

  throw new HttpError(501, "No system folder dialog is available on this machine", {
    code: "unavailable",
  });
}
