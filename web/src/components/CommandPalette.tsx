import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowRight,
  FolderPlus,
  LayoutGrid,
  RefreshCw,
  Search,
  Sparkles,
  Wifi,
} from "lucide-react";
import { api } from "../lib/api";
import { copyText } from "../lib/format";
import { useApp } from "../context/AppContext";
import { useRouter } from "../lib/router";
import { useToast } from "./Toast";

interface Item {
  id: string;
  group: string;
  label: string;
  hint?: string;
  icon: React.ReactNode;
  run: () => void | Promise<void>;
}

export function CommandPalette() {
  const { activeModal, closeModal, openModal, overview, systemInfo, refresh } = useApp();
  const { navigate } = useRouter();
  const { pushToast } = useToast();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const open = activeModal === "palette";

  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIndex(0);
      setTimeout(() => inputRef.current?.focus(), 20);
    }
  }, [open]);

  const items = useMemo<Item[]>(() => {
    const actions: Item[] = [
      {
        id: "add",
        group: "Actions",
        label: "Add project",
        icon: <FolderPlus size={15} />,
        run: () => {
          closeModal();
          setTimeout(() => openModal("add-project"), 40);
        },
      },
      {
        id: "demo",
        group: "Actions",
        label: "Load demo project",
        icon: <Sparkles size={15} />,
        run: async () => {
          try {
            const { project } = await api.createDemoProject();
            await refresh();
            closeModal();
            navigate("/p/" + project.id + "/previews");
          } catch (error) {
            pushToast(error instanceof Error ? error.message : "Could not load demo", "error");
          }
        },
      },
      {
        id: "share",
        group: "Actions",
        label: "Share on Wi-Fi",
        icon: <Wifi size={15} />,
        run: () => {
          closeModal();
          setTimeout(() => openModal("share"), 40);
        },
      },
      {
        id: "copy",
        group: "Actions",
        label: "Copy network URL",
        hint: systemInfo?.primaryUrl,
        icon: <ArrowRight size={15} />,
        run: async () => {
          await copyText(systemInfo?.primaryUrl || window.location.origin);
          closeModal();
          pushToast("Network URL copied", "success");
        },
      },
      {
        id: "refresh",
        group: "Actions",
        label: "Refresh workspace",
        icon: <RefreshCw size={15} />,
        run: async () => {
          await refresh();
          closeModal();
          pushToast("Workspace refreshed", "success");
        },
      },
    ];
    const projects: Item[] = (overview?.projects || []).map((project) => ({
      id: "project-" + project.id,
      group: "Projects",
      label: project.name,
      hint: project.source.url || project.repoPath,
      icon: <LayoutGrid size={15} />,
      run: () => {
        closeModal();
        navigate("/p/" + project.id);
      },
    }));
    const all = [...projects, ...actions];
    const needle = query.trim().toLowerCase();
    if (!needle) return all;
    return all.filter(
      (item) =>
        item.label.toLowerCase().includes(needle) ||
        (item.hint || "").toLowerCase().includes(needle)
    );
  }, [overview, query, closeModal, openModal, navigate, pushToast, refresh, systemInfo]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    if (activeIndex > items.length - 1) setActiveIndex(Math.max(items.length - 1, 0));
    const active = listRef.current?.querySelector(".palette-item-active");
    active?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, items.length]);

  if (!open) return null;

  const groups: { name: string; items: Item[] }[] = [];
  for (const item of items) {
    const group = groups.find((entry) => entry.name === item.group);
    if (group) group.items.push(item);
    else groups.push({ name: item.group, items: [item] });
  }

  return createPortal(
    <div
      className="palette-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) closeModal();
      }}
    >
      <div className="palette" role="dialog" aria-modal="true" aria-label="Command palette">
        <div className="palette-search">
          <Search size={15} />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search projects and actions…"
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActiveIndex((index) => Math.min(index + 1, items.length - 1));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setActiveIndex((index) => Math.max(index - 1, 0));
              } else if (event.key === "Enter") {
                event.preventDefault();
                const item = items[activeIndex];
                if (item) item.run();
              } else if (event.key === "Escape") {
                closeModal();
              }
            }}
          />
          <span className="kbd">esc</span>
        </div>
        <div className="palette-list" ref={listRef}>
          {groups.length === 0 && <div className="palette-empty">No results</div>}
          {groups.map((group) => (
            <div className="palette-group" key={group.name}>
              <div className="palette-group-label">{group.name}</div>
              {group.items.map((item) => {
                const index = items.indexOf(item);
                return (
                  <button
                    key={item.id}
                    className={"palette-item" + (index === activeIndex ? " palette-item-active" : "")}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => item.run()}
                  >
                    <span className="palette-item-icon">{item.icon}</span>
                    <span className="palette-item-label">{item.label}</span>
                    {item.hint && <span className="palette-item-hint truncate">{item.hint}</span>}
                    <ArrowRight size={13} className="palette-item-arrow" />
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        <div className="palette-footer">
          <span><span className="kbd">↑</span> <span className="kbd">↓</span> navigate</span>
          <span><span className="kbd">↵</span> select</span>
          <span><span className="kbd">esc</span> close</span>
        </div>
      </div>
    </div>,
    document.body
  );
}
