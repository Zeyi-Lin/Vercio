import { useEffect, useState } from "react";
import { UserRound } from "lucide-react";
import { useApp } from "../context/AppContext";
import { initials } from "../lib/format";
import { useToast } from "./Toast";
import { Button, Field, Modal, TextInput } from "./ui";

export function ProfileModal() {
  const { activeModal, closeModal, settings, saveSettings } = useApp();
  const open = activeModal === "profile";
  const [name, setName] = useState(settings.userName || "");
  const [busy, setBusy] = useState(false);
  const { pushToast } = useToast();

  useEffect(() => {
    if (open) setName(settings.userName || "");
  }, [open, settings.userName]);

  const save = async () => {
    setBusy(true);
    try {
      await saveSettings({ userName: name.trim() });
      closeModal();
    } catch (error) {
      pushToast(error instanceof Error ? error.message : "Could not update profile", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={closeModal}
      size="sm"
      title="Local profile"
      description="Your display name is used for comments and notes. It stays on this machine."
      footer={
        <>
          <Button onClick={closeModal} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} loading={busy}>
            Save profile
          </Button>
        </>
      }
    >
      <div className="profile-head">
        <span className="avatar avatar-lg">{initials(name || "Guest")}</span>
        <div>
          <div style={{ fontWeight: 550 }}>{name || "Guest"}</div>
          <div className="hint">Local collaborator</div>
        </div>
      </div>
      <Field label="Display name" hint="Shown on comments you post from this browser.">
        <TextInput
          value={name}
          onChange={(event) => setName(event.target.value.slice(0, 60))}
          placeholder="e.g. Maya Chen"
          onKeyDown={(event) => {
            if (event.key === "Enter") save();
          }}
          autoFocus
        />
      </Field>
      <div className="profile-note">
        <UserRound size={13} />
        <span>No account, no sign-in. Vercio runs entirely on your machine.</span>
      </div>
    </Modal>
  );
}
