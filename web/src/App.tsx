import { useEffect } from "react";
import { RouterProvider, matchRoute, useRouter } from "./lib/router";
import { ToastProvider } from "./components/Toast";
import { AppProvider, useApp } from "./context/AppContext";
import { TopNav } from "./components/TopNav";
import { ShareModal } from "./components/ShareModal";
import { AddProjectModal } from "./components/AddProjectModal";
import { ProfileModal } from "./components/ProfileModal";
import { CommandPalette } from "./components/CommandPalette";
import { LogoMark } from "./components/Logo";
import { Dashboard } from "./pages/Dashboard";
import { ProjectPage } from "./pages/ProjectPage";
import { NotFound } from "./pages/NotFound";

function Footer() {
  const { systemInfo } = useApp();
  return (
    <footer className="footer">
      <div className="container footer-inner">
        <div className="footer-brand">
          <LogoMark className="footer-mark" />
          <span>Vercio</span>
          <span className="footer-sep">/</span>
          <span className="muted">Local-first frontend collaboration</span>
        </div>
        <div className="footer-meta">
          {systemInfo?.lanUrls[0] && (
            <a href={systemInfo.primaryUrl} className="footer-link mono" target="_blank" rel="noreferrer">
              {systemInfo.primaryUrl.replace(/^https?:\/\//, "")}
            </a>
          )}
          <span className="footer-sep">·</span>
          <span className="muted mono">v{systemInfo?.version || "0.1.0"}</span>
          <span className="footer-sep">·</span>
          <span className="footer-status">
            <span className="share-chip-dot" />
            {systemInfo ? "Online" : "Starting"}
          </span>
        </div>
      </div>
    </footer>
  );
}

function AppRoutes() {
  const { path } = useRouter();
  const route = matchRoute(path);
  if (route.page === "dashboard") return <Dashboard />;
  if (route.page === "project" && route.projectId) {
    return (
      <ProjectPage
        key={route.projectId}
        projectId={route.projectId}
        tab={route.tab || "previews"}
      />
    );
  }
  return <NotFound />;
}

function AppShell() {
  const { openModal, activeModal, closeModal } = useApp();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (activeModal === "palette") closeModal();
        else openModal("palette");
        return;
      }
      if (event.key === "Escape" && activeModal) {
        closeModal();
        return;
      }
      if (!typing && event.key === "/" && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        openModal("palette");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeModal, closeModal, openModal]);

  return (
    <div className="app-shell">
      <TopNav />
      <main className="app-main">
        <AppRoutes />
      </main>
      <Footer />
      <ShareModal />
      <AddProjectModal />
      <ProfileModal />
      <CommandPalette />
    </div>
  );
}

export function App() {
  return (
    <RouterProvider>
      <ToastProvider>
        <AppProvider>
          <AppShell />
        </AppProvider>
      </ToastProvider>
    </RouterProvider>
  );
}
