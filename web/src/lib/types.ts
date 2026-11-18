export type DeploymentStatus =
  | "queued"
  | "preparing"
  | "installing"
  | "starting"
  | "ready"
  | "error"
  | "stopped";

export type PreviewMode = "auto" | "server" | "static";

export interface FrameworkInfo {
  label: string;
  type: "server" | "static";
  kind: string;
  packageManager: string;
}

export interface Deployment {
  id: string;
  projectId: string;
  branch: string;
  status: DeploymentStatus;
  mode: PreviewMode;
  requestedMode: PreviewMode;
  port: number | null;
  urlPath: string | null;
  commit: string;
  shortSha: string;
  commitMessage: string;
  author: string;
  framework: FrameworkInfo | null;
  error: string | null;
  createdAt: string;
  readyAt: string | null;
  stoppedAt: string | null;
  devCommand: string | null;
  isProduction: boolean;
  projectName?: string;
}

export interface ProjectSource {
  kind: "git" | "path" | "demo";
  input?: string;
  url?: string;
  path?: string;
}

export interface BrowseRoot {
  kind: "home" | "desktop" | "documents" | "downloads";
  path: string;
}

export interface BrowseEntry {
  name: string;
  path: string;
  hidden: boolean;
  isGitRepo: boolean;
}

export interface BrowseListing {
  path: string;
  name: string;
  parent: string | null;
  isGitRepo: boolean;
  isHome: boolean;
  breadcrumbs: { label: string; path: string }[];
  roots: BrowseRoot[];
  entries: BrowseEntry[];
  hiddenCount: number;
  showHidden: boolean;
}

export interface LatestCommit {
  shortSha: string;
  message: string;
  author: string;
  date: string;
  timestamp: number;
  branch: string;
}

export interface Project {
  id: string;
  name: string;
  source: ProjectSource;
  repoPath: string;
  defaultBranch: string;
  currentBranch: string;
  originUrl: string;
  dirtyCount: number;
  branchCount: number;
  framework: FrameworkInfo | null;
  description: string;
  tagline: string;
  links: { label: string; url: string }[];
  status: "ready" | "importing" | "error";
  error: string | null;
  isDemo: boolean;
  createdAt: string;
  updatedAt: string;
  latestCommit: LatestCommit | null;
}

export interface Branch {
  name: string;
  ref: string;
  sha: string;
  shortSha: string;
  date: string;
  timestamp: number;
  author: string;
  subject: string;
  isDefault: boolean;
  isCurrent: boolean;
  remoteOnly: boolean;
  deployment: Deployment | null;
}

export interface Note {
  id: string;
  projectId: string;
  title: string;
  body: string;
  tags: string[];
  pinned: boolean;
  branch: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Comment {
  id: string;
  projectId: string;
  branch: string | null;
  author: string;
  body: string;
  clientId?: string;
  createdAt: string;
}

export interface SystemInfo {
  hostname: string;
  platform: string;
  release: string;
  port: number;
  node: string;
  version: string;
  localUrl: string;
  lanUrls: { name: string; address: string; url: string }[];
  primaryUrl: string;
  wifiName: string;
  qrDataUrl: string | null;
  dataDir: string;
  projectCount: number;
  runningCount: number;
  noteCount: number;
  maxPreviews: number;
}

export interface Stats {
  projects: number;
  branches: number;
  running: number;
  notes: number;
  comments: number;
}

export interface Settings {
  userName: string;
  defaultAuthor: string;
}

export interface Overview {
  projects: Project[];
  deployments: Deployment[];
  settings: Settings;
  stats: Stats;
}

export interface ProjectDetail {
  project: Project;
  deployments: Deployment[];
  notesCount: number;
  commentsCount: number;
}

export interface BranchList {
  projectId: string;
  defaultBranch: string;
  currentBranch: string;
  branches: Branch[];
}

export interface Readme {
  name: string;
  markdown: string;
}

export interface BranchChanges {
  branch: string;
  base: string;
  files: { path: string; additions: number; deletions: number }[];
  fileCount: number;
  additions: number;
  deletions: number;
}
