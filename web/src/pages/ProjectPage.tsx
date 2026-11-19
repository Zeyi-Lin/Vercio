import { useCallback, useEffect, useState } from "react";
import { AlertCircle, ArrowLeft, Loader2, RefreshCw } from "lucide-react";
import { api } from "../lib/api";
import { useApp } from "../context/AppContext";
import { useT } from "../i18n";
import { Link, useRouter } from "../lib/router";
import type { ProjectDetail } from "../lib/types";
import { useToast } from "../components/Toast";
import { Button, Skeleton } from "../components/ui";
import { ProjectPreviews } from "./ProjectPreviews";

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
  const { overview, refresh: refreshApp } = useApp();
  const { navigate } = useRouter();
  const { pushToast } = useToast();
  const t = useT();
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  // Overview / notes / settings pages no longer exist: send their old deep
  // links to the single preview workspace.
  useEffect(() => {
    if (tab !== "previews") navigate("/p/" + projectId + "/previews", { replace: true });
  }, [navigate, projectId, tab]);

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
    [projectId, t]
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
    return (
      <div className="project-workspace">
        <div className="workspace-state">
          <div className="project-error-state">
            <span className="empty-icon"><AlertCircle size={20} /></span>
            <h1>{t("project.notFound")}</h1>
            <p className="muted">{error}</p>
            <Link to="/" className="btn btn-secondary btn-sm" style={{ marginTop: 18 }}>
              <ArrowLeft size={13} /> {t("project.backToProjects")}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (!project) return <WorkspaceSkeleton />;

  const importing = project.status === "importing";
  const importFailed = project.status === "error";

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

  if (importing || importFailed) {
    return (
      <div className="project-workspace">
        <div className="workspace-state">{importState}</div>
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
