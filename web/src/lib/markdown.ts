import DOMPurify from "dompurify";
import { marked } from "marked";

marked.setOptions({
  gfm: true,
  breaks: false,
});

export function renderMarkdown(source: string): string {
  if (!source) return "";
  const html = marked.parse(source, { async: false }) as string;
  return DOMPurify.sanitize(html, {
    ADD_ATTR: ["target", "rel"],
  });
}

export function plainText(source: string): string {
  return source
    .replace(/^#+\s+/gm, "")
    .replace(/[*_`>\[\]]/g, "")
    .replace(/\([^)]*\)/g, "")
    .trim();
}
