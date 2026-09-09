import assert from "node:assert/strict";
import test from "node:test";
import { renderSupportMarkdown } from "./support-markdown.ts";

test("renderSupportMarkdown turns fences, lists, and inline code into HTML", () => {
  const html = renderSupportMarkdown(
    [
      "```",
      "http://127.0.0.1:5173/ai",
      "```",
      "",
      "注意：",
      "- 末尾带 `/ai`，不要加 `:3000` 或 `:3100`",
      "  （那是 API 内部监听端口，外部访问不到）。",
      "- Anthropic 协议是 `POST /ai/v1/messages`",
    ].join("\n"),
  );

  assert.match(html, /<pre><code>http:\/\/127\.0\.0\.1:5173\/ai\n<\/code><\/pre>/);
  assert.match(html, /<p>注意：<\/p>/);
  assert.match(html, /<ul>/);
  assert.match(html, /<li>[\s\S]*<code>\/ai<\/code>[\s\S]*<code>:3000<\/code>/);
  assert.match(html, /<code>POST \/ai\/v1\/messages<\/code>/);
  assert.equal(html.includes("```"), false);
});

test("renderSupportMarkdown strips script tags and javascript URLs", () => {
  assert.equal(renderSupportMarkdown("<script>alert(1)</script>"), "");
  const link = renderSupportMarkdown("[x](javascript:alert(1))");
  assert.equal(link.includes("javascript:"), false);
  assert.match(link, /<a>x<\/a>/);
});

test("renderSupportMarkdown keeps in-app paths and opens http links in a new tab", () => {
  const internal = renderSupportMarkdown("[接入教程](/me/guide)");
  assert.match(internal, /<a href="\/me\/guide">接入教程<\/a>/);
  assert.equal(internal.includes('target="_blank"'), false);

  const external = renderSupportMarkdown("[健康检查](https://tokenhub.haizhi.com/health)");
  assert.match(external, /href="https:\/\/tokenhub\.haizhi\.com\/health"/);
  assert.match(external, /rel="noopener noreferrer"/);
  assert.match(external, /target="_blank"/);
});
