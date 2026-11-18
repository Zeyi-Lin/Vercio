import { memo, useMemo } from "react";
import { renderMarkdown } from "../lib/markdown";

export const Markdown = memo(function Markdown({
  source,
  className = "",
}: {
  source: string;
  className?: string;
}) {
  const html = useMemo(() => renderMarkdown(source), [source]);
  return <div className={"prose " + className} dangerouslySetInnerHTML={{ __html: html }} />;
});
