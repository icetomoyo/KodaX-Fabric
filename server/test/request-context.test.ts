import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { gunzipSync, gzipSync } from "node:zlib";
import type { RelayCandidate, RelayPrincipal } from "../src/lib/relay/types.js";

process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:5432/test";
process.env.REDIS_URL ??= "redis://127.0.0.1:6379/15";
process.env.JWT_SECRET ??= "unit-test-jwt-secret";
process.env.CREDENTIAL_ENCRYPT_KEY ??= "unit-test-credential-secret";

const {
  assertSafeRequestId,
  buildRequestContextRecord,
  contextBlobFilePath,
  DEFAULT_BLOB_MIN_BYTES,
  findRequestContextFile,
  publicCandidate,
  readRequestContextForDetail,
  readRequestContextRecord,
  redactHeaders,
  requestContextFilePath,
  sanitizeContextValue,
  serializeRequestContext,
  summarizeRequestContextForDetail,
  userRequestContextFilePath,
  writeRequestContextFile,
} = await import("../src/lib/relay/request-context.js");

const principal: RelayPrincipal = {
  employeeId: 7,
  employeeApiKeyId: 11,
  teamId: 4,
  protocol: "openai_chat",
  productLineId: 1,
  employeeName: "张闯",
  employeePhone: "13800000000",
  employeeDept: "平台",
};

const candidate: RelayCandidate = {
  routeId: 1,
  routePriority: 0,
  routeWeight: 100,
  clientModel: "glm-5.3",
  upstreamModel: "glm-5.3",
  providerCode: "glm",
  authStyle: "bearer",
  supportedProtocols: ["openai_chat"],
  upstreamProtocol: "openai_chat",
  productLineId: 1,
  productType: "coding_plan",
  retryPolicy: null,
  credentialId: 9,
  credentialSuffix: "Ab12",
  secretEncrypted: "should-never-appear",
  baseUrl: "https://open.bigmodel.cn/api/paas/v4",
  credentialPriority: 0,
  credentialWeight: 100,
};

