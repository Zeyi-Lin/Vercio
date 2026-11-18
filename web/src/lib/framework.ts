import type { TranslationKey } from "../i18n/dictionary";

export interface FrameworkLike {
  label: string;
  kind?: string;
}

export function frameworkLabel(
  framework: FrameworkLike | null | undefined,
  t: (key: TranslationKey) => string
): string {
  if (!framework) return "";
  if (framework.kind === "static") return t("framework.static");
  if (framework.kind === "generic") return t("framework.custom");
  return framework.label;
}
