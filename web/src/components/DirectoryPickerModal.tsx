import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronRight,
  CornerLeftUp,
  Download,
  FileText,
  Folder,
  FolderGit2,
  Home,
  Monitor,
  RefreshCw,
  Search,
} from "lucide-react";
import { api, ApiError } from "../lib/api";
import type { BrowseEntry, BrowseListing, BrowseRoot } from "../lib/types";
import { useT } from "../i18n";
import { Button, Modal, Skeleton, TextInput } from "./ui";

type Translate = ReturnType<typeof useT>;

function browseErrorText(error: unknown, t: Translate): string {
  if (error instanceof ApiError) {
    const code = (error.details as { code?: string } | undefined)?.code;
    if (code === "missing") return t("picker.errorMissing");
    if (code === "not-directory") return t("picker.errorNotDirectory");
    if (code === "denied") return t("picker.errorDenied");
    if (code === "unreadable") return t("picker.errorUnreadable");
    return error.message;
  }
  return error instanceof Error ? error.message : t("picker.error");
}

function rootLabel(kind: BrowseRoot["kind"], t: Translate): string {
  if (kind === "home") return t("picker.home");
  if (kind === "desktop") return t("picker.desktop");
  if (kind === "documents") return t("picker.documents");
  return t("picker.downloads");
}

function RootIcon({ kind }: { kind: BrowseRoot["kind"] }) {
  if (kind === "home") return <Home size={12} />;
  if (kind === "desktop") return <Monitor size={12} />;
  if (kind === "documents") return <FileText size={12} />;
  return <Download size={12} />;
}

