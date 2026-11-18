import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  GitBranch,
  Loader2,
  Play,
  RefreshCw,
  Share2,
} from "lucide-react";
import { api } from "../lib/api";
import { useApp } from "../context/AppContext";
import { Link, useRouter } from "../lib/router";
import { relativeTime, truncateMiddle } from "../lib/format";
import type { ProjectDetail } from "../lib/types";
import { useToast } from "../components/Toast";
import { ProjectMark } from "../components/ProjectCard";
import { GithubIcon } from "../components/icons";
import { Badge, Button, Skeleton } from "../components/ui";
import { ProjectOverview } from "./ProjectOverview";
import { ProjectPreviews } from "./ProjectPreviews";
import { ProjectNotes } from "./ProjectNotes";
import { ProjectSettings } from "./ProjectSettings";

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "previews", label: "Previews" },
  { id: "notes", label: "Notes" },
  { id: "settings", label: "Settings" },
] as const;

function ProjectSkeleton() {
  return (
    <div className="container project-page">
      <div className="project-head">
        <div className="project-head-row">
          <Skeleton width={44} height={44} style={{ borderRadius: 11 }} />
          <div style={{ flex: 1 }}>
            <Skeleton width={180} height={26} />
            <Skeleton width={320} height={14} style={{ marginTop: 10 }} />
          </div>
        </div>
      </div>
      <div className="project-content">
        <div className="project-loading-panels">
          <Skeleton height={120} />
          <Skeleton height={320} />
        </div>
      </div>
    </div>
  );
}

