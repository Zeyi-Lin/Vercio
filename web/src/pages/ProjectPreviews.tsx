import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  GitBranch,
  GitCompare,
  MessageSquare,
  Monitor,
  Smartphone,
  Square,
  Tablet,
} from "lucide-react";
import { api } from "../lib/api";
import { useApp } from "../context/AppContext";
import { useInterval } from "../lib/hooks";
import { relativeTime } from "../lib/format";
import type {
  BranchChanges,
  BranchList,
  Deployment,
  Note,
  Project,
} from "../lib/types";
import { useToast } from "../components/Toast";
import { BranchPanel } from "../components/BranchPanel";
import { BrowserFrame, isPendingStatus } from "../components/PreviewPane";
import { CommentsPanel } from "../components/CommentsPanel";
import { Badge, Button, EmptyState, Skeleton, StatusPill } from "../components/ui";

type Device = "desktop" | "tablet" | "mobile";

const DEVICES: { id: Device; label: string; icon: typeof Monitor }[] = [
  { id: "desktop", label: "Desktop", icon: Monitor },
  { id: "tablet", label: "Tablet", icon: Tablet },
  { id: "mobile", label: "Mobile", icon: Smartphone },
];

export function ProjectPreviews({ project }: { project: Project }) {
  const { openModal } = useApp();
  const { pushToast } = useToast();
  const [data, setData] = useState<BranchList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [branchRefreshing, setBranchRefreshing] = useState(false);
  const [selected, setSelected] = useState("");
  const [compare, setCompare] = useState(false);
  const [compareBranch, setCompareBranch] = useState("");
  const [device, setDevice] = useState<Device>("desktop");
  const [deployments, setDeployments] = useState<Record<string, Deployment>>({});
  const [logs, setLogs] = useState<Record<string, string>>({});
  const [reloads, setReloads] = useState<Record<string, number>>({});
  const [showComments, setShowComments] = useState(false);
  const [commentCount, setCommentCount] = useState(0);
  const [changes, setChanges] = useState<BranchChanges | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const inflight = useRef<Set<string>>(new Set());
  const deploymentsRef = useRef(deployments);
  deploymentsRef.current = deployments;

  const loadBranches = useCallback(
    async (silent = false) => {
      if (!silent) setBranchRefreshing(true);
      try {
        const result = await api.branches(project.id);
        setData(result);
        setError("");
        return result;
      } catch (loadError) {
        if (!silent) {
          setError(loadError instanceof Error ? loadError.message : "Could not load branches");
          setLoading(false);
        }
        return null;
      } finally {
        if (!silent) {
          setLoading(false);
          setBranchRefreshing(false);
        }
      }
    },
    [project.id]
  );

  useEffect(() => {
    setLoading(true);
    setData(null);
    setSelected("");
    setDeployments({});
    setLogs({});
    setChanges(null);
    setShowComments(false);
    loadBranches(false);
  }, [project.id, loadBranches]);

  useEffect(() => {
    const handler = (event: Event) => {
      const payload = (event as CustomEvent).detail as {
        type?: string;
        data?: { projectId?: string };
      };
      if (!payload?.data?.projectId || payload.data.projectId === project.id) {
        loadBranches(true);
      }
    };
    window.addEventListener("vercio:event", handler);
    return () => window.removeEventListener("vercio:event", handler);
  }, [loadBranches, project.id]);

  // Merge the latest deployment snapshot coming from the branches API.
  useEffect(() => {
    if (!data) return;
    setDeployments((current) => {
      const next = { ...current };
      for (const branch of data.branches) {
        if (!branch.deployment) continue;
        const existing = next[branch.name];
        if (!existing || branch.deployment.createdAt >= existing.createdAt) {
          next[branch.name] = branch.deployment;
        }
      }
      return next;
    });
  }, [data]);

  const fetchLogs = useCallback(async (deploymentId: string) => {
    try {
      const result = await api.deploymentLogs(deploymentId);
      setLogs((current) => ({ ...current, [deploymentId]: result.log }));
    } catch {}
  }, []);

  const ensureDeployment = useCallback(
    async (branch: string, force = false): Promise<Deployment | null> => {
      if (!branch) return null;
      const existing =
        deploymentsRef.current[branch] ||
        data?.branches.find((item) => item.name === branch)?.deployment;
      if (!force && existing && (existing.status === "ready" || isPendingStatus(existing.status))) {
        setDeployments((current) =>
          current[branch]?.id === existing.id ? current : { ...current, [branch]: existing }
        );
        return existing;
      }
      if (inflight.current.has(branch)) return deploymentsRef.current[branch] || null;
      inflight.current.add(branch);
      try {
        const result = await api.deploy(project.id, branch);
        setDeployments((current) => ({ ...current, [branch]: result.deployment }));
        if (isPendingStatus(result.deployment.status)) fetchLogs(result.deployment.id);
        return result.deployment;
      } catch (deployError) {
        pushToast(
          deployError instanceof Error ? deployError.message : "Could not start preview",
          "error"
        );
        return null;
      } finally {
        inflight.current.delete(branch);
      }
    },
    [project.id, data, pushToast, fetchLogs]
  );

  // Pick the initial branch from the URL once branches are available.
  useEffect(() => {
    if (!data || selected) return;
    const params = new URLSearchParams(window.location.search);
    const wanted = params.get("branch");
    const initial =
      wanted && data.branches.some((branch) => branch.name === wanted)
        ? wanted
        : data.defaultBranch;
    setSelected(initial);
    ensureDeployment(initial);
    const compareWanted = params.get("compare");
    if (
      compareWanted &&
      compareWanted !== initial &&
      data.branches.some((branch) => branch.name === compareWanted)
    ) {
      setCompare(true);
      setCompareBranch(compareWanted);
      ensureDeployment(compareWanted);
    } else {
      const other = data.branches.find((branch) => branch.name !== initial)?.name || "";
      setCompareBranch(other);
    }
  }, [data, selected, ensureDeployment]);

  // Keep the URL shareable with the selected branch.
  useEffect(() => {
    if (!selected) return;
    const params = new URLSearchParams();
    params.set("branch", selected);
    if (compare && compareBranch) params.set("compare", compareBranch);
    const next = "/p/" + project.id + "/previews?" + params.toString();
    if (window.location.pathname + window.location.search !== next) {
      window.history.replaceState({}, "", next);
    }
  }, [selected, compare, compareBranch, project.id]);

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    setChanges(null);
    api
      .changes(project.id, selected)
      .then((result) => {
        if (!cancelled) setChanges(result);
      })
      .catch(() => {});
    api
      .comments(project.id, selected)
      .then((result) => {
        if (!cancelled) setCommentCount(result.comments.length);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [project.id, selected]);

  useEffect(() => {
    api
      .notes(project.id)
      .then((result) => setNotes(result.notes))
      .catch(() => {});
  }, [project.id]);

  const primaryDeployment = deployments[selected] || null;
  const compareDeployment = compareBranch ? deployments[compareBranch] || null : null;

  const pendingDeployments = useMemo(() => {
    const list: Deployment[] = [];
    for (const deployment of [primaryDeployment, compare ? compareDeployment : null]) {
      if (deployment && isPendingStatus(deployment.status)) list.push(deployment);
    }
    return list;
  }, [primaryDeployment, compareDeployment, compare]);

  useInterval(
    () => {
      if (!pendingDeployments.length) return;
      let terminal = false;
      Promise.all(
        pendingDeployments.map(async (deployment) => {
          try {
            const [deploymentResult, logResult] = await Promise.all([
              api.deployment(deployment.id),
              api.deploymentLogs(deployment.id),
            ]);
            setLogs((current) => ({ ...current, [deployment.id]: logResult.log }));
            setDeployments((current) => {
              const next = { ...current };
              for (const branch of Object.keys(next)) {
                if (next[branch].id === deployment.id) next[branch] = deploymentResult.deployment;
              }
              return next;
            });
            if (!isPendingStatus(deploymentResult.deployment.status)) terminal = true;
          } catch {}
        })
      ).then(() => {
        if (terminal) loadBranches(true);
      });
    },
    pendingDeployments.length ? 1100 : null
  );

  const selectBranch = (branch: string) => {
    setSelected(branch);
    if (compare && branch === compareBranch) {
      const alternative = data?.branches.find((item) => item.name !== branch)?.name;
      if (alternative) {
        setCompareBranch(alternative);
        ensureDeployment(alternative);
      }
    }
    ensureDeployment(branch);
  };

  const toggleCompare = () => {
    if (compare) {
      setCompare(false);
      return;
    }
    const alternative = data?.branches.find((item) => item.name !== selected)?.name;
    if (!alternative) return;
    setShowComments(false);
    setCompare(true);
    setCompareBranch(alternative);
    ensureDeployment(alternative);
  };

  const chooseCompareBranch = (branch: string) => {
    setCompareBranch(branch);
    ensureDeployment(branch);
  };

  const reloadBranch = (branch: string) => {
    setReloads((current) => ({ ...current, [branch]: (current[branch] || 0) + 1 }));
  };

  const retryBranch = (branch: string) => {
    ensureDeployment(branch, true);
  };

  const stopBranch = async (branch: string) => {
    const deployment = deploymentsRef.current[branch];
    if (!deployment) return;
    try {
      const result = await api.stopDeployment(deployment.id);
      setDeployments((current) => ({ ...current, [branch]: result.deployment }));
      pushToast("Preview stopped", "info");
    } catch (stopError) {
      pushToast(stopError instanceof Error ? stopError.message : "Could not stop preview", "error");
    }
  };

  if (error && !data) {
    return (
      <div className="previews-error card">
        <span className="empty-icon"><AlertCircle size={18} /></span>
        <h3>Could not load branches</h3>
        <p className="muted">{error}</p>
        <Button size="sm" variant="secondary" onClick={() => loadBranches(false)}>
          Try again
        </Button>
      </div>
    );
  }

  if (loading && !data) {
    return (
      <div className="previews previews-loading">
        <aside className="branch-panel">
          <div className="branch-panel-head"><Skeleton width={90} height={14} /></div>
          <div className="branch-list">
            {[0, 1, 2, 3, 4].map((index) => (
              <div className="branch-item" key={index}>
                <Skeleton width="70%" height={11} />
                <Skeleton width="90%" height={9} style={{ marginTop: 9 }} />
                <Skeleton width="45%" height={8} style={{ marginTop: 9 }} />
              </div>
            ))}
          </div>
        </aside>
        <section className="preview-stage">
          <Skeleton height={40} style={{ margin: 14 }} />
          <div style={{ padding: 20, flex: 1 }}>
            <Skeleton height="100%" style={{ minHeight: 380 }} />
          </div>
        </section>
      </div>
    );
  }

  if (data && data.branches.length === 0) {
    return (
      <div className="card">
        <EmptyState
          icon={<GitBranch size={18} />}
          title="No branches found"
          description="Make a commit on this repository, then refresh the branch list."
          actions={
            <Button size="sm" variant="secondary" onClick={() => loadBranches(false)}>
              Refresh branches
            </Button>
          }
        />
      </div>
    );
  }

  const selectedIsDefault = data?.branches.find((branch) => branch.name === selected)?.isDefault;

  return (
    <div className={"previews" + (showComments ? " previews-with-discussion" : "")}>
      <BranchPanel
        branches={data?.branches || []}
        loading={loading}
        selected={selected}
        deployments={deployments}
        compare={compare}
        compareBranch={compareBranch}
        refreshing={branchRefreshing}
        onSelect={selectBranch}
        onRefresh={() => loadBranches(false)}
      />

      <section className="preview-stage">
        <div className="preview-toolbar">
          <div className="preview-toolbar-left">
            <span className="toolbar-branch">
              <GitBranch size={12} />
              <span className="mono truncate">{selected || "Select a branch"}</span>
            </span>
            {primaryDeployment && <StatusPill status={primaryDeployment.status} />}
            {primaryDeployment?.mode && (
              <span className="toolbar-mode">{primaryDeployment.mode === "server" ? "dev server" : "static"}</span>
            )}
            {selectedIsDefault && <span className="toolbar-mode">production</span>}
          </div>
          <div className="preview-toolbar-right">
            <div className="segmented device-toggle" role="group" aria-label="Preview viewport">
              {DEVICES.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  className={"segmented-option" + (device === id ? " active" : "")}
                  onClick={() => setDevice(id)}
                  title={label + " preview"}
                  aria-label={label + " preview"}
                  disabled={compare}
                >
                  <Icon size={13} />
                </button>
              ))}
            </div>
            <Button
              size="sm"
              variant="secondary"
              className={"toolbar-btn" + (compare ? " is-active" : "")}
              icon={<GitCompare size={13} />}
              onClick={toggleCompare}
              disabled={!data || data.branches.length < 2}
            >
              Compare
            </Button>
            <Button
              size="sm"
              variant="secondary"
              className={"toolbar-btn" + (showComments ? " is-active" : "")}
              icon={<MessageSquare size={13} />}
              onClick={() =>
                setShowComments((value) => {
                  if (!value) setCompare(false);
                  return !value;
                })
              }
            >
              Discussion
              {commentCount > 0 && <span className="btn-count">{commentCount}</span>}
            </Button>
          </div>
        </div>

        <div className={"preview-panes" + (compare ? " preview-panes-compare" : "")}>
          {selected ? (
            <BrowserFrame
              deployment={primaryDeployment}
              branch={selected}
              device={device}
              logs={primaryDeployment ? logs[primaryDeployment.id] || "" : ""}
              reloadKey={reloads[selected] || 0}
              onReload={() => reloadBranch(selected)}
              onRetry={() => retryBranch(selected)}
              onStop={primaryDeployment ? () => stopBranch(selected) : undefined}
            />
          ) : (
            <div className="preview-placeholder">
              <EmptyState
                icon={<GitBranch size={18} />}
                title="Pick a branch to preview"
                description="Every branch gets an isolated worktree and its own live preview."
              />
            </div>
          )}

          {compare && (
            <BrowserFrame
              deployment={compareDeployment}
              branch={compareBranch}
              device={device}
              logs={compareDeployment ? logs[compareDeployment.id] || "" : ""}
              reloadKey={reloads[compareBranch] || 0}
              onReload={() => reloadBranch(compareBranch)}
              onRetry={() => retryBranch(compareBranch)}
              onStop={compareDeployment ? () => stopBranch(compareBranch) : undefined}
              branchPicker={
                <select
                  className="branch-picker mono"
                  value={compareBranch}
                  onChange={(event) => chooseCompareBranch(event.target.value)}
                  title="Compare against another branch"
                  aria-label="Compare against another branch"
                >
                  {data?.branches
                    .filter((branch) => branch.name !== selected)
                    .map((branch) => (
                      <option key={branch.name} value={branch.name}>
                        {branch.name}
                      </option>
                    ))}
                </select>
              }
            />
          )}
        </div>

        <div className="preview-meta-bar">
          <div className="preview-meta-left">
            {primaryDeployment ? (
              <>
                <span className="commit-sha mono">{primaryDeployment.shortSha}</span>
                <span className="commit-msg truncate">{primaryDeployment.commitMessage}</span>
                <span className="dot-sep">·</span>
                <span className="meta-muted">{primaryDeployment.author}</span>
                <span className="dot-sep">·</span>
                <span className="meta-muted">{relativeTime(primaryDeployment.createdAt)}</span>
              </>
            ) : (
              <span className="muted">No preview running for this branch.</span>
            )}
          </div>
          <div className="preview-meta-right">
            {changes && (
              <span className="changes-summary" title={"Compared with " + changes.base}>
                <span className="changes-plus">+{changes.additions}</span>
                <span className="changes-minus">−{changes.deletions}</span>
                <span className="meta-muted">{changes.fileCount} files</span>
              </span>
            )}
            {primaryDeployment?.framework && <Badge>{primaryDeployment.framework.label}</Badge>}
            {primaryDeployment && primaryDeployment.status === "ready" && (
              <Button
                size="sm"
                variant="ghost"
                icon={<Square size={10} />}
                onClick={() => stopBranch(selected)}
              >
                Stop preview
              </Button>
            )}
            {primaryDeployment && (
              <span className="deployment-id mono" title="Deployment ID">
                {primaryDeployment.id}
              </span>
            )}
            <button className="link-button" onClick={() => openModal("share")}>
              Share preview
            </button>
          </div>
        </div>
      </section>

      {showComments && selected && (
        <CommentsPanel
          project={project}
          branch={selected}
          notes={notes}
          onClose={() => setShowComments(false)}
          onCountChange={setCommentCount}
        />
      )}
    </div>
  );
}
