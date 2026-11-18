import { useEffect, useRef } from "react";
import { Terminal as TerminalIcon } from "lucide-react";
import { useT } from "../i18n";

export function TerminalLog({
  log,
  title,
  emptyText,
}: {
  log: string;
  title?: string;
  emptyText?: string;
}) {
  const t = useT();
  const ref = useRef<HTMLPreElement | null>(null);

  useEffect(() => {
    const element = ref.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [log]);

  const lineCount = log ? log.split("\n").filter(Boolean).length : 0;

  return (
    <div className="terminal">
      <div className="terminal-head">
        <span className="terminal-title">
          <TerminalIcon size={12} />
          {title || t("preview.logs.title")}
        </span>
        <span className="terminal-count">{t("preview.logs.lines", { count: lineCount })}</span>
      </div>
      <pre className="terminal-body" ref={ref}>
        {log || emptyText || t("preview.logs.waiting")}
      </pre>
    </div>
  );
}
