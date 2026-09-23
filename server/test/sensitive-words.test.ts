import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import Fastify from "fastify";

process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:5432/test";
process.env.REDIS_URL ??= "redis://127.0.0.1:6379/15";
process.env.JWT_SECRET ??= "unit-test-jwt-secret";
process.env.CREDENTIAL_ENCRYPT_KEY ??= "unit-test-credential-secret";

import { createRequire } from "node:module";

const {
  buildSensitiveWordMatcher,
  compileSensitiveWords,
  excerptForSensitiveHit,
  extractUserScanTexts,
  findSensitiveWord,
  findSensitiveWordInRequest,
  parseSensitiveWordsConfig,
  patchSensitiveWordFlags,
  resolveSensitiveWordFlags,
  sortSensitiveWordRows,
  uniqueWords,
  validateSensitiveRegex,
  zhipuSensitiveContentError,
} = await import("../src/lib/relay/sensitive-words.js");
const {
  extractWordsFromText,
  parseSensitiveWordFile,
} = await import("../src/lib/relay/sensitive-word-import.js");
const { adminSensitiveWordRoutes } = await import("../src/routes/admin/sensitive-words.js");
const { adminSettingsRoutes } = await import("../src/routes/admin/settings.js");
const require = createRequire(import.meta.url);
const ExcelJS = require("exceljs");

test("findSensitiveWord matches 英雄联盟 after space and zero-width evasion", () => {
  const words = ["英雄联盟"];
  assert.equal(findSensitiveWord("今晚一起打英雄联盟", words), "英雄联盟");
  assert.equal(findSensitiveWord("英 雄 联 盟", words), "英雄联盟");
  assert.equal(findSensitiveWord("英\u200b雄联盟", words), "英雄联盟");
  assert.equal(findSensitiveWord("英雄联盟！！", words), "英雄联盟");
  assert.equal(findSensitiveWord("今天天气不错", words), null);
});

test("findSensitiveWord is case-insensitive for latin words", () => {
  assert.equal(findSensitiveWord("Watch LOL tonight", ["lol"]), "lol");
  assert.equal(findSensitiveWord("watch lol tonight", ["LOL"]), "LOL");
});

test("adjacent message parts do not glue into a false match", () => {
  const body = {
    model: "glm-5.3",
    messages: [
      { role: "user", content: "英雄" },
      { role: "assistant", content: "联盟" },
    ],
  };
  assert.equal(findSensitiveWordInRequest(body, ["英雄联盟"]), null);
});

test("compileSensitiveWords normalizes once, dedupes, and drops invalid entries", () => {
  assert.deepEqual(
    compileSensitiveWords([" 英雄联盟 ", "英雄联盟", "LOL", "", "x".repeat(80), 42]),
    [
      { word: "英雄联盟", needle: "英雄联盟" },
      { word: "LOL", needle: "lol" },
    ],
  );
});

test("matcher returns the earliest hit and honors normalization", () => {
  const matcher = buildSensitiveWordMatcher(["英雄联盟", "外挂"]);
  assert.equal(matcher.match("卖外挂的打英雄联盟"), "外挂");
  assert.equal(matcher.match("英 雄 联 盟"), "英雄联盟");
  assert.equal(matcher.match("Watch LOL tonight"), null);
  assert.equal(buildSensitiveWordMatcher(["LOL"]).match("Watch LOL tonight"), "LOL");
  assert.equal(matcher.match("今天天气不错"), null);
  assert.equal(matcher.match(""), null);
});

test("oversized strings keep head and tail in the scan window", () => {
  const filler = "x".repeat(120_000);
  const headBody = { messages: [{ role: "user", content: `英雄联盟${filler}` }] };
  const tailBody = { messages: [{ role: "user", content: `${filler}英雄联盟` }] };
  assert.equal(findSensitiveWordInRequest(headBody, ["英雄联盟"]), "英雄联盟");
  assert.equal(findSensitiveWordInRequest(tailBody, ["英雄联盟"]), "英雄联盟");
});