test("request context path is day/requestId.json.gz", () => {
  assert.equal(
    requestContextFilePath("/var/lib/tokenhub/request-context", "2026-09-01", "threq_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
    "/var/lib/tokenhub/request-context/2026-09-01/threq_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.json.gz",
  );
  assert.equal(
    userRequestContextFilePath("/var/lib/tokenhub/request-context", 7, "2026-09-01", "threq_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
    "/var/lib/tokenhub/request-context/users/7/2026-09-01/threq_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.json.gz",
  );
  assert.throws(() => userRequestContextFilePath("/tmp", 0, "2026-09-01", "threq_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"));
});

test("unsafe request ids are rejected", () => {
  assert.throws(() => assertSafeRequestId("../etc/passwd"));
  assert.throws(() => requestContextFilePath("/tmp", "2026-09-01", "a/b"));
  assert.throws(() => requestContextFilePath("/tmp", "not-a-day", "threq_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"));
});

test("authorization headers are redacted", () => {
  assert.deepEqual(
    redactHeaders({
      authorization: "Bearer sk-live-secret",
      "x-api-key": "abc",
      "user-agent": "claude-code",
    }),
    {
      authorization: "[redacted]",
      "x-api-key": "[redacted]",
      "user-agent": "claude-code",
    },
  );
});

test("secrets in JSON bodies are redacted, messages stay", () => {
  const sanitized = sanitizeContextValue({
    model: "glm-5.3",
    api_key: "sk-secret",
    secretEncrypted: "cipher",
    messages: [{ role: "user", content: "重构登录" }],
  }) as Record<string, unknown>;
  assert.equal(sanitized.api_key, "[redacted]");
  assert.equal(sanitized.secretEncrypted, "[redacted]");
  assert.deepEqual(sanitized.messages, [{ role: "user", content: "重构登录" }]);
});

test("candidate snapshot never includes the encrypted secret", () => {
  const published = publicCandidate(candidate);
  assert.equal(published?.credentialSuffix, "Ab12");
  assert.equal(JSON.stringify(published).includes("should-never-appear"), false);
});

test("envelope keeps request messages and strips employee phone", () => {
  const record = buildRequestContextRecord({
    requestId: "threq_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    startedAt: new Date("2026-09-01T04:00:00.000Z"),
    endedAt: new Date("2026-09-01T04:00:01.500Z"),
    principal,
    clientModel: "glm-5.3",
    candidate,
    status: "success",
    httpStatus: 200,
    usage: {
      promptTokens: 10,
      completionTokens: 4,
      totalTokens: 14,
      cacheReadTokens: 0,
      raw: { prompt_tokens: 10 },
    },
    context: {
      path: "/v1/chat/completions",
      stream: false,
      headers: { authorization: "Bearer vk-secret", "user-agent": "cursor" },
      requestBody: { model: "glm-5.3", messages: [{ role: "user", content: "hello" }] },
      retryTrace: [
        {
          attempt: 1,
          providerCode: "glm",
          productLineId: 1,
          credentialId: 9,
          credentialSuffix: "Ab12",
          status: 200,
          latencyMs: 120,
          outcome: "success",
        },
      ],
      responseBody: { choices: [{ message: { content: "ok" } }] },
    },
  });
  assert.equal(record.latencyMs, 1500);
  assert.equal(record.headers.authorization, "[redacted]");
  assert.deepEqual(record.requestBody, {
    model: "glm-5.3",
    messages: [{ role: "user", content: "hello" }],
  });
  assert.equal("employeePhone" in record.principal, false);
  assert.equal(JSON.stringify(record).includes("should-never-appear"), false);
  assert.equal(JSON.stringify(record).includes("vk-secret"), false);
});

test("oversized envelopes drop bodies instead of overflowing the cap", () => {
  const record = buildRequestContextRecord({
    requestId: "threq_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    startedAt: new Date("2026-09-01T04:00:00.000Z"),
    principal,
    clientModel: "glm-5.3",
    status: "success",
    context: {
      path: "/v1/chat/completions",
      stream: false,
      headers: {},
      requestBody: { blob: "x".repeat(5000) },
      retryTrace: [],
      responseBody: { blob: "y".repeat(5000) },
    },
  });
  const { json, truncated } = serializeRequestContext(record, 2_000);
  assert.equal(truncated, true);
  const parsed = JSON.parse(json) as { truncated: boolean; requestBody: { omitted?: string } };
  assert.equal(parsed.truncated, true);
  assert.ok(parsed.requestBody.omitted);
  assert.ok(Buffer.byteLength(json) <= 2_000);
});

test("writeRequestContextFile gzip-roundtrips under the quota day", async () => {
  const root = await mkdtemp(join(tmpdir(), "th-context-"));
  const record = buildRequestContextRecord({
    requestId: "threq_cccccccccccccccccccccccccccccccc",
    startedAt: new Date("2026-09-01T04:00:00.000Z"),
    principal,
    clientModel: "glm-5.3",
    candidate,
    status: "success",
    context: {
      path: "/v1/messages",
      stream: true,
      headers: { "anthropic-version": "2023-06-01" },
      requestBody: { model: "glm-5.3", messages: [{ role: "user", content: "hi" }] },
      retryTrace: [],
      streamAudit: {
        truncated: false,
        eventCount: 3,
        assembled: { protocol: "anthropic_messages", message: { content: [{ type: "text", text: "hi" }] } },
      },
    },
  });
  const path = await writeRequestContextFile({
    rootDir: root,
    timeZone: "Asia/Shanghai",
    maxBytes: 1_000_000,
    blobMinBytes: DEFAULT_BLOB_MIN_BYTES,
    record,
  });
  assert.equal(path, join(root, "users", "7", "2026-09-01", "threq_cccccccccccccccccccccccccccccccc.json.gz"));
  const unzipped = gunzipSync(await readFile(path)).toString("utf8");
  const parsed = JSON.parse(unzipped) as { requestBody: { messages: unknown[] }; streamAudit: { eventCount: number } };
  assert.equal(parsed.streamAudit.eventCount, 3);
  assert.equal(parsed.requestBody.messages.length, 1);
  const viaHelper = await readRequestContextRecord(path) as { requestBody: { messages: unknown[] } };
  assert.equal(viaHelper.requestBody.messages.length, 1);
});

test("detail summary keeps small envelopes and strips oversized bodies", () => {
  const small = { requestId: "threq_small", requestBody: { hello: "world" }, retryTrace: [] };
  const kept = summarizeRequestContextForDetail(small, 1_000);
  assert.equal(kept.omittedBodies, false);
  assert.equal(kept.context, small);

  const huge = {
    requestId: "threq_huge",
    requestBody: { blob: "x".repeat(4000) },
    responseBody: { blob: "y".repeat(4000) },
    streamAudit: { eventCount: 2, assembled: { blob: "z".repeat(4000) } },
    retryTrace: [{ attempt: 1 }],
  };
  const summarized = summarizeRequestContextForDetail(huge, 1_000);
  assert.equal(summarized.omittedBodies, true);
  const context = summarized.context as {
    requestBody: { omitted?: string };
    responseBody: { omitted?: string };
    streamAudit: { assembled: { omitted?: string }; eventCount: number };
    retryTrace: unknown[];
  };
  assert.ok(context.requestBody.omitted);
  assert.ok(context.responseBody.omitted);
  assert.ok(context.streamAudit.assembled.omitted);
  assert.equal(context.streamAudit.eventCount, 2);
  assert.equal(context.retryTrace.length, 1);
});

test("findRequestContextFile locates the gzip by quota day", async () => {
  const root = await mkdtemp(join(tmpdir(), "th-context-find-"));
  const startedAt = new Date("2026-09-01T04:00:00.000Z");
  const record = buildRequestContextRecord({
    requestId: "threq_dddddddddddddddddddddddddddddddd",
    startedAt,
    principal,
    clientModel: "glm-5.3",
    status: "success",
    context: {
      path: "/v1/chat/completions",
      stream: false,
      headers: {},
      requestBody: { model: "glm-5.3" },
      retryTrace: [],
      responseBody: { ok: true },
    },
  });
  const written = await writeRequestContextFile({
    rootDir: root,
    timeZone: "Asia/Shanghai",
    maxBytes: 1_000_000,
    blobMinBytes: DEFAULT_BLOB_MIN_BYTES,
    record,
  });
  assert.equal(
    await findRequestContextFile(root, "Asia/Shanghai", record.requestId, startedAt, 7),
    written,
  );
  // 新布局必须带 employeeId 才能定位；不带时只搜旧日目录布局
  assert.equal(
    await findRequestContextFile(root, "Asia/Shanghai", record.requestId, startedAt),
    null,
  );
  assert.equal(
    await findRequestContextFile(
      root,
      "Asia/Shanghai",
      "threq_eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      startedAt,
      7,
    ),
    null,
  );
});

// ---------------------------------------------------------------------------
// contextFormat 2: content-addressed dedup + hydration
// ---------------------------------------------------------------------------

function makeRecord(requestId: string, requestBody: unknown, responseBody?: unknown) {
  return buildRequestContextRecord({
    requestId,
    startedAt: new Date("2026-09-01T04:00:00.000Z"),
    endedAt: new Date("2026-09-01T04:00:02.000Z"),
    principal,
    clientModel: "glm-5.3",
    candidate,
    status: "success",
    httpStatus: 200,
    context: {
      path: "/ai/v1/messages",
      stream: true,
      headers: { authorization: "Bearer vk-secret" },
      requestBody,
      retryTrace: [],
      responseBody: responseBody ?? { ok: true },
    },
  });
}

async function countStoreFiles(root: string): Promise<{ blocks: number; files: number }> {
  const count = async (store: string) => {
    try {
      const entries = await readdir(join(root, store), { recursive: true, withFileTypes: true });
      return entries.filter((e) => e.isFile() && !e.name.endsWith(".tmp")).length;
    } catch {
      return 0;
    }
  };
  return { blocks: await count("blocks"), files: await count("files") };
}

const bigToolResult = (pad: string) => ({
  type: "tool_result",
  tool_use_id: "call_big",
  content: `命令输出：${pad}`,
});
const SHARED = bigToolResult("x".repeat(4096));

test("repeated heavy content is stored once and referenced by both envelopes", async () => {
  const root = await mkdtemp(join(tmpdir(), "th-context-dedup-"));
  const body = {
    model: "glm-5.3",
    system: [{ type: "text", text: "系统提示词".repeat(600) }],
    tools: [{ name: "Bash", description: "y".repeat(2000) }],
    messages: [
      { role: "user", content: [SHARED, { type: "text", text: "短问题" }] },
      { role: "assistant", content: [{ type: "text", text: "短回答" }] },
    ],
  };
  const recordA = makeRecord("threq_dedupaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", body);
  const recordB = makeRecord("threq_dedupbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", body);

  const pathA = await writeRequestContextFile({ rootDir: root, timeZone: "Asia/Shanghai", maxBytes: 10_000_000, blobMinBytes: DEFAULT_BLOB_MIN_BYTES, record: recordA });
  const pathB = await writeRequestContextFile({ rootDir: root, timeZone: "Asia/Shanghai", maxBytes: 10_000_000, blobMinBytes: DEFAULT_BLOB_MIN_BYTES, record: recordB });

  const counts = await countStoreFiles(root);
  assert.equal(counts.blocks, 3, "system + tools + shared tool_result, each exactly once");
  assert.equal(counts.files, 0);

  const envelopeA = JSON.parse(gunzipSync(await readFile(pathA)).toString("utf8")) as {
    contextFormat: number;
    requestBody: { system: { blob: string }; tools: { blob: string }; messages: Array<{ role: string; content: unknown[] }> };
  };
  assert.equal(envelopeA.contextFormat, 2);
  assert.match(envelopeA.requestBody.system.blob, /^[a-f0-9]{64}$/);
  const refTool = envelopeA.requestBody.messages[0].content[0] as { blob: string; kind: string; bytes: number };
  assert.equal(refTool.kind, "block");
  assert.ok(refTool.bytes > 1024);
  // 短内容内联
  assert.deepEqual(envelopeA.requestBody.messages[1].content, [{ type: "text", text: "短回答" }]);

  const envelopeB = JSON.parse(gunzipSync(await readFile(pathB)).toString("utf8")) as typeof envelopeA;
  assert.equal(
    (envelopeB.requestBody.messages[0].content[0] as { blob: string }).blob,
    refTool.blob,
    "same content → same hash in both envelopes",
  );

  // 拼回与拆前语义相等
  const hydratedA = (await readRequestContextRecord(pathA)) as Record<string, unknown>;
  delete hydratedA.contextFormat;
  assert.deepEqual(hydratedA.requestBody, recordA.requestBody);
  const hydratedB = (await readRequestContextRecord(pathB)) as Record<string, unknown>;
  delete hydratedB.contextFormat;
  assert.deepEqual(hydratedB, recordB);
});

test("small requests never touch the content stores", async () => {
  const root = await mkdtemp(join(tmpdir(), "th-context-small-"));
  const record = makeRecord("threq_small1111111111111111111111111111", {
    model: "glm-5.3",
    messages: [{ role: "user", content: "hi" }],
  });
  const path = await writeRequestContextFile({ rootDir: root, timeZone: "Asia/Shanghai", maxBytes: 1_000_000, blobMinBytes: DEFAULT_BLOB_MIN_BYTES, record });
  const counts = await countStoreFiles(root);
  assert.equal(counts.blocks + counts.files, 0);
  const hydrated = await readRequestContextRecord(path);
  assert.deepEqual((hydrated as { requestBody: unknown }).requestBody, record.requestBody);
});

test("blob threshold boundary: inline below 1024 serialized bytes, ref at/above", async () => {
  const root = await mkdtemp(join(tmpdir(), "th-context-boundary-"));
  // 阈值按序列化后的 JSON 字节数算：字符串值 = 字符数 + 2 个引号
  const cases = [
    { chars: 1021, serialized: 1023, inline: true },
    { chars: 1022, serialized: 1024, inline: false },
    { chars: 1025, serialized: 1027, inline: false },
  ];
  for (const { chars, serialized, inline } of cases) {
    const record = makeRecord(`threq_bnd${chars}aaaaaaaaaaaaaaaaaaaaaaaaaaaa`, {
      model: "glm-5.3",
      system: "s".repeat(chars),
    });
    const path = await writeRequestContextFile({ rootDir: root, timeZone: "Asia/Shanghai", maxBytes: 1_000_000, blobMinBytes: 1024, record });
    const envelope = JSON.parse(gunzipSync(await readFile(path)).toString("utf8")) as { requestBody: { system: unknown } };
    if (inline) {
      assert.equal(envelope.requestBody.system, "s".repeat(chars), `${serialized}B stays inline`);
    } else {
      const ref = envelope.requestBody.system as { blob: string; bytes: number };
      assert.equal(typeof ref.blob, "string", `${serialized}B becomes a ref`);
      assert.equal(ref.bytes, serialized);
    }
    const hydrated = await readRequestContextRecord(path);
    assert.deepEqual((hydrated as { requestBody: unknown }).requestBody, record.requestBody);
  }
});

test("base64 document blocks are stored decoded and rebuild identically", async () => {
  const root = await mkdtemp(join(tmpdir(), "th-context-file-"));
  const pdfBytes = Buffer.from("%PDF-1.7 mock pdf payload ".repeat(100), "utf8");
  const documentBlock = {
    type: "document",
    source: { type: "base64", media_type: "application/pdf", data: pdfBytes.toString("base64") },
  };
  const imageBlock = {
    type: "image",
    source: { type: "base64", media_type: "image/png", data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]).toString("base64") + "i".repeat(2000) },
  };
  const record = makeRecord("threq_fileaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", {
    model: "glm-5.3",
    messages: [{ role: "user", content: [documentBlock, imageBlock] }],
  });
  const path = await writeRequestContextFile({ rootDir: root, timeZone: "Asia/Shanghai", maxBytes: 10_000_000, blobMinBytes: DEFAULT_BLOB_MIN_BYTES, record });

  const counts = await countStoreFiles(root);
  assert.equal(counts.files, 2);
  assert.equal(counts.blocks, 0);

  const envelope = JSON.parse(gunzipSync(await readFile(path)).toString("utf8")) as {
    requestBody: { messages: Array<{ content: Array<{ blob: string; kind: string; media_type?: string }> }> };
  };
  const [pdfRef, imgRef] = envelope.requestBody.messages[0].content;
  assert.equal(pdfRef.kind, "file");
  assert.equal(pdfRef.media_type, "application/pdf");
  assert.equal(pdfRef.bytes, pdfBytes.length, "bytes = decoded length");
  assert.equal(imgRef.media_type, "image/png");
  // 原始二进制在货架上
  const stored = await readFile(contextBlobFilePath(root, "file", pdfRef.blob));
  assert.equal(stored.compare(pdfBytes), 0);

  const hydrated = (await readRequestContextRecord(path)) as { requestBody: { messages: Array<{ content: unknown[] }> } };
  assert.deepEqual(hydrated.requestBody.messages[0].content[0], documentBlock);
  assert.deepEqual(hydrated.requestBody.messages[0].content[1], imageBlock);
});

