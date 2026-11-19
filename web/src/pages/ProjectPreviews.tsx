import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Ellipsis,
  GitBranch,
  GitCompare,
  MessageSquare,
  Minimize2,
  Monitor,
  RefreshCw,
  Settings,
  Smartphone,
  Square,
  Tablet,
} from "lucide-react";
import { api } from "../lib/api";
import { useApp } from "../context/AppContext";
import { useT } from "../i18n";
import { useInterval, useMediaQuery } from "../lib/hooks";
import { relativeTime } from "../lib/format";
import { frameworkLabel } from "../lib/framework";
import { Link, useRouter } from "../lib/router";
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

const DEVICES: { id: Device; labelKey: "preview.device.desktop" | "preview.device.tablet" | "preview.device.mobile"; icon: typeof Monitor }[] = [
  { id: "desktop", labelKey: "preview.device.desktop", icon: Monitor },
  { id: "tablet", labelKey: "preview.device.tablet", icon: Tablet },
  { id: "mobile", labelKey: "preview.device.mobile", icon: Smartphone },
];

const BRANCH_PANEL_COLLAPSED_KEY = "vercio:branch-panel-collapsed";

export function ProjectPreviews({
  project,
  onRefreshRepo,
  repoRefreshing = false,
}: {
  project: Project;
  onRefreshRepo?: () => void;
  repoRefreshing?: boolean;
}) {
  const { openModal } = useApp();
  const { navigate } = useRouter();
  const { pushToast } = useToast();
  const t = useT();
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
  const [menuOpen, setMenuOpen] = useState(false);
  const [pinnedBranch, setPinnedBranch] = useState<string | null>(project.pinnedBranch ?? null);
  const [reattaching, setReattaching] = useState(false);
  const [focus, setFocus] = useState(false);
  const [branchesCollapsed, setBranchesCollapsed] = useState(() => {
    try {
      return window.localStorage.getItem(BRANCH_PANEL_COLLAPSED_KEY) === "1";
    } catch {
      return false;
    }
  });
  const narrowWorkspace = useMediaQuery("(max-width: 860px)");
  // The stacked mobile layout needs the full panel; ignore the stored fold there.
  const branchesFolded = branchesCollapsed && !narrowWorkspace;
  const menuRef = useRef<HTMLDivElement | null>(null);
  const inflight = useRef<Set<string>>(new Set());
  const deploymentsRef = useRef(deployments);
  deploymentsRef.current = deployments;

  useEffect(() => {
    try {
      window.localStorage.setItem(BRANCH_PANEL_COLLAPSED_KEY, branchesCollapsed ? "1" : "0");
    } catch {}
  }, [branchesCollapsed]);

  // Keep the pin in sync when the project is refreshed from another view.
  useEffect(() => {
    setPinnedBranch(project.pinnedBranch ?? null);
  }, [project.id, project.pinnedBranch]);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  // Immersive preview fills the browser viewport only: browser tabs and the
  // address bar stay visible, unlike the native Fullscreen API.
  const enterFocus = useCallback(() => setFocus(true), []);
  const exitFocus = useCallback(() => setFocus(false), []);

  useEffect(() => {
    if (!focus) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        exitFocus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [focus, exitFocus]);

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
          setError(loadError instanceof Error ? loadError.message : t("preview.couldNotLoad"));
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

  const deploymentFor = useCallback(
    (branch: string): Deployment | null =>
      deploymentsRef.current[branch] ||
      data?.branches.find((item) => item.name === branch)?.deployment ||
      null,
    [data]
  );

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
          deployError instanceof Error ? deployError.message : t("preview.startError"),
          "error"
        );
        return null;
      } finally {
        inflight.current.delete(branch);
      }
    },
    [project.id, data, pushToast, fetchLogs]
  );

  const startBranch = useCallback(
    (branch: string) => {
      if (!branch) return;
      void ensureDeployment(branch);
    },
    [ensureDeployment]
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
    // Never start a local service implicitly: a ready/pending deployment is
    // reused below by the branch snapshot merge, everything else shows the
    // in-pane start affordance instead.
    const compareWanted = params.get("compare");
    if (
      compareWanted &&
      compareWanted !== initial &&
      data.branches.some((branch) => branch.name === compareWanted)
    ) {
      setCompare(true);
      setCompareBranch(compareWanted);
    } else {
      const other = data.branches.find((branch) => branch.name !== initial)?.name || "";
      setCompareBranch(other);
    }
  }, [data, selected]);

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
  const primaryLiveState: "following" | "snapshot" | "detached" =
    primaryDeployment?.liveState || (primaryDeployment?.live ? "following" : "snapshot");
  const selectedSource = data?.sources?.find((source) => source.branch === selected) || null;
  const primarySourceLabel =
    primaryDeployment?.sourceKind === "working-copy"
      ? t("preview.sourceWorkingCopy")
      : t("preview.sourceWorktree");
  const fetchedLogSnapshots = useRef<Record<string, string>>({});

  useEffect(() => {
    if (focus && primaryDeployment?.status !== "ready") exitFocus();
  }, [focus, primaryDeployment?.status, exitFocus]);

  // The status poll stops as soon as a deployment reaches a terminal state, and
  // SSE refreshes can flip that state before the poll gets another tick. Keep a
  // log snapshot per deployment/status transition so failed or stopped previews
  // always show the complete output (including anything the process flushed
  // while shutting down, which arrives just after the error).
  useEffect(() => {
    const targets = [primaryDeployment, compare ? compareDeployment : null].filter(
      (item): item is Deployment => Boolean(item)
    );
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (const deployment of targets) {
      const snapshot = deployment.id + ":" + deployment.status;
      if (fetchedLogSnapshots.current[deployment.id] === snapshot) continue;
      fetchedLogSnapshots.current[deployment.id] = snapshot;
      fetchLogs(deployment.id);
      if (!isPendingStatus(deployment.status)) {
        timers.push(setTimeout(() => fetchLogs(deployment.id), 600));
      }
    }
    return () => {
      for (const timer of timers) clearTimeout(timer);
    };
  }, [
    primaryDeployment?.id,
    primaryDeployment?.status,
    compare,
    compareDeployment?.id,
    compareDeployment?.status,
    fetchLogs,
  ]);

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

  const applySelection = (branch: string) => {
    setSelected(branch);
    if (compare && branch === compareBranch) {
      const alternative = data?.branches.find((item) => item.name !== branch)?.name;
      if (alternative) setCompareBranch(alternative);
    }
    const existing = deploymentFor(branch);
    if (existing) {
      setDeployments((current) =>
        current[branch]?.id === existing.id ? current : { ...current, [branch]: existing }
      );
    }
  };

  const selectBranch = (branch: string) => {
    if (!branch || branch === selected) return;
    // Switching is side-effect free: an unstarted branch just shows the
    // "preview not running" panel with an explicit start button.
    applySelection(branch);
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
  };

  const chooseCompareBranch = (branch: string) => {
    setCompareBranch(branch);
  };

  const reloadBranch = (branch: string) => {
    setReloads((current) => ({ ...current, [branch]: (current[branch] || 0) + 1 }));
  };

  const retryBranch = (branch: string) => {
    ensureDeployment(branch, true);
  };

  const pinBranch = useCallback(
    async (branch: string | null) => {
      const previous = pinnedBranch;
      setPinnedBranch(branch);
      try {
        const result = await api.updateProject(project.id, { pinnedBranch: branch });
        setPinnedBranch(result.project.pinnedBranch ?? null);
      } catch (pinError) {
        setPinnedBranch(previous);
        pushToast(
          pinError instanceof Error ? pinError.message : t("preview.pinError"),
          "error"
        );
      }
    },
    [pinnedBranch, project.id, pushToast, t]
  );

  const stopBranch = async (branch: string) => {
    const deployment = deploymentsRef.current[branch];
    if (!deployment) return;
    try {
      const result = await api.stopDeployment(deployment.id);
      setDeployments((current) => ({ ...current, [branch]: result.deployment }));
      pushToast(t("preview.stoppedToast"), "info");
    } catch (stopError) {
      pushToast(stopError instanceof Error ? stopError.message : t("preview.stopError"), "error");
    }
  };

  const reattachBranch = async (branch: string) => {
    const deployment = deploymentFor(branch);
    if (!deployment) return;
    setReattaching(true);
    try {
      const result = await api.followDeployment(deployment.id);
      setDeployments((current) => ({ ...current, [branch]: result.deployment }));
      if (result.deployment.liveState === "following") {
        pushToast(t("preview.reattachOk"), "info");
      } else {
        pushToast(t("preview.reattachNoSource"), "info");
      }
    } catch (reattachError) {
      pushToast(
        reattachError instanceof Error ? reattachError.message : t("preview.reattachError"),
        "error"
      );
    } finally {
      setReattaching(false);
    }
  };

  if (error && !data) {
    return (
      <div className="previews previews-fallback">
        <div className="previews-error card">
          <span className="empty-icon"><AlertCircle size={18} /></span>
          <h3>{t("preview.couldNotLoad")}</h3>
          <p className="muted">{error}</p>
          <Button size="sm" variant="secondary" onClick={() => loadBranches(false)}>
            {t("preview.tryAgain")}
          </Button>
        </div>
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
      <div className="previews previews-fallback">
        <div className="card">
          <EmptyState
            icon={<GitBranch size={18} />}
            title={t("preview.noBranches")}
            description={t("preview.noBranchesDesc")}
            actions={
              <Button size="sm" variant="secondary" onClick={() => loadBranches(false)}>
                {t("preview.refreshBranchesBtn")}
              </Button>
            }
          />
        </div>
      </div>
    );
  }

  const selectedIsDefault = data?.branches.find((branch) => branch.name === selected)?.isDefault;

  return (
    <div
      className={
        "previews" +
        (branchesFolded ? " previews-branches-collapsed" : "") +
        (showComments ? " previews-with-discussion" : "")
      }
    >
      <BranchPanel
        branches={data?.branches || []}
        sources={data?.sources || []}
        loading={loading}
        selected={selected}
        deployments={deployments}
        compare={compare}
        compareBranch={compareBranch}
        refreshing={branchRefreshing}
        onSelect={selectBranch}
        onRefresh={() => loadBranches(false)}
        pinnedBranch={pinnedBranch}
        onPinBranch={pinBranch}
        collapsed={branchesFolded}
        onToggleCollapsed={() => setBranchesCollapsed((value) => !value)}
        footerActions={
          <div className="toolbar-menu" ref={menuRef}>
            <button
              type="button"
              className={"icon-btn toolbar-icon" + (menuOpen ? " is-active" : "")}
              onClick={() => setMenuOpen((value) => !value)}
              title={t("preview.moreActions")}
              aria-label={t("preview.moreActions")}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
            >
              <Ellipsis size={14} />
            </button>
            {menuOpen && (
              <div className="toolbar-menu-pop" role="menu">
                <button
                  type="button"
                  className="toolbar-menu-item"
                  role="menuitemcheckbox"
                  aria-checked={compare}
                  disabled={!data || data.branches.length < 2}
                  onClick={() => {
                    setMenuOpen(false);
                    toggleCompare();
                  }}
                >
                  <GitCompare size={13} />
                  {t("preview.compare")}
                </button>
                <Link
                  to={"/p/" + project.id + "/overview"}
                  className="toolbar-menu-item"
                  role="menuitem"
                  onClick={() => setMenuOpen(false)}
                >
                  {t("project.tab.overview")}
                </Link>
                <Link
                  to={"/p/" + project.id + "/notes"}
                  className="toolbar-menu-item"
                  role="menuitem"
                  onClick={() => setMenuOpen(false)}
                >
                  {t("project.tab.notes")}
                </Link>
                <button
                  type="button"
                  className="toolbar-menu-item"
                  role="menuitem"
                  disabled={!onRefreshRepo || repoRefreshing}
                  onClick={() => {
                    setMenuOpen(false);
                    onRefreshRepo?.();
                  }}
                >
                  <RefreshCw size={13} className={repoRefreshing ? "spin" : ""} />
                  {repoRefreshing ? t("project.refreshing") : t("project.refresh")}
                </button>
              </div>
            )}
          </div>
        }
      />

      <section className="preview-stage">
        <div className="preview-toolbar">
          <div className="preview-toolbar-left">
            <span className="toolbar-branch">
              <GitBranch size={12} />
              <span className="mono truncate">{selected || t("preview.selectBranch")}</span>
            </span>
            {primaryDeployment && <StatusPill status={primaryDeployment.status} />}
            {primaryDeployment?.status === "ready" && primaryLiveState === "following" && (
              <span
                className="toolbar-live"
                title={t("preview.liveHint", {
                  source: primarySourceLabel,
                  branch: selected,
                })}
              >
                <span className="live-dot" />
                {t("preview.live")}
              </span>
            )}
            {primaryDeployment?.status === "ready" &&
              primaryLiveState === "following" &&
              primaryDeployment.sourceKind && (
                <span className="toolbar-mode">{primarySourceLabel}</span>
              )}
            {primaryDeployment?.status === "ready" && primaryLiveState === "snapshot" && (
              <span
                className="toolbar-snapshot"
                title={t("preview.snapshotHint", {
                  branch: selected,
                  sha: primaryDeployment.shortSha,
                })}
              >
                {t("preview.snapshot")} · {primaryDeployment.shortSha}
              </span>
            )}
            {primaryDeployment?.status === "ready" && primaryLiveState === "detached" && (
              <span
                className="toolbar-live is-paused"
                title={t("preview.detachedHint", { branch: selected })}
              >
                <span className="live-dot" />
                {t("preview.detached")}
              </span>
            )}
            {!primaryDeployment && selectedSource && (
              <span
                className="toolbar-snapshot"
                title={t("preview.sourceAvailableHint", { branch: selected })}
              >
                {t("preview.sourceAvailable")}
              </span>
            )}
            {primaryDeployment?.mode && (
              <span className="toolbar-mode">{primaryDeployment.mode === "server" ? t("preview.devServer") : t("preview.static")}</span>
            )}
            {selectedIsDefault && <span className="toolbar-mode">{t("preview.production")}</span>}
          </div>
          <div className="preview-toolbar-right">
            <div className="segmented device-toggle" role="group" aria-label={t("preview.viewportAria")}>
              {DEVICES.map(({ id, labelKey, icon: Icon }) => (
                <button
                  key={id}
                  className={"segmented-option" + (device === id ? " active" : "")}
                  onClick={() => setDevice(id)}
                  title={t("preview.deviceAria", { device: t(labelKey) })}
                  aria-label={t("preview.deviceAria", { device: t(labelKey) })}
                  disabled={compare}
                >
                  <Icon size={13} />
                </button>
              ))}
            </div>
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
              {t("preview.discussion")}
              {commentCount > 0 && <span className="btn-count">{commentCount}</span>}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              className="toolbar-btn"
              icon={<Settings size={13} />}
              onClick={() => navigate("/p/" + project.id + "/settings")}
            >
              {t("preview.settings")}
            </Button>
          </div>
        </div>

        {primaryDeployment?.status === "ready" && primaryLiveState === "detached" && (
          <div className="preview-live-banner">
            <AlertCircle size={14} className="preview-live-banner-icon" />
            <div className="preview-live-banner-text">
              <strong>{t("preview.detached")}</strong>
              <span>{t("preview.detachedHint", { branch: selected })}</span>
            </div>
            <Button
              size="sm"
              variant="secondary"
              disabled={reattaching}
              onClick={() => reattachBranch(selected)}
            >
              {reattaching ? t("preview.reattaching") : t("preview.reattach")}
            </Button>
          </div>
        )}

        <div className={"preview-panes" + (compare ? " preview-panes-compare" : "")}>
          {selected ? (
            <div className={"preview-frame-wrap" + (focus ? " is-focus" : "")}>
              <BrowserFrame
                deployment={primaryDeployment}
                branch={selected}
                device={device}
                logs={primaryDeployment ? logs[primaryDeployment.id] || "" : ""}
                reloadKey={reloads[selected] || 0}
                onReload={() => reloadBranch(selected)}
                onStart={() => startBranch(selected)}
                onRetry={() => retryBranch(selected)}
                onStop={primaryDeployment ? () => stopBranch(selected) : undefined}
                onFullscreen={enterFocus}
              />
              {focus && (
                <button
                  type="button"
                  className="preview-focus-exit"
                  onClick={exitFocus}
                >
                  <Minimize2 size={14} />
                  {t("preview.exitFullscreen")}
                  <span className="preview-focus-kbd">Esc</span>
                </button>
              )}
            </div>
          ) : (
            <div className="preview-placeholder">
              <EmptyState
                icon={<GitBranch size={18} />}
                title={t("preview.pickBranch")}
                description={t("preview.pickBranchDesc")}
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
              onStart={() => startBranch(compareBranch)}
              onRetry={() => retryBranch(compareBranch)}
              onStop={compareDeployment ? () => stopBranch(compareBranch) : undefined}
              branchPicker={
                <select
                  className="branch-picker mono"
                  value={compareBranch}
                  onChange={(event) => chooseCompareBranch(event.target.value)}
                  title={t("preview.compareAgainst")}
                  aria-label={t("preview.compareAgainst")}
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
              <span className="muted">{t("preview.noPreview")}</span>
            )}
          </div>
          <div className="preview-meta-right">
            {changes && (
              <span className="changes-summary" title={t("preview.changesTitle", { branch: changes.base })}>
                <span className="changes-plus">+{changes.additions}</span>
                <span className="changes-minus">−{changes.deletions}</span>
                <span className="meta-muted">{t("preview.files", { count: changes.fileCount })}</span>
              </span>
            )}
            {primaryDeployment?.framework && <Badge>{frameworkLabel(primaryDeployment.framework, t)}</Badge>}
            {primaryDeployment && primaryDeployment.status === "ready" && (
              <Button
                size="sm"
                variant="ghost"
                icon={<Square size={10} />}
                onClick={() => stopBranch(selected)}
              >
                {t("preview.stop")}
              </Button>
            )}
            {primaryDeployment && (
              <span className="deployment-id mono" title={t("preview.deploymentId")}>
                {primaryDeployment.id}
              </span>
            )}
            <button
              className="link-button"
              onClick={() =>
                openModal("share", selected ? { projectId: project.id, branch: selected } : undefined)
              }
            >
              {t("preview.share")}
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