test("middle of an oversized string is outside the scan window by design", () => {
  const filler = "x".repeat(60_000);
  const body = { messages: [{ role: "user", content: `${filler}英雄联盟${filler}` }] };
  assert.equal(findSensitiveWordInRequest(body, ["英雄联盟"]), null);
});

test("requests beyond the total scan budget keep head and tail windows only", () => {
  const unit = "y".repeat(10_000);
  const blocksWithWordAt = (index: number) => {
    const blocks = Array.from({ length: 40 }, () => unit);
    blocks[index] = `英雄联盟${blocks[index]}`;
    return { messages: [{ role: "user", content: blocks }] };
  };
  const plain = { messages: [{ role: "user", content: Array.from({ length: 40 }, () => unit) }] };
  const bounded = extractUserScanTexts(plain).join("\n");
  assert.ok(bounded.length > 0 && bounded.length <= 257_000);
  assert.equal(findSensitiveWordInRequest(blocksWithWordAt(0), ["英雄联盟"]), "英雄联盟");
  assert.equal(findSensitiveWordInRequest(blocksWithWordAt(39), ["英雄联盟"]), "英雄联盟");
  assert.equal(findSensitiveWordInRequest(blocksWithWordAt(20), ["英雄联盟"]), null);
});

test("user scan texts cover three protocols and exclude non-user content", () => {
  const chat = extractUserScanTexts({
    model: "glm-5.3",
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "我们去玩英雄联盟" },
          { type: "image_url", image_url: { url: "data:image/png;base64,aaaa" } },
        ],
      },
    ],
  });
  // 只取 text 字段：base64 图片数据不进扫描
  assert.deepEqual(chat, ["我们去玩英雄联盟"]);

  const responses = extractUserScanTexts({
    model: "glm-5.3",
    input: [{ role: "user", content: [{ type: "input_text", text: "英雄联盟" }] }],
  });
  assert.deepEqual(responses, ["英雄联盟"]);

  // 口径决策（2026-09-22）：只扫 role=user，system 模板与 assistant 历史不扫
  const anthropic = extractUserScanTexts({
    model: "glm-5.3",
    system: "你是助手",
    messages: [
      { role: "user", content: [{ type: "text", text: "今晚开黑英雄联盟" }] },
      { role: "assistant", content: [{ type: "text", text: "英雄联盟真好玩" }] },
    ],
  });
  assert.deepEqual(anthropic, ["今晚开黑英雄联盟"]);
});

test("segments are scanned independently and never glue across blocks", () => {
  const body = {
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "英雄" },
          { type: "text", text: "联盟" },
        ],
      },
    ],
  };
  const texts = extractUserScanTexts(body);
  assert.deepEqual(texts, ["英雄", "联盟"]);
  assert.equal(findSensitiveWordInRequest(body, ["英雄联盟"]), null);
});

test("single-message space evasion still matches after segmented extraction", () => {
  const body = { messages: [{ role: "user", content: "英 雄 联 盟" }] };
  assert.equal(findSensitiveWordInRequest(body, ["英雄联盟"]), "英雄联盟");
});

test("extractWordsFromText reads one word per line and strips markdown markers", () => {
  assert.deepEqual(
    extractWordsFromText("# 词库\n- 英雄联盟\n1. lol\n\n`原神`\n"),
    ["英雄联盟", "lol", "原神"],
  );
});

test("parseSensitiveWordFile reads txt and xlsx, rejects legacy xls", async () => {
  const txt = await parseSensitiveWordFile("words.md", Buffer.from("- 英雄联盟\nlol\n", "utf8"));
  assert.deepEqual(txt, ["英雄联盟", "lol"]);
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("words");
  sheet.addRow(["敏感词"]);
  sheet.addRow(["英雄联盟"]);
  sheet.addRow(["lol"]);
  const xlsx = await parseSensitiveWordFile(
    "words.xlsx",
    Buffer.from(await workbook.xlsx.writeBuffer()),
  );
  assert.deepEqual(xlsx, ["英雄联盟", "lol"]);
  await assert.rejects(
    () => parseSensitiveWordFile("words.xls", Buffer.from("legacy")),
    /请使用 \.xlsx 格式的表格/,
  );
});

