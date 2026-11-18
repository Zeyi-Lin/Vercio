import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { AnchorHTMLAttributes, MouseEvent, ReactNode } from "react";

interface RouterState {
  path: string;
  query: URLSearchParams;
  navigate: (to: string, options?: { replace?: boolean; scroll?: boolean }) => void;
}

const RouterContext = createContext<RouterState | null>(null);

export function RouterProvider({ children }: { children: ReactNode }) {
  const [location, setLocation] = useState({
    path: window.location.pathname,
    search: window.location.search,
  });

  useEffect(() => {
    const onPopState = () => setLocation({ path: window.location.pathname, search: window.location.search });
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const navigate = useCallback((to: string, options: { replace?: boolean; scroll?: boolean } = {}) => {
    const previous = window.location.pathname + window.location.search;
    const next = to.startsWith("/") ? to : "/" + to;
    if (previous === next) return;
    if (options.replace) window.history.replaceState({}, "", next);
    else window.history.pushState({}, "", next);
    setLocation({ path: window.location.pathname, search: window.location.search });
    if (options.scroll !== false) window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
  }, []);

  const value = useMemo<RouterState>(
    () => ({
      path: location.path,
      query: new URLSearchParams(location.search),
      navigate,
    }),
    [location, navigate]
  );

  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

export function useRouter(): RouterState {
  const context = useContext(RouterContext);
  if (!context) throw new Error("useRouter must be used inside RouterProvider");
  return context;
}

interface LinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  to: string;
  replace?: boolean;
}

export function Link({ to, replace, onClick, children, ...rest }: LinkProps) {
  const { navigate, path, query } = useRouter();
  const current = path + (query.toString() ? "?" + query.toString() : "");
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey) return;
    if (event.button !== 0) return;
    event.preventDefault();
    navigate(to, { replace });
  };
  return (
    <a href={to} onClick={handleClick} {...rest} aria-current={current === to ? "page" : undefined}>
      {children}
    </a>
  );
}

export interface RouteMatch {
  page: "dashboard" | "project" | "notfound";
  projectId?: string;
  tab?: string;
}

export function matchRoute(pathname: string): RouteMatch {
  if (pathname === "/" || pathname === "") return { page: "dashboard" };
  const projectMatch = pathname.match(/^\/p\/([^/]+)(?:\/([^/]+))?\/?$/);
  if (projectMatch) {
    return {
      page: "project",
      projectId: decodeURIComponent(projectMatch[1]),
      tab: projectMatch[2] ? decodeURIComponent(projectMatch[2]) : "previews",
    };
  }
  return { page: "notfound" };
}
