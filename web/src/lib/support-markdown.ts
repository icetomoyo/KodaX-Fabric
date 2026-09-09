import { marked } from "marked";
import sanitizeHtml from "sanitize-html";

marked.use({
  async: false,
  gfm: true,
  breaks: true,
});

const sanitizeOptions: sanitizeHtml.IOptions = {
  allowedTags: [
    "p",
    "br",
    "ul",
    "ol",
    "li",
    "pre",
    "code",
    "blockquote",
    "strong",
    "em",
    "del",
    "a",
    "h1",
    "h2",
    "h3",
    "h4",
    "hr",
    "table",
    "thead",
    "tbody",
    "tr",
    "th",
    "td",
  ],
  allowedAttributes: {
    a: ["href", "rel", "target"],
    code: ["class"],
    th: ["align"],
    td: ["align"],
  },
  allowedSchemes: ["http", "https", "mailto"],
  allowProtocolRelative: false,
  transformTags: {
    a: (tagName, attribs) => {
      const href = attribs.href ?? "";
      const external = /^(https?:|mailto:)/i.test(href);
      const internal = href.startsWith("/") && !href.startsWith("//");
      if (!external && !internal) {
        const next = { ...attribs };
        delete next.href;
        return { tagName, attribs: next };
      }
      if (!external) return { tagName, attribs };
      return {
        tagName,
        attribs: {
          ...attribs,
          rel: "noopener noreferrer",
          target: "_blank",
        },
      };
    },
  },
};

export function renderSupportMarkdown(source: string): string {
  const parsed = marked.parse(source, { async: false });
  if (typeof parsed !== "string") {
    throw new Error("marked.parse returned a Promise");
  }
  return sanitizeHtml(parsed, sanitizeOptions);
}
