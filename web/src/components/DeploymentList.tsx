import { ArrowUpRight, GitBranch } from "lucide-react";
import { Link } from "../lib/router";
import { relativeTime } from "../lib/format";
import type { Deployment } from "../lib/types";
import { EmptyState, StatusPill } from "./ui";

export function DeploymentList({
  deployments,
  showProject = true,
  emptyTitle = "No deployments yet",
  emptyDescription,
}: {
  deployments: Deployment[];
  showProject?: boolean;
  emptyTitle?: string;
  emptyDescription?: React.ReactNode;
}) {
  if (!deployments.length) {
    return <EmptyState title={emptyTitle} description={emptyDescription} />;
  }
  if (!showProject) {
    return (
      <div className="deployment-list deployment-list-compact">
        {deployments.map((deployment) => (
          <Link
            key={deployment.id}
            to={
              "/p/" +
              deployment.projectId +
              "/previews?branch=" +
              encodeURIComponent(deployment.branch)
            }
            className="deployment-compact-row"
          >
            <StatusPill status={deployment.status} />
            <span className="deployment-compact-main">
              <span className="deployment-branch mono truncate">
                <GitBranch size={11} />
                {deployment.branch}
              </span>
              <span className="deployment-compact-commit truncate">
                <span className="mono">{deployment.shortSha}</span> {deployment.commitMessage}
              </span>
            </span>
            <span className="deployment-compact-time">{relativeTime(deployment.createdAt)}</span>
            <span className="deployment-arrow">
              <ArrowUpRight size={13} />
            </span>
          </Link>
        ))}
      </div>
    );
  }
  return (
    <div className="deployment-list">
      <div className={"deployment-row deployment-row-head" + (showProject ? "" : " no-project")}>
        <span>Status</span>
        {showProject && <span>Project</span>}
        <span>Branch</span>
        <span>Commit</span>
        <span className="deployment-time-col">Created</span>
        <span />
      </div>
      {deployments.map((deployment) => {
        const href =
          "/p/" +
          deployment.projectId +
          "/previews?branch=" +
          encodeURIComponent(deployment.branch);
        return (
          <Link
            key={deployment.id}
            to={href}
            className={"deployment-row" + (showProject ? "" : " no-project")}
          >
            <StatusPill status={deployment.status} />
            {showProject && <span className="deployment-project truncate">{deployment.projectName}</span>}
            <span className="deployment-branch mono truncate">
              <GitBranch size={11} />
              {deployment.branch}
            </span>
            <span className="deployment-commit truncate">
              <span className="mono" style={{ color: "var(--text-faint)" }}>{deployment.shortSha}</span>{" "}
              {deployment.commitMessage}
            </span>
            <span className="deployment-time-col">{relativeTime(deployment.createdAt)}</span>
            <span className="deployment-arrow">
              <ArrowUpRight size={13} />
            </span>
          </Link>
        );
      })}
    </div>
  );
}
