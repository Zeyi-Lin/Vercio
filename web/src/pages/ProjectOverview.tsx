import { useEffect, useState } from "react";
import {
  BookOpen,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  GitBranch,
  Pencil,
  RefreshCw,
  StickyNote,
  X,
} from "lucide-react";
import { api } from "../lib/api";
import { Link } from "../lib/router";
import { relativeTime, truncateMiddle } from "../lib/format";
import type { Note, ProjectDetail } from "../lib/types";
import { useToast } from "../components/Toast";
import { GithubIcon } from "../components/icons";
import { DeploymentList } from "../components/DeploymentList";
import { Markdown } from "../components/Markdown";
import { ShareCard } from "../components/ShareCard";
import { Button, EmptyState, Skeleton } from "../components/ui";

export function ProjectOverview({
  detail,
  onReload,
}: {
  detail: ProjectDetail;
  onReload: () => void;
}) {
  const { project, deployments } = detail;
  const { pushToast } = useToast();
  const [description, setDescription] = useState(project.description);
  const [draft, setDraft] = useState(project.description);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [readme, setReadme] = useState<{ name: string; markdown: string } | null>(null);
  const [readmeLoading, setReadmeLoading] = useState(true);
  const [readmeExpanded, setReadmeExpanded] = useState(false);
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [repoRefreshing, setRepoRefreshing] = useState(false);

  useEffect(() => {
    setDescription(project.description);
    setDraft(project.description);
  }, [project.description]);

  useEffect(() => {
    let cancelled = false;
    setReadmeLoading(true);
    api
      .readme(project.id)
      .then((result) => {
        if (!cancelled) setReadme(result.readme);
      })
      .catch(() => {
        if (!cancelled) setReadme(null);
      })
      .finally(() => {
        if (!cancelled) setReadmeLoading(false);
      });
    api
      .notes(project.id)
      .then((result) => {
        if (!cancelled) setNotes(result.notes.slice(0, 4));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [project.id]);

  const saveBrief = async () => {
    setSaving(true);
    try {
      const result = await api.updateProject(project.id, { description: draft });
      setDescription(result.project.description);
      setDraft(result.project.description);
      setEditing(false);
      onReload();
      pushToast("Product brief saved", "success");
    } catch (error) {
      pushToast(error instanceof Error ? error.message : "Could not save brief", "error");
    } finally {
      setSaving(false);
    }
  };

  const refreshRepo = async () => {
    setRepoRefreshing(true);
    try {
      await api.refreshProject(project.id);
      onReload();
      pushToast("Repository refreshed", "success");
    } catch (error) {
      pushToast(error instanceof Error ? error.message : "Could not refresh", "error");
    } finally {
      setRepoRefreshing(false);
    }
  };

  const sourceLabel = project.isDemo
    ? "Bundled demo repository"
    : project.source.url
      ? project.source.url.replace(/^https?:\/\//, "")
      : truncateMiddle(project.repoPath, 40);

  return (
    <div className="overview-grid">
      <div className="overview-main">
        <section className="card brief-card">
          <div className="card-head">
            <div>
              <h2 className="card-title">Product brief</h2>
              <p className="card-subtitle">
                What this product is, who it&apos;s for, and what you&apos;re building toward.
              </p>
            </div>
            {!editing ? (
              <Button size="sm" variant="secondary" icon={<Pencil size={12} />} onClick={() => setEditing(true)}>
                Edit
              </Button>
            ) : (
              <Button size="sm" variant="ghost" icon={<X size={12} />} onClick={() => { setEditing(false); setDraft(description); }}>
                Cancel
              </Button>
            )}
          </div>
          <div className="card-body">
            {editing ? (
              <div className="brief-editor">
                <textarea
                  className="textarea textarea-mono"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder={"## What are we building?\n\nDescribe the product, the audience and the next milestone. Markdown is supported."}
                  rows={14}
                  autoFocus
                />
                <div className="brief-editor-foot">
                  <span className="hint">Markdown supported · saved locally</span>
                  <div className="brief-editor-actions">
                    <Button size="sm" onClick={() => { setEditing(false); setDraft(description); }} disabled={saving}>
                      Cancel
                    </Button>
                    <Button size="sm" variant="primary" onClick={saveBrief} loading={saving}>
                      Save brief
                    </Button>
                  </div>
                </div>
              </div>
            ) : description ? (
              <Markdown source={description} />
            ) : (
              <div className="brief-empty">
                <span className="brief-empty-icon"><Pencil size={16} /></span>
                <div>
                  <strong>Write the product brief</strong>
                  <p className="hint">
                    Explain what this product is and why it exists. Your team will see it right here
                    on every branch preview.
                  </p>
                </div>
                <Button size="sm" variant="primary" onClick={() => setEditing(true)}>
                  Write brief
                </Button>
              </div>
            )}
          </div>
        </section>

        <section className="card readme-card">
          <div className="card-head">
            <div className="readme-title">
              <BookOpen size={15} />
              <div>
                <h2 className="card-title">README</h2>
                <p className="card-subtitle">
                  From <span className="mono">{readme?.name || "README.md"}</span> on{" "}
                  <span className="mono">{project.defaultBranch}</span>
                </p>
              </div>
            </div>
            {readme && (
              <Button size="sm" variant="ghost" icon={<ExternalLink size={12} />} onClick={() => setReadmeExpanded(true)}>
                Open
              </Button>
            )}
          </div>
          <div className="card-body">
            {readmeLoading ? (
              <div className="readme-skeleton">
                <Skeleton width="55%" height={20} />
                <Skeleton width="92%" height={12} style={{ marginTop: 16 }} />
                <Skeleton width="86%" height={12} style={{ marginTop: 8 }} />
                <Skeleton width="70%" height={12} style={{ marginTop: 8 }} />
              </div>
            ) : readme ? (
              <>
                <div className={"readme-content" + (readmeExpanded ? "" : " readme-clamped")}>
                  <Markdown source={readme.markdown} />
                </div>
                <button className="readme-toggle" onClick={() => setReadmeExpanded((value) => !value)}>
                  {readmeExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                  {readmeExpanded ? "Show less" : "Show full README"}
                </button>
              </>
            ) : (
              <EmptyState
                icon={<BookOpen size={18} />}
                title="No README on the production branch"
                description="Add a README.md to the repository and it will show up here for the whole team."
              />
            )}
          </div>
        </section>
      </div>

      <aside className="overview-side">
        <section className="card">
          <div className="card-head">
            <div>
              <h2 className="card-title">Repository</h2>
              <p className="card-subtitle">Connected to this workspace.</p>
            </div>
            <Button
              size="sm"
              variant="ghost"
              icon={<RefreshCw size={12} className={repoRefreshing ? "spin" : ""} />}
              onClick={refreshRepo}
              disabled={repoRefreshing}
            >
              Refresh
            </Button>
          </div>
          <div className="card-body repo-details">
            <div className="detail-row">
              <span className="detail-label">Source</span>
              <span className="detail-value">
                {project.source.url ? (
                  <a href={project.source.url} target="_blank" rel="noreferrer" className="detail-link">
                    <GithubIcon size={12} />
                    <span className="mono">{sourceLabel}</span>
                    <ExternalLink size={11} />
                  </a>
                ) : (
                  <span className="mono truncate">{sourceLabel}</span>
                )}
              </span>
            </div>
            <div className="detail-row">
              <span className="detail-label">Default branch</span>
              <span className="detail-value mono"><GitBranch size={11} /> {project.defaultBranch}</span>
            </div>
            <div className="detail-row">
              <span className="detail-label">Branches</span>
              <span className="detail-value">{project.branchCount}</span>
            </div>
            <div className="detail-row">
              <span className="detail-label">Local path</span>
              <span className="detail-value mono truncate" title={project.repoPath}>
                {truncateMiddle(project.repoPath, 30)}
              </span>
            </div>
            {project.latestCommit && (
              <div className="detail-row">
                <span className="detail-label">Last commit</span>
                <span className="detail-value">
                  <span className="mono">{project.latestCommit.shortSha}</span>{" "}
                  {relativeTime(project.latestCommit.date)}
                </span>
              </div>
            )}
            {project.dirtyCount > 0 && (
              <div className="dirty-note">
                {project.dirtyCount} uncommitted file{project.dirtyCount === 1 ? "" : "s"} in the working
                copy. Previews always use committed branches.
              </div>
            )}
          </div>
        </section>

        <section className="card">
          <div className="card-head">
            <div>
              <h2 className="card-title">Deployments</h2>
              <p className="card-subtitle">Recent previews for this project.</p>
            </div>
            <Link to={"/p/" + project.id + "/previews"} className="text-link">
              All previews
            </Link>
          </div>
          <div className="card-body card-body-flush">
            <DeploymentList
              deployments={deployments.slice(0, 5)}
              showProject={false}
              emptyTitle="No previews yet"
              emptyDescription="Open the Previews tab and click a branch."
            />
          </div>
        </section>

        <section className="card">
          <div className="card-head">
            <div>
              <h2 className="card-title">Notes</h2>
              <p className="card-subtitle">Context living next to the code.</p>
            </div>
            <Link to={"/p/" + project.id + "/notes"} className="text-link">
              Open notes
            </Link>
          </div>
          <div className="card-body notes-mini">
            {notes === null ? (
              <>
                <Skeleton height={38} />
                <Skeleton height={38} style={{ marginTop: 8 }} />
              </>
            ) : notes.length === 0 ? (
              <EmptyState
                icon={<StickyNote size={17} />}
                title="No notes yet"
                description="Write the product brief, design reviews or launch checklists."
              />
            ) : (
              notes.map((note) => (
                <Link to={"/p/" + project.id + "/notes?note=" + note.id} className="note-mini" key={note.id}>
                  <span className="note-mini-icon"><StickyNote size={13} /></span>
                  <span className="note-mini-body">
                    <span className="note-mini-title">{note.title}</span>
                    <span className="note-mini-meta">
                      {note.branch ? <span className="mono">{note.branch}</span> : "Project note"}
                      <span className="dot-sep">·</span>
                      {relativeTime(note.updatedAt)}
                    </span>
                  </span>
                  {note.pinned && <span className="note-pin-dot" title="Pinned" />}
                </Link>
              ))
            )}
          </div>
        </section>

        <ShareCard compact />
      </aside>
    </div>
  );
}