test("secrets are redacted before fingerprinting, blobs hold no plaintext keys", async () => {
  const root = await mkdtemp(join(tmpdir(), "th-context-secret-"));
  const record = makeRecord("threq_secretaaaaaaaaaaaaaaaaaaaaaaaaaaaa", {
    model: "glm-5.3",
    system: "长系统提示词".repeat(400),
    nested: { api_key: "sk-live-plaintext-secret", keep: "v".repeat(1200) },
  });
  const path = await writeRequestContextFile({ rootDir: root, timeZone: "Asia/Shanghai", maxBytes: 10_000_000, blobMinBytes: DEFAULT_BLOB_MIN_BYTES, record });
  const counts = await countStoreFiles(root);
  assert.ok(counts.blocks >= 1);
  const blocksDir = join(root, "blocks");
  const entries = await readdir(blocksDir, { recursive: true, withFileTypes: true });
  let blobText = "";
  for (const entry of entries.filter((e) => e.isFile())) {
    blobText += gunzipSync(await readFile(join(entry.parentPath, entry.name))).toString("utf8");
  }
  assert.equal(blobText.includes("sk-live-plaintext-secret"), false, "blobs must not leak plaintext keys");
  assert.ok(blobText.includes("[redacted]"));
  const envelope = gunzipSync(await readFile(path)).toString("utf8");
  assert.equal(envelope.includes("sk-live-plaintext-secret"), false);
  assert.equal(envelope.includes("vk-secret"), false);
});

