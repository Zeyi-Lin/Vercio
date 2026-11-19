import fs from "node:fs";
import path from "node:path";
import { browseDirectory } from "./lib/browse.js";
import { pickFolder } from "./lib/folder-dialog.js";
import { HttpError, isInside, readJSONBody, sendError, sendJSON, serveStaticFile } from "./lib/http.js";
import { newId } from "./lib/ids.js";
import { getSystemInfo } from "./lib/lan.js";
import { diffStat, resolveBranch } from "./lib/git.js";
import { toPublicSource } from "./lib/sources.js";

function nowIso() {
  return new Date().toISOString();
}

function parseTags(value) {
  if (Array.isArray(value)) {
    return value.map((tag) => String(tag).trim()).filter(Boolean).slice(0, 8);
  }
  return [];
}

function deploymentWithProject(deployment, projectMap) {
  const project = projectMap.get(deployment.projectId);
  return { ...deployment, projectName: project?.name || "Unknown project" };
}

function previewStatusPage(deployment) {
  const status = deployment.status;
  const title =
    status === "error"
      ? "Preview failed"
      : status === "stopped"
        ? "Preview stopped"
        : status === "ready"
          ? "Preview ready"
          : "Building preview";
  const detail =
    status === "error"
      ? deployment.error || "Something went wrong while preparing this branch."
      : status === "stopped"
        ? "This preview is no longer running. Ask for a new deployment from the Vercio dashboard."
        : "Vercio is preparing this branch. This page refreshes automatically.";
  const fatal = status === "error" || status === "stopped";
  return [
    "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">",
    "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">",
    "<title>" + title + " - Vercio</title>",
    "<style>",
    ":root{color-scheme:dark}*{box-sizing:border-box}",
    "body{margin:0;min-height:100vh;display:grid;place-items:center;background:#000;color:#ededed;",
    "font:14px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}",
    ".card{width:min(560px,90vw);border:1px solid #222;border-radius:12px;padding:32px;",
    "background:radial-gradient(120% 120% at 0% 0%,#111 0%,#050505 60%)}",
    ".logo{display:flex;align-items:center;gap:10px;font-weight:600;font-size:16px;margin-bottom:22px}",
    ".mark{width:22px;height:22px;display:grid;place-items:center;border-radius:6px;background:#fff;color:#000;font-weight:700}",
    "h1{font-size:22px;margin:0 0 6px;letter-spacing:-.02em}",
    "p{color:#888;margin:0 0 22px}",
    ".meta{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:24px}",
    ".pill{border:1px solid #2a2a2a;border-radius:999px;padding:4px 10px;color:#a1a1a1;font-size:12px}",
    ".dots{display:inline-flex;gap:3px}.dot{width:5px;height:5px;border-radius:50%;background:#666;animation:p 1.2s infinite}",
    ".dot:nth-child(2){animation-delay:.15s}.dot:nth-child(3){animation-delay:.3s}",
    "@keyframes p{0%,100%{opacity:.25}50%{opacity:1}}",
    "a{color:#3291ff;text-decoration:none}",
    "</style></head><body><div class=\"card\">",
    "<div class=\"logo\"><span class=\"mark\">V</span>Vercio</div>",
    "<h1>" + title + "</h1><p>" + detail + "</p>",
    "<div class=\"meta\"><span class=\"pill\">" + (deployment.branch || "branch") + "</span>",
    "<span class=\"pill\">" + (deployment.shortSha || "") + "</span>",
    "<span class=\"pill\">" + status + "</span></div>",
    fatal
      ? "<a href=\"/\">Open the Vercio dashboard</a>"
      : "<div class=\"dots\"><span class=\"dot\"></span><span class=\"dot\"></span><span class=\"dot\"></span></div>",
    "<script>",
    fatal
      ? ""
      : "var id=" + JSON.stringify(deployment.id) + ";setInterval(function(){fetch('/api/deployments/'+id).then(function(r){return r.json()}).then(function(d){if(d&&d.deployment&&(d.deployment.status==='ready'||d.deployment.status==='error'||d.deployment.status==='stopped'))location.reload()}).catch(function(){})},1500);",
    "</script></div></body></html>",
  ].join("");
}

