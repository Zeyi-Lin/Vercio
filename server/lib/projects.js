import fs from "node:fs";
import path from "node:path";
import { slugify } from "./config.js";
import { seedDemoRepo } from "./demo.js";
import {
  cloneRepo,
  fetchRepo,
  getRepoInfo,
  headSha,
  isGitRepo,
  listBranches,
  normalizeSource,
  readReadme,
} from "./git.js";
import { HttpError } from "./http.js";
import { newId, shortId } from "./ids.js";

function nowIso() {
  return new Date().toISOString();
}

const DEMO_DESCRIPTION = [
  "Lumen turns every call into decisions, owners, and follow-ups - without anyone touching a note template.",
  "",
  "This is the bundled Vercio demo repository. Every branch is a different iteration of the Lumen marketing site:",
  "",
  "- **main** - the current production landing page.",
  "- **feat/aurora-hero** - a bolder hero with an animated aurora backdrop and refreshed positioning.",
  "- **feat/pricing-v2** - monthly/annual pricing toggle with three new tiers.",
  "- **fix/mobile-nav** - a working mobile navigation and responsive polish.",
  "",
  "Pick any branch in the Previews tab to see its frontend. Notes and comments are seeded so you can try out the collaboration features.",
].join("\n");

const DEMO_NOTES = [
  {
    title: "Launch checklist",
    tags: ["launch", "marketing"],
    pinned: true,
    body: [
      "## Shipping the new site",
      "",
      "- [x] Aurora hero pass on **feat/aurora-hero**",
      "- [x] Pricing page rewrite",
      "- [ ] Final mobile nav QA on real devices",
      "- [ ] Swap the production branch once mobile is signed off",
      "",
      "> Reminder: previews are isolated git worktrees, so every branch runs at the same time.",
      "",
      "### Owners",
      "",
      "| Area | Owner |",
      "| --- | --- |",
      "| Hero & motion | Maya |",
      "| Pricing | Arjun |",
      "| Mobile | Sofia |",
    ].join("\n"),
  },
  {
    title: "Design review - aurora hero",
    tags: ["design", "review"],
    pinned: false,
    branch: "feat/aurora-hero",
    body: [
      "## What changed",
      "",
      "The hero now uses a slow-moving aurora gradient instead of the flat mesh. Headline is shorter and product-led.",
      "",
      "**Questions for review**",
      "",
      "1. Is the aurora too loud behind the primary CTA?",
      "2. Should the logo cloud move above the fold?",
      "3. Mobile: reduce the blur radius to keep the first paint fast.",
      "",
      "CSS note: the aurora layer uses a 24s ease-in-out drift animation.",
    ].join("\n"),
  },
  {
    title: "Positioning & voice",
    tags: ["product"],
    pinned: false,
    body: [
      "## One-liner",
      "",
      "Lumen is where team meetings turn into shipped work.",
      "",
      "## Audience",
      "",
      "Product teams of 5-50 who live in calls but hate writing recap docs.",
      "",
      "## Voice",
      "",
      "Direct, warm, zero corporate gloss. Short sentences. Verbs first.",
    ].join("\n"),
  },
];

const DEMO_COMMENT = {
  branch: "feat/aurora-hero",
  author: "Maya Chen",
  body: "The new hero direction is so much stronger. Can we try a darker aurora on mobile before we ship it?",
};

export class ProjectsManager {
  constructor({ store, events, config, deployments }) {
    this.store = store;
    this.events = events;
    this.config = config;
    this.deployments = deployments;
    this.importing = new Map();
    this.migratePinnedBranches();
    this.recoverInterrupted();
  }

  // Older databases stored a single pinned branch as `pinnedBranch`. Fold it
  // into the `pinnedBranches` array so the rest of the server only sees one shape.
  migratePinnedBranches() {
    let changed = false;
    for (const project of this.store.get().projects) {
      if (!Array.isArray(project.pinnedBranches)) {
        const legacy =
          typeof project.pinnedBranch === "string" ? project.pinnedBranch.trim() : "";
        project.pinnedBranches = legacy ? [legacy] : [];
        changed = true;
      }
      if (Object.prototype.hasOwnProperty.call(project, "pinnedBranch")) {
        delete project.pinnedBranch;
        changed = true;
      }
    }
    if (changed) this.store.markDirty();
  }

  recoverInterrupted() {
    let changed = false;
    for (const project of this.store.get().projects) {
      if (project.status === "importing") {
        project.status = "error";
        project.error = "Import was interrupted by a server restart. Try again.";
        project.updatedAt = nowIso();
        changed = true;
      }
    }
    if (changed) this.store.markDirty();
  }

  emit(project, type = "project.updated") {
    this.events.emit(type, { projectId: project.id, status: project.status });
  }

