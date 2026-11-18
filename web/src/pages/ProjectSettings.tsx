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
import { useT } from "../i18n";
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
  const t = useT();
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
      pushToast(t("settings.saved"), "success");
    } catch (error) {
      pushToast(error instanceof Error ? error.message : t("settings.saveError"), "error");
    } finally {
      setSaving(false);
    }
  };

  const refreshRepo = async () => {
    setRefreshing(true);
    try {
      await api.refreshProject(project.id);
      onReload();
      pushToast(t("settings.refreshed"), "success");
    } catch (error) {
      pushToast(error instanceof Error ? error.message : t("settings.refreshError"), "error");
    } finally {
      setRefreshing(false);
    }
  };

  const saveProfile = async () => {
    setSavingProfile(true);
    try {
      await saveSettings({ userName: displayName.trim() });
    } catch (error) {
      pushToast(error instanceof Error ? error.message : t("profile.error"), "error");
    } finally {
      setSavingProfile(false);
    }
  };

  const deleteProject = async () => {
    setDeleting(true);
    try {
      await api.deleteProject(project.id, project.source.kind !== "path");
      setDeleteOpen(false);
      pushToast(t("settings.danger.deleted"), "success");
      onDeleted();
    } catch (error) {
      pushToast(error instanceof Error ? error.message : t("settings.deleteError"), "error");
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
              <h2 className="card-title">{t("settings.details.title")}</h2>
              <p className="card-subtitle">{t("settings.details.subtitle")}</p>
            </div>
          </div>
          <div className="card-body settings-form">
            <Field label={t("settings.name")}>
              <TextInput value={name} onChange={(event) => setName(event.target.value.slice(0, 80))} />
            </Field>
            <Field label={t("settings.tagline")} hint={t("settings.taglineHint")}>
              <TextInput
                value={tagline}
                onChange={(event) => setTagline(event.target.value.slice(0, 300))}
                placeholder={t("settings.taglinePlaceholder")}
              />
            </Field>
            <Field label={t("settings.links")} hint={t("settings.linksHint")}>
              <div className="link-editor">
                {links.map((link, index) => (
                  <div className="link-row" key={index}>
                    <TextInput
                      placeholder={t("settings.linkLabel")}
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
                      aria-label={t("settings.removeLink")}
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
                  {t("settings.addLink")}
                </Button>
              </div>
            </Field>
            <div className="settings-form-actions">
              <Button variant="primary" onClick={save} loading={saving}>
                {t("settings.save")}
              </Button>
            </div>
          </div>
        </section>

        <section className="card">
          <div className="card-head">
            <div>
              <h2 className="card-title">{t("settings.repo.title")}</h2>
              <p className="card-subtitle">{t("settings.repo.subtitle")}</p>
            </div>
            <Button
              size="sm"
              variant="ghost"
              icon={<RefreshCw size={12} className={refreshing ? "spin" : ""} />}
              onClick={refreshRepo}
              disabled={refreshing}
            >
              {t("settings.fetchLatest")}
            </Button>
          </div>
          <div className="card-body repo-details">
            <div className="detail-row">
              <span className="detail-label">{t("settings.source")}</span>
              <span className="detail-value">
                {project.source.url ? (
                  <a href={project.source.url} target="_blank" rel="noreferrer" className="detail-link">
                    <GithubIcon size={12} />
                    <span className="mono">{project.source.url.replace(/^https?:\/\//, "")}</span>
                  </a>
                ) : (
                  <span className="mono">{project.isDemo ? t("project.demoRepository") : projectSlug(project)}</span>
                )}
              </span>
            </div>
            <div className="detail-row">
              <span className="detail-label">{t("settings.localPath")}</span>
              <span className="detail-value mono" title={project.repoPath}>
                {truncateMiddle(project.repoPath, 52)}
              </span>
            </div>
            <div className="detail-row">
              <span className="detail-label">{t("settings.defaultBranch")}</span>
              <span className="detail-value mono"><GitBranch size={11} /> {project.defaultBranch}</span>
            </div>
            <div className="detail-row">
              <span className="detail-label">{t("settings.checkedOut")}</span>
              <span className="detail-value mono">{project.currentBranch || "—"}</span>
            </div>
            {project.dirtyCount > 0 && (
              <div className="dirty-note">
                <AlertCircle size={13} />
                {t("settings.dirtyNote", { count: project.dirtyCount })}
              </div>
            )}
            <p className="hint" style={{ marginTop: 4 }}>{t("settings.worktreeHint")}</p>
          </div>
        </section>

        <section className="card">
          <div className="card-head">
            <div>
              <h2 className="card-title">{t("settings.profile.title")}</h2>
              <p className="card-subtitle">{t("settings.profile.subtitle")}</p>
            </div>
          </div>
          <div className="card-body settings-form">
            <Field label={t("settings.profile.displayName")}>
              <div className="inline-field">
                <TextInput
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value.slice(0, 60))}
                  placeholder={t("settings.profile.placeholder")}
                />
                <Button onClick={saveProfile} loading={savingProfile}>
                  {t("common.save")}
                </Button>
              </div>
            </Field>
          </div>
        </section>

        <section className="card danger-zone">
          <div className="card-head">
            <div>
              <h2 className="card-title">
                <ShieldAlert size={15} /> {t("settings.danger.title")}
              </h2>
              <p className="card-subtitle">{t("settings.danger.subtitle")}</p>
            </div>
          </div>
          <div className="card-body danger-body">
            <div>
              <strong>{t("settings.danger.delete")}</strong>
              <p className="hint">
                {project.source.kind !== "path" ? t("settings.danger.hintClone") : t("settings.danger.hintLocal")}
              </p>
            </div>
            <Button variant="danger" size="sm" icon={<Trash2 size={13} />} onClick={() => setDeleteOpen(true)}>
              {t("settings.danger.delete")}
            </Button>
          </div>
        </section>
      </div>

      <aside className="settings-side">
        <ShareCard compact />
        <section className="card">
          <div className="card-head">
            <div>
              <h2 className="card-title">{t("settings.workspace.title")}</h2>
              <p className="card-subtitle">{t("settings.workspace.subtitle")}</p>
            </div>
            <Share2 size={15} className="muted" />
          </div>
          <div className="card-body repo-details">
            <div className="detail-row">
              <span className="detail-label">{t("settings.workspace.network")}</span>
              <span className="detail-value mono truncate">{systemInfo?.primaryUrl.replace(/^https?:\/\//, "")}</span>
            </div>
            <div className="detail-row">
              <span className="detail-label">{t("settings.workspace.data")}</span>
              <span className="detail-value mono truncate" title={systemInfo?.dataDir}>
                {truncateMiddle(systemInfo?.dataDir || "", 30)}
              </span>
            </div>
            <div className="detail-row">
              <span className="detail-label">{t("settings.workspace.version")}</span>
              <span className="detail-value mono">v{systemInfo?.version}</span>
            </div>
            <div className="detail-row">
              <span className="detail-label">{t("settings.workspace.maxPreviews")}</span>
              <span className="detail-value">{systemInfo?.maxPreviews ?? "—"}</span>
            </div>
            {systemInfo && (
              <div className="settings-copy-row">
                <CopyButton
                  value={systemInfo.primaryUrl}
                  label={t("settings.workspace.copyLink")}
                  className="btn btn-sm btn-secondary"
                />
              </div>
            )}
          </div>
        </section>
      </aside>

      <ConfirmDialog
        open={deleteOpen}
        title={t("settings.danger.confirmTitle", { name: project.name })}
        description={
          project.source.kind !== "path" ? t("settings.danger.confirmDescClone") : t("settings.danger.confirmDescLocal")
        }
        confirmLabel={t("settings.danger.delete")}
        confirmationText={project.name}
        busy={deleting}
        onCancel={() => setDeleteOpen(false)}
        onConfirm={deleteProject}
      />
    </div>
  );
}
