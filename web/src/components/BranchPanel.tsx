import { useMemo, useState } from "react";
import { GitBranch, RefreshCw, Search } from "lucide-react";
import { relativeTime } from "../lib/format";
import type { Branch, Deployment } from "../lib/types";
import { Skeleton, Spinner } from "./ui";

function branchDeployment(
  branch: Branch,
  deployments: Record<string, Deployment>
): Deployment | null {
  return deployments[branch.name] || branch.deployment || null;
}

export function BranchPanel({
  branches,
  loading,
  selected,
  deployments,
  compareBranch,
  compare,
  refreshing,
  onSelect,
  onRefresh,
}: {
  branches: Branch[];
  loading: boolean;
  selected: string;
  deployments: Record<string, Deployment>;
  compareBranch?: string;
  compare?: boolean;
  refreshing?: boolean;
  onSelect: (branch: string) => void;
  onRefresh: () => void;
}) {
  const [filter, setFilter] = useState("");

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return branches;
    return branches.filter(
      (branch) =>
        branch.name.toLowerCase().includes(needle) ||
        (branch.subject || "").toLowerCase().includes(needle) ||
        (branch.author || "").toLowerCase().includes(needle)
    );
  }, [branches, filter]);

  return (
    <aside className="branch-panel">
      <div className="branch-panel-head">
        <div className="branch-panel-title">
          <h2>Branches</h2>
          <span className="branch-count">{branches.length}</span>
        </div>
        <button
          className="icon-btn"
          onClick={onRefresh}
          disabled={refreshing}
          title="Refresh branches"
          aria-label="Refresh branches"
        >
          {refreshing ? <Spinner /> : <RefreshCw size={14} />}
        </button>
      </div>
      <div className="branch-search">
        <Search size={13} />
        <input
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Find a branch…"
          aria-label="Filter branches"
        />
      </div>
      <div className="branch-list">
        {loading &&
          [0, 1, 2, 3, 4].map((index) => (
            <div className="branch-item branch-item-skeleton" key={index}>
              <Skeleton width="70%" height={12} />
              <Skeleton width="90%" height={10} style={{ marginTop: 8 }} />
              <Skeleton width="45%" height={9} style={{ marginTop: 8 }} />
            </div>
          ))}
        {!loading && visible.length === 0 && (
          <p className="branch-empty">No branches match “{filter}”.</p>
        )}
        {!loading &&
          visible.map((branch) => {
            const deployment = branchDeployment(branch, deployments);
            const active = branch.name === selected;
            const compared = compare && branch.name === compareBranch;
            return (
              <button
                key={branch.name}
                className={
                  "branch-item" +
                  (active ? " branch-item-active" : "") +
                  (compared ? " branch-item-compared" : "")
                }
                onClick={() => onSelect(branch.name)}
                aria-pressed={active}
              >
                <div className="branch-item-top">
                  <GitBranch size={11} className="branch-item-icon" />
                  <span className="branch-item-name mono truncate">{branch.name}</span>
                  {branch.isDefault && <span className="branch-tag">prod</span>}
                </div>
                <div className="branch-item-subject truncate">
                  {branch.subject || "No commit message"}
                </div>
                <div className="branch-item-meta">
                  <span className="truncate">{branch.author}</span>
                  <span className="dot-sep">·</span>
                  <span>{relativeTime(branch.date)}</span>
                  <span className="branch-item-state">
                    {deployment ? (
                      <span className={"branch-state branch-state-" + deployment.status}>
                        <span className="branch-state-dot" />
                        {deployment.status === "ready"
                          ? "ready"
                          : deployment.status === "error"
                            ? "error"
                            : deployment.status === "stopped"
                              ? "idle"
                              : "building"}
                      </span>
                    ) : (
                      <span className="branch-state branch-state-none">
                        <span className="branch-state-dot" />
                        new
                      </span>
                    )}
                  </span>
                </div>
              </button>
            );
          })}
      </div>
      <div className="branch-panel-foot">
        <span>Click a branch to preview it instantly.</span>
      </div>
    </aside>
  );
}