  toPublic(project) {
    return {
      id: project.id,
      name: project.name,
      source: project.source,
      repoPath: project.repoPath,
      defaultBranch: project.defaultBranch,
      currentBranch: project.currentBranch,
      originUrl: project.originUrl || "",
      dirtyCount: project.dirtyCount || 0,
      branchCount: project.branchCount || 0,
      pinnedBranches: Array.isArray(project.pinnedBranches) ? project.pinnedBranches : [],
      framework: project.framework || null,
      description: project.description || "",
      tagline: project.tagline || "",
      links: project.links || [],
      status: project.status,
      error: project.error || null,
      isDemo: Boolean(project.isDemo),
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      latestCommit: project.latestCommit || null,
    };
  }

  list() {
    return this.store
      .get()
      .projects.slice()
      .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""))
      .map((project) => this.toPublic(project));
  }

  get(id) {
    const project = this.store.get().projects.find((item) => item.id === id);
    if (!project) throw new HttpError(404, "Project not found");
    return project;
  }

  async updateGitMeta(project) {
    const info = await getRepoInfo(project.repoPath);
    const branchInfo = await listBranches(project.repoPath);
    project.defaultBranch = branchInfo.defaultBranch || info.defaultBranch;
    project.currentBranch = info.currentBranch;
    project.originUrl = info.originUrl;
    project.dirtyCount = info.dirtyCount;
    project.branchCount = branchInfo.branches.length;
    const production =
      branchInfo.branches.find((branch) => branch.isDefault) || branchInfo.branches[0];
    if (production) {
      project.latestCommit = {
        shortSha: production.shortSha,
        message: production.subject,
        author: production.author,
        date: production.date,
        timestamp: production.timestamp,
        branch: production.name,
      };
    }
    project.updatedAt = nowIso();
    this.store.markDirty();
    return project;
  }

  async create(options = {}) {
    const normalized = normalizeSource(options.source);
    if (normalized.kind === "path") {
      let stat;
      try {
        stat = await fs.promises.stat(normalized.path);
      } catch {
        throw new HttpError(400, "That folder does not exist");
      }
      if (!stat.isDirectory()) throw new HttpError(400, "That path is not a folder");
      if (!(await isGitRepo(normalized.path))) {
        throw new HttpError(422, "This folder is not a git repository");
      }
      if (!(await headSha(normalized.path))) {
        throw new HttpError(422, "This repository has no commits yet");
      }
      const project = {
        id: newId("prj"),
        name: (options.name && String(options.name).trim()) || normalized.name,
        source: { kind: "path", input: String(options.source).trim(), path: normalized.path },
        repoPath: normalized.path,
        description: "",
        tagline: "",
        links: [],
        pinnedBranches: [],
        status: "ready",
        error: null,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      await this.updateGitMeta(project);
      this.store.get().projects.push(project);
      this.store.markDirty();
      this.emit(project, "project.created");
      return this.toPublic(project);
    }

    const destDir = path.join(
      this.config.dirs.repos,
      (slugify(normalized.name) || "repo") + "-" + shortId(6)
    );
    const project = {
      id: newId("prj"),
      name: (options.name && String(options.name).trim()) || normalized.name,
      source: { kind: "git", input: String(options.source).trim(), url: normalized.url },
      repoPath: destDir,
      description: "",
      tagline: "",
      links: [],
      pinnedBranches: [],
      status: "importing",
      error: null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    this.store.get().projects.push(project);
    this.store.markDirty();
    this.emit(project, "project.created");
    this.startImport(project);
    return this.toPublic(project);
  }

  startImport(project) {
    if (this.importing.has(project.id)) return;
    const task = (async () => {
      try {
        await fs.promises.mkdir(this.config.dirs.repos, { recursive: true });
        await cloneRepo(project.source.url, project.repoPath, (line) => {
          project.importLog = (project.importLog || []).concat(line).slice(-100);
        });
        await this.updateGitMeta(project);
        project.status = "ready";
        project.error = null;
        project.updatedAt = nowIso();
        this.store.markDirty();
        this.emit(project);
      } catch (error) {
        project.status = "error";
        project.error = error.message || "Could not clone this repository";
        project.updatedAt = nowIso();
        this.store.markDirty();
        this.emit(project);
      } finally {
        this.importing.delete(project.id);
      }
    })();
    this.importing.set(project.id, task);
  }

  async retryImport(project) {
    if (project.source.kind !== "git") {
      throw new HttpError(400, "Only GitHub repositories can be re-imported");
    }
    if (project.status === "importing") throw new HttpError(409, "Import already in progress");
    project.status = "importing";
    project.error = null;
    project.updatedAt = nowIso();
    this.store.markDirty();
    this.emit(project);
    this.startImport(project);
    return this.toPublic(project);
  }

  async createDemo() {
    const { repoPath, manifest } = await seedDemoRepo(this.config);
    const existing = this.store.get().projects.find((project) => project.repoPath === repoPath);
    if (existing) {
      await this.updateGitMeta(existing);
      existing.isDemo = true;
      existing.status = "ready";
      existing.error = null;
      this.store.markDirty();
      this.emit(existing);
      return this.toPublic(existing);
    }
    const project = {
      id: newId("prj"),
      name: "Lumen",
      source: { kind: "demo", input: repoPath, path: repoPath },
      repoPath,
      description: DEMO_DESCRIPTION,
      tagline: "AI meeting notes for teams that ship.",
      links: [],
      pinnedBranches: [],
      status: "ready",
      error: null,
      isDemo: true,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    await this.updateGitMeta(project);
    project.branchCount = Math.max(project.branchCount || 0, manifest.length);
    this.store.get().projects.push(project);
    this.seedDemoContent(project);
    this.store.markDirty();
    this.emit(project, "project.created");
    return this.toPublic(project);
  }

  seedDemoContent(project) {
    const state = this.store.get();
    const hasNotes = state.notes.some((note) => note.projectId === project.id);
    if (!hasNotes) {
      for (const note of DEMO_NOTES) {
        state.notes.push({
          id: newId("note"),
          projectId: project.id,
          title: note.title,
          body: note.body,
          tags: note.tags || [],
          pinned: Boolean(note.pinned),
          branch: note.branch || null,
          createdAt: nowIso(),
          updatedAt: nowIso(),
        });
      }
    }
    const hasComments = state.comments.some((comment) => comment.projectId === project.id);
    if (!hasComments) {
      state.comments.push({
        id: newId("cmt"),
        projectId: project.id,
        branch: DEMO_COMMENT.branch,
        author: DEMO_COMMENT.author,
        body: DEMO_COMMENT.body,
        createdAt: nowIso(),
      });
    }
  }

  async update(project, patch) {
    const allowed = ["name", "description", "tagline"];
    for (const key of allowed) {
      if (patch[key] !== undefined) {
        if (typeof patch[key] !== "string") throw new HttpError(400, key + " must be a string");
        project[key] = patch[key].slice(0, key === "description" ? 20000 : 300);
      }
    }
    if (Array.isArray(patch.links)) {
      project.links = patch.links
        .filter((link) => link && typeof link.url === "string")
        .slice(0, 8)
        .map((link) => ({
          label: String(link.label || "Link").slice(0, 80),
          url: String(link.url).slice(0, 500),
        }));
    }
    if (patch.pinnedBranches !== undefined) {
      if (!Array.isArray(patch.pinnedBranches)) {
        throw new HttpError(400, "pinnedBranches must be an array of branch names");
      }
      const wanted = [];
      for (const value of patch.pinnedBranches) {
        if (typeof value !== "string") {
          throw new HttpError(400, "pinnedBranches must be an array of branch names");
        }
        const name = value.trim().slice(0, 255);
        if (name && !wanted.includes(name)) wanted.push(name);
      }
      if (wanted.length) {
        if (project.status !== "ready") throw new HttpError(409, "Project is not ready");
        const { branches } = await listBranches(project.repoPath);
        const available = new Set(branches.map((branch) => branch.name));
        const missing = wanted.find((name) => !available.has(name));
        if (missing) throw new HttpError(422, "Branch not found: " + missing);
      }
      project.pinnedBranches = wanted;
    }
    project.updatedAt = nowIso();
    this.store.markDirty();
    this.emit(project);
    return this.toPublic(project);
  }

  async refresh(project) {
    if (project.status !== "ready") throw new HttpError(409, "Project is not ready");
    const result = await fetchRepo(project.repoPath).catch((error) => ({
      ok: false,
      message: error.message,
    }));
    await this.updateGitMeta(project);
    this.emit(project);
    return { ...this.toPublic(project), fetch: result };
  }

  async remove(project, options = {}) {
    const deleteRepo = options.deleteRepo !== false;
    await this.deployments.removeProject(project);
    const state = this.store.get();
    state.notes = state.notes.filter((note) => note.projectId !== project.id);
    state.comments = state.comments.filter((comment) => comment.projectId !== project.id);
    state.projects = state.projects.filter((item) => item.id !== project.id);
    this.store.markDirty();
    if (deleteRepo && (project.source.kind === "git" || project.source.kind === "demo")) {
      const repoRoot = path.resolve(this.config.dirs.repos);
      const repoPath = path.resolve(project.repoPath);
      if (repoPath.startsWith(repoRoot + path.sep)) {
        await fs.promises.rm(repoPath, { recursive: true, force: true }).catch(() => {});
      }
    }
    this.events.emit("project.deleted", { projectId: project.id });
    return { ok: true };
  }

  async readReadme(project) {
    const branchInfo = await listBranches(project.repoPath);
    const production =
      branchInfo.branches.find((branch) => branch.isDefault) || branchInfo.branches[0];
    if (!production) return null;
    return readReadme(project.repoPath, production.ref);
  }
}
