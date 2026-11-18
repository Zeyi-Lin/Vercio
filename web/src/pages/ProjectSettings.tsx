import { useEffect, useState } from "react";
import {
  AlertCircle,
  GitBranch,
  Plus,
  RefreshCw,
  Share2,
  ShieldAlert,
  Trash2,
  X,
} from "lucide-react";
import { api } from "../lib/api";
import { useApp } from "../context/AppContext";
import { projectSlug, truncateMiddle } from "../lib/format";
import type { Project } from "../lib/types";
import { useToast } from "../components/Toast";
import { GithubIcon } from "../components/icons";
import { ShareCard } from "../components/ShareCard";
import { Button, ConfirmDialog, CopyButton, Field, TextInput } from "../components/ui";

export function ProjectSettings({
  project,
  onReload,
  onDeleted,
}: {
  project: Project;
  onReload: () => void;
  onDeleted: () => void;
}) {
  const { systemInfo, settings, saveSettings } = useApp();
  const { pushToast } = useToast();
  const [name, setName] = useState(project.name);
  const [tagline, setTagline] = useState(project.tagline);
  const [links, setLinks] = useState(project.links || []);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [displayName, setDisplayName] = useState(settings.userName);
  const [savingProfile, setSavingProfile] = useState(false);

  useEffect(() => {
    setName(project.name);
    setTagline(project.tagline);
    setLinks(project.links || []);
  }, [project.name, project.tagline, project.links]);

  useEffect(() => {
    setDisplayName(settings.userName);
  }, [settings.userName]);

  const save = async () => {
    setSaving(true);
    try {
      await api.updateProject(project.id, {
        name: name.trim() || project.name,
        tagline: tagline.slice(0, 300),
        links: links.filter((link) => link.url.trim() || link.label.trim()),
      });
      onReload();
      pushToast("Project settings saved", "success");
    } catch (error) {
      pushToast(error instanceof Error ? error.message : "Could not save settings", "error");
    } finally {
      setSaving(false);
    }
  };

  const refreshRepo = async () => {
    setRefreshing(true);
    try {
      await api.refreshProject(project.id);
      onReload();
      pushToast("Repository refreshed", "success");
    } catch (error) {
      pushToast(error instanceof Error ? error.message : "Could not refresh repository", "error");
    } finally {
      setRefreshing(false);
    }
  };

  const saveProfile = async () => {
    setSavingProfile(true);
    try {
      await saveSettings({ userName: displayName.trim() });
    } catch (error) {
      pushToast(error instanceof Error ? error.message : "Could not save profile", "error");
    } finally {
      setSavingProfile(false);
    }
  };

  const deleteProject = async () => {
    setDeleting(true);
    try {
      await api.deleteProject(project.id, project.source.kind !== "path");
      setDeleteOpen(false);
      pushToast("Project removed", "success");
      onDeleted();
    } catch (error) {
      pushToast(error instanceof Error ? error.message : "Could not delete project", "error");
    } finally {
      setDeleting(false);
    }
  };

  const updateLink = (index: number, patch: Partial<{ label: string; url: string }>) => {
    setLinks((current) =>
      current.map((link, linkIndex) => (linkIndex === index ? { ...link, ...patch } : link))
    );
  };

  return (
    <div className="settings-grid">
      <div className="settings-main">
        <section className="card">
          <div className="card-head">
            <div>
              <h2 className="card-title">Project details</h2>
              <p className="card-subtitle">How this project appears across Vercio.</p>
            </div>
          </div>
          <div className="card-body settings-form">
            <Field label="Project name">
              <TextInput value={name} onChange={(event) => setName(event.target.value.slice(0, 80))} />
            </Field>
            <Field label="Tagline" hint="A single line shown under the project name.">
              <TextInput
                value={tagline}
                onChange={(event) => setTagline(event.target.value.slice(0, 300))}
                placeholder="AI meeting notes for teams that ship."
              />
            </Field>
            <Field label="Links" hint="Product site, docs, design files — anything your team needs.">
              <div className="link-editor">
                {links.map((link, index) => (
                  <div className="link-row" key={index}>
                    <TextInput
                      placeholder="Label"
                      value={link.label}
                      onChange={(event) => updateLink(index, { label: event.target.value })}
                    />
                    <TextInput
                      placeholder="https://…"
                      value={link.url}
                      onChange={(event) => updateLink(index, { url: event.target.value })}
                    />
                    <button
                      className="icon-btn"
                      onClick={() => setLinks((current) => current.filter((_, linkIndex) => linkIndex !== index))}
                      aria-label="Remove link"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Plus size={13} />}
                  onClick={() => setLinks((current) => [...current, { label: "", url: "" }])}
                >
                  Add link
                </Button>
              </div>
            </Field>
            <div className="settings-form-actions">
              <Button variant="primary" onClick={save} loading={saving}>
                Save changes
              </Button>
            </div>
          </div>
        </section>

        <section className="card">
          <div className="card-head">
            <div>
              <h2 className="card-title">Repository</h2>
              <p className="card-subtitle">Source, branch and worktree configuration.</p>
            </div>
            <Button
              size="sm"
              variant="ghost"
              icon={<RefreshCw size={12} className={refreshing ? "spin" : ""} />}
              onClick={refreshRepo}
              disabled={refreshing}
            >
              Fetch latest
            </Button>
          </div>
          <div className="card-body repo-details">
            <div className="detail-row">
              <span className="detail-label">Source</span>
              <span className="detail-value">
                {project.source.url ? (
                  <a href={project.source.url} target="_blank" rel="noreferrer" className="detail-link">
                    <GithubIcon size={12} />
                    <span className="mono">{project.source.url.replace(/^https?:\/\//, "")}</span>
                  </a>
                ) : (
                  <span className="mono">{projectSlug(project)}</span>
                )}
              </span>
            </div>
            <div className="detail-row">
              <span className="detail-label">Local path</span>
              <span className="detail-value mono" title={project.repoPath}>
                {truncateMiddle(project.repoPath, 52)}
              </span>
            </div>
            <div className="detail-row">
              <span className="detail-label">Default branch</span>
              <span className="detail-value mono"><GitBranch size={11} /> {project.defaultBranch}</span>
            </div>
            <div className="detail-row">
              <span className="detail-label">Checked out branch</span>
              <span className="detail-value mono">{project.currentBranch || "—"}</span>
            </div>
            {project.dirtyCount > 0 && (
              <div className="dirty-note">
                <AlertCircle size={13} />
                {project.dirtyCount} uncommitted file{project.dirtyCount === 1 ? "" : "s"} in the working copy.
                Previews only use committed branches.
              </div>
            )}
            <p className="hint" style={{ marginTop: 4 }}>
              Previews are created from isolated git worktrees under your Vercio data directory, so
              branches can run side by side without touching your working copy.
            </p>
          </div>
        </section>

        <section className="card">
          <div className="card-head">
            <div>
              <h2 className="card-title">Local profile</h2>
              <p className="card-subtitle">Used when you comment or leave notes.</p>
            </div>
          </div>
          <div className="card-body settings-form">
            <Field label="Display name">
              <div className="inline-field">
                <TextInput
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value.slice(0, 60))}
                  placeholder="e.g. Maya Chen"
                />
                <Button onClick={saveProfile} loading={savingProfile}>
                  Save
                </Button>
              </div>
            </Field>
          </div>
        </section>

        <section className="card danger-zone">
          <div className="card-head">
            <div>
              <h2 className="card-title">
                <ShieldAlert size={15} /> Danger zone
              </h2>
              <p className="card-subtitle">Remove this project from the workspace.</p>
            </div>
          </div>
          <div className="card-body danger-body">
            <div>
              <strong>Delete project</strong>
              <p className="hint">
                Removes previews and workspace data.{project.source.kind !== "path"
                  ? " The cloned repository will also be deleted."
                  : " Your local repository on disk is never touched."}
              </p>
            </div>
            <Button variant="danger" size="sm" icon={<Trash2 size={13} />} onClick={() => setDeleteOpen(true)}>
              Delete project
            </Button>
          </div>
        </section>
      </div>

      <aside className="settings-side">
        <ShareCard compact />
        <section className="card">
          <div className="card-head">
            <div>
              <h2 className="card-title">Workspace</h2>
              <p className="card-subtitle">This Vercio instance.</p>
            </div>
            <Share2 size={15} className="muted" />
          </div>
          <div className="card-body repo-details">
            <div className="detail-row">
              <span className="detail-label">Network</span>
              <span className="detail-value mono truncate">{systemInfo?.primaryUrl.replace(/^https?:\/\//, "")}</span>
            </div>
            <div className="detail-row">
              <span className="detail-label">Data</span>
              <span className="detail-value mono truncate" title={systemInfo?.dataDir}>
                {truncateMiddle(systemInfo?.dataDir || "", 30)}
              </span>
            </div>
            <div className="detail-row">
              <span className="detail-label">Version</span>
              <span className="detail-value mono">v{systemInfo?.version}</span>
            </div>
            <div className="detail-row">
              <span className="detail-label">Max live previews</span>
              <span className="detail-value">{systemInfo?.maxPreviews ?? "—"}</span>
            </div>
            {systemInfo && (
              <div className="settings-copy-row">
                <CopyButton
                  value={systemInfo.primaryUrl}
                  label="Copy workspace link"
                  className="btn btn-sm btn-secondary"
                />
              </div>
            )}
          </div>
        </section>
      </aside>

      <ConfirmDialog
        open={deleteOpen}
        title={"Delete " + project.name + "?"}
        description={
          <>
            This removes the project, its deployments, notes and comments from Vercio.
            {project.source.kind !== "path"
              ? " The cloned repository in the Vercio data folder will be deleted too."
              : " Your local repository is not touched."}
          </>
        }
        confirmLabel="Delete project"
        confirmationText={project.name}
        busy={deleting}
        onCancel={() => setDeleteOpen(false)}
        onConfirm={deleteProject}
      />
    </div>
  );
}