test("sortSensitiveWordRows orders by hit count then word", () => {
  const rows = [
    { word: "zeta", hitCount: 1 },
    { word: "alpha", hitCount: 3 },
    { word: "beta", hitCount: 3 },
  ];
  assert.deepEqual(
    sortSensitiveWordRows(rows, "hitCount", "desc").map((row) => row.word),
    ["alpha", "beta", "zeta"],
  );
  assert.deepEqual(
    sortSensitiveWordRows(rows, "word", "asc").map((row) => row.word),
    ["alpha", "beta", "zeta"],
  );
});

test("parseSensitiveWordsConfig defaults to detect-on intercept-off", () => {
  assert.deepEqual(parseSensitiveWordsConfig(null), {
    detectEnabled: true,
    interceptEnabled: false,
    words: [],
    regexWords: [],
  });
  assert.deepEqual(parseSensitiveWordsConfig({ enabled: false, words: [" 英雄联盟 ", "英雄联盟"] }), {
    detectEnabled: false,
    interceptEnabled: false,
    words: ["英雄联盟"],
    regexWords: [],
  });
  assert.deepEqual(
    parseSensitiveWordsConfig({ detectEnabled: true, interceptEnabled: true, words: ["lol"] }),
    { detectEnabled: true, interceptEnabled: true, words: ["lol"], regexWords: [] },
  );
  assert.deepEqual(
    parseSensitiveWordsConfig({ detectEnabled: false, interceptEnabled: true, words: ["lol"] }),
    { detectEnabled: true, interceptEnabled: true, words: ["lol"], regexWords: [] },
  );
  assert.deepEqual(uniqueWords(["lol", "LOL", "  ", "x".repeat(80)]), ["lol"]);
  assert.deepEqual(
    parseSensitiveWordsConfig({ regexWords: [" 英[-.·]?雄 ", "英[-.·]?雄", "x".repeat(200)] }),
    { detectEnabled: true, interceptEnabled: false, words: [], regexWords: ["英[-.·]?雄"] },
  );
});

test("regex word type catches punctuation-evasion that normalization misses", () => {
  const matcher = buildSensitiveWordMatcher(["英雄联盟"], ["英[-—.·]?雄"]);
  assert.equal(matcher.match("今晚开黑英-雄联盟"), "英[-—.·]?雄");
  assert.equal(matcher.match("今晚开黑英·雄联盟"), "英[-—.·]?雄");
  assert.equal(matcher.match("英 雄联盟"), "英雄联盟"); // 空格插空由归一化命中，包含词优先
  assert.equal(matcher.match("今天天气不错"), null);
  assert.equal(matcher.regexPatterns.length, 1);
});

test("regex word validation rejects empty, oversized, and invalid patterns", () => {
  assert.throws(() => validateSensitiveRegex("  "), /正则敏感词不能为空/);
  assert.throws(() => validateSensitiveRegex("x".repeat(129)), /不能超过 128 个字符/);
  assert.throws(() => validateSensitiveRegex("英雄([("), /正则表达式无效/);
  const pattern = validateSensitiveRegex("英[-.·]?雄");
  assert.equal(pattern.flags.includes("i"), true);
});

test("matcher skips invalid regex words at load instead of throwing", () => {
  const matcher = buildSensitiveWordMatcher([], ["英雄([(", "外[-—]?挂"]);
  assert.equal(matcher.regexPatterns.length, 1);
  assert.equal(matcher.match("挖个外-挂"), "外[-—]?挂");
});

