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
import { useT } from "../i18n";
import { Link, normalizeProjectTab, useRouter } from "../lib/router";
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
  { id: "overview", labelKey: "project.tab.overview" },
  { id: "previews", labelKey: "project.tab.previews" },
  { id: "notes", labelKey: "project.tab.notes" },
  { id: "settings", labelKey: "project.tab.settings" },
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

function WorkspaceSkeleton() {
  return (
    <div className="project-workspace">
      <div className="previews previews-loading">
        <aside className="branch-panel">
          <div className="branch-panel-head">
            <Skeleton width={82} height={13} />
            <Skeleton width={18} height={18} />
          </div>
          <div className="branch-search">
            <Skeleton width="60%" height={11} />
          </div>
          <div className="branch-list">
            {[0, 1, 2].map((index) => (
              <div className="branch-item" key={index}>
                <Skeleton width="62%" height={11} />
                <Skeleton width="88%" height={9} style={{ marginTop: 9 }} />
                <Skeleton width="45%" height={8} style={{ marginTop: 9 }} />
              </div>
            ))}
          </div>
          <div className="branch-panel-foot">
            <Skeleton width="70%" height={9} />
          </div>
        </aside>
        <section className="preview-stage">
          <div className="preview-toolbar">
            <Skeleton width={130} height={12} />
            <Skeleton width={190} height={26} />
          </div>
          <div className="preview-panes">
            <Skeleton height="100%" style={{ minHeight: 380, borderRadius: 12 }} />
          </div>
        </section>
      </div>
    </div>
  );
}

export function ProjectPage({ projectId, tab }: { projectId: string; tab: string }) {
  const { overview, openModal, refresh: refreshApp } = useApp();
  const { navigate } = useRouter();
  const { pushToast } = useToast();
  const t = useT();
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
        if (!silent) setError(loadError instanceof Error ? loadError.message : t("project.notFound"));
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
  const activeTab = normalizeProjectTab(tab);
  const workspace = activeTab === "previews";

  const refreshRepo = async () => {
    setRefreshing(true);
    try {
      const result = await api.refreshProject(projectId);
      await load(true);
      await refreshApp();
      pushToast(
        result.project.status === "ready" ? t("project.refreshedToast") : t("project.refreshIssuesToast"),
        result.project.status === "ready" ? "success" : "error"
      );
    } catch (refreshError) {
      pushToast(refreshError instanceof Error ? refreshError.message : t("project.refreshError"), "error");
    } finally {
      setRefreshing(false);
    }
  };

  if (error && !project) {
    const notFound = (
      <div className="project-error-state">
        <span className="empty-icon"><AlertCircle size={20} /></span>
        <h1>{t("project.notFound")}</h1>
        <p className="muted">{error}</p>
        <Link to="/" className="btn btn-secondary btn-sm" style={{ marginTop: 18 }}>
          <ArrowLeft size={13} /> {t("project.backToProjects")}
        </Link>
      </div>
    );
    return workspace ? (
      <div className="project-workspace">
        <div className="workspace-state">{notFound}</div>
      </div>
    ) : (
      <div className="container page project-page">{notFound}</div>
    );
  }

  if (!project) return workspace ? <WorkspaceSkeleton /> : <ProjectSkeleton />;

  const importing = project.status === "importing";
  const importFailed = project.status === "error";
  const sourceLabel = project.isDemo
    ? t("project.demoRepository")
    : project.source.url
      ? project.source.url.replace(/^https?:\/\//, "")
      : truncateMiddle(project.repoPath, 46);

  const importState = importing ? (
    <div className="import-state">
      <span className="import-spinner"><Loader2 size={20} className="spin" /></span>
      <h2>{t("project.importing.title")}</h2>
      <p>{t("project.importing.desc", { url: project.source.url || "" })}</p>
      <div className="import-bar"><Skeleton width="100%" height={4} /></div>
    </div>
  ) : importFailed ? (
    <div className="import-state">
      <span className="import-spinner is-error"><AlertCircle size={20} /></span>
      <h2>{t("project.importFailed.title")}</h2>
      <p>{project.error || t("project.importFailed.desc")}</p>
      <div className="import-actions">
        <Button
          variant="primary"
          size="sm"
          icon={<RefreshCw size={13} />}
          onClick={async () => {
            try {
              await api.retryImport(project.id);
              pushToast(t("project.retryToast"), "info");
              await load(true);
            } catch (retryError) {
              pushToast(retryError instanceof Error ? retryError.message : t("project.retryError"), "error");
            }
          }}
        >
          {t("project.retryImport")}
        </Button>
        <Button variant="secondary" size="sm" onClick={() => navigate("/")}>
          {t("project.backToProjects")}
        </Button>
      </div>
      <p className="hint">{t("project.importHint")}</p>
    </div>
  ) : null;

  if (workspace) {
    if (importing || importFailed) {
      return (
        <div className="project-workspace">
          <div className="workspace-state">
            {importState}
          </div>
        </div>
      );
    }
    if (!detail) return <WorkspaceSkeleton />;
    return (
      <div className="project-workspace">
        <ProjectPreviews
          project={project}
          onRefreshRepo={refreshRepo}
          repoRefreshing={refreshing}
        />
      </div>
    );
  }

  return (
    <div className="container project-page">
      <header className="project-head">
        <div className="project-head-row">
          <ProjectMark name={project.name} size="lg" />
          <div className="project-head-text">
            <div className="project-title-line">
              <h1>{project.name}</h1>
              {project.isDemo && <Badge tone="blue">{t("project.demo")}</Badge>}
              {importing && <Badge tone="amber">{t("project.importing")}</Badge>}
              {importFailed && <Badge tone="amber">{t("project.importFailed")}</Badge>}
            </div>
            <p className="project-head-tagline">
              {project.tagline || t("project.taglinePlaceholder")}
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
              {t("project.refresh")}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              icon={<Share2 size={13} />}
              onClick={() => openModal("share")}
            >
              {t("project.share")}
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
              {t("project.preview")}
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
          <span className="meta-item"><GitBranch size={12} /> {t("project.branches", { count: project.branchCount || 0 })}</span>
          <span className="dot-sep">·</span>
          <span className="meta-item">{t("project.default")} <span className="mono">{project.defaultBranch}</span></span>
          {project.dirtyCount > 0 && (
            <>
              <span className="dot-sep">·</span>
              <span className="meta-item meta-warn">
                {t("project.uncommitted", { count: project.dirtyCount })}
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

        <nav className="tabs project-tabs" aria-label={t("project.sectionsAria")}>
          {TABS.map((item) => (
            <Link
              key={item.id}
              to={"/p/" + project.id + "/" + item.id}
              className={"tab" + (activeTab === item.id ? " tab-active" : "")}
            >
              {t(item.labelKey)}
            </Link>
          ))}
        </nav>
      </header>

      {importing && <div className="project-state card">{importState}</div>}
      {importFailed && <div className="project-state card">{importState}</div>}

      {!importing && !importFailed && detail && (
        <div className="project-content">
          {activeTab === "overview" && (
            <ProjectOverview detail={detail} onReload={() => load(true)} />
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
