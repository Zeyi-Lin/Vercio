import { Languages } from "lucide-react";
import { useI18n } from "../i18n";

export function LanguageSwitcher({ compact = false }: { compact?: boolean }) {
  const { language, setLanguage, t } = useI18n();
  return (
    <div
      className={"language-switch" + (compact ? " language-switch-compact" : "")}
      role="group"
      aria-label={t("common.switchLanguage")}
    >
      {!compact && <Languages size={12} className="language-icon" />}
      <button
        type="button"
        className={"language-option" + (language === "en" ? " active" : "")}
        onClick={() => setLanguage("en")}
      >
        EN
      </button>
      <button
        type="button"
        className={"language-option" + (language === "zh" ? " active" : "")}
        onClick={() => setLanguage("zh")}
      >
        中文
      </button>
    </div>
  );
}
