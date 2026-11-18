import { ChevronRight, Search, Wifi } from "lucide-react";
import { Link, matchRoute, useRouter } from "../lib/router";
import { initials } from "../lib/format";
import { useApp } from "../context/AppContext";
import { useT } from "../i18n";
import { LogoMark } from "./Logo";
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
      <div className="container topbar-inner">
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
              <ChevronRight size={13} className="muted" aria-hidden="true" />
              <Link to={"/p/" + project.id} className="topbar-link truncate" style={{ maxWidth: 220 }}>
                {project.name}
              </Link>
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
