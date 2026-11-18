import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import {
  AlertCircle,
  Check,
  ExternalLink,
  GitBranch,
  Loader2,
  Play,
  RotateCw,
  Square,
} from "lucide-react";
import { relativeTime } from "../lib/format";
import type { Deployment } from "../lib/types";
import { CopyButton, Spinner, StatusPill } from "./ui";
import { TerminalLog } from "./TerminalLog";

export const PENDING_STATUSES = ["queued", "preparing", "installing", "starting"];

export function isPendingStatus(status?: string): boolean {
  return Boolean(status && PENDING_STATUSES.includes(status));
}

function statusHeadline(deployment: Deployment): string {
  switch (deployment.status) {
    case "queued":
      return "Queued";
    case "preparing":
      return "Checking out branch";
    case "installing":
      return "Installing dependencies";
    case "starting":
      return "Starting dev server";
    case "ready":
      return "Preview ready";
    case "error":
      return "Preview failed";
    case "stopped":
      return "Preview stopped";
    default:
      return "Preparing preview";
  }
}

function BuildSteps({ status }: { status: string }) {
  const steps = [
    { key: "preparing", label: "Checkout branch" },
    { key: "installing", label: "Install dependencies" },
    { key: "starting", label: "Start dev server" },
  ];
  const order = ["preparing", "installing", "starting", "ready"];
  const activeIndex = order.indexOf(status);
  return (
    <div className="build-steps">
      {steps.map((step, index) => {
        const stepIndex = order.indexOf(step.key);
        const done = activeIndex > stepIndex || status === "ready";
        const active = activeIndex === stepIndex;
        return (
          <div
            className={
              "build-step" + (done ? " done" : "") + (active ? " active" : "")
            }
            key={step.key}
          >
            <span className="build-step-icon">
              {done ? <Check size={10} /> : active ? <Spinner /> : <span>{index + 1}</span>}
            </span>
            {step.label}
          </div>
        );
      })}
    </div>
  );
}

export function PreviewState({
  deployment,
  branch,
  logs,
  onRetry,
  onStop,
}: {
  deployment?: Deployment | null;
  branch: string;
  logs: string;
  onRetry: () => void;
  onStop?: () => void;
}) {
  const status = deployment?.status;
  const pending = !deployment || isPendingStatus(status);
  const failed = status === "error";
  const stopped = status === "stopped";

  return (
    <div className={"build-overlay" + (failed ? " build-overlay-error" : "")}>
      <div className="build-panel">
        <div className="build-head">
          <span className={"build-icon" + (failed ? " is-error" : stopped ? " is-idle" : "")}>
            {failed ? <AlertCircle size={18} /> : stopped ? <Square size={15} /> : <Loader2 size={17} className="spin" />}
          </span>
          <div className="build-heading">
            <h3>{deployment ? statusHeadline(deployment) : "Preparing preview"}</h3>
            <p>
              <GitBranch size={11} /> <span className="mono">{branch}</span>
              {deployment && (
                <>
                  <span className="dot-sep">·</span>
                  <span className="mono">{deployment.shortSha}</span>
                  <span className="dot-sep">·</span>
                  {relativeTime(deployment.createdAt)}
                </>
              )}
            </p>
          </div>
          {deployment && !pending && <StatusPill status={deployment.status} />}
        </div>

        {pending && <BuildSteps status={status || "queued"} />}

        {failed && (
          <div className="build-error">
            <p>{deployment?.error || "The preview could not be prepared."}</p>
            <div className="build-error-actions">
              <button className="btn btn-sm btn-primary" onClick={onRetry}>
                <RotateCw size={12} /> Retry preview
              </button>
            </div>
          </div>
        )}

        {stopped && (
          <div className="build-error">
            <p>{deployment?.error || "This preview is not running anymore."}</p>
            <div className="build-error-actions">
              <button className="btn btn-sm btn-secondary" onClick={onRetry}>
                <Play size={12} /> Start preview
              </button>
              {onStop && (
                <button className="btn btn-sm btn-ghost" onClick={onStop}>
                  Remove
                </button>
              )}
            </div>
          </div>
        )}

        <TerminalLog
          log={logs}
          title={failed ? "Preview logs" : pending ? "Preparing preview" : "Preview logs"}
          emptyText={pending ? "Spinning up an isolated worktree…" : "No logs."}
        />

        {pending && (
          <p className="build-hint">
            Previews run from an isolated git worktree. Dependencies are cached after the first
            install, so switching branches gets faster.
          </p>
        )}
      </div>
    </div>
  );
}

