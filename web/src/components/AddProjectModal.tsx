import { useEffect, useState } from "react";
import { FolderGit2, Loader2, Sparkles } from "lucide-react";
import { GithubIcon } from "./icons";
import { api } from "../lib/api";
import { useApp } from "../context/AppContext";
import { useRouter } from "../lib/router";
import { useToast } from "./Toast";
import { Button, Field, Modal, TextInput } from "./ui";

type Tab = "github" | "local";

export function AddProjectModal() {
  const { activeModal, closeModal, refresh } = useApp();
  const open = activeModal === "add-project";
  const { navigate } = useRouter();
  const { pushToast } = useToast();
  const [tab, setTab] = useState<Tab>("github");
  const [source, setSource] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<"import" | "demo" | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setSource("");
    setName("");
    setError("");
    setBusy(null);
  }, [open]);

  const submit = async () => {
    if (!source.trim()) {
      setError(tab === "github" ? "Enter a GitHub repository" : "Enter a local repository path");
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
          ? "Importing " + project.name + " from GitHub"
          : "Added " + project.name,
        "success"
      );
      navigate("/p/" + project.id);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Could not add this project");
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
      pushToast("Demo project ready — try switching branches", "success");
      navigate("/p/" + project.id + "/previews");
    } catch (demoError) {
      setError(demoError instanceof Error ? demoError.message : "Could not load the demo project");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal
      open={open}
      onClose={closeModal}
      title="New project"
      description="Point Vercio at a repository. Every branch becomes a live preview."
      footer={
        <>
          <button
            className="btn btn-ghost btn-sm"
            style={{ marginRight: "auto" }}
            onClick={loadDemo}
            disabled={busy !== null}
          >
            {busy === "demo" ? <Loader2 size={13} className="spin" /> : <Sparkles size={13} />}
            {busy === "demo" ? "Preparing demo…" : "Load demo project"}
          </button>
          <Button onClick={closeModal} disabled={busy !== null}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} loading={busy === "import"}>
            {tab === "github" ? "Import repository" : "Add project"}
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
          <GithubIcon size={13} /> GitHub repository
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
          <FolderGit2 size={14} /> Local folder
        </button>
      </div>

      <div className="add-project-body">
        {tab === "github" ? (
          <Field
            label="Repository"
            hint={
              <>
                Paste a URL or <span className="mono">owner/repo</span>. Vercio clones with your local
                git credentials — private repositories work too.
              </>
            }
          >
            <TextInput
              value={source}
              onChange={(event) => setSource(event.target.value)}
              placeholder="acme/marketing-site or https://github.com/acme/site"
              onKeyDown={(event) => {
                if (event.key === "Enter") submit();
              }}
              autoFocus
            />
          </Field>
        ) : (
          <Field
            label="Repository path"
            hint="Any git repository on this machine. Vercio creates isolated worktrees — your working copy stays untouched."
          >
            <TextInput
              value={source}
              onChange={(event) => setSource(event.target.value)}
              placeholder="/Users/you/code/acme-site"
              onKeyDown={(event) => {
                if (event.key === "Enter") submit();
              }}
              autoFocus
            />
          </Field>
        )}

        <Field label={<>Project name <span className="muted">(optional)</span></>}>
          <TextInput
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Auto-detected from the repository"
          />
        </Field>

        {error && <div className="alert alert-error">{error}</div>}

        <div className="add-project-hint">
          <span className="add-project-dot" />
          Previews run locally. Nothing leaves your machine or network.
        </div>
      </div>
    </Modal>
  );
}