export function ProjectPage({ projectId, tab }: { projectId: string; tab: string }) {
  const { overview, openModal, refresh: refreshApp } = useApp();
  const { navigate } = useRouter();
  const { pushToast } = useToast();
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(
    async (silent = false) => {
      try {
        const data = await api.project(projectId);
        setDetail(data);
        setError("");
      } catch (loadError) {
        if (!silent) setError(loadError instanceof Error ? loadError.message : "Project not found");
      }
    },
    [projectId]
  );

  useEffect(() => {
    setDetail(null);
    load();
  }, [projectId, load]);

  useEffect(() => {
    const handler = (event: Event) => {
      const payload = (event as CustomEvent).detail as { type?: string; data?: { projectId?: string } };
      if (!payload?.data?.projectId || payload.data.projectId === projectId) load(true);
    };
    window.addEventListener("vercio:event", handler);
    return () => window.removeEventListener("vercio:event", handler);
  }, [projectId, load]);

  const project = detail?.project || overview?.projects.find((item) => item.id === projectId) || null;
  const activeTab = TABS.some((item) => item.id === tab) ? tab : "previews";

  const refreshRepo = async () => {
    setRefreshing(true);
    try {
      const result = await api.refreshProject(projectId);
      await load(true);
      await refreshApp();
      pushToast(
        result.project.status === "ready" ? "Repository refreshed" : "Refresh completed with issues",
        result.project.status === "ready" ? "success" : "error"
      );
    } catch (refreshError) {
      pushToast(refreshError instanceof Error ? refreshError.message : "Could not refresh", "error");
    } finally {
      setRefreshing(false);
    }
  };

  if (error && !project) {
    return (
      <div className="container page project-page">
        <div className="project-error-state">
          <span className="empty-icon"><AlertCircle size={20} /></span>
          <h1>Project not found</h1>
          <p className="muted">{error}</p>
          <Link to="/" className="btn btn-secondary btn-sm" style={{ marginTop: 18 }}>
            <ArrowLeft size={13} /> Back to projects
          </Link>
        </div>
      </div>
    );
  }

  if (!project) return <ProjectSkeleton />;

  const importing = project.status === "importing";
  const importFailed = project.status === "error";
  const sourceLabel = project.isDemo
    ? "Bundled demo repository"
    : project.source.url
      ? project.source.url.replace(/^https?:\/\//, "")
      : truncateMiddle(project.repoPath, 46);

  return (
    <div className="container project-page">
      <header className="project-head">
        <div className="project-head-row">
          <ProjectMark name={project.name} size="lg" />
          <div className="project-head-text">
            <div className="project-title-line">
              <h1>{project.name}</h1>
              {project.isDemo && <Badge tone="blue">Demo</Badge>}
              {importing && <Badge tone="amber">Importing</Badge>}
              {importFailed && <Badge tone="amber">Import failed</Badge>}
            </div>
            <p className="project-head-tagline">
              {project.tagline || "No tagline yet — add one in Settings."}
            </p>
          </div>
          <div className="project-actions">
            <Button
              size="sm"
              variant="secondary"
              icon={<RefreshCw size={13} className={refreshing ? "spin" : ""} />}
              onClick={refreshRepo}
              disabled={importing || importFailed || refreshing}
            >
              Refresh
            </Button>
            <Button
              size="sm"
              variant="secondary"
              icon={<Share2 size={13} />}
              onClick={() => openModal("share")}
            >
              Share
            </Button>
            <Button
              size="sm"
              variant="primary"
              icon={<Play size={13} />}
              onClick={() =>
                navigate("/p/" + project.id + "/previews?branch=" + encodeURIComponent(project.defaultBranch))
              }
              disabled={importing || importFailed}
            >
              Preview
            </Button>
          </div>
        </div>

        <div className="project-meta-row">
          <span className="meta-item meta-source">
            {project.source.url ? <GithubIcon size={13} /> : <GitBranch size={13} />}
            {project.source.url ? (
              <a href={project.source.url} target="_blank" rel="noreferrer" className="meta-link">
                {sourceLabel}
              </a>
            ) : (
              <span className="mono">{sourceLabel}</span>
            )}
          </span>
          <span className="dot-sep">·</span>
          <span className="meta-item"><GitBranch size={12} /> {project.branchCount || 0} branches</span>
          <span className="dot-sep">·</span>
          <span className="meta-item">default <span className="mono">{project.defaultBranch}</span></span>
          {project.dirtyCount > 0 && (
            <>
              <span className="dot-sep">·</span>
              <span className="meta-item meta-warn">
                {project.dirtyCount} uncommitted {project.dirtyCount === 1 ? "change" : "changes"} not previewed
              </span>
            </>
          )}
          <span className="meta-spacer" />
          {project.latestCommit && (
            <span className="meta-item meta-commit truncate">
              <span className="mono muted">{project.latestCommit.shortSha}</span>
              {project.latestCommit.message}
              <span className="dot-sep">·</span>
              {relativeTime(project.latestCommit.date)}
            </span>
          )}
        </div>

        <nav className="tabs project-tabs" aria-label="Project sections">
          {TABS.map((item) => (
            <Link
              key={item.id}
              to={"/p/" + project.id + "/" + item.id}
              className={"tab" + (activeTab === item.id ? " tab-active" : "")}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </header>

      {importing && (
        <div className="project-state card">
          <div className="import-state">
            <span className="import-spinner"><Loader2 size={20} className="spin" /></span>
            <h2>Cloning repository</h2>
            <p>
              Vercio is importing <span className="mono">{project.source.url}</span>. Large repositories
              can take a minute — you can leave this page and come back.
            </p>
            <div className="import-bar"><Skeleton width="100%" height={4} /></div>
          </div>
        </div>
      )}

      {importFailed && (
        <div className="project-state card">
          <div className="import-state">
            <span className="import-spinner is-error"><AlertCircle size={20} /></span>
            <h2>Import failed</h2>
            <p>{project.error || "Vercio could not clone this repository."}</p>
            <div className="import-actions">
              <Button
                variant="primary"
                size="sm"
                icon={<RefreshCw size={13} />}
                onClick={async () => {
                  try {
                    await api.retryImport(project.id);
                    pushToast("Retrying import", "info");
                    await load(true);
                  } catch (retryError) {
                    pushToast(retryError instanceof Error ? retryError.message : "Retry failed", "error");
                  }
                }}
              >
                Retry import
              </Button>
              <Button variant="secondary" size="sm" onClick={() => navigate("/")}>
                Back to projects
              </Button>
            </div>
            <p className="hint">
              Private repository? Make sure your local git credentials (SSH key or credential helper)
              have access.
            </p>
          </div>
        </div>
      )}

      {!importing && !importFailed && detail && (
        <div className={"project-content" + (activeTab === "previews" ? " project-content-previews" : "")}>
          {activeTab === "overview" && (
            <ProjectOverview detail={detail} onReload={() => load(true)} />
          )}
          {activeTab === "previews" && (
            <ProjectPreviews project={project} />
          )}
          {activeTab === "notes" && (
            <ProjectNotes project={project} />
          )}
          {activeTab === "settings" && (
            <ProjectSettings
              project={project}
              onReload={() => load(true)}
              onDeleted={() => {
                refreshApp();
                navigate("/");
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}
