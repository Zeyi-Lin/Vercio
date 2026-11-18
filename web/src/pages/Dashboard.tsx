import { useMemo, useState } from "react";
import {
  ArrowRight,
  FolderInput,
  GitBranch,
  MessageSquare,
  Plus,
  ShieldCheck,
  Sparkles,
  Wifi,
} from "lucide-react";
import { useApp } from "../context/AppContext";
import { useT } from "../i18n";
import { api } from "../lib/api";
import { useRouter, Link } from "../lib/router";
import type { Deployment, Project } from "../lib/types";
import { useToast } from "../components/Toast";
import { ProjectCard } from "../components/ProjectCard";
import { DeploymentList } from "../components/DeploymentList";
import { ShareCard } from "../components/ShareCard";
import { Button, Skeleton } from "../components/ui";

function latestDeployments(deployments: Deployment[]): Map<string, Deployment> {
  const map = new Map<string, Deployment>();
  for (const deployment of deployments) {
    if (!map.has(deployment.projectId)) map.set(deployment.projectId, deployment);
  }
  return map;
}

function HeroMock({ t }: { t: ReturnType<typeof useT> }) {
  return (
    <div className="hero-mock" aria-hidden="true">
      <div className="hero-mock-glow" />
      <div className="hero-mock-window">
        <div className="hero-mock-bar">
          <span className="traffic-dot" />
          <span className="traffic-dot" />
          <span className="traffic-dot" />
          <span className="hero-mock-url mono">vercio.local / preview / aurora-hero</span>
          <span className="hero-mock-live">
            <span className="share-chip-dot" />
            {t("heroMock.live")}
          </span>
        </div>
        <div className="hero-mock-body">
          <div className="hero-mock-side">
            <div className="hero-mock-side-label">{t("heroMock.branches")}</div>
            {[
              { name: "main", active: false },
              { name: "feat/aurora-hero", active: true },
              { name: "feat/pricing-v2", active: false },
              { name: "fix/mobile-nav", active: false },
            ].map((branch) => (
              <div
                key={branch.name}
                className={"hero-mock-branch" + (branch.active ? " active" : "")}
              >
                <GitBranch size={10} />
                <span className="mono">{branch.name}</span>
                {branch.active && <span className="hero-mock-branch-dot" />}
              </div>
            ))}
          </div>
          <div className="hero-mock-canvas">
            <div className="hero-mock-aurora hero-mock-aurora-a" />
            <div className="hero-mock-aurora hero-mock-aurora-b" />
            <div className="hero-mock-page">
              <div className="hero-mock-badge">{t("heroMock.new")}</div>
              <div className="hero-mock-heading" />
              <div className="hero-mock-heading short" />
              <div className="hero-mock-copy" />
              <div className="hero-mock-copy short" />
              <div className="hero-mock-buttons">
                <span />
                <span />
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="hero-mock-pill hero-mock-pill-a">
        <span className="share-chip-dot" />
        {t("heroMock.previewReady")} <span className="mono">1.2s</span>
      </div>
      <div className="hero-mock-pill hero-mock-pill-b">
        <Wifi size={11} /> {t("heroMock.sharedWifi")}
      </div>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="container dashboard">
      <div className="dashboard-head">
        <div style={{ width: "55%" }}>
          <Skeleton width={90} height={12} />
          <Skeleton width={220} height={34} style={{ marginTop: 14 }} />
          <Skeleton width={380} height={14} style={{ marginTop: 12 }} />
        </div>
        <Skeleton width={180} height={36} />
      </div>
      <div className="stats-strip">
        {[0, 1, 2, 3].map((index) => (
          <div className="stat" key={index}>
            <Skeleton width={70} height={10} />
            <Skeleton width={40} height={22} style={{ marginTop: 8 }} />
          </div>
        ))}
      </div>
      <div className="project-grid">
        {[0, 1].map((index) => (
          <div className="project-card" key={index}>
            <Skeleton height={150} />
          </div>
        ))}
      </div>
    </div>
  );
}

