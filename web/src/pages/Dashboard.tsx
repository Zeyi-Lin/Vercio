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

function HeroMock() {
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
            live
          </span>
        </div>
        <div className="hero-mock-body">
          <div className="hero-mock-side">
            <div className="hero-mock-side-label">Branches</div>
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
              <div className="hero-mock-badge">New</div>
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
        Preview ready <span className="mono">1.2s</span>
      </div>
      <div className="hero-mock-pill hero-mock-pill-b">
        <Wifi size={11} /> Shared on Wi-Fi
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
      pushToast("Demo project ready — click any branch to preview it", "success");
      navigate("/p/" + project.id + "/previews");
    } catch (demoError) {
      pushToast(demoError instanceof Error ? demoError.message : "Could not load demo", "error");
    } finally {
      setDemoBusy(false);
    }
  };

  if (loading && !overview) return <DashboardSkeleton />;

  if (error && !overview) {
    return (
      <div className="container page">
        <div className="alert alert-error" style={{ marginTop: 24 }}>
          Could not reach the Vercio server: {error}
          <Button size="sm" variant="secondary" style={{ marginLeft: "auto" }} onClick={() => refresh()}>
            Retry
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
              <span className="share-chip-dot" /> Local-first
            </span>
            <span className="hero-eyebrow-text">Vercel-style frontend collaboration, on your machine</span>
          </div>
          <h1 className="hero-title">
            Every branch.
            <br />
            <span className="hero-accent">One click away.</span>
          </h1>
          <p className="hero-sub">
            Point Vercio at any git repository and preview its frontend branch by branch — then share
            it with everyone on your Wi-Fi. No cloud, no deploys, no waiting.
          </p>
          <div className="hero-actions">
            <Button
              variant="primary"
              size="lg"
              icon={<Plus size={16} />}
              onClick={() => openModal("add-project")}
            >
              Add project
            </Button>
            <Button
              size="lg"
              variant="secondary"
              icon={demoBusy ? undefined : <Sparkles size={15} />}
              loading={demoBusy}
              onClick={loadDemo}
            >
              Load demo project
            </Button>
          </div>
          <div className="hero-note">
            <span>Git worktrees</span>
            <span className="dot-sep">·</span>
            <span>Instant branch previews</span>
            <span className="dot-sep">·</span>
            <span>Shared over Wi-Fi</span>
            <span className="dot-sep">·</span>
            <span>Product notes built in</span>
          </div>
          <HeroMock />
        </section>

        <div className="feature-grid">
          <div className="feature-card">
            <span className="feature-icon"><GitBranch size={17} /></span>
            <h3>Branches, not builds</h3>
            <p>
              Every branch is checked out into an isolated git worktree and previewed live. Switch
              branches with one click while your working copy stays untouched.
            </p>
          </div>
          <div className="feature-card">
            <span className="feature-icon"><Wifi size={17} /></span>
            <h3>Collaborate on Wi-Fi</h3>
            <p>
              Share a QR code and your teammates can open the same dashboard, inspect any branch or
              leave comments — all on the local network.
            </p>
          </div>
          <div className="feature-card">
            <span className="feature-icon"><MessageSquare size={17} /></span>
            <h3>Context that stays</h3>
            <p>
              Write the product brief, keep design notes next to the code and discuss each branch
              without another SaaS subscription.
            </p>
          </div>
        </div>

        <div className="empty-footer-note">
          <ShieldCheck size={14} />
          Vercio runs on this machine. Your code and notes never leave the local network.
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
            {online ? "Live on your network" : "Local workspace"}
          </div>
          <h1 className="dashboard-title">Overview</h1>
          <p className="dashboard-sub">
            Preview any branch of any repository — shared instantly with your team on Wi-Fi.
          </p>
        </div>
        <div className="dashboard-actions">
          <Button
            variant="secondary"
            icon={<Wifi size={14} />}
            onClick={() => openModal("share")}
          >
            Share
          </Button>
          <Button
            variant="secondary"
            icon={<Sparkles size={14} />}
            loading={demoBusy}
            onClick={loadDemo}
          >
            Demo
          </Button>
          <Button
            variant="primary"
            icon={<Plus size={15} />}
            onClick={() => openModal("add-project")}
          >
            Add project
          </Button>
        </div>
      </header>

      <div className="stats-strip">
        <div className="stat">
          <span className="stat-label">Projects</span>
          <span className="stat-value">{stats?.projects ?? projects.length}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Branches</span>
          <span className="stat-value">{stats?.branches ?? "—"}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Live previews</span>
          <span className="stat-value">
            {stats?.running ?? 0}
            {(stats?.running ?? 0) > 0 && <span className="stat-live"><span className="share-chip-dot" /></span>}
          </span>
        </div>
        <div className="stat">
          <span className="stat-label">Notes & comments</span>
          <span className="stat-value">{(stats?.notes ?? 0) + (stats?.comments ?? 0)}</span>
        </div>
      </div>

      <section className="section">
        <div className="section-head">
          <div>
            <h2 className="section-title">Projects</h2>
            <p className="section-sub">Repositories connected to this workspace.</p>
          </div>
          <Button size="sm" variant="secondary" icon={<FolderInput size={13} />} onClick={() => openModal("add-project")}>
            New project
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
            <span className="project-add-title">New project</span>
            <span className="project-add-desc">Import from GitHub or a local folder</span>
          </button>
        </div>
      </section>

      <div className="dashboard-lower">
        <section className="card deployments-card">
          <div className="card-head">
            <div>
              <h2 className="card-title">Recent deployments</h2>
              <p className="card-subtitle">Every branch you preview becomes a deployment.</p>
            </div>
            <span className="live-indicator">
              <span className="share-chip-dot" />
              Live
            </span>
          </div>
          <div className="card-body card-body-flush">
            <DeploymentList
              deployments={deployments.slice(0, 8)}
              emptyTitle="No previews yet"
              emptyDescription={
                <>
                  Open a project and click a branch to spin up its first preview.{" "}
                  <Link to={"/p/" + projects[0].id + "/previews"} className="text-link">
                    Start with {projects[0].name} <ArrowRight size={12} />
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
                <h2 className="card-title">Local by design</h2>
                <p className="card-subtitle">The whole workspace runs on this machine.</p>
              </div>
              <ShieldCheck size={16} className="muted" />
            </div>
            <div className="local-list">
              <div className="local-item">
                <GitBranch size={14} />
                <div>
                  <strong>Isolated worktrees</strong>
                  <span>Previews never touch your working copy.</span>
                </div>
              </div>
              <div className="local-item">
                <ShieldCheck size={14} />
                <div>
                  <strong>No uploads</strong>
                  <span>Code, branches and notes stay local.</span>
                </div>
              </div>
              <div className="local-item">
                <MessageSquare size={14} />
                <div>
                  <strong>Decisions live with the code</strong>
                  <span>Briefs, notes and comments per branch.</span>
                </div>
              </div>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
