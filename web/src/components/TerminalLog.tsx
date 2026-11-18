import { useEffect, useRef } from "react";
import { Terminal as TerminalIcon } from "lucide-react";

export function TerminalLog({
  log,
  title = "Preview logs",
  emptyText = "Waiting for logs…",
}: {
  log: string;
  title?: string;
  emptyText?: string;
}) {
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
          {title}
        </span>
        <span className="terminal-count">{lineCount} lines</span>
      </div>
      <pre className="terminal-body" ref={ref}>
        {log || emptyText}
      </pre>
    </div>
  );
}
