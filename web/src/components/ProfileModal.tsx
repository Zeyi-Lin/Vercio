import { useEffect, useState } from "react";
import { Moon, Sun, UserRound } from "lucide-react";
import { useTheme } from "../theme";
import { useApp } from "../context/AppContext";
import { useI18n } from "../i18n";
import { initials } from "../lib/format";
import { useToast } from "./Toast";
import { Button, Field, Modal, TextInput } from "./ui";
import { LanguageSwitcher } from "./LanguageSwitcher";

export function ProfileModal() {
  const { activeModal, closeModal, settings, saveSettings } = useApp();
  const { t } = useI18n();
  const { theme, setTheme } = useTheme();
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
      pushToast(error instanceof Error ? error.message : t("profile.error"), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={closeModal}
      size="sm"
      title={t("profile.title")}
      description={t("profile.description")}
      footer={
        <>
          <Button onClick={closeModal} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" onClick={save} loading={busy}>
            {t("profile.save")}
          </Button>
        </>
      }
    >
      <div className="profile-head">
        <span className="avatar avatar-lg">{initials(name || "Guest")}</span>
        <div>
          <div style={{ fontWeight: 550 }}>{name || "Guest"}</div>
          <div className="hint">{t("profile.localCollaborator")}</div>
        </div>
      </div>
      <Field label={t("profile.displayName")} hint={t("profile.displayNameHint")}>
        <TextInput
          value={name}
          onChange={(event) => setName(event.target.value.slice(0, 60))}
          placeholder={t("profile.displayNamePlaceholder")}
          onKeyDown={(event) => {
            if (event.key === "Enter") save();
          }}
          autoFocus
        />
      </Field>
      <div className="profile-language">
        <div>
          <div className="label">{t("profile.languageLabel")}</div>
          <div className="hint">{t("profile.languageHint")}</div>
        </div>
        <LanguageSwitcher compact />
      </div>
      <div className="profile-theme">
        <div>
          <div className="label">{t("theme.label")}</div>
          <div className="hint">{t("theme.hint")}</div>
        </div>
        <div className="segmented">
          <button
            type="button"
            className={"segmented-option" + (theme === "light" ? " active" : "")}
            onClick={() => setTheme("light")}
          >
            <Sun size={11} /> {t("theme.light")}
          </button>
          <button
            type="button"
            className={"segmented-option" + (theme === "dark" ? " active" : "")}
            onClick={() => setTheme("dark")}
          >
            <Moon size={11} /> {t("theme.dark")}
          </button>
        </div>
      </div>
      <div className="profile-note">
        <UserRound size={13} />
        <span>{t("profile.note")}</span>
      </div>
    </Modal>
  );
}