test("blob write failure falls back to inline content", async () => {
  const root = await mkdtemp(join(tmpdir(), "th-context-fallback-"));
  // 把 blocks 货架占成一个普通文件，mkdir 必然失败 → 降级内联
  await writeFile(join(root, "blocks"), "not a directory");
  const record = makeRecord("threq_fallbackaaaaaaaaaaaaaaaaaaaaaaaaaa", {
    model: "glm-5.3",
    system: "z".repeat(5000),
  });
  const path = await writeRequestContextFile({ rootDir: root, timeZone: "Asia/Shanghai", maxBytes: 10_000_000, blobMinBytes: DEFAULT_BLOB_MIN_BYTES, record });
  const envelope = JSON.parse(gunzipSync(await readFile(path)).toString("utf8")) as { contextFormat: number; requestBody: { system: unknown } };
  assert.equal(envelope.requestBody.system, "z".repeat(5000), "failed blob stays inline");
  const hydrated = await readRequestContextRecord(path);
  assert.deepEqual((hydrated as { requestBody: unknown }).requestBody, record.requestBody);
});

test("concurrent writes of the same content keep one blob and both envelopes", async () => {
  const root = await mkdtemp(join(tmpdir(), "th-context-concurrent-"));
  const body = { model: "glm-5.3", system: "c".repeat(6000) };
  const first = makeRecord("threq_conc11111111111111111111111111111", body);
  const second = makeRecord("threq_conc22222222222222222222222222222", body);
  const [p1, p2] = await Promise.all([
    writeRequestContextFile({ rootDir: root, timeZone: "Asia/Shanghai", maxBytes: 1_000_000, blobMinBytes: 1024, record: first }),
    writeRequestContextFile({ rootDir: root, timeZone: "Asia/Shanghai", maxBytes: 1_000_000, blobMinBytes: 1024, record: second }),
  ]);
  const counts = await countStoreFiles(root);
  assert.equal(counts.blocks, 1);
  assert.equal((await countStoreFiles(root)).blocks, 1);
  await readRequestContextRecord(p1);
  await readRequestContextRecord(p2);
});

