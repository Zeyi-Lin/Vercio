import fs from "node:fs";
import path from "node:path";
import { runGit } from "./git.js";
import { HttpError } from "./http.js";

const AUTHORS = [
  { name: "Maya Chen", email: "maya@lumen.local" },
  { name: "Arjun Patel", email: "arjun@lumen.local" },
  { name: "Sofia Reyes", email: "sofia@lumen.local" },
  { name: "Noah Kim", email: "noah@lumen.local" },
];

const DAY = 24 * 60 * 60 * 1000;

async function clearRepo(repoDir) {
  const entries = await fs.promises.readdir(repoDir);
  await Promise.all(
    entries
      .filter((entry) => entry !== ".git")
      .map((entry) =>
        fs.promises.rm(path.join(repoDir, entry), { recursive: true, force: true })
      )
  );
}

async function copyFrom(sourceDir, destDir) {
  const entries = await fs.promises.readdir(sourceDir);
  for (const entry of entries) {
    if (entry.startsWith("_") || entry === ".DS_Store") continue;
    await fs.promises.cp(path.join(sourceDir, entry), path.join(destDir, entry), {
      recursive: true,
      force: true,
      filter: (src) => !src.includes(".DS_Store"),
    });
  }
}

function demoReadme(manifest) {
  const rows = manifest
    .map((entry) => "| " + entry.branch + " | " + entry.message + " |")
    .join("\n");
  return [
    "# Lumen",
    "",
    "**AI meeting notes for teams that ship.**",
    "",
    "Lumen turns every call into decisions, owners, and follow-ups - without anybody touching a note template.",
    "",
    "This repository is the bundled Vercio demo. Every branch is a different iteration of the marketing site, so you can watch the frontend change as you switch branches.",
    "",
    "| Branch | Last change |",
    "| --- | --- |",
    rows,
    "",
    "Run it with the Vercio preview engine, or locally with npm run dev.",
    "",
  ].join("\n");
}

async function commitAt(repoDir, options) {
  await runGit(["add", "-A"], repoDir);
  await runGit(["commit", "-m", options.message], repoDir, {
    env: {
      GIT_AUTHOR_NAME: options.author.name,
      GIT_AUTHOR_EMAIL: options.author.email,
      GIT_COMMITTER_NAME: options.author.name,
      GIT_COMMITTER_EMAIL: options.author.email,
      GIT_AUTHOR_DATE: options.date,
      GIT_COMMITTER_DATE: options.date,
    },
  });
}

/**
 * Builds a real git repository with several branches from the bundled demo assets.
 * The repository is created once inside the data directory and reused afterwards.
 */
export async function seedDemoRepo(config) {
  const sourceDir = path.join(config.examplesDir, "demo");
  const manifestFile = path.join(sourceDir, "manifest.json");
  if (!fs.existsSync(manifestFile)) {
    throw new HttpError(500, "Demo assets are missing. Expected examples/demo/manifest.json");
  }
  let manifest;
  try {
    manifest = JSON.parse(await fs.promises.readFile(manifestFile, "utf8"));
  } catch (error) {
    throw new HttpError(500, "Could not read the demo manifest: " + error.message);
  }
  if (!Array.isArray(manifest) || manifest.length < 2) {
    throw new HttpError(500, "The demo manifest needs at least two branches");
  }
  const repoDir = path.join(config.dirs.repos, "lumen-demo");
  if (fs.existsSync(path.join(repoDir, ".git"))) {
    return { repoPath: repoDir, manifest, seeded: false };
  }
  const sharedDir = path.join(sourceDir, "_shared");
  const variantsDir = path.join(sourceDir, "variants");
  if (!fs.existsSync(sharedDir) || !fs.existsSync(variantsDir)) {
    throw new HttpError(500, "Demo assets are incomplete");
  }
  await fs.promises.mkdir(config.dirs.repos, { recursive: true });
  await fs.promises.rm(repoDir, { recursive: true, force: true });
  await fs.promises.mkdir(repoDir, { recursive: true });
  await runGit(["init", "-b", "main"], repoDir);
  await runGit(["config", "user.name", "Lumen Design Team"], repoDir);
  await runGit(["config", "user.email", "design@lumen.local"], repoDir);

  const now = Date.now();
  let baseBranch = null;
  for (let index = 0; index < manifest.length; index += 1) {
    const entry = manifest[index];
    if (!entry.branch || !entry.variant) {
      throw new HttpError(500, "Demo manifest entries need branch and variant names");
    }
    const variantDir = path.join(variantsDir, entry.variant);
    if (!fs.existsSync(variantDir)) {
      throw new HttpError(500, "Demo variant is missing: " + entry.variant);
    }
    if (index === 0) {
      baseBranch = entry.branch;
      await clearRepo(repoDir);
    } else {
      await runGit(["checkout", "-B", entry.branch, baseBranch || "main"], repoDir);
      await clearRepo(repoDir);
    }
    await copyFrom(sharedDir, repoDir);
    await copyFrom(variantDir, repoDir);
    await fs.promises.writeFile(path.join(repoDir, "README.md"), demoReadme(manifest));
    await fs.promises.writeFile(path.join(repoDir, ".gitignore"), "node_modules/\n.vercio/\n");
    const daysAgo = Number(entry.daysAgo ?? manifest.length - index);
    const date = new Date(now - daysAgo * DAY - index * 3600 * 1000).toISOString();
    const author = AUTHORS[index % AUTHORS.length];
    await commitAt(repoDir, {
      message: entry.message || "Update the Lumen site",
      date,
      author,
    });
  }
  await runGit(["checkout", "main"], repoDir);
  return { repoPath: repoDir, manifest, seeded: true };
}
