import { ChevronRight, Search, Wifi } from "lucide-react";
import { Link, matchRoute, useRouter } from "../lib/router";
import { initials } from "../lib/format";
import { useApp } from "../context/AppContext";
import { LogoMark } from "./Logo";
import { Kbd } from "./ui";

export function TopNav() {
  const { overview, settings, openModal } = useApp();
  const { path } = useRouter();
  const route = matchRoute(path);
  const project =
    route.page === "project" && overview
      ? overview.projects.find((item) => item.id === route.projectId)
      : null;

  return (
    <header className="topbar">
      <div className="container topbar-inner">
        <div className="topbar-left">
          <Link to="/" className="brand" aria-label="Vercio home">
            <LogoMark />
            <span className="brand-name">Vercio</span>
            <span className="brand-version">alpha</span>
          </Link>
          <div className="topnav-divider" />
          <Link to="/" className="topbar-link">
            Projects
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
          <button className="cmd-trigger" onClick={() => openModal("palette")} aria-label="Open search">
            <Search size={13} />
            <span className="cmd-label">Search</span>
            <Kbd>⌘K</Kbd>
          </button>
          <button className="share-chip" onClick={() => openModal("share")} title="Share on your local network">
            <span className="share-chip-dot" />
            <Wifi size={13} />
            <span className="share-label">Share</span>
          </button>
          <button className="avatar-btn" onClick={() => openModal("profile")} aria-label="Local profile">
            <span className="avatar">{initials(settings.userName || "Guest")}</span>
          </button>
        </div>
      </div>
    </header>
  );
}