test("legacy day-layout files are still found and read as-is", async () => {
  const root = await mkdtemp(join(tmpdir(), "th-context-legacy-"));
  const record = makeRecord("threq_legacyaaaaaaaaaaaaaaaaaaaaaaaaaaaa", {
    model: "glm-5.3",
    messages: [{ role: "user", content: "old world" }],
  });
  const legacyPath = requestContextFilePath(root, "2026-09-01", record.requestId);
  await mkdir(join(root, "2026-09-01"), { recursive: true });
  await writeFile(legacyPath, gzipSync(Buffer.from(JSON.stringify(record))));
  const found = await findRequestContextFile(root, "Asia/Shanghai", record.requestId, new Date("2026-09-01T04:00:00.000Z"), 7);
  assert.equal(found, legacyPath);
  const parsed = (await readRequestContextRecord(legacyPath)) as Record<string, unknown>;
  assert.equal("contextFormat" in parsed, false);
  assert.deepEqual(parsed.requestBody, record.requestBody);
});

test("a missing blob fails hydration with a clear error, detail falls back to the envelope", async () => {
  const root = await mkdtemp(join(tmpdir(), "th-context-missing-"));
  const record = makeRecord("threq_missingaaaaaaaaaaaaaaaaaaaaaaaaaa", {
    model: "glm-5.3",
    system: "m".repeat(3000),
  });
  const path = await writeRequestContextFile({ rootDir: root, timeZone: "Asia/Shanghai", maxBytes: 1_000_000, blobMinBytes: 1024, record });
  const envelope = JSON.parse(gunzipSync(await readFile(path)).toString("utf8")) as { requestBody: { system: { blob: string } } };
  const blobPath = contextBlobFilePath(root, "block", envelope.requestBody.system.blob);
  await unlink(blobPath);

  await assert.rejects(readRequestContextRecord(path), /blob missing/);
  const detail = await readRequestContextForDetail(path);
  assert.equal(detail.omittedBodies, true);
  const context = detail.context as { requestBody: { system: { blob: string; bytes: number } } };
  assert.equal(context.requestBody.system.blob, envelope.requestBody.system.blob);
});

