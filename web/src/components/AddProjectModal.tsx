import { useEffect, useState } from "react";
import { FolderGit2, FolderOpen, Loader2, Sparkles } from "lucide-react";
import { GithubIcon } from "./icons";
import { api } from "../lib/api";
import { useApp } from "../context/AppContext";
import { useT } from "../i18n";
import { useRouter } from "../lib/router";
import { useToast } from "./Toast";
import { Button, Field, Modal, TextInput } from "./ui";
import { DirectoryPickerModal } from "./DirectoryPickerModal";

type Tab = "github" | "local";

export function AddProjectModal() {
  const { activeModal, closeModal, refresh } = useApp();
  const open = activeModal === "add-project";
  const { navigate } = useRouter();
  const { pushToast } = useToast();
  const t = useT();
  const [tab, setTab] = useState<Tab>("github");
  const [source, setSource] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<"import" | "demo" | null>(null);
  const [error, setError] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSource("");
    setName("");
    setError("");
    setBusy(null);
    setPickerOpen(false);
  }, [open]);

  const submit = async () => {
    if (!source.trim()) {
      setError(tab === "github" ? t("add.emptyGithub") : t("add.emptyLocal"));
      return;
    }
    setBusy("import");
    setError("");
    try {
      const { project } = await api.createProject(source.trim(), name.trim() || undefined);
      await refresh();
      closeModal();
      pushToast(
        project.status === "importing"
          ? t("add.importingToast", { name: project.name })
          : t("add.addedToast", { name: project.name }),
        "success"
      );
      navigate("/p/" + project.id);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : t("add.error"));
    } finally {
      setBusy(null);
    }
  };

  const loadDemo = async () => {
    setBusy("demo");
    setError("");
    try {
      const { project } = await api.createDemoProject();
      await refresh();
      closeModal();
      pushToast(t("add.demoReadyToast"), "success");
      navigate("/p/" + project.id + "/previews");
    } catch (demoError) {
      setError(demoError instanceof Error ? demoError.message : t("add.demoError"));
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <Modal
        open={open}
        onClose={closeModal}
        title={t("add.title")}
        description={t("add.description")}
        footer={
          <>
            <button
              className="btn btn-ghost btn-sm"
              style={{ marginRight: "auto" }}
              onClick={loadDemo}
              disabled={busy !== null}
            >
              {busy === "demo" ? <Loader2 size={13} className="spin" /> : <Sparkles size={13} />}
              {busy === "demo" ? t("add.preparingDemo") : t("add.loadDemo")}
            </button>
            <Button onClick={closeModal} disabled={busy !== null}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" onClick={submit} loading={busy === "import"}>
              {tab === "github" ? t("add.importRepository") : t("add.addProject")}
            </Button>
          </>
        }
      >
        <div className="modal-tabs" role="tablist">
          <button
            role="tab"
            aria-selected={tab === "github"}
            className={"modal-tab" + (tab === "github" ? " active" : "")}
            onClick={() => {
              setTab("github");
              setError("");
            }}
          >
            <GithubIcon size={13} /> {t("add.githubTab")}
          </button>
          <button
            role="tab"
            aria-selected={tab === "local"}
            className={"modal-tab" + (tab === "local" ? " active" : "")}
            onClick={() => {
              setTab("local");
              setError("");
            }}
          >
            <FolderGit2 size={14} /> {t("add.localTab")}
          </button>
        </div>

        <div className="add-project-body">
          {tab === "github" ? (
            <Field
              label={t("add.repoLabel")}
              hint={t("add.repoHint")}
            >
              <TextInput
                value={source}
                onChange={(event) => setSource(event.target.value)}
                placeholder={t("add.repoPlaceholder")}
                onKeyDown={(event) => {
                  if (event.key === "Enter") submit();
                }}
                autoFocus
              />
            </Field>
          ) : (
            <Field
              label={t("add.pathLabel")}
              hint={t("add.pathHint")}
            >
              <div className="input-row">
                <TextInput
                  value={source}
                  onChange={(event) => setSource(event.target.value)}
                  placeholder={t("add.pathPlaceholder")}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") submit();
                  }}
                  autoFocus
                />
                <Button
                  onClick={() => setPickerOpen(true)}
                  icon={<FolderOpen size={14} />}
                  disabled={busy !== null}
                >
                  {t("add.browse")}
                </Button>
              </div>
            </Field>
          )}

          <Field label={<>{t("add.nameLabel")} <span className="muted">({t("common.optional")})</span></>}>
            <TextInput
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t("add.namePlaceholder")}
            />
          </Field>

          {error && <div className="alert alert-error">{error}</div>}

          <div className="add-project-hint">
            <span className="add-project-dot" />
            {t("add.localNote")}
          </div>
        </div>
      </Modal>
      <DirectoryPickerModal
        open={pickerOpen}
        initialPath={source}
        onClose={() => setPickerOpen(false)}
        onSelect={(path) => {
          setSource(path);
          setError("");
        }}
      />
    </>
  );
}
