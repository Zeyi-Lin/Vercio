import { ArrowUpRight, GitBranch } from "lucide-react";
import { Link } from "../lib/router";
import { useT } from "../i18n";
import { firstLine, initials, projectSlug, relativeTime } from "../lib/format";
import { frameworkLabel } from "../lib/framework";
import type { Deployment, Project } from "../lib/types";
import { Badge, StatusPill } from "./ui";

function markHue(name: string): number {
  let hash = 0;
  for (let index = 0; index < name.length; index += 1) {
    hash = name.charCodeAt(index) + ((hash << 5) - hash);
  }
  return Math.abs(hash) % 360;
}

export function ProjectMark({ name, size = "md" }: { name: string; size?: "sm" | "md" | "lg" }) {
  const hue = markHue(name);
  return (
    <span
      className={
        "project-mark" +
        (size === "sm" ? " project-mark-sm" : size === "lg" ? " project-mark-lg" : "")
      }
      style={{ ["--mark-hue" as string]: hue }}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
}

export function ProjectCard({
  project,
  latestDeployment,
}: {
  project: Project;
  latestDeployment?: Deployment;
}) {
  const t = useT();
  const summary =
    project.tagline || (project.description ? firstLine(project.description) : "");
  const importing = project.status === "importing";
  const failed = project.status === "error";

  return (
    <Link to={"/p/" + project.id} className={"project-card" + (importing ? " project-card-loading" : "")}>
      <div className="project-card-top">
        <ProjectMark name={project.name} />
        <div className="project-card-title">
          <div className="project-card-name">
            <h3>{project.name}</h3>
            {project.isDemo && <Badge tone="blue">{t("project.demo")}</Badge>}
          </div>
          <span className="project-card-slug mono truncate">
            {project.source.kind === "path" ? "local" : project.source.kind === "demo" ? "local · demo" : "github"} ·{" "}
            {project.defaultBranch || "main"}
          </span>
        </div>
        <span className="project-card-status">
          {importing ? (
            <span className="status status-pending"><span className="status-dot" />{t("project.importing")}</span>
          ) : failed ? (
            <span className="status status-error"><span className="status-dot" />{t("project.importFailed")}</span>
          ) : latestDeployment ? (
            <StatusPill status={latestDeployment.status} />
          ) : (
            <span className="status status-idle"><span className="status-dot" />{t("project.notDeployed")}</span>
          )}
        </span>
      </div>

      <p className={"project-card-desc" + (summary ? "" : " project-card-desc-empty")}>
        {importing
          ? t("project.cloning")
          : failed
            ? project.error || t("project.importError")
            : summary || t("project.noDescription")}
      </p>

      <div className="project-card-meta">
        <span className="project-card-meta-item">
          <GitBranch size={12} />
          {t("project.branches", { count: project.branchCount || 0 })}
        </span>
        {project.framework && (
          <>
            <span className="dot-sep">·</span>
            <span className="project-card-meta-item">{frameworkLabel(project.framework, t)}</span>
          </>
        )}
        {importing && (
          <>
            <span className="dot-sep">·</span>
            <span className="project-card-meta-item">
              <span className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5 }} />
              {t("project.working")}
            </span>
          </>
        )}
      </div>

      <div className="project-card-footer">
        {project.latestCommit ? (
          <>
            <span className="avatar" style={{ width: 20, height: 20, fontSize: 9 }}>
              {initials(project.latestCommit.author)}
            </span>
            <span className="project-card-commit truncate">
              <span className="mono" style={{ color: "var(--text-faint)" }}>{project.latestCommit.shortSha}</span>{" "}
              {project.latestCommit.message}
            </span>
            <time className="project-card-time">{relativeTime(project.latestCommit.date)}</time>
          </>
        ) : (
          <span className="project-card-commit muted">{projectSlug(project)}</span>
        )}
        <span className="project-card-open">
          {t("project.open")} <ArrowUpRight size={13} />
        </span>
      </div>
    </Link>
  );
}