test("intercept requires detect; turning detect off clears intercept", () => {
  assert.deepEqual(resolveSensitiveWordFlags({ detectEnabled: false, interceptEnabled: true }), {
    detectEnabled: true,
    interceptEnabled: true,
  });
  assert.deepEqual(resolveSensitiveWordFlags({ detectEnabled: true, interceptEnabled: false }), {
    detectEnabled: true,
    interceptEnabled: false,
  });
  const current = { detectEnabled: true, interceptEnabled: true };
  assert.deepEqual(patchSensitiveWordFlags(current, { detectEnabled: false }), {
    detectEnabled: false,
    interceptEnabled: false,
  });
  assert.deepEqual(
    patchSensitiveWordFlags(
      { detectEnabled: false, interceptEnabled: false },
      { interceptEnabled: true },
    ),
    { detectEnabled: true, interceptEnabled: true },
  );
  assert.deepEqual(patchSensitiveWordFlags(current, { interceptEnabled: false }), {
    detectEnabled: true,
    interceptEnabled: false,
  });
});

test("employee-facing block is disguised as Zhipu 1301 and does not name the word", () => {
  const blocked = zhipuSensitiveContentError();
  assert.equal(blocked.code, "1301");
  assert.equal(blocked.httpStatus, 400);
  assert.equal(
    blocked.message,
    "系统检测到输入或生成内容可能包含不安全或敏感内容，请您避免输入易产生敏感内容的提示语，感谢您的配合",
  );
  assert.doesNotMatch(blocked.message, /英雄联盟/);
  assert.doesNotMatch(blocked.message, /敏感词/);
});

test("excerptForSensitiveHit keeps the matched region", () => {
  const body = {
    messages: [{ role: "user", content: `${"前".repeat(3000)}今晚打英雄联盟${"后".repeat(3000)}` }],
  };
  const excerpt = excerptForSensitiveHit(body, "英雄联盟");
  assert.match(excerpt, /英雄联盟/);
  assert.ok(excerpt.length <= 4000);
  assert.match(excerpt, /^…/);
  assert.match(excerpt, /…$/);
});

test("employee relay scans for sensitive words before acquiring quota", () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const lib = readFileSync(resolve(root, "src/lib/relay/sensitive-words.ts"), "utf8");
  const chat = readFileSync(resolve(root, "src/routes/relay/chat-completions.ts"), "utf8");
  const anthropic = readFileSync(resolve(root, "src/routes/relay/anthropic-messages.ts"), "utf8");
  assert.match(
    lib,
    /if \(!config\.detectEnabled \|\| \(matcher\.needles\.length === 0 && matcher\.regexPatterns\.length === 0\)\)/,
  );
  assert.match(lib, /record: true/);
  assert.match(lib, /intercept: config\.interceptEnabled/);
  assert.match(chat, /evaluateSensitiveRequest/);
  assert.match(chat, /sensitiveHit\.intercept/);
  assert.match(chat, /zhipuSensitiveContentError/);
  assert.match(chat, /recordSensitiveWordHit/);
  assert.match(chat, /action: sensitiveHit.intercept \? "intercept" : "detect"/);
  assert.match(chat, /evaluateSensitiveRequest[\s\S]*acquireRelayQuota/);
  assert.doesNotMatch(chat, /sensitive_content/);
  assert.match(anthropic, /evaluateSensitiveRequest/);
  assert.match(anthropic, /sensitiveHit\.intercept/);
  assert.match(anthropic, /zhipuSensitiveContentError/);
  assert.match(anthropic, /recordSensitiveWordHit/);
  assert.match(anthropic, /action: sensitiveHit.intercept \? "intercept" : "detect"/);
  assert.match(anthropic, /evaluateSensitiveRequest[\s\S]*acquireRelayQuota/);
  assert.doesNotMatch(anthropic, /sensitive_content/);
});

