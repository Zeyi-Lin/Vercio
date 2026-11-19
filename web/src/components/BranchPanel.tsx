import { useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
import {
  Copy,
  GitBranch,
  PanelLeftClose,
  PanelLeftOpen,
  Pin,
  PinOff,
  RefreshCw,
  Search,
} from "lucide-react";
import { useT } from "../i18n";
import { copyText, relativeTime } from "../lib/format";
import type { Branch, BranchSource, Deployment } from "../lib/types";
import { Skeleton, Spinner } from "./ui";
import { useToast } from "./Toast";

function branchDeployment(
  branch: Branch,
  deployments: Record<string, Deployment>
): Deployment | null {
  return deployments[branch.name] || branch.deployment || null;
}

type Translate = ReturnType<typeof useT>;

function deploymentLiveState(deployment: Deployment): "following" | "snapshot" | "detached" {
  return deployment.liveState || (deployment.live ? "following" : "snapshot");
}

function deploymentStateClass(deployment: Deployment): string {
  if (deployment.status !== "ready") return deployment.status;
  const state = deploymentLiveState(deployment);
  if (state === "following") return "live";
  if (state === "detached") return "detached";
  return "ready";
}

function deploymentStateLabel(deployment: Deployment, t: Translate): string {
  if (deployment.status === "ready") {
    const state = deploymentLiveState(deployment);
    if (state === "following") return t("preview.stateLive");
    if (state === "detached") return t("preview.stateDetached");
    return t("preview.stateReady");
  }
  if (deployment.status === "error") return t("preview.stateError");
  if (deployment.status === "stopped") return t("preview.stateIdle");
  return t("preview.building");
}

export function BranchPanel({
  branches,
  sources = [],
  loading,
  selected,
  deployments,
  compareBranch,
  compare,
  refreshing,
  onSelect,
  onRefresh,
  pinnedBranches = [],
  onTogglePinnedBranch,
  collapsed = false,
  onToggleCollapsed,
  footerActions,
}: {
  branches: Branch[];
  sources?: BranchSource[];
  loading: boolean;
  selected: string;
  deployments: Record<string, Deployment>;
  compareBranch?: string;
  compare?: boolean;
  refreshing?: boolean;
  onSelect: (branch: string) => void;
  onRefresh: () => void;
  pinnedBranches?: string[];
  onTogglePinnedBranch?: (branch: string) => void;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  footerActions?: ReactNode;
}) {
  const t = useT();
  const { pushToast } = useToast();
  const [filter, setFilter] = useState("");
  const [ctxMenu, setCtxMenu] = useState<{ branch: string; x: number; y: number } | null>(
    null
  );
  const ctxMenuRef = useRef<HTMLDivElement | null>(null);

  const pinnedSet = useMemo(() => new Set(pinnedBranches), [pinnedBranches]);

  // Pinned branches sit first in pin order (newest pin first); every other
  // branch keeps its git order below them.
  const orderedBranches = useMemo(() => {
    if (!pinnedBranches.length) return branches;
    const byName = new Map(branches.map((branch) => [branch.name, branch]));
    const pinned = pinnedBranches
      .map((name) => byName.get(name))
      .filter((branch): branch is Branch => Boolean(branch));
    if (!pinned.length) return branches;
    const pinnedNames = new Set(pinned.map((branch) => branch.name));
    return [...pinned, ...branches.filter((branch) => !pinnedNames.has(branch.name))];
  }, [branches, pinnedBranches]);

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return orderedBranches;
    return orderedBranches.filter(
      (branch) =>
        branch.name.toLowerCase().includes(needle) ||
        (branch.subject || "").toLowerCase().includes(needle) ||
        (branch.author || "").toLowerCase().includes(needle)
    );
  }, [orderedBranches, filter]);

  const visiblePinned = useMemo(
    () => visible.filter((branch) => pinnedSet.has(branch.name)),
    [visible, pinnedSet]
  );
  const visibleOthers = useMemo(
    () => visible.filter((branch) => !pinnedSet.has(branch.name)),
    [visible, pinnedSet]
  );

  useEffect(() => {
    if (!ctxMenu) return;
    const onPointerDown = (event: MouseEvent) => {
      if (
        ctxMenuRef.current &&
        event.target instanceof Node &&
        ctxMenuRef.current.contains(event.target)
      ) {
        return;
      }
      setCtxMenu(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setCtxMenu(null);
    };
    const onResize = () => setCtxMenu(null);
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", onResize);
    };
  }, [ctxMenu]);

  const openContextMenu = (branch: string, event: ReactMouseEvent) => {
    event.preventDefault();
    const itemCount = 1 + (onTogglePinnedBranch ? 1 : 0);
    const width = 212;
    const height = 40 + itemCount * 34;
    setCtxMenu({
      branch,
      x: Math.max(8, Math.min(event.clientX, window.innerWidth - width - 8)),
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - height - 8)),
    });
  };

  const copyBranchName = async (branch: string) => {
    try {
      await copyText(branch);
      pushToast(t("preview.branchNameCopied"), "success");
    } catch {
      pushToast(t("common.copyFailed"), "error");
    }
  };

  const renderBranch = (branch: Branch) => {
    const deployment = branchDeployment(branch, deployments);
    const source = sources.find((item) => item.branch === branch.name) || null;
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
        onContextMenu={(event) => openContextMenu(branch.name, event)}
        aria-pressed={active}
      >
        <div className="branch-item-top">
          <GitBranch size={11} className="branch-item-icon" />
          <span className="branch-item-name mono truncate">{branch.name}</span>
          {pinnedSet.has(branch.name) && (
            <span
              className="branch-item-pin"
              title={t("preview.pinnedHint")}
              aria-label={t("preview.pinnedHint")}
            >
              <Pin size={10} />
            </span>
          )}
          {branch.isDefault && <span className="branch-tag">{t("preview.prod")}</span>}
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
              <span className={"branch-state branch-state-" + deploymentStateClass(deployment)}>
                <span className="branch-state-dot" />
                {deploymentStateLabel(deployment, t)}
              </span>
            ) : source ? (
              <span
                className="branch-state branch-state-source"
                title={t("preview.sourceAvailableHint", { branch: branch.name })}
              >
                <span className="branch-state-dot" />
                {t("preview.stateSource")}
              </span>
            ) : (
              <span className="branch-state branch-state-none">
                <span className="branch-state-dot" />
                {t("preview.new")}
              </span>
            )}
          </span>
        </div>
      </button>
    );
  };

  if (collapsed) {
    return (
      <aside className="branch-panel branch-panel-collapsed">
        <div className="branch-panel-rail">
          <button
            type="button"
            className="icon-btn branch-panel-rail-toggle"
            onClick={onToggleCollapsed}
            title={t("preview.expandBranches")}
            aria-label={t("preview.expandBranches")}
            aria-expanded={false}
          >
            <PanelLeftOpen size={14} />
          </button>
          <span className="branch-panel-rail-label">{t("preview.branches")}</span>
          <span className="branch-panel-rail-count">{branches.length}</span>
          <button
            type="button"
            className="icon-btn branch-panel-rail-refresh"
            onClick={onRefresh}
            disabled={refreshing}
            title={t("preview.refreshBranches")}
            aria-label={t("preview.refreshBranches")}
          >
            {refreshing ? <Spinner /> : <RefreshCw size={13} />}
          </button>
        </div>
      </aside>
    );
  }

  return (
    <aside className="branch-panel">
      <div className="branch-panel-head">
        <div className="branch-panel-title">
          <h2>{t("preview.branches")}</h2>
          <span className="branch-count">{branches.length}</span>
        </div>
        <div className="branch-panel-head-actions">
          {onToggleCollapsed && (
            <button
              type="button"
              className="icon-btn branch-panel-collapse"
              onClick={onToggleCollapsed}
              title={t("preview.collapseBranches")}
              aria-label={t("preview.collapseBranches")}
              aria-expanded={true}
            >
              <PanelLeftClose size={14} />
            </button>
          )}
          <button
            className="icon-btn"
            onClick={onRefresh}
            disabled={refreshing}
            title={t("preview.refreshBranches")}
            aria-label={t("preview.refreshBranches")}
          >
            {refreshing ? <Spinner /> : <RefreshCw size={14} />}
          </button>
        </div>
      </div>
      <div className="branch-search">
        <Search size={13} />
        <input
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder={t("preview.search")}
          aria-label={t("preview.filterAria")}
        />
      </div>
      <div className="branch-list" onScroll={() => setCtxMenu(null)}>
        {loading &&
          [0, 1, 2, 3, 4].map((index) => (
            <div className="branch-item branch-item-skeleton" key={index}>
              <Skeleton width="70%" height={12} />
              <Skeleton width="90%" height={10} style={{ marginTop: 8 }} />
              <Skeleton width="45%" height={9} style={{ marginTop: 8 }} />
            </div>
          ))}
        {!loading && visible.length === 0 && (
          <p className="branch-empty">{t("preview.noMatch", { query: filter })}</p>
        )}
        {!loading && visiblePinned.map(renderBranch)}
        {!loading && visiblePinned.length > 0 && visibleOthers.length > 0 && (
          <div className="branch-list-divider" role="separator" />
        )}
        {!loading && visibleOthers.map(renderBranch)}
      </div>
      {ctxMenu && (
        <div
          ref={ctxMenuRef}
          className="branch-context-menu"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
          role="menu"
          aria-label={ctxMenu.branch}
          onContextMenu={(event) => event.preventDefault()}
        >
          <div className="branch-context-head mono truncate">{ctxMenu.branch}</div>
          <button
            type="button"
            role="menuitem"
            className="branch-context-item"
            onClick={() => {
              const target = ctxMenu.branch;
              setCtxMenu(null);
              void copyBranchName(target);
            }}
          >
            <Copy size={13} />
            <span>{t("preview.copyBranchName")}</span>
          </button>
          {onTogglePinnedBranch && (
            <button
              type="button"
              role="menuitem"
              className="branch-context-item"
              onClick={() => {
                const target = ctxMenu.branch;
                setCtxMenu(null);
                onTogglePinnedBranch(target);
              }}
            >
              {pinnedSet.has(ctxMenu.branch) ? <PinOff size={13} /> : <Pin size={13} />}
              <span>
                {pinnedSet.has(ctxMenu.branch)
                  ? t("preview.unpinBranch")
                  : t("preview.pinBranch")}
              </span>
            </button>
          )}
        </div>
      )}
      <div className="branch-panel-foot">
        <span className="branch-panel-hint" title={t("preview.clickHint")}>
          {t("preview.clickHint")}
        </span>
        {footerActions}
      </div>
    </aside>
  );
}
