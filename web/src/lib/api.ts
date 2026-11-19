import type {
  BranchChanges,
  BranchList,
  BranchSource,
  BrowseListing,
  Comment,
  Deployment,
  FolderPickResult,
  Note,
  Overview,
  Project,
  ProjectDetail,
  Readme,
  Settings,
  SystemInfo,
} from "./types";

export class ApiError extends Error {
  status: number;
  details?: unknown;
  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  });
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const error = (payload as { error?: { message?: string; details?: unknown } } | null)?.error;
    const message = error?.message || "Request failed (" + response.status + ")";
    throw new ApiError(message, response.status, error?.details);
  }
  return payload as T;
}

export const api = {
  async system() {
    return request<{ system: SystemInfo; settings: Settings; stats: Overview["stats"] }>(
      "/api/system"
    );
  },
  async overview() {
    return request<Overview>("/api/overview");
  },
  async settings(patch: Partial<Settings>) {
    return request<{ settings: Settings }>("/api/settings", {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
  },
  async createProject(source: string, name?: string) {
    return request<{ project: Project }>("/api/projects", {
      method: "POST",
      body: JSON.stringify({ source, name }),
    });
  },
  async createDemoProject() {
    return request<{ project: Project }>("/api/projects/demo", { method: "POST" });
  },
  async pickFolder(path?: string, prompt?: string) {
    return request<FolderPickResult>("/api/fs/pick-folder", {
      method: "POST",
      body: JSON.stringify({ path: path || undefined, prompt: prompt || undefined }),
    });
  },
  async browseDirectory(target?: string, options: { showHidden?: boolean } = {}) {
    const params = new URLSearchParams();
    if (target) params.set("path", target);
    if (options.showHidden) params.set("showHidden", "1");
    const query = params.toString();
    return request<{ listing: BrowseListing }>("/api/fs/browse" + (query ? "?" + query : ""));
  },
  async project(id: string) {
    return request<ProjectDetail>("/api/projects/" + encodeURIComponent(id));
  },
  async updateProject(
    id: string,
    patch: Partial<Pick<Project, "name" | "tagline" | "description" | "links" | "pinnedBranch">>
  ) {
    return request<{ project: Project }>("/api/projects/" + encodeURIComponent(id), {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
  },
  async deleteProject(id: string, deleteRepo = true) {
    return request<{ ok: boolean }>(
      "/api/projects/" + encodeURIComponent(id) + "?deleteRepo=" + (deleteRepo ? "1" : "0"),
      { method: "DELETE" }
    );
  },
  async refreshProject(id: string) {
    return request<{ project: Project }>("/api/projects/" + encodeURIComponent(id) + "/refresh", {
      method: "POST",
    });
  },
  async retryImport(id: string) {
    return request<{ project: Project }>("/api/projects/" + encodeURIComponent(id) + "/retry", {
      method: "POST",
    });
  },
  async branches(id: string) {
    return request<BranchList>("/api/projects/" + encodeURIComponent(id) + "/branches");
  },
  async readme(id: string) {
    return request<{ readme: Readme | null }>(
      "/api/projects/" + encodeURIComponent(id) + "/readme"
    );
  },
  async changes(id: string, branch: string) {
    return request<BranchChanges>(
      "/api/projects/" +
        encodeURIComponent(id) +
        "/changes?branch=" +
        encodeURIComponent(branch)
    );
  },
  async deploy(id: string, branch: string, mode: "auto" | "server" | "static" = "auto") {
    return request<{ deployment: Deployment; reused: boolean }>(
      "/api/projects/" + encodeURIComponent(id) + "/deployments",
      { method: "POST", body: JSON.stringify({ branch, mode }) }
    );
  },
  async sources(id: string) {
    return request<{ sources: BranchSource[] }>(
      "/api/projects/" + encodeURIComponent(id) + "/sources"
    );
  },
  async followDeployment(id: string) {
    return request<{ deployment: Deployment }>(
      "/api/deployments/" + encodeURIComponent(id) + "/follow",
      { method: "POST" }
    );
  },
  async unfollowDeployment(id: string) {
    return request<{ deployment: Deployment }>(
      "/api/deployments/" + encodeURIComponent(id) + "/follow",
      { method: "DELETE" }
    );
  },
  async deployment(id: string) {
    return request<{ deployment: Deployment }>("/api/deployments/" + encodeURIComponent(id));
  },
  async deploymentLogs(id: string) {
    return request<{ id: string; log: string; status: Deployment["status"] }>(
      "/api/deployments/" + encodeURIComponent(id) + "/logs"
    );
  },
  async stopDeployment(id: string) {
    return request<{ deployment: Deployment }>(
      "/api/deployments/" + encodeURIComponent(id) + "/stop",
      { method: "POST" }
    );
  },
  async notes(projectId: string) {
    return request<{ notes: Note[] }>("/api/projects/" + encodeURIComponent(projectId) + "/notes");
  },
  async createNote(projectId: string, note: Partial<Note>) {
    return request<{ note: Note }>("/api/projects/" + encodeURIComponent(projectId) + "/notes", {
      method: "POST",
      body: JSON.stringify(note),
    });
  },
  async updateNote(id: string, patch: Partial<Note>) {
    return request<{ note: Note }>("/api/notes/" + encodeURIComponent(id), {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
  },
  async deleteNote(id: string) {
    return request<{ ok: boolean }>("/api/notes/" + encodeURIComponent(id), { method: "DELETE" });
  },
  async comments(projectId: string, branch?: string) {
    return request<{ comments: Comment[] }>(
      "/api/projects/" +
        encodeURIComponent(projectId) +
        "/comments" +
        (branch ? "?branch=" + encodeURIComponent(branch) : "")
    );
  },
  async createComment(
    projectId: string,
    input: { branch?: string | null; author: string; body: string; clientId: string }
  ) {
    return request<{ comment: Comment }>(
      "/api/projects/" + encodeURIComponent(projectId) + "/comments",
      { method: "POST", body: JSON.stringify(input) }
    );
  },
  async deleteComment(id: string, clientId: string) {
    return request<{ ok: boolean }>(
      "/api/comments/" + encodeURIComponent(id) + "?clientId=" + encodeURIComponent(clientId),
      { method: "DELETE" }
    );
  },
};
