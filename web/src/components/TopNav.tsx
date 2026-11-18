import { ChevronRight, GitBranch, GitFork, Search, Wifi } from "lucide-react";
import { Link, matchRoute, useRouter } from "../lib/router";
import { initials } from "../lib/format";
import { useApp } from "../context/AppContext";
import { useT } from "../i18n";
import { LogoMark } from "./Logo";
import { ProjectMark } from "./ProjectCard";
import { GithubIcon } from "./icons";
import { Kbd } from "./ui";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { ThemeToggle } from "./ThemeToggle";

export function TopNav() {
  const { overview, settings, openModal } = useApp();
  const { path } = useRouter();
  const t = useT();
  const route = matchRoute(path);
  const project =
    route.page === "project" && overview
      ? overview.projects.find((item) => item.id === route.projectId)
      : null;

  return (
    <header className="topbar">
      <div className={"container topbar-inner" + (project ? " topbar-inner-project" : "")}>
        <div className="topbar-left">
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
                <Link
                  to={"/p/" + project.id}
                  className="topbar-project-link"
                  title={project.name}
                  aria-current={route.page === "project" ? "page" : undefined}
                >
                  <ProjectMark name={project.name} size="sm" />
                  <span className="topbar-project-name truncate">{project.name}</span>
                </Link>
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
          <LanguageSwitcher />
          <ThemeToggle />
          <button className="avatar-btn" onClick={() => openModal("profile")} aria-label={t("nav.profile")}>
            <span className="avatar">{initials(settings.userName || "Guest")}</span>
          </button>
        </div>
      </div>
    </header>
  );
}
