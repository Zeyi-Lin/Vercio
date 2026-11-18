import { useEffect, useMemo, useRef, useState } from "react";
import {
  Eye,
  FileText,
  GitBranch,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Search,
  StickyNote,
  Trash2,
} from "lucide-react";
import { api } from "../lib/api";
import { useT } from "../i18n";
import { plainText } from "../lib/markdown";
import { relativeTime } from "../lib/format";
import type { Note, Project } from "../lib/types";
import { useToast } from "../components/Toast";
import { ConfirmDialog, Button, EmptyState, Skeleton } from "../components/ui";
import { Markdown } from "../components/Markdown";

interface Draft {
  title: string;
  body: string;
  tags: string;
  pinned: boolean;
  branch: string;
}

function noteToDraft(note: Note): Draft {
  return {
    title: note.title,
    body: note.body,
    tags: (note.tags || []).join(", "),
    pinned: note.pinned,
    branch: note.branch || "",
  };
}

const EMPTY_DRAFT: Draft = { title: "", body: "", tags: "", pinned: false, branch: "" };

function parseTags(value: string): string[] {
  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 8);
}

export function ProjectNotes({ project }: { project: Project }) {
  const { pushToast } = useToast();
  const t = useT();
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [selectedId, setSelectedId] = useState<string>("");
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [mode, setMode] = useState<"write" | "preview">("preview");
  const [search, setSearch] = useState("");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [branches, setBranches] = useState<string[]>([]);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [creating, setCreating] = useState(false);
  const skipNextSave = useRef(true);
  const titleRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    setNotes(null);
    Promise.all([api.notes(project.id), api.branches(project.id)])
      .then(([notesResult, branchesResult]) => {
        if (cancelled) return;
        setNotes(notesResult.notes);
        setBranches(branchesResult.branches.map((branch) => branch.name));
        const requested = new URLSearchParams(window.location.search).get("note");
        const initial =
          (requested && notesResult.notes.find((note) => note.id === requested)) ||
          notesResult.notes[0];
        if (initial) {
          setSelectedId(initial.id);
          setDraft(noteToDraft(initial));
          skipNextSave.current = true;
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setNotes([]);
          pushToast(error instanceof Error ? error.message : t("notes.loadError"), "error");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [project.id, pushToast]);

  useEffect(() => {
    const handler = (event: Event) => {
      const payload = (event as CustomEvent).detail as { data?: { projectId?: string } };
      if (payload?.data?.projectId && payload.data.projectId !== project.id) return;
      api
        .notes(project.id)
        .then((result) => setNotes(result.notes))
        .catch(() => {});
    };
    window.addEventListener("vercio:event", handler);
    return () => window.removeEventListener("vercio:event", handler);
  }, [project.id]);

  const selectedNote = useMemo(
    () => notes?.find((note) => note.id === selectedId) || null,
    [notes, selectedId]
  );

  useEffect(() => {
    if (!selectedNote) return;
    setDraft(noteToDraft(selectedNote));
    skipNextSave.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  useEffect(() => {
    if (!selectedNote) return;
    if (skipNextSave.current) {
      skipNextSave.current = false;
      return;
    }
    setSaveState("saving");
    const timer = setTimeout(async () => {
      try {
        const result = await api.updateNote(selectedNote.id, {
          title: draft.title,
          body: draft.body,
          tags: parseTags(draft.tags),
          pinned: draft.pinned,
          branch: draft.branch || null,
        });
        setNotes((current) =>
          current ? current.map((note) => (note.id === result.note.id ? result.note : note)) : current
        );
        setSaveState("saved");
      } catch {
        setSaveState("error");
      }
    }, 700);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  useEffect(() => {
    if (!selectedId) return;
    const next = "/p/" + project.id + "/notes?note=" + selectedId;
    if (window.location.pathname + window.location.search !== next) {
      window.history.replaceState({}, "", next);
    }
  }, [selectedId, project.id]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const list = (notes || []).slice().sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return (b.updatedAt || "").localeCompare(a.updatedAt || "");
    });
    if (!needle) return list;
    return list.filter(
      (note) =>
        note.title.toLowerCase().includes(needle) ||
        note.body.toLowerCase().includes(needle) ||
        (note.tags || []).some((tag) => tag.toLowerCase().includes(needle))
    );
  }, [notes, search]);

  const createNote = async () => {
    if (creating) return;
    setCreating(true);
    try {
      const result = await api.createNote(project.id, {
        title: t("notes.untitled"),
        body: "",
        tags: [],
        pinned: false,
        branch: null,
      });
      setNotes((current) => (current ? [result.note, ...current] : [result.note]));
      setSelectedId(result.note.id);
      setDraft(noteToDraft(result.note));
      setMode("write");
      skipNextSave.current = true;
      setTimeout(() => {
        titleRef.current?.focus();
        titleRef.current?.select();
      }, 60);
    } catch (error) {
      pushToast(error instanceof Error ? error.message : t("notes.createError"), "error");
    } finally {
      setCreating(false);
    }
  };

  const deleteNote = async () => {
    if (!selectedNote) return;
    setDeleting(true);
    try {
      await api.deleteNote(selectedNote.id);
      const remaining = (notes || []).filter((note) => note.id !== selectedNote.id);
      setNotes(remaining);
      setSelectedId(remaining[0]?.id || "");
      if (remaining[0]) {
        setDraft(noteToDraft(remaining[0]));
        skipNextSave.current = true;
      } else {
        setDraft(EMPTY_DRAFT);
      }
      setDeleteOpen(false);
      pushToast(t("notes.deleted"), "success");
    } catch (error) {
      pushToast(error instanceof Error ? error.message : t("notes.deleteError"), "error");
    } finally {
      setDeleting(false);
    }
  };

  const forceSave = async () => {
    if (!selectedNote) return;
    setSaveState("saving");
    try {
      const result = await api.updateNote(selectedNote.id, {
        title: draft.title,
        body: draft.body,
        tags: parseTags(draft.tags),
        pinned: draft.pinned,
        branch: draft.branch || null,
      });
      setNotes((current) =>
        current ? current.map((note) => (note.id === result.note.id ? result.note : note)) : current
      );
      setSaveState("saved");
    } catch {
      setSaveState("error");
    }
  };

  const wordCount = draft.body.trim() ? draft.body.trim().split(/\s+/).length : 0;

  return (
    <div className="notes-layout">
      <aside className="notes-sidebar">
        <div className="notes-sidebar-head">
          <div className="notes-sidebar-title">
            <h2>{t("notes.title")}</h2>
            <span className="branch-count">{notes?.length || 0}</span>
          </div>
          <button
            className="icon-btn bordered"
            onClick={createNote}
            title={t("notes.new")}
            aria-label={t("notes.new")}
            disabled={creating}
          >
            <Plus size={14} />
          </button>
        </div>
        <div className="branch-search">
          <Search size={13} />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("notes.search")}
            aria-label={t("notes.search")}
          />
        </div>
        <div className="note-list">
          {notes === null &&
            [0, 1, 2].map((index) => (
              <div className="note-item" key={index}>
                <Skeleton width="65%" height={12} />
                <Skeleton width="90%" height={9} style={{ marginTop: 9 }} />
              </div>
            ))}
          {notes !== null && filtered.length === 0 && (
            <p className="branch-empty">
              {notes.length === 0 ? t("notes.noNotes") : t("notes.noMatch", { query: search })}
            </p>
          )}
          {filtered.map((note) => (
            <button
              key={note.id}
              className={"note-item" + (note.id === selectedId ? " note-item-active" : "")}
              onClick={() => {
                setSelectedId(note.id);
                setDraft(noteToDraft(note));
                setMode("preview");
                skipNextSave.current = true;
              }}
            >
              <div className="note-item-title">
                {note.pinned && <Pin size={10} className="note-pin" />}
                <span className="truncate">{note.title}</span>
              </div>
              <p className="note-item-snippet">
                {plainText(note.body).slice(0, 96) || t("notes.emptyNote")}
              </p>
              <div className="note-item-meta">
                {note.branch ? (
                  <span className="note-item-branch mono truncate"><GitBranch size={9} /> {note.branch}</span>
                ) : (
                  <span className="note-item-branch">{t("notes.projectNote")}</span>
                )}
                <span>{relativeTime(note.updatedAt)}</span>
              </div>
            </button>
          ))}
        </div>
        <div className="notes-sidebar-foot">
          <StickyNote size={12} />
          {t("notes.savedLocally")}
        </div>
      </aside>

      <section className="note-editor">
        {notes === null ? (
          <div className="note-editor-loading">
            <Skeleton width="40%" height={30} />
            <Skeleton height={14} style={{ marginTop: 20 }} />
            <Skeleton width="80%" height={14} style={{ marginTop: 8 }} />
            <Skeleton height="40%" style={{ marginTop: 24 }} />
          </div>
        ) : creating ? (
          <div className="note-editor-loading">
            <Skeleton width="45%" height={28} />
            <Skeleton height={12} style={{ marginTop: 18 }} />
            <Skeleton width="75%" height={12} style={{ marginTop: 8 }} />
            <Skeleton height="38%" style={{ marginTop: 24 }} />
          </div>
        ) : !selectedNote || !notes.length ? (
          <EmptyState
            icon={<FileText size={20} />}
            title={t("notes.emptyTitle")}
            description={t("notes.emptyDesc")}
            actions={
              <Button variant="primary" size="sm" icon={<Plus size={13} />} onClick={createNote}>
                {t("notes.newNote")}
              </Button>
            }
          />
        ) : (
          <>
            <div className="note-editor-head">
              <input
                ref={titleRef}
                className="note-title-input"
                value={draft.title}
                onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
                placeholder={t("notes.titlePlaceholder")}
                onKeyDown={(event) => {
                  if ((event.metaKey || event.ctrlKey) && event.key === "s") {
                    event.preventDefault();
                    forceSave();
                  }
                }}
              />
              <div className="note-editor-actions">
                <button
                  className={"icon-btn" + (draft.pinned ? " is-active" : "")}
                  onClick={() => setDraft((current) => ({ ...current, pinned: !current.pinned }))}
                  title={draft.pinned ? t("notes.unpin") : t("notes.pin")}
                  aria-label={draft.pinned ? t("notes.unpin") : t("notes.pin")}
                >
                  {draft.pinned ? <PinOff size={14} /> : <Pin size={14} />}
                </button>
                <button
                  className="icon-btn"
                  onClick={() => setDeleteOpen(true)}
                  title={t("notes.delete")}
                  aria-label={t("notes.delete")}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>

            <div className="note-editor-meta">
              <div className="note-meta-left">
                <span className={"save-state save-" + saveState}>
                  {t(
                    saveState === "saving"
                      ? "notes.saveState.saving"
                      : saveState === "saved"
                        ? "notes.saveState.saved"
                        : saveState === "error"
                          ? "notes.saveState.error"
                          : "notes.saveState.idle"
                  )}
                </span>
                <span className="dot-sep">·</span>
                <span>{t("notes.words", { count: wordCount })}</span>
                <span className="dot-sep">·</span>
                <span>{t("notes.edited", { time: relativeTime(selectedNote.updatedAt) })}</span>
              </div>
              <div className="note-meta-right">
                <label className="note-branch-select">
                  <GitBranch size={11} />
                  <select
                    value={draft.branch}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, branch: event.target.value }))
                    }
                    aria-label={t("notes.linkBranch")}
                  >
                    <option value="">{t("notes.projectNote")}</option>
                    {branches.map((branch) => (
                      <option key={branch} value={branch}>
                        {branch}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="segmented">
                  <button
                    className={"segmented-option" + (mode === "write" ? " active" : "")}
                    onClick={() => setMode("write")}
                  >
                    <Pencil size={11} /> {t("notes.write")}
                  </button>
                  <button
                    className={"segmented-option" + (mode === "preview" ? " active" : "")}
                    onClick={() => setMode("preview")}
                  >
                    <Eye size={11} /> {t("notes.preview")}
                  </button>
                </div>
              </div>
            </div>

            <div className="note-tags-row">
              <span className="note-tags-label">{t("notes.tags")}</span>
              {mode === "write" ? (
                <input
                  className="note-tags-input"
                  value={draft.tags}
                  onChange={(event) => setDraft((current) => ({ ...current, tags: event.target.value }))}
                  placeholder={t("notes.tagsPlaceholder")}
                />
              ) : parseTags(draft.tags).length ? (
                <div className="note-tag-chips">
                  {parseTags(draft.tags).map((tag) => (
                    <span className="tag-chip" key={tag}>{tag}</span>
                  ))}
                </div>
              ) : (
                <span className="hint">{t("notes.noTags")}</span>
              )}
            </div>

            <div className="note-body">
              {mode === "write" ? (
                <textarea
                  className="note-textarea"
                  value={draft.body}
                  onChange={(event) => setDraft((current) => ({ ...current, body: event.target.value }))}
                  placeholder={t("notes.bodyPlaceholder")}
                  onKeyDown={(event) => {
                    if ((event.metaKey || event.ctrlKey) && event.key === "s") {
                      event.preventDefault();
                      forceSave();
                    }
                  }}
                  spellCheck
                />
              ) : (
                <div className="note-preview">
                  {draft.body.trim() ? (
                    <Markdown source={draft.body} />
                  ) : (
                    <p className="muted">{t("notes.noPreview")}</p>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </section>

      <ConfirmDialog
        open={deleteOpen}
        title={t("notes.deleteTitle")}
        description={t("notes.deleteDesc")}
        confirmLabel={t("notes.deleteConfirm")}
        busy={deleting}
        onCancel={() => setDeleteOpen(false)}
        onConfirm={deleteNote}
      />
    </div>
  );
}