export function BrowserFrame({
  deployment,
  branch,
  device,
  logs,
  reloadKey,
  onReload,
  onRetry,
  onStop,
  branchPicker,
  compact = false,
}: {
  deployment?: Deployment | null;
  branch: string;
  device: "desktop" | "tablet" | "mobile";
  logs: string;
  reloadKey: number;
  onReload: () => void;
  onRetry: () => void;
  onStop?: () => void;
  branchPicker?: ReactNode;
  compact?: boolean;
}) {
  const ready = deployment?.status === "ready";
  const [frameLoaded, setFrameLoaded] = useState(false);
  const [loadingSlow, setLoadingSlow] = useState(false);

  useEffect(() => {
    setFrameLoaded(false);
    if (!ready) return;
    const timer = setTimeout(() => setLoadingSlow(true), 1400);
    return () => clearTimeout(timer);
  }, [deployment?.id, reloadKey, ready]);

  const previewHref = deployment ? "/preview/" + deployment.id + "/" : "#";
  const displayUrl = deployment ? "/preview/" + deployment.id : "/preview";

  return (
    <div className={"device-frame device-" + device}>
      <div className="browser">
        <div className="browser-bar">
          <div className="browser-dots" aria-hidden="true">
            <span className="traffic-dot" />
            <span className="traffic-dot" />
            <span className="traffic-dot" />
          </div>
          <div className="browser-url">
            <span className="browser-lock">V</span>
            <span className="mono truncate">{ready ? displayUrl : branch + " · " + (deployment?.status || "new")}</span>
            {ready && (
              <CopyButton
                value={window.location.origin + previewHref}
                label=""
                className="browser-copy"
              />
            )}
          </div>
          <div className="browser-actions">
            {branchPicker}
            <a
              className="icon-btn"
              href={previewHref}
              target="_blank"
              rel="noreferrer"
              title="Open preview in a new tab"
              aria-label="Open preview in a new tab"
            >
              <ExternalLink size={13} />
            </a>
            <button
              className="icon-btn"
              onClick={onReload}
              title="Reload preview"
              aria-label="Reload preview"
              disabled={!ready}
            >
              <RotateCw size={13} />
            </button>
          </div>
        </div>
        <div className="browser-viewport">
          {ready ? (
            <>
              {!frameLoaded && (
                <div className="frame-loading">
                  <Spinner large />
                  <span>Loading preview…</span>
                  {loadingSlow && <span className="hint">First load can take a moment for dev servers.</span>}
                </div>
              )}
              <iframe
                key={deployment.id + ":" + reloadKey}
                className="preview-iframe"
                src={previewHref + (reloadKey ? "?r=" + reloadKey : "")}
                title={"Preview of " + branch}
                onLoad={() => setFrameLoaded(true)}
                allow="clipboard-read; clipboard-write"
              />
            </>
          ) : (
            <PreviewState
              deployment={deployment}
              branch={branch}
              logs={logs}
              onRetry={onRetry}
              onStop={onStop}
            />
          )}
        </div>
      </div>
      {compact && deployment?.status === "ready" && (
        <div className="frame-compact-meta">
          <span className="mono">{deployment.shortSha}</span>
          <span className="dot-sep">·</span>
          ready
        </div>
      )}
    </div>
  );
}
