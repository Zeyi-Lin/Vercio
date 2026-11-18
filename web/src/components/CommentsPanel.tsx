import { useCallback, useEffect, useRef, useState } from "react";
import {
  CornerDownRight,
  MessageSquare,
  RefreshCw,
  Send,
  StickyNote,
  Trash2,
  X,
} from "lucide-react";
import { api } from "../lib/api";
import { initials, relativeTime } from "../lib/format";
import { Link } from "../lib/router";
import { useApp } from "../context/AppContext";
import type { Comment, Note, Project } from "../lib/types";
import { useToast } from "./Toast";
import { Button, EmptyState, Spinner, Skeleton } from "./ui";

function clientId(): string {
  try {
    const existing = window.localStorage.getItem("vercio:client");
    if (existing) return existing;
    const created = crypto.randomUUID();
    window.localStorage.setItem("vercio:client", created);
    return created;
  } catch {
    return "local-client";
  }
}

export function CommentsPanel({
  project,
  branch,
  notes,
  onClose,
  onCountChange,
}: {
  project: Project;
  branch: string;
  notes: Note[];
  onClose: () => void;
  onCountChange: (count: number) => void;
}) {
  const { authorName, openModal } = useApp();
  const { pushToast } = useToast();
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const idRef = useRef(clientId());

  const load = useCallback(async () => {
    try {
      const result = await api.comments(project.id, branch);
      setComments(result.comments);
      onCountChange(result.comments.length);
    } catch {
      setComments([]);
    }
  }, [project.id, branch, onCountChange]);

  useEffect(() => {
    setComments(null);
    load();
  }, [load]);

  useEffect(() => {
    const handler = () => {
      load();
    };
    window.addEventListener("vercio:event", handler);
    return () => window.removeEventListener("vercio:event", handler);
  }, [load]);

  const post = async () => {
    const text = body.trim();
    if (!text || busy) return;
    setBusy(true);
    try {
      const result = await api.createComment(project.id, {
        branch,
        author: authorName || "Guest",
        body: text,
        clientId: idRef.current,
      });
      setComments((current) => [...(current || []), result.comment]);
      setBody("");
      onCountChange((comments?.length || 0) + 1);
      pushToast("Comment posted", "success");
    } catch (error) {
      pushToast(error instanceof Error ? error.message : "Could not post comment", "error");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (comment: Comment) => {
    try {
      await api.deleteComment(comment.id, idRef.current);
      const next = (comments || []).filter((item) => item.id !== comment.id);
      setComments(next);
      onCountChange(next.length);
    } catch (error) {
      pushToast(error instanceof Error ? error.message : "Could not delete comment", "error");
    }
  };

  const linkedNotes = notes.filter((note) => note.branch === branch);

  return (
    <aside className="discussion-panel">
      <div className="discussion-head">
        <div>
          <h2 className="discussion-title">
            <MessageSquare size={14} /> Discussion
          </h2>
          <p className="discussion-subtitle mono">{branch}</p>
        </div>
        <div className="discussion-head-actions">
          <button
            className="icon-btn"
            onClick={async () => {
              setRefreshing(true);
              await load();
              setRefreshing(false);
            }}
            aria-label="Refresh discussion"
            title="Refresh discussion"
          >
            {refreshing ? <Spinner /> : <RefreshCw size={14} />}
          </button>
          <button className="icon-btn" onClick={onClose} aria-label="Close discussion" title="Close discussion">
            <X size={15} />
          </button>
        </div>
      </div>

      {linkedNotes.length > 0 && (
        <div className="discussion-linked">
          <span className="discussion-section-label">Linked notes</span>
          {linkedNotes.map((note) => (
            <Link
              key={note.id}
              to={"/p/" + project.id + "/notes?note=" + note.id}
              className="linked-note"
            >
              <StickyNote size={12} />
              <span className="truncate">{note.title}</span>
              <CornerDownRight size={11} className="linked-note-arrow" />
            </Link>
          ))}
        </div>
      )}

      <div className="discussion-list">
        {comments === null &&
          [0, 1].map((index) => (
            <div className="comment-skeleton" key={index}>
              <Skeleton width={26} height={26} style={{ borderRadius: "50%" }} />
              <div style={{ flex: 1 }}>
                <Skeleton width="40%" height={10} />
                <Skeleton width="90%" height={10} style={{ marginTop: 8 }} />
              </div>
            </div>
          ))}
        {comments && comments.length === 0 && (
          <EmptyState
            icon={<MessageSquare size={17} />}
            title="Start the conversation"
            description="Leave feedback on this branch. Everyone on the network sees it instantly."
          />
        )}
        {comments?.map((comment) => (
          <div className="comment" key={comment.id}>
            <span className="avatar comment-avatar">{initials(comment.author)}</span>
            <div className="comment-body">
              <div className="comment-meta">
                <span className="comment-author">{comment.author}</span>
                <time>{relativeTime(comment.createdAt)}</time>
                {comment.clientId === idRef.current && (
                  <button className="comment-delete" onClick={() => remove(comment)} title="Delete comment">
                    <Trash2 size={11} />
                  </button>
                )}
              </div>
              <p className="comment-text">{comment.body}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="discussion-composer">
        <textarea
          className="textarea discussion-input"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder={"Comment on " + branch + "…"}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") post();
          }}
        />
        <div className="discussion-composer-foot">
          <button className="discussion-author" onClick={() => openModal("profile")} title="Edit display name">
            Posting as <strong>{authorName || "Guest"}</strong> · edit
          </button>
          <Button
            size="sm"
            variant="primary"
            icon={<Send size={12} />}
            loading={busy}
            disabled={!body.trim()}
            onClick={post}
          >
            Post
          </Button>
        </div>
      </div>
    </aside>
  );
}