export function DirectoryPickerModal({
  open,
  initialPath,
  onClose,
  onSelect,
}: {
  open: boolean;
  initialPath?: string;
  onClose: () => void;
  onSelect: (path: string) => void;
}) {
  const t = useT();
  const [listing, setListing] = useState<BrowseListing | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("");
  const [showHidden, setShowHidden] = useState(false);
  const requestSeq = useRef(0);
  const crumbsRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(
    async (target: string, options: { showHidden?: boolean } = {}) => {
      const hidden = options.showHidden ?? showHidden;
      const requestId = ++requestSeq.current;
      setLoading(true);
      setError("");
      try {
        const result = await api.browseDirectory(target, { showHidden: hidden });
        if (requestId !== requestSeq.current) return;
        setListing(result.listing);
        setFilter("");
      } catch (loadError) {
        if (requestId !== requestSeq.current) return;
        setError(browseErrorText(loadError, t));
      } finally {
        if (requestId === requestSeq.current) setLoading(false);
      }
    },
    [showHidden, t]
  );

  // Load the folder the field already points at; fall back to the home folder
  // when the typed value is not a readable directory (e.g. an absolute repo path).
  useEffect(() => {
    if (!open) return;
    requestSeq.current += 1;
    const requestId = requestSeq.current;
    setListing(null);
    setError("");
    setFilter("");
    setShowHidden(false);
    setLoading(true);
    const preferred = (initialPath || "").trim();
    (async () => {
      try {
        try {
          const result = await api.browseDirectory(preferred, { showHidden: false });
          if (requestId === requestSeq.current) setListing(result.listing);
        } catch {
          const home = await api.browseDirectory("", { showHidden: false });
          if (requestId === requestSeq.current) setListing(home.listing);
        }
      } catch (initialError) {
        if (requestId === requestSeq.current) setError(browseErrorText(initialError, t));
      } finally {
        if (requestId === requestSeq.current) setLoading(false);
      }
    })();
    return () => {
      requestSeq.current += 1;
    };
  }, [open, initialPath, t]);

  // This dialog sits on top of the "new project" dialog, which has its own
  // Escape handler. Stop the event during the capture phase so Escape only
  // closes the folder picker.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopImmediatePropagation();
      event.preventDefault();
      onClose();
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [open, onClose]);

  useEffect(() => {
    const element = crumbsRef.current;
    if (element) element.scrollLeft = element.scrollWidth;
  }, [listing?.path]);

  const filtered = useMemo(() => {
    if (!listing) return [] as BrowseEntry[];
    const needle = filter.trim().toLowerCase();
    if (!needle) return listing.entries;
    return listing.entries.filter((entry) => entry.name.toLowerCase().includes(needle));
  }, [filter, listing]);

  const select = () => {
    if (!listing?.isGitRepo) return;
    onSelect(listing.path);
    onClose();
  };

  const toggleHidden = (next: boolean) => {
    setShowHidden(next);
    if (listing) void load(listing.path, { showHidden: next });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      className="dir-picker-modal"
      title={t("picker.title")}
      description={t("picker.description")}
      footer={
        <>
          <label className="dir-toggle">
            <input type="checkbox" checked={showHidden} onChange={(event) => toggleHidden(event.target.checked)} />
            {t("picker.showHidden")}
            {listing && listing.hiddenCount > 0 ? " (" + listing.hiddenCount + ")" : ""}
          </label>
          <Button onClick={onClose} disabled={loading && !listing}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" onClick={select} disabled={!listing?.isGitRepo || loading}>
            {t("picker.select")}
          </Button>
        </>
      }
    >
      <div className="dir-picker">
        {listing && listing.roots.length > 0 && (
          <div className="dir-roots">
            {listing.roots.map((root) => (
              <button
                key={root.kind + root.path}
                type="button"
                className={"dir-root" + (root.path === listing.path ? " active" : "")}
                onClick={() => void load(root.path)}
                title={root.path}
              >
                <RootIcon kind={root.kind} />
                {rootLabel(root.kind, t)}
              </button>
            ))}
          </div>
        )}

        <div className="dir-toolbar">
          <button
            type="button"
            className="icon-btn bordered"
            aria-label={t("picker.up")}
            title={t("picker.up")}
            disabled={!listing?.parent || loading}
            onClick={() => listing?.parent && void load(listing.parent)}
          >
            <CornerLeftUp size={15} />
          </button>
          <div className="dir-crumbs" ref={crumbsRef}>
            {(listing?.breadcrumbs || []).map((crumb, index, all) => (
              <span className="dir-crumb-wrap" key={crumb.path}>
                <button
                  type="button"
                  className={"dir-crumb" + (index === all.length - 1 ? " dir-crumb-current" : "")}
                  onClick={() => void load(crumb.path)}
                  title={crumb.path}
                >
                  {crumb.label}
                </button>
                {index < all.length - 1 && <ChevronRight size={11} className="dir-crumb-sep" />}
              </span>
            ))}
            {!listing && <span className="dir-crumb-placeholder">{t("picker.loading")}</span>}
          </div>
          <button
            type="button"
            className="icon-btn bordered"
            aria-label={t("picker.refresh")}
            title={t("picker.refresh")}
            disabled={loading || !listing}
            onClick={() => listing && void load(listing.path)}
          >
            <RefreshCw size={14} className={loading ? "spin" : ""} />
          </button>
        </div>

        <div className="dir-filter">
          <Search size={13} className="dir-filter-icon" />
          <TextInput
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder={t("picker.filterPlaceholder")}
            aria-label={t("picker.filterPlaceholder")}
            spellCheck={false}
          />
        </div>

        {error && <div className="alert alert-error">{error}</div>}

        <div className="dir-list" role="list">
          {!listing && loading ? (
            Array.from({ length: 5 }).map((_, index) => (
              <div className="dir-skeleton" key={index}>
                <Skeleton width={14} height={14} />
                <Skeleton width={38 + index * 9 + "%"} height={11} />
              </div>
            ))
          ) : filtered.length === 0 ? (
            <div className="dir-empty">
              <Folder size={18} />
              {filter.trim() ? t("picker.noMatch") : t("picker.empty")}
            </div>
          ) : (
            filtered.map((entry) => (
              <button
                type="button"
                role="listitem"
                key={entry.path}
                className={"dir-row" + (entry.isGitRepo ? " is-git" : "")}
                onClick={() => void load(entry.path)}
                title={entry.path}
              >
                {entry.isGitRepo ? (
                  <FolderGit2 size={14} className="dir-row-icon" />
                ) : (
                  <Folder size={14} className="dir-row-icon" />
                )}
                <span className="dir-row-name">{entry.name}</span>
                {entry.isGitRepo && <span className="dir-row-badge">{t("picker.git")}</span>}
                <ChevronRight size={13} className="dir-row-chevron" />
              </button>
            ))
          )}
        </div>

        {listing && (
          <div className={"dir-status" + (listing.isGitRepo ? " is-repo" : "")}>
            <span className="dir-status-dot" />
            {listing.isGitRepo ? t("picker.currentIsRepo") : t("picker.notGitRepo")}
          </div>
        )}
      </div>
    </Modal>
  );
}