export function Dashboard() {
  const { overview, systemInfo, loading, error, openModal, refresh, stats } = useApp();
  const { navigate } = useRouter();
  const { pushToast } = useToast();
  const t = useT();
  const [demoBusy, setDemoBusy] = useState(false);

  const projects = overview?.projects || [];
  const deployments = overview?.deployments || [];
  const latest = useMemo(() => latestDeployments(deployments), [deployments]);
  const online = (systemInfo?.lanUrls.length || 0) > 0;

  const loadDemo = async () => {
    setDemoBusy(true);
    try {
      const { project } = await api.createDemoProject();
      await refresh();
      pushToast(t("dashboard.demoReady"), "success");
      navigate("/p/" + project.id + "/previews");
    } catch (demoError) {
      pushToast(demoError instanceof Error ? demoError.message : t("dashboard.demoError"), "error");
    } finally {
      setDemoBusy(false);
    }
  };

  if (loading && !overview) return <DashboardSkeleton />;

  if (error && !overview) {
    return (
      <div className="container page">
        <div className="alert alert-error" style={{ marginTop: 24 }}>
          {t("dashboard.serverError", { error })}
          <Button size="sm" variant="secondary" style={{ marginLeft: "auto" }} onClick={() => refresh()}>
            {t("common.retry")}
          </Button>
        </div>
      </div>
    );
  }

  if (!projects.length) {
    return (
      <div className="container dashboard">
        <section className="hero">
          <div className="hero-eyebrow">
            <span className="hero-pill">
              <span className="share-chip-dot" /> {t("dashboard.hero.localFirst")}
            </span>
            <span className="hero-eyebrow-text">{t("dashboard.hero.eyebrow")}</span>
          </div>
          <h1 className="hero-title">
            {t("dashboard.hero.title1")}
            <br />
            <span className="hero-accent">{t("dashboard.hero.title2")}</span>
          </h1>
          <p className="hero-sub">{t("dashboard.hero.sub")}</p>
          <div className="hero-actions">
            <Button
              variant="primary"
              size="lg"
              icon={<Plus size={16} />}
              onClick={() => openModal("add-project")}
            >
              {t("dashboard.addProject")}
            </Button>
            <Button
              size="lg"
              variant="secondary"
              icon={demoBusy ? undefined : <Sparkles size={15} />}
              loading={demoBusy}
              onClick={loadDemo}
            >
              {t("add.loadDemo")}
            </Button>
          </div>
          <div className="hero-note">
            <span>{t("dashboard.feature1Title")}</span>
            <span className="dot-sep">·</span>
            <span>{t("dashboard.stats.live")}</span>
            <span className="dot-sep">·</span>
            <span>{t("dashboard.feature2Title")}</span>
            <span className="dot-sep">·</span>
            <span>{t("dashboard.feature3Title")}</span>
          </div>
          <HeroMock t={t} />
        </section>

        <div className="feature-grid">
          <div className="feature-card">
            <span className="feature-icon"><GitBranch size={17} /></span>
            <h3>{t("dashboard.feature1Title")}</h3>
            <p>{t("dashboard.feature1Desc")}</p>
          </div>
          <div className="feature-card">
            <span className="feature-icon"><Wifi size={17} /></span>
            <h3>{t("dashboard.feature2Title")}</h3>
            <p>{t("dashboard.feature2Desc")}</p>
          </div>
          <div className="feature-card">
            <span className="feature-icon"><MessageSquare size={17} /></span>
            <h3>{t("dashboard.feature3Title")}</h3>
            <p>{t("dashboard.feature3Desc")}</p>
          </div>
        </div>

        <div className="empty-footer-note">
          <ShieldCheck size={14} />
          {t("dashboard.shieldNote")}
        </div>
      </div>
    );
  }

  return (
    <div className="container dashboard">
      <header className="dashboard-head">
        <div>
          <div className="eyebrow">
            <span className={"eyebrow-dot" + (online ? " live" : "")} />
            {online ? t("dashboard.eyebrowLive") : t("dashboard.eyebrowLocal")}
          </div>
          <h1 className="dashboard-title">{t("dashboard.title")}</h1>
          <p className="dashboard-sub">{t("dashboard.subtitle")}</p>
        </div>
        <div className="dashboard-actions">
          <Button
            variant="secondary"
            icon={<Wifi size={14} />}
            onClick={() => openModal("share")}
          >
            {t("dashboard.share")}
          </Button>
          <Button
            variant="secondary"
            icon={<Sparkles size={14} />}
            loading={demoBusy}
            onClick={loadDemo}
          >
            {t("dashboard.demo")}
          </Button>
          <Button
            variant="primary"
            icon={<Plus size={15} />}
            onClick={() => openModal("add-project")}
          >
            {t("dashboard.addProject")}
          </Button>
        </div>
      </header>

      <div className="stats-strip">
        <div className="stat">
          <span className="stat-label">{t("dashboard.stats.projects")}</span>
          <span className="stat-value">{stats?.projects ?? projects.length}</span>
        </div>
        <div className="stat">
          <span className="stat-label">{t("dashboard.stats.branches")}</span>
          <span className="stat-value">{stats?.branches ?? "—"}</span>
        </div>
        <div className="stat">
          <span className="stat-label">{t("dashboard.stats.live")}</span>
          <span className="stat-value">
            {stats?.running ?? 0}
            {(stats?.running ?? 0) > 0 && <span className="stat-live"><span className="share-chip-dot" /></span>}
          </span>
        </div>
        <div className="stat">
          <span className="stat-label">{t("dashboard.stats.notes")}</span>
          <span className="stat-value">{(stats?.notes ?? 0) + (stats?.comments ?? 0)}</span>
        </div>
      </div>

      <section className="section">
        <div className="section-head">
          <div>
            <h2 className="section-title">{t("dashboard.projects")}</h2>
            <p className="section-sub">{t("dashboard.projectsSubtitle")}</p>
          </div>
          <Button size="sm" variant="secondary" icon={<FolderInput size={13} />} onClick={() => openModal("add-project")}>
            {t("dashboard.newProject")}
          </Button>
        </div>
        <div className="project-grid">
          {projects.map((project: Project) => (
            <ProjectCard
              key={project.id}
              project={project}
              latestDeployment={latest.get(project.id)}
            />
          ))}
          <button className="project-add-card" onClick={() => openModal("add-project")}>
            <span className="project-add-icon"><Plus size={17} /></span>
            <span className="project-add-title">{t("dashboard.newProject")}</span>
            <span className="project-add-desc">{t("dashboard.newProjectDesc")}</span>
          </button>
        </div>
      </section>

      <div className="dashboard-lower">
        <section className="card deployments-card">
          <div className="card-head">
            <div>
              <h2 className="card-title">{t("dashboard.recent")}</h2>
              <p className="card-subtitle">{t("dashboard.recentSubtitle")}</p>
            </div>
            <span className="live-indicator">
              <span className="share-chip-dot" />
              {t("dashboard.live")}
            </span>
          </div>
          <div className="card-body card-body-flush">
            <DeploymentList
              deployments={deployments.slice(0, 8)}
              emptyTitle={t("dashboard.recentEmptyTitle")}
              emptyDescription={
                <>
                  {t("dashboard.recentEmptyDesc")}{" "}
                  <Link to={"/p/" + projects[0].id + "/previews"} className="text-link">
                    {t("dashboard.startWith", { name: projects[0].name })} <ArrowRight size={12} />
                  </Link>
                </>
              }
            />
          </div>
        </section>
        <aside className="dashboard-side">
          <ShareCard />
          <section className="card local-card">
            <div className="card-head card-head-flush">
              <div>
                <h2 className="card-title">{t("dashboard.localTitle")}</h2>
                <p className="card-subtitle">{t("dashboard.localSubtitle")}</p>
              </div>
              <ShieldCheck size={16} className="muted" />
            </div>
            <div className="local-list">
              <div className="local-item">
                <GitBranch size={14} />
                <div>
                  <strong>{t("dashboard.localWorktrees")}</strong>
                  <span>{t("dashboard.localWorktreesDesc")}</span>
                </div>
              </div>
              <div className="local-item">
                <ShieldCheck size={14} />
                <div>
                  <strong>{t("dashboard.localUploads")}</strong>
                  <span>{t("dashboard.localUploadsDesc")}</span>
                </div>
              </div>
              <div className="local-item">
                <MessageSquare size={14} />
                <div>
                  <strong>{t("dashboard.localDecisions")}</strong>
                  <span>{t("dashboard.localDecisionsDesc")}</span>
                </div>
              </div>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