test("super-admin 敏感词检测 submenu is wired into the console", () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const layout = readFileSync(resolve(root, "web/src/layouts/AdminLayout.vue"), "utf8");
  const router = readFileSync(resolve(root, "web/src/router/index.ts"), "utf8");
  const words = readFileSync(resolve(root, "web/src/views/admin/SensitiveWordsView.vue"), "utf8");
  const hits = readFileSync(resolve(root, "web/src/views/admin/SensitiveHitsView.vue"), "utf8");
  const settings = readFileSync(resolve(root, "web/src/views/admin/SettingsView.vue"), "utf8");
  const app = readFileSync(resolve(root, "server/src/app.ts"), "utf8");
  assert.match(layout, />敏感词检测</);
  assert.match(
    layout,
    /index="\/admin\/logs">调用日志[\s\S]*index="\/admin\/error-logs">报错日志[\s\S]*敏感词检测[\s\S]*index="\/admin\/sensitive-words">敏感词管理[\s\S]*index="\/admin\/sensitive-detect-records">敏感词检测记录[\s\S]*index="\/admin\/sensitive-intercept-records">敏感词拦截记录[\s\S]*index="\/admin\/ops-audit">操作审计[\s\S]*index="\/admin\/settings">系统设置/,
  );
  assert.match(router, /name: "admin-sensitive-words"[\s\S]*roles: \["admin"\]/);
  assert.match(router, /name: "admin-sensitive-detect-records"[\s\S]*sensitiveHitAction: "detect"/);
  assert.match(router, /name: "admin-sensitive-intercept-records"[\s\S]*sensitiveHitAction: "intercept"/);
  assert.match(router, /name: "admin-settings"[\s\S]*roles: \["admin"\]/);
  assert.match(words, /\/api\/admin\/sensitive-words/);
  assert.doesNotMatch(words, /启用拦截/);
  assert.match(settings, /敏感词检测/);
  assert.match(settings, /启用检测/);
  assert.match(settings, /敏感词拦截/);
  assert.match(settings, /启用拦截/);
  assert.match(settings, /!settingsLoaded \|\| loading \|\| patching \|\| !sensitiveWordDetectEnabled/);
  assert.match(settings, /\/api\/admin\/settings/);
  assert.doesNotMatch(settings, /class="page-title"/);
  assert.match(words, /导入文档/);
  assert.match(words, /命中次数/);
  assert.match(words, /TABLE_PAGE_SIZE/);
  assert.match(words, /\/api\/admin\/sensitive-words\/import/);
  assert.match(words, /http\.delete\("\/api\/admin\/sensitive-words", \{\s*data: \{ word, matchType \},\s*\}\)/);
  assert.doesNotMatch(words, /class="page-title"/);
  assert.match(hits, /\/api\/admin\/sensitive-word-hits/);
  assert.match(hits, /命中词/);
  assert.match(hits, /action: hitAction.value/);
  assert.doesNotMatch(hits, /class="page-title"/);
  assert.match(app, /adminSensitiveWordRoutes/);
  assert.match(app, /adminSettingsRoutes/);
});

test("unauthenticated sensitive-word admin calls return 401", async () => {
  const app = Fastify();
  await app.register(adminSensitiveWordRoutes);
  await app.register(adminSettingsRoutes);
  await app.ready();
  try {
    const list = await app.inject({ method: "GET", url: "/api/admin/sensitive-words" });
    const add = await app.inject({
      method: "POST",
      url: "/api/admin/sensitive-words",
      payload: { word: "英雄联盟" },
    });
    const hits = await app.inject({ method: "GET", url: "/api/admin/sensitive-word-hits" });
    const imported = await app.inject({
      method: "POST",
      url: "/api/admin/sensitive-words/import",
      payload: { filename: "words.txt", contentBase64: Buffer.from("lol\n").toString("base64") },
    });
    const settings = await app.inject({ method: "GET", url: "/api/admin/settings" });
    assert.equal(list.statusCode, 401);
    assert.equal(add.statusCode, 401);
    assert.equal(hits.statusCode, 401);
    assert.equal(imported.statusCode, 401);
    assert.equal(settings.statusCode, 401);
  } finally {
    await app.close();
  }
});