export function createRequestHandler(deps) {
  const { store, events, config, projects, deployments, runtime } = deps;
  const openFolderDialog = deps.folderDialog || pickFolder;

  return async function handleRequest(req, res) {
    const url = new URL(req.url || "/", "http://localhost");
    const pathname = url.pathname;
    const query = url.searchParams;

    try {
      // Preview hosting: redirects to the isolated preview server so absolute
      // asset paths and hot reload keep working. This URL is stable and shareable.
      const previewMatch = pathname.match(/^\/preview\/([^/]+)(\/.*)?$/);
      if (previewMatch) {
        const id = decodeURIComponent(previewMatch[1]);
        const rest = previewMatch[2] || "/";
        let deployment;
        try {
          deployment = deployments.getDeployment(id);
        } catch {
          res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
          res.end(previewStatusPage({ id, status: "error", error: "Deployment not found" }));
          return;
        }
        const port = deployments.previewPort(id);
        if (port) {
          let hostname = "127.0.0.1";
          try {
            hostname = new URL("http://" + (req.headers.host || "127.0.0.1:4000")).hostname;
          } catch {}
          const location = "http://" + (hostname.includes(":") ? "[" + hostname + "]" : hostname) + ":" + port + rest;
          res.writeHead(302, { Location: location, "Cache-Control": "no-store" });
          res.end("Redirecting to preview...");
          return;
        }
        res.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
        });
        res.end(previewStatusPage(deployment));
        return;
      }

      if (!pathname.startsWith("/api/")) {
        // Single-page app assets from the production build.
        if (req.method === "GET" || req.method === "HEAD") {
          if (fs.existsSync(config.webDist)) {
            const relative = pathname === "/" ? "index.html" : pathname.slice(1);
            const assetPath = path.resolve(config.webDist, relative);
            if (isInside(config.webDist, assetPath) && fs.existsSync(assetPath) && fs.statSync(assetPath).isFile()) {
              await serveStaticFile(req, res, assetPath, { cacheControl: "public, max-age=60" });
              return;
            }
            if (!path.extname(pathname)) {
              await serveStaticFile(req, res, path.join(config.webDist, "index.html"), {
                cacheControl: "no-store",
              });
              return;
            }
          }
          res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
          res.end(
            "Vercio API is running. Start the frontend with 'npm run dev', or build it with 'npm run build'.\n"
          );
          return;
        }
      }

      if (pathname === "/api/health" && req.method === "GET") {
        sendJSON(res, 200, {
          ok: true,
          version: config.version,
          port: runtime.port,
          uptime: Math.round(process.uptime()),
        });
        return;
      }

      if (pathname === "/api/system" && req.method === "GET") {
        const state = store.get();
        const running = state.deployments.filter((item) => item.status === "ready").length;
        const info = await getSystemInfo({
          config,
          port: runtime.port,
          projectCount: state.projects.length,
          runningCount: running,
          noteCount: state.notes.length,
        });
        sendJSON(res, 200, {
          system: info,
          settings: state.settings,
          stats: {
            projects: state.projects.length,
            branches: state.projects.reduce((sum, project) => sum + (project.branchCount || 0), 0),
            running,
            notes: state.notes.length,
            comments: state.comments.length,
          },
        });
        return;
      }

      // Folder browser for the "new project" dialog. Lists directories on the
      // machine that runs Vercio so users can pick a repository without typing
      // an absolute path. Files and file contents are never returned.
      if (pathname === "/api/fs/browse" && req.method === "GET") {
        const listing = await browseDirectory(query.get("path") || "", {
          showHidden: query.get("showHidden") === "1",
        });
        sendJSON(res, 200, { listing });
        return;
      }

      // Opens the operating system's own folder chooser on this machine so a
      // local repository can be picked without typing a path. The dialog is
      // native, so the request stays open until the user chooses or cancels.
      if (pathname === "/api/fs/pick-folder" && req.method === "POST") {
        const body = await readJSONBody(req);
        if (body.path !== undefined && typeof body.path !== "string") {
          throw new HttpError(400, "path must be a string");
        }
        if (body.prompt !== undefined && typeof body.prompt !== "string") {
          throw new HttpError(400, "prompt must be a string");
        }
        const controller = new AbortController();
        const handleClose = () => {
          if (!res.writableEnded) controller.abort();
        };
        res.on("close", handleClose);
        let result;
        try {
          result = await openFolderDialog({
            defaultPath: body.path,
            prompt: body.prompt,
            signal: controller.signal,
          });
        } catch (dialogError) {
          if (controller.signal.aborted) return;
          throw dialogError;
        } finally {
          res.off("close", handleClose);
        }
        if (controller.signal.aborted) return;
        sendJSON(res, 200, result);
        return;
      }

      if (pathname === "/api/events" && req.method === "GET") {
        events.addClient(req, res);
        return;
      }

      if (pathname === "/api/overview" && req.method === "GET") {
        const state = store.get();
        const projectMap = new Map(state.projects.map((project) => [project.id, project]));
        const recent = state.deployments.slice(0, 40).map((deployment) =>
          deploymentWithProject(deployments.toPublic(deployment), projectMap)
        );
        sendJSON(res, 200, {
          projects: projects.list(),
          deployments: recent,
          settings: state.settings,
          stats: {
            projects: state.projects.length,
            branches: state.projects.reduce((sum, project) => sum + (project.branchCount || 0), 0),
            running: state.deployments.filter((item) => item.status === "ready").length,
            notes: state.notes.length,
            comments: state.comments.length,
          },
        });
        return;
      }

      if (pathname === "/api/settings" && req.method === "PATCH") {
        const body = await readJSONBody(req);
        const state = store.get();
        if (typeof body.userName === "string") state.settings.userName = body.userName.slice(0, 60);
        if (typeof body.defaultAuthor === "string") {
          state.settings.defaultAuthor = body.defaultAuthor.slice(0, 60);
        }
        store.markDirty();
        events.emit("settings.updated", {});
        sendJSON(res, 200, { settings: state.settings });
        return;
      }

      if (pathname === "/api/projects" && req.method === "GET") {
        sendJSON(res, 200, { projects: projects.list() });
        return;
      }

      if (pathname === "/api/projects" && req.method === "POST") {
        const body = await readJSONBody(req);
        const project = await projects.create({ source: body.source, name: body.name });
        sendJSON(res, 201, { project });
        return;
      }

      if (pathname === "/api/projects/demo" && req.method === "POST") {
        const project = await projects.createDemo();
        sendJSON(res, 201, { project });
        return;
      }

      let match = pathname.match(/^\/api\/projects\/([^/]+)$/);
      if (match) {
        const project = projects.get(decodeURIComponent(match[1]));
        if (req.method === "GET") {
          const state = store.get();
          const projectDeployments = state.deployments
            .filter((deployment) => deployment.projectId === project.id)
            .map((deployment) => deployments.toPublic(deployment));
          sendJSON(res, 200, {
            project: projects.toPublic(project),
            deployments: projectDeployments,
            notesCount: state.notes.filter((note) => note.projectId === project.id).length,
            commentsCount: state.comments.filter((comment) => comment.projectId === project.id).length,
          });
          return;
        }
        if (req.method === "PATCH") {
          const body = await readJSONBody(req);
          const updated = await projects.update(project, body);
          sendJSON(res, 200, { project: updated });
          return;
        }
        if (req.method === "DELETE") {
          await projects.remove(project, { deleteRepo: query.get("deleteRepo") !== "0" });
          sendJSON(res, 200, { ok: true });
          return;
        }
      }

      match = pathname.match(/^\/api\/projects\/([^/]+)\/refresh$/);
      if (match && req.method === "POST") {
        const project = projects.get(decodeURIComponent(match[1]));
        const updated = await projects.refresh(project);
        sendJSON(res, 200, { project: updated });
        return;
      }

      match = pathname.match(/^\/api\/projects\/([^/]+)\/retry$/);
      if (match && req.method === "POST") {
        const project = projects.get(decodeURIComponent(match[1]));
        const updated = await projects.retryImport(project);
        sendJSON(res, 202, { project: updated });
        return;
      }

      match = pathname.match(/^\/api\/projects\/([^/]+)\/branches$/);
      if (match && req.method === "GET") {
        const project = projects.get(decodeURIComponent(match[1]));
        if (project.status !== "ready") throw new HttpError(409, "Project is not ready yet");
        const branches = await deployments.getBranches(project, await import("./lib/git.js"));
        sendJSON(res, 200, {
          projectId: project.id,
          defaultBranch: branches.defaultBranch,
          currentBranch: branches.currentBranch,
          branches: branches.branches,
          sources: branches.sources || [],
        });
        return;
      }

      match = pathname.match(/^\/api\/projects\/([^/]+)\/sources$/);
      if (match && req.method === "GET") {
        const project = projects.get(decodeURIComponent(match[1]));
        if (project.status !== "ready") throw new HttpError(409, "Project is not ready yet");
        const sources = await deployments.getSources(project, { force: true });
        sendJSON(res, 200, { sources: sources.map((source) => toPublicSource(source)) });
        return;
      }

      match = pathname.match(/^\/api\/projects\/([^/]+)\/readme$/);
      if (match && req.method === "GET") {
        const project = projects.get(decodeURIComponent(match[1]));
        if (project.status !== "ready") throw new HttpError(409, "Project is not ready yet");
        const readme = await projects.readReadme(project);
        sendJSON(res, 200, { readme });
        return;
      }

      match = pathname.match(/^\/api\/projects\/([^/]+)\/changes$/);
      if (match && req.method === "GET") {
        const project = projects.get(decodeURIComponent(match[1]));
        if (project.status !== "ready") throw new HttpError(409, "Project is not ready yet");
        const branch = query.get("branch");
        if (!branch) throw new HttpError(400, "branch query parameter is required");
        const branches = await deployments.getBranches(project, await import("./lib/git.js"));
        const production = branches.branches.find((item) => item.isDefault) || branches.branches[0];
        if (!production) throw new HttpError(404, "No branches found");
        if (production.name === branch) {
          sendJSON(res, 200, {
            branch,
            base: production.name,
            files: [],
            fileCount: 0,
            additions: 0,
            deletions: 0,
          });
          return;
        }
        const [baseRef, headRef] = await Promise.all([
          resolveBranch(project.repoPath, production.name),
          resolveBranch(project.repoPath, branch),
        ]);
        const stat = await diffStat(project.repoPath, baseRef.sha, headRef.sha);
        sendJSON(res, 200, { branch, base: production.name, ...stat });
        return;
      }

      match = pathname.match(/^\/api\/projects\/([^/]+)\/deployments$/);
      if (match) {
        const project = projects.get(decodeURIComponent(match[1]));
        if (req.method === "GET") {
          const list = store
            .get()
            .deployments.filter((deployment) => deployment.projectId === project.id)
            .map((deployment) => deployments.toPublic(deployment));
          sendJSON(res, 200, { deployments: list });
          return;
        }
        if (req.method === "POST") {
          const body = await readJSONBody(req);
          if (!body.branch || typeof body.branch !== "string") {
            throw new HttpError(400, "branch is required");
          }
          const result = await deployments.create(project, body.branch, {
            mode: body.mode || "auto",
          });
          sendJSON(res, result.reused ? 200 : 202, result);
          return;
        }
      }

      match = pathname.match(/^\/api\/deployments\/([^/]+)$/);
      if (match && req.method === "GET") {
        const deployment = deployments.getDeployment(decodeURIComponent(match[1]));
        sendJSON(res, 200, { deployment: deployments.toPublic(deployment) });
        return;
      }

      match = pathname.match(/^\/api\/deployments\/([^/]+)\/logs$/);
      if (match && req.method === "GET") {
        const id = decodeURIComponent(match[1]);
        const logs = deployments.getLog(id);
        sendJSON(res, 200, { id, log: logs.log, status: logs.status });
        return;
      }

      match = pathname.match(/^\/api\/deployments\/([^/]+)\/follow$/);
      if (match && (req.method === "POST" || req.method === "DELETE")) {
        const id = decodeURIComponent(match[1]);
        const deployment =
          req.method === "POST"
            ? await deployments.followById(id)
            : deployments.unfollowById(id);
        sendJSON(res, 200, { deployment });
        return;
      }

      match = pathname.match(/^\/api\/deployments\/([^/]+)\/stop$/);
      if (match && req.method === "POST") {
        const id = decodeURIComponent(match[1]);
        const deployment = deployments.stopById(id);
        sendJSON(res, 200, { deployment });
        return;
      }

      match = pathname.match(/^\/api\/projects\/([^/]+)\/notes$/);
      if (match) {
        const project = projects.get(decodeURIComponent(match[1]));
        const state = store.get();
        if (req.method === "GET") {
          const notes = state.notes
            .filter((note) => note.projectId === project.id)
            .sort((a, b) => {
              if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
              return (b.updatedAt || "").localeCompare(a.updatedAt || "");
            });
          sendJSON(res, 200, { notes });
          return;
        }
        if (req.method === "POST") {
          const body = await readJSONBody(req);
          const note = {
            id: newId("note"),
            projectId: project.id,
            title: String(body.title || "Untitled note").slice(0, 160) || "Untitled note",
            body: String(body.body || "").slice(0, 100000),
            tags: parseTags(body.tags),
            pinned: Boolean(body.pinned),
            branch: typeof body.branch === "string" && body.branch ? body.branch : null,
            createdAt: nowIso(),
            updatedAt: nowIso(),
          };
          state.notes.push(note);
          store.markDirty();
          events.emit("note.changed", { projectId: project.id, noteId: note.id, kind: "created" });
          sendJSON(res, 201, { note });
          return;
        }
      }

      match = pathname.match(/^\/api\/notes\/([^/]+)$/);
      if (match) {
        const id = decodeURIComponent(match[1]);
        const state = store.get();
        const note = state.notes.find((item) => item.id === id);
        if (!note) throw new HttpError(404, "Note not found");
        if (req.method === "PATCH") {
          const body = await readJSONBody(req);
          if (typeof body.title === "string") note.title = body.title.slice(0, 160) || "Untitled note";
          if (typeof body.body === "string") note.body = body.body.slice(0, 100000);
          if (body.tags !== undefined) note.tags = parseTags(body.tags);
          if (typeof body.pinned === "boolean") note.pinned = body.pinned;
          if (body.branch !== undefined) {
            note.branch = typeof body.branch === "string" && body.branch ? body.branch : null;
          }
          note.updatedAt = nowIso();
          store.markDirty();
          events.emit("note.changed", { projectId: note.projectId, noteId: note.id, kind: "updated" });
          sendJSON(res, 200, { note });
          return;
        }
        if (req.method === "DELETE") {
          state.notes = state.notes.filter((item) => item.id !== id);
          store.markDirty();
          events.emit("note.changed", { projectId: note.projectId, noteId: id, kind: "deleted" });
          sendJSON(res, 200, { ok: true });
          return;
        }
      }

      match = pathname.match(/^\/api\/projects\/([^/]+)\/comments$/);
      if (match) {
        const project = projects.get(decodeURIComponent(match[1]));
        const state = store.get();
        if (req.method === "GET") {
          const branch = query.get("branch");
          const comments = state.comments
            .filter((comment) => comment.projectId === project.id)
            .filter((comment) => !branch || comment.branch === branch)
            .sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));
          sendJSON(res, 200, { comments });
          return;
        }
        if (req.method === "POST") {
          const body = await readJSONBody(req);
          const comment = {
            id: newId("cmt"),
            projectId: project.id,
            branch: typeof body.branch === "string" && body.branch ? body.branch : null,
            author: String(body.author || "Anonymous").slice(0, 60) || "Anonymous",
            body: String(body.body || "").slice(0, 5000),
            clientId: String(body.clientId || "").slice(0, 80),
            createdAt: nowIso(),
          };
          if (!comment.body.trim()) throw new HttpError(400, "Comment cannot be empty");
          state.comments.push(comment);
          store.markDirty();
          events.emit("comment.changed", { projectId: project.id, commentId: comment.id });
          sendJSON(res, 201, { comment });
          return;
        }
      }

      match = pathname.match(/^\/api\/comments\/([^/]+)$/);
      if (match && req.method === "DELETE") {
        const id = decodeURIComponent(match[1]);
        const state = store.get();
        const comment = state.comments.find((item) => item.id === id);
        if (!comment) throw new HttpError(404, "Comment not found");
        const clientId = query.get("clientId") || "";
        if (comment.clientId && clientId && comment.clientId !== clientId) {
          throw new HttpError(403, "You can only delete your own comments");
        }
        state.comments = state.comments.filter((item) => item.id !== id);
        store.markDirty();
        events.emit("comment.changed", { projectId: comment.projectId, commentId: id });
        sendJSON(res, 200, { ok: true });
        return;
      }

      if (pathname.startsWith("/api/")) {
        sendError(res, 404, "API route not found");
        return;
      }

      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
    } catch (error) {
      if (res.headersSent) {
        try { res.end(); } catch {}
        return;
      }
      const status = error instanceof HttpError ? error.status : 500;
      if (status >= 500) console.error("[vercio]", error);
      sendError(res, status, error.message || "Internal server error", error.details);
    }
  };
}
