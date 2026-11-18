import { Moon, Sun } from "lucide-react";
import { useT } from "../i18n";
import { useTheme } from "../theme";

export function ThemeToggle({ className = "" }: { className?: string }) {
  const { theme, toggleTheme } = useTheme();
  const t = useT();
  const label = theme === "dark" ? t("theme.toLight") : t("theme.toDark");
  return (
    <button
      type="button"
      className={"icon-btn theme-toggle" + (className ? " " + className : "")}
      onClick={toggleTheme}
      title={label}
      aria-label={label}
    >
      {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
    </button>
  );
}
