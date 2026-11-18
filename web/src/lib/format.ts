export function relativeTime(input?: string | number | null): string {
  if (!input) return "—";
  const date = typeof input === "number" ? new Date(input) : new Date(input);
  const time = date.getTime();
  if (Number.isNaN(time)) return "—";
  const delta = Date.now() - time;
  const seconds = Math.round(delta / 1000);
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return minutes + "m ago";
  const hours = Math.round(minutes / 60);
  if (hours < 24) return hours + "h ago";
  const days = Math.round(hours / 24);
  if (days < 30) return days + "d ago";
  const months = Math.round(days / 30);
  if (months < 12) return months + "mo ago";
  return Math.round(months / 12) + "y ago";
}

export function formatDate(input?: string | number | null): string {
  if (!input) return "—";
  const date = typeof input === "number" ? new Date(input) : new Date(input);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function initials(name?: string): string {
  const value = (name || "").trim();
  if (!value) return "V";
  const parts = value.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function projectSlug(project: {
  name: string;
  source: { url?: string; path?: string; kind?: string };
}): string {
  if (project.source.url) {
    return project.source.url.replace(/^https?:\/\//, "").replace(/^git@/, "").replace(/\.git$/, "");
  }
  if (project.source.path) {
    const parts = project.source.path.split("/").filter(Boolean);
    return parts.slice(-2).join("/") || project.source.path;
  }
  return project.name;
}

export function truncateMiddle(value: string, max = 46): string {
  if (!value || value.length <= max) return value;
  const half = Math.floor((max - 1) / 2);
  return value.slice(0, half) + "…" + value.slice(value.length - half);
}

export function firstLine(text: string, max = 140): string {
  const line = (text || "")
    .replace(/^#+\s+/gm, "")
    .replace(/[*_`>#-]/g, "")
    .trim()
    .split("\n")[0];
  return line.length > max ? line.slice(0, max) + "…" : line;
}

export function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  return new Promise((resolve, reject) => {
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    try {
      document.execCommand("copy");
      resolve();
    } catch (error) {
      reject(error);
    } finally {
      document.body.removeChild(area);
    }
  });
}

export function statusLabel(status?: string): string {
  switch (status) {
    case "ready":
      return "Ready";
    case "queued":
      return "Queued";
    case "preparing":
      return "Preparing";
    case "installing":
      return "Installing";
    case "starting":
      return "Starting";
    case "error":
      return "Error";
    case "stopped":
      return "Stopped";
    default:
      return "Not deployed";
  }
}

export function statusTone(status?: string): "ready" | "pending" | "error" | "idle" {
  if (status === "ready") return "ready";
  if (status === "error") return "error";
  if (status && ["queued", "preparing", "installing", "starting"].includes(status)) return "pending";
  return "idle";
}
