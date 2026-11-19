import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { api } from "../lib/api";
import { useT } from "../i18n";
import type { Project } from "../lib/types";
import { useToast } from "./Toast";
import { Button, ConfirmDialog, Field, Modal, TextInput } from "./ui";

export function ProjectSettingsModal({
  project,
  open,
  onClose,
}: {
  project: Project;
  open: boolean;
  onClose: () => void;
}) {
  const t = useT();
  const { pushToast } = useToast();
  const [name, setName] = useState(project.name);
  const [tagline, setTagline] = useState(project.tagline);
  const [saving, setSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(project.name);
    setTagline(project.tagline);
  }, [open, project.name, project.tagline]);

  const save = async () => {
    setSaving(true);
    try {
      await api.updateProject(project.id, {
        name: name.trim() || project.name,
        tagline: tagline.slice(0, 300),
      });
      pushToast(t("settings.saved"), "success");
      onClose();
    } catch (error) {
      pushToast(error instanceof Error ? error.message : t("settings.saveError"), "error");
    } finally {
      setSaving(false);
    }
  };

  const deleteProject = async () => {
    setDeleting(true);
    try {
      await api.deleteProject(project.id, project.source.kind !== "path");
      setDeleteOpen(false);
      onClose();
      // Full reload keeps the workspace shell from pointing at a deleted project.
      window.location.assign("/");
    } catch (error) {
      pushToast(error instanceof Error ? error.message : t("settings.deleteError"), "error");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        size="sm"
        title={t("settings.details.title")}
        description={t("settings.details.subtitle")}
        footer={
          <>
            <Button onClick={onClose} disabled={saving}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" onClick={save} loading={saving}>
              {t("settings.save")}
            </Button>
          </>
        }
      >
        <div className="settings-form">
          <Field label={t("settings.name")}>
            <TextInput
              value={name}
              onChange={(event) => setName(event.target.value.slice(0, 80))}
              autoFocus
            />
          </Field>
          <Field label={t("settings.tagline")} hint={t("settings.taglineHint")}>
            <TextInput
              value={tagline}
              onChange={(event) => setTagline(event.target.value.slice(0, 300))}
              placeholder={t("settings.taglinePlaceholder")}
            />
          </Field>
          <div className="settings-modal-danger">
            <div>
              <strong>{t("settings.danger.delete")}</strong>
              <p className="hint">
                {project.source.kind !== "path"
                  ? t("settings.danger.hintClone")
                  : t("settings.danger.hintLocal")}
              </p>
            </div>
            <Button
              variant="danger"
              size="sm"
              icon={<Trash2 size={13} />}
              onClick={() => setDeleteOpen(true)}
            >
              {t("settings.danger.delete")}
            </Button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={deleteOpen}
        title={t("settings.danger.confirmTitle", { name: project.name })}
        description={
          project.source.kind !== "path"
            ? t("settings.danger.confirmDescClone")
            : t("settings.danger.confirmDescLocal")
        }
        confirmLabel={t("settings.danger.delete")}
        confirmationText={project.name}
        busy={deleting}
        onCancel={() => setDeleteOpen(false)}
        onConfirm={deleteProject}
      />
    </>
  );
}
