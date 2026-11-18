import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, ChevronRight, GitBranch, GitFork, Search, Wifi } from "lucide-react";
import { Link, matchRoute, normalizeProjectTab, useRouter } from "../lib/router";
import { initials } from "../lib/format";
import { useApp } from "../context/AppContext";
import { useT } from "../i18n";
import { LogoMark } from "./Logo";
import { ProjectMark } from "./ProjectCard";
import { GithubIcon } from "./icons";
import { Kbd } from "./ui";

export function TopNav() {
  const { overview, settings, openModal } = useApp();
  const { path } = useRouter();
  const t = useT();
  const route = matchRoute(path);
  const project =
    route.page === "project" && overview
      ? overview.projects.find((item) => item.id === route.projectId)
      : null;
  const [switchOpen, setSwitchOpen] = useState(false);
  const switchRef = useRef<HTMLDivElement | null>(null);
  const projectTab = normalizeProjectTab(route.tab);

  useEffect(() => {
    setSwitchOpen(false);
  }, [path]);

  useEffect(() => {
    if (!switchOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (switchRef.current && !switchRef.current.contains(event.target as Node)) {
        setSwitchOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSwitchOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [switchOpen]);

  return (
    <header className="topbar">
      <div className={"container topbar-inner" + (project ? " topbar-inner-project" : "")}>
        <div className={"topbar-left" + (switchOpen ? " topbar-left-menu-open" : "")}>
          <Link to="/" className="brand" aria-label={t("nav.home")}>
            <LogoMark />
            <span className="brand-name">Vercio</span>
            <span className="brand-version">alpha</span>
          </Link>
          <div className="topnav-divider" />
          <Link to="/" className="topbar-link">
            {t("nav.projects")}
          </Link>
          {project && (
            <>
              <ChevronRight size={13} className="topbar-crumb-sep muted" aria-hidden="true" />
              <div className="topbar-project">
                <div className="topbar-project-switch" ref={switchRef}>
                  <button
                    type="button"
                    className="topbar-project-link topbar-project-trigger"
                    onClick={() => setSwitchOpen((value) => !value)}
                    title={t("nav.switchProject")}
                    aria-haspopup="menu"
                    aria-expanded={switchOpen}
                  >
                    <ProjectMark name={project.name} size="sm" />
                    <span className="topbar-project-name truncate">{project.name}</span>
                    <ChevronDown size={12} className="topbar-project-caret" aria-hidden="true" />
                  </button>
                  {switchOpen && (
                    <div
                      className="project-switch-pop"
                      id="project-switch-menu"
                      role="menu"
                      aria-label={t("nav.switchProject")}
                    >
                      <div className="project-switch-label">{t("nav.switchProject")}</div>
                      {overview?.projects.map((item) => {
                        const current = item.id === project.id;
                        return (
                          <Link
                            key={item.id}
                            to={"/p/" + item.id + "/" + projectTab}
                            className={"project-switch-item" + (current ? " is-current" : "")}
                            role="menuitem"
                            aria-current={current ? "page" : undefined}
                            onClick={() => setSwitchOpen(false)}
                          >
                            <ProjectMark name={item.name} size="sm" />
                            <span className="project-switch-text">
                              <span className="project-switch-name truncate">{item.name}</span>
                              <span className="project-switch-meta">
                                {t("project.branches", { count: item.branchCount || 0 })}
                                <span className="dot-sep">·</span>
                                <span className="mono">{item.defaultBranch}</span>
                              </span>
                            </span>
                            {current && (
                              <Check size={13} className="project-switch-check" aria-hidden="true" />
                            )}
                          </Link>
                        );
                      })}
                    </div>
                  )}
                </div>
                <span className="topbar-project-meta topbar-project-repo" title={project.repoPath}>
                  {project.source.url ? <GithubIcon size={13} /> : <GitFork size={13} />}
                  <span className="mono truncate">{project.repoPath}</span>
                </span>
                <span className="dot-sep topbar-project-sep topbar-project-sep-branches">·</span>
                <span className="topbar-project-meta topbar-project-branches">
                  <GitBranch size={12} />
                  {t("project.branches", { count: project.branchCount || 0 })}
                </span>
                <span className="dot-sep topbar-project-sep topbar-project-sep-default">·</span>
                <span className="topbar-project-meta topbar-project-default">
                  {t("project.default")} <span className="mono">{project.defaultBranch}</span>
                </span>
                {project.dirtyCount > 0 && (
                  <>
                    <span className="dot-sep topbar-project-sep topbar-project-sep-warn">·</span>
                    <span className="topbar-project-meta topbar-project-warn">
                      {t("project.uncommitted", { count: project.dirtyCount })}
                    </span>
                  </>
                )}
              </div>
            </>
          )}
        </div>
        <div className="topbar-right">
          <button className="cmd-trigger" onClick={() => openModal("palette")} aria-label={t("nav.openSearch")}>
            <Search size={13} />
            <span className="cmd-label">{t("nav.search")}</span>
            <Kbd>⌘K</Kbd>
          </button>
          <button className="share-chip" onClick={() => openModal("share")} title={t("nav.shareOnNetwork")}>
            <span className="share-chip-dot" />
            <Wifi size={13} />
            <span className="share-label">{t("nav.share")}</span>
          </button>
          <button className="avatar-btn" onClick={() => openModal("profile")} aria-label={t("nav.profile")}>
            <span className="avatar">{initials(settings.userName || "Guest")}</span>
          </button>
        </div>
      </div>
    </header>
  );
}
