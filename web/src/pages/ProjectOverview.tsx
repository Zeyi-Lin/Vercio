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
import { useT } from "../i18n";
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
  const t = useT();
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
      pushToast(t("overview.brief.saved"), "success");
    } catch (error) {
      pushToast(error instanceof Error ? error.message : t("overview.brief.saveError"), "error");
    } finally {
      setSaving(false);
    }
  };

  const refreshRepo = async () => {
    setRepoRefreshing(true);
    try {
      await api.refreshProject(project.id);
      onReload();
      pushToast(t("overview.refreshed"), "success");
    } catch (error) {
      pushToast(error instanceof Error ? error.message : t("overview.refreshError"), "error");
    } finally {
      setRepoRefreshing(false);
    }
  };

  const sourceLabel = project.isDemo
    ? t("project.demoRepository")
    : project.source.url
      ? project.source.url.replace(/^https?:\/\//, "")
      : truncateMiddle(project.repoPath, 40);

  return (
    <div className="overview-grid">
      <div className="overview-main">
        <section className="card brief-card">
          <div className="card-head">
            <div>
              <h2 className="card-title">{t("overview.brief.title")}</h2>
              <p className="card-subtitle">{t("overview.brief.subtitle")}</p>
            </div>
            {!editing ? (
              <Button size="sm" variant="secondary" icon={<Pencil size={12} />} onClick={() => setEditing(true)}>
                {t("overview.brief.edit")}
              </Button>
            ) : (
              <Button size="sm" variant="ghost" icon={<X size={12} />} onClick={() => { setEditing(false); setDraft(description); }}>
                {t("common.cancel")}
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
                  placeholder={t("overview.brief.placeholder")}
                  rows={14}
                  autoFocus
                />
                <div className="brief-editor-foot">
                  <span className="hint">{t("overview.brief.markdownHint")}</span>
                  <div className="brief-editor-actions">
                    <Button size="sm" onClick={() => { setEditing(false); setDraft(description); }} disabled={saving}>
                      {t("common.cancel")}
                    </Button>
                    <Button size="sm" variant="primary" onClick={saveBrief} loading={saving}>
                      {t("overview.brief.save")}
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
                  <strong>{t("overview.brief.emptyTitle")}</strong>
                  <p className="hint">{t("overview.brief.emptyDesc")}</p>
                </div>
                <Button size="sm" variant="primary" onClick={() => setEditing(true)}>
                  {t("overview.brief.write")}
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
                <h2 className="card-title">{t("overview.readme.title")}</h2>
                <p className="card-subtitle">
                  {t("overview.readme.from", { name: readme?.name || "README.md", branch: project.defaultBranch })}
                </p>
              </div>
            </div>
            {readme && (
              <Button size="sm" variant="ghost" icon={<ExternalLink size={12} />} onClick={() => setReadmeExpanded(true)}>
                {t("common.open")}
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
                  {readmeExpanded ? t("overview.readme.less") : t("overview.readme.full")}
                </button>
              </>
            ) : (
              <EmptyState
                icon={<BookOpen size={18} />}
                title={t("overview.readme.emptyTitle")}
                description={t("overview.readme.emptyDesc")}
              />
            )}
          </div>
        </section>
      </div>

      <aside className="overview-side">
        <section className="card">
          <div className="card-head">
            <div>
              <h2 className="card-title">{t("overview.repo.title")}</h2>
              <p className="card-subtitle">{t("overview.repo.subtitle")}</p>
            </div>
            <Button
              size="sm"
              variant="ghost"
              icon={<RefreshCw size={12} className={repoRefreshing ? "spin" : ""} />}
              onClick={refreshRepo}
              disabled={repoRefreshing}
            >
              {t("common.refresh")}
            </Button>
          </div>
          <div className="card-body repo-details">
            <div className="detail-row">
              <span className="detail-label">{t("overview.repo.source")}</span>
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
              <span className="detail-label">{t("overview.repo.defaultBranch")}</span>
              <span className="detail-value mono"><GitBranch size={11} /> {project.defaultBranch}</span>
            </div>
            <div className="detail-row">
              <span className="detail-label">{t("overview.repo.branches")}</span>
              <span className="detail-value">{project.branchCount}</span>
            </div>
            <div className="detail-row">
              <span className="detail-label">{t("overview.repo.localPath")}</span>
              <span className="detail-value mono truncate" title={project.repoPath}>
                {truncateMiddle(project.repoPath, 30)}
              </span>
            </div>
            {project.latestCommit && (
              <div className="detail-row">
                <span className="detail-label">{t("overview.repo.lastCommit")}</span>
                <span className="detail-value">
                  <span className="mono">{project.latestCommit.shortSha}</span>{" "}
                  {relativeTime(project.latestCommit.date)}
                </span>
              </div>
            )}
            {project.dirtyCount > 0 && (
              <div className="dirty-note">{t("overview.repo.dirty", { count: project.dirtyCount })}</div>
            )}
          </div>
        </section>

        <section className="card">
          <div className="card-head">
            <div>
              <h2 className="card-title">{t("overview.deployments.title")}</h2>
              <p className="card-subtitle">{t("overview.deployments.subtitle")}</p>
            </div>
            <Link to={"/p/" + project.id + "/previews"} className="text-link">
              {t("overview.deployments.all")}
            </Link>
          </div>
          <div className="card-body card-body-flush">
            <DeploymentList
              deployments={deployments.slice(0, 5)}
              showProject={false}
              emptyTitle={t("overview.deployments.emptyTitle")}
              emptyDescription={t("overview.deployments.emptyDesc")}
            />
          </div>
        </section>

        <section className="card">
          <div className="card-head">
            <div>
              <h2 className="card-title">{t("overview.notes.title")}</h2>
              <p className="card-subtitle">{t("overview.notes.subtitle")}</p>
            </div>
            <Link to={"/p/" + project.id + "/notes"} className="text-link">
              {t("overview.notes.open")}
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
                title={t("overview.notes.emptyTitle")}
                description={t("overview.notes.emptyDesc")}
              />
            ) : (
              notes.map((note) => (
                <Link to={"/p/" + project.id + "/notes?note=" + note.id} className="note-mini" key={note.id}>
                  <span className="note-mini-icon"><StickyNote size={13} /></span>
                  <span className="note-mini-body">
                    <span className="note-mini-title">{note.title}</span>
                    <span className="note-mini-meta">
                      {note.branch ? <span className="mono">{note.branch}</span> : t("overview.notes.projectNote")}
                      <span className="dot-sep">·</span>
                      {relativeTime(note.updatedAt)}
                    </span>
                  </span>
                  {note.pinned && <span className="note-pin-dot" title={t("overview.notes.pinned")} />}
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
