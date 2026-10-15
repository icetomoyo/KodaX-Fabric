/**
 * E2E-only fetch patch loaded into the server process.
 *
 * Official glm / deepseek / huoshan templates have no env override for base URL.
 * GLM coding_plan relay always uses the domestic gateway (resolveRelayUpstreamConfig).
 * Rewrite those hosts to the local mock so routing + binding + Authorization
 * headers still run, while the mock records which KEY arrived.
 */
const MOCK_ORIGIN = "http://127.0.0.1:3311";
const OFFICIAL_HOSTS = new Set([
  "open.bigmodel.cn",
  "api.z.ai",
  "api.deepseek.com",
  "ark.cn-beijing.volces.com",
]);

function rewriteIfOfficial(raw) {
  try {
    const url = new URL(raw);
    if (!OFFICIAL_HOSTS.has(url.hostname)) return null;
    url.protocol = "http:";
    url.host = "127.0.0.1:3311";
    return url;
  } catch {
    return null;
  }
}

const originalFetch = globalThis.fetch;
globalThis.fetch = function rewriteOfficialUpstreamFetch(input, init) {
  if (input instanceof Request) {
    const rewritten = rewriteIfOfficial(input.url);
    if (rewritten) input = new Request(rewritten, input);
  } else if (input instanceof URL) {
    const rewritten = rewriteIfOfficial(input.href);
    if (rewritten) input = rewritten;
  } else if (typeof input === "string") {
    const rewritten = rewriteIfOfficial(input);
    if (rewritten) input = rewritten;
  }
  return originalFetch(input, init);
};

console.log(`[e2e] fetch rewrite: official LLM hosts → ${MOCK_ORIGIN}`);