test("detail read hydrates small envelopes and omits oversized reconstructions", async () => {
  const root = await mkdtemp(join(tmpdir(), "th-context-detail-"));
  const small = makeRecord("threq_detail11111111111111111111111111", {
    model: "glm-5.3",
    messages: [{ role: "user", content: "hi" }],
  });
  const smallPath = await writeRequestContextFile({ rootDir: root, timeZone: "Asia/Shanghai", maxBytes: 1_000_000, blobMinBytes: 1024, record: small });
  const smallDetail = await readRequestContextForDetail(smallPath);
  assert.equal(smallDetail.omittedBodies, false);
  assert.deepEqual((smallDetail.context as { requestBody: unknown }).requestBody, small.requestBody);

  const big = makeRecord("threq_detail22222222222222222222222222", {
    model: "glm-5.3",
    system: "b".repeat(300 * 1024),
  });
  const bigPath = await writeRequestContextFile({ rootDir: root, timeZone: "Asia/Shanghai", maxBytes: 10_000_000, blobMinBytes: 1024, record: big });
  const bigDetail = await readRequestContextForDetail(bigPath);
  assert.equal(bigDetail.omittedBodies, true);
  const ref = (bigDetail.context as { requestBody: { system: { blob: string; bytes: number } } }).requestBody.system;
  assert.match(ref.blob, /^[a-f0-9]{64}$/);
  assert.ok(ref.bytes > 300 * 1024);
});
