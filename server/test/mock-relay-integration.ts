/**
 * Explicit M2 relay integration test.
 *
 * This test starts the real Fastify application and a local node:http upstream,
 * uses the configured local PostgreSQL and Redis instances, and never contacts
 * an external service. Every database row is unique to this run and is removed
 * in foreign-key dependency order in the final cleanup.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { and, eq, inArray } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

// Make retry and cooldown behavior deterministic before config.ts is loaded.
process.env.RELAY_MAX_ATTEMPTS = "3";
process.env.RELAY_COOLDOWN_SECONDS = "30";
process.env.RELAY_UPSTREAM_TIMEOUT_MS = "10000";

const [
  { buildApp },
  { db, sql },
  schema,
  { encryptEmployeeApiKey, generateApiKey },
  { encryptSecret, secretSuffix },
  { redis },
  { getDefaultEnterpriseId },
] = await Promise.all([
  import("../src/app.js"),
  import("../src/db/client.js"),
  import("../src/db/schema/index.js"),
  import("../src/lib/api-key.js"),
  import("../src/lib/crypto-secret.js"),
  import("../src/redis.js"),
  import("../src/lib/enterprise.js"),
]);

const {
  credentialEmployeeGrants,
  employeeApiKeys,
  employees,
  modelRoutes,
  productLines,
  providers,
  requestAuditBodies,
  requestAudits,
  upstreamCredentials,
  usageCountersDaily,
} = schema;

type MockResponseKind = "401" | "400" | "429" | "500" | "json" | "sse";

type MockUsage = {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
};

type MockPlan = {
  name: string;
  response: MockResponseKind;
  expectedModel: string;
  expectedStream: boolean;
  usage: MockUsage | null;
  calls: number;
};

type ScenarioName = "auth" | "bad-request" | "rate-limit" | "stream";

type ScenarioDefinition = {
  name: ScenarioName;
  firstResponse: Exclude<MockResponseKind, "json" | "sse">;
  secondResponse: "json" | "sse";
  stream: boolean;
  usage: MockUsage;
};

type ScenarioFixture = ScenarioDefinition & {
  employeeApiKeyRaw: string;
  clientModel: string;
  upstreamModel: string;
  providerId: number;
  productLineId: number;
  routeId: number;
  firstCredentialId: number;
  secondCredentialId: number;
  firstPlan: MockPlan;
  secondPlan: MockPlan;
  clientRequestHeader: string;
};

type RelayCallResult = {
  status: number;
  contentType: string;
  body: string;
  requestId: string;
};

type PersistedAudit = {
  requestId: string;
  credentialId: number | null;
  isStream: boolean;
  status: "success" | "upstream_error" | "client_error" | "cancelled";
  httpStatus: number | null;
  upstreamStatus: number | null;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  usageSource: "upstream" | "estimated" | "none" | null;
  retryCount: number;
  retryTrace: unknown;
  requestHeaders: unknown;
  responseBody: unknown;
};

const runToken = randomUUID().replaceAll("-", "");
const marker = `m2mock_${runToken.slice(0, 16)}`;
const employeePhone = `m2${runToken.slice(0, 16)}`;
const scenarios: ScenarioDefinition[] = [
  {
    name: "auth",
    firstResponse: "401",
    secondResponse: "json",
    stream: false,
    usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 },
  },
  {
    name: "bad-request",
    firstResponse: "400",
    secondResponse: "json",
    stream: false,
    usage: { prompt_tokens: 5, completion_tokens: 6, total_tokens: 11 },
  },
  {
    name: "rate-limit",
    firstResponse: "429",
    secondResponse: "json",
    stream: false,
    usage: { prompt_tokens: 5, completion_tokens: 8, total_tokens: 13 },
  },
  {
    name: "stream",
    firstResponse: "500",
    secondResponse: "sse",
    stream: true,
    usage: { prompt_tokens: 7, completion_tokens: 10, total_tokens: 17 },
  },
];

const created = {
  employeeId: null as number | null,
  employeeApiKeyIds: [] as number[],
  providerIds: [] as number[],
  productLineIds: [] as number[],
  credentialIds: [] as number[],
  grantIds: [] as number[],
  routeIds: [] as number[],
};
const trackedRequestIds = new Set<string>();
const trackedRedisKeys = new Set<string>();
const sensitiveValues: string[] = [];
const plansByAuthorization = new Map<string, MockPlan>();
const mockHandlerFailures: string[] = [];
const fixtures = new Map<ScenarioName, ScenarioFixture>();

let tokenHubApp: FastifyInstance | null = null;
let upstreamServer: Server | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function localAddress(server: Server): string {
  const address = server.address();
  assert(address && typeof address !== "string", "local mock server has no TCP address");
  return `http://127.0.0.1:${(address as AddressInfo).port}`;
}

async function listenLocal(server: Server): Promise<string> {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return localAddress(server);
}

async function closeLocalServer(server: Server | null): Promise<void> {
  if (!server?.listening) return;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
    server.closeIdleConnections();
  });
}

async function closeTokenHubApp(): Promise<void> {
  if (tokenHubApp) await tokenHubApp.close();
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const raw = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(raw),
  });
  res.end(raw);
}

async function readMockRequest(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.byteLength;
    if (bytes > 1024 * 1024) throw new Error("mock request exceeded one MiB");
    chunks.push(buffer);
  }
  const parsed = JSON.parse(Buffer.concat(chunks, bytes).toString("utf8")) as unknown;
  if (!isRecord(parsed)) throw new Error("mock request body is not an object");
  return parsed;
}

async function sendSse(res: ServerResponse, plan: MockPlan): Promise<void> {
  const id = `mock_${plan.name}`;
  const chunks = [
    `data: ${JSON.stringify({
      id,
      object: "chat.completion.chunk",
      created: 0,
      model: plan.expectedModel,
      choices: [
        { index: 0, delta: { role: "assistant", content: "mock " }, finish_reason: null },
      ],
    })}\n\n`,
    `data: ${JSON.stringify({
      id,
      object: "chat.completion.chunk",
      created: 0,
      model: plan.expectedModel,
      choices: [
        { index: 0, delta: { content: "stream ok" }, finish_reason: "stop" },
      ],
    })}\n\n`,
    `data: ${JSON.stringify({
      id,
      object: "chat.completion.chunk",
      created: 0,
      model: plan.expectedModel,
      choices: [],
      usage: plan.usage,
    })}\n\n`,
    "data: [DONE]\n\n",
  ];

  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache",
  });
  for (const chunk of chunks) {
    res.write(chunk);
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  res.end();
}

async function handleMockUpstream(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (req.method !== "POST" || req.url !== "/v1/chat/completions") {
    mockHandlerFailures.push("unexpected mock upstream path");
    sendJson(res, 404, { error: { message: "not found" } });
    return;
  }

  const authorization = Array.isArray(req.headers.authorization)
    ? req.headers.authorization[0]
    : req.headers.authorization;
  const plan = authorization ? plansByAuthorization.get(authorization) : undefined;
  if (!plan) {
    mockHandlerFailures.push("unknown or absent upstream authorization");
    sendJson(res, 401, { error: { message: "unknown credential" } });
    return;
  }

  plan.calls += 1;
  const body = await readMockRequest(req);
  if (body.model !== plan.expectedModel || body.stream !== plan.expectedStream) {
    mockHandlerFailures.push(`unexpected request payload for ${plan.name}`);
    sendJson(res, 500, { error: { message: "unexpected mock payload" } });
    return;
  }

  switch (plan.response) {
    case "401":
      sendJson(res, 401, {
        error: { message: "mock authentication failure", type: "authentication_error" },
      });
      return;
    case "400":
      sendJson(res, 400, {
        error: {
          message: "mock bad request",
          type: "invalid_request_error",
          code: "mock_bad_request",
        },
      });
      return;
    case "429":
      sendJson(res, 429, {
        error: { message: "mock rate limit", type: "rate_limit_error" },
      });
      return;
    case "500":
      // End immediately after the 500 headers. The relay must switch candidates
      // before committing any SSE bytes to its downstream response.
      res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
      res.end();
      return;
    case "sse":
      await sendSse(res, plan);
      return;
    case "json":
      sendJson(res, 200, {
        id: `mock_${plan.name}`,
        object: "chat.completion",
        created: 0,
        model: plan.expectedModel,
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: `mock ${plan.name} ok` },
            finish_reason: "stop",
          },
        ],
        usage: plan.usage,
      });
  }
}

function createMockServer(): Server {
  return createServer((req, res) => {
    void handleMockUpstream(req, res).catch(() => {
      mockHandlerFailures.push("mock upstream handler failed");
      if (!res.headersSent) {
        sendJson(res, 500, { error: { message: "mock handler failed" } });
      } else if (!res.writableEnded) {
        res.end();
      }
    });
  });
}

async function insertFixtures(upstreamBaseUrl: string): Promise<void> {
  const enterpriseId = await getDefaultEnterpriseId();
  const [employee] = await db
    .insert(employees)
    .values({
      name: `M2 Mock Employee ${marker}`,
      phone: employeePhone,
      passwordHash: "mock-relay-integration-password-not-used",
      dept: marker,
      role: "employee",
      status: "active",
      enterpriseId,
      mustChangePassword: false,
    })
    .returning({ id: employees.id });
  created.employeeId = employee.id;

  for (const definition of scenarios) {
    const scenarioMarker = `${marker}_${definition.name.replaceAll("-", "_")}`;
    const clientModel = `client-${scenarioMarker}`;
    const upstreamModel = `upstream-${scenarioMarker}`;
    const [provider] = await db
      .insert(providers)
      .values({
        code: `provider_${scenarioMarker}`,
        name: `M2 Mock Provider ${scenarioMarker}`,
        defaultBaseUrl: `${upstreamBaseUrl}/v1`,
        authStyle: "bearer",
        openaiCompatLevel: "full",
        status: "active",
      })
      .returning({ id: providers.id });
    created.providerIds.push(provider.id);

    const [productLine] = await db
      .insert(productLines)
      .values({
        providerId: provider.id,
        code: `line_${scenarioMarker}`,
        name: `M2 Mock Line ${scenarioMarker}`,
        productType: "api",
        shareMode: "grant_only",
        allowAutoRoute: false,
        status: "active",
      })
      .returning({ id: productLines.id });
    created.productLineIds.push(productLine.id);

    const generatedKey = generateApiKey();
    sensitiveValues.push(generatedKey.raw);
    const [apiKey] = await db
      .insert(employeeApiKeys)
      .values({
        employeeId: employee.id,
        name: `M2 Mock Key ${scenarioMarker}`,
        keyPrefix: generatedKey.prefix,
        keyHash: generatedKey.hash,
        keyEncrypted: encryptEmployeeApiKey(generatedKey.raw),
        protocol: "openai_chat",
        productLineId: productLine.id,
        expiresAt: new Date(Date.now() + 15 * 60_000),
      })
      .returning({ id: employeeApiKeys.id });
    created.employeeApiKeyIds.push(apiKey.id);

    const firstSecret = `mock_upstream_${randomUUID().replaceAll("-", "")}`;
    const secondSecret = `mock_upstream_${randomUUID().replaceAll("-", "")}`;
    sensitiveValues.push(firstSecret, secondSecret);
    const [firstCredential, secondCredential] = await db
      .insert(upstreamCredentials)
      .values([
        {
          productLineId: productLine.id,
          label: `M2 Mock First ${scenarioMarker}`,
          secretEncrypted: encryptSecret(firstSecret),
          secretSuffix: secretSuffix(firstSecret),
          supportedProtocols: ["openai_chat"],
          priority: 200,
          weight: 100,
          status: "active" as const,
        },
        {
          productLineId: productLine.id,
          label: `M2 Mock Second ${scenarioMarker}`,
          secretEncrypted: encryptSecret(secondSecret),
          secretSuffix: secretSuffix(secondSecret),
          supportedProtocols: ["openai_chat"],
          priority: 100,
          weight: 100,
          status: "active" as const,
        },
      ])
      .returning({ id: upstreamCredentials.id });
    created.credentialIds.push(firstCredential.id, secondCredential.id);

    const grants = await db
      .insert(credentialEmployeeGrants)
      .values([
        { credentialId: firstCredential.id, employeeId: employee.id },
        { credentialId: secondCredential.id, employeeId: employee.id },
      ])
      .returning({ id: credentialEmployeeGrants.id });
    created.grantIds.push(...grants.map((grant) => grant.id));

    const [route] = await db
      .insert(modelRoutes)
      .values({
        clientModel,
        productLineId: productLine.id,
        upstreamModel,
        enabled: true,
        priority: 100,
        weight: 100,
      })
      .returning({ id: modelRoutes.id });
    created.routeIds.push(route.id);

    const firstPlan: MockPlan = {
      name: `${definition.name}-first`,
      response: definition.firstResponse,
      expectedModel: upstreamModel,
      expectedStream: definition.stream,
      usage: null,
      calls: 0,
    };
    const secondPlan: MockPlan = {
      name: `${definition.name}-second`,
      response: definition.secondResponse,
      expectedModel: upstreamModel,
      expectedStream: definition.stream,
      usage: definition.usage,
      calls: 0,
    };
    plansByAuthorization.set(`Bearer ${firstSecret}`, firstPlan);
    plansByAuthorization.set(`Bearer ${secondSecret}`, secondPlan);

    fixtures.set(definition.name, {
      ...definition,
      employeeApiKeyRaw: generatedKey.raw,
      clientModel,
      upstreamModel,
      providerId: provider.id,
      productLineId: productLine.id,
      routeId: route.id,
      firstCredentialId: firstCredential.id,
      secondCredentialId: secondCredential.id,
      firstPlan,
      secondPlan,
      clientRequestHeader: `m2-mock-${marker}-${definition.name}`,
    });
  }
}

function requireFixture(name: ScenarioName): ScenarioFixture {
  const fixture = fixtures.get(name);
  assert(fixture, `missing ${name} fixture`);
  return fixture;
}

function rememberRedisKeys(employeeId: number): void {
  const minute = Math.floor(Date.now() / 60_000);
  trackedRedisKeys.add(`tokenhub:relay:rpm:${employeeId}:${minute}`);
  trackedRedisKeys.add(`tokenhub:relay:concurrency:v2:${employeeId}`);
}

async function callRelay(baseUrl: string, fixture: ScenarioFixture): Promise<RelayCallResult> {
  assert(created.employeeId !== null, "employee fixture is missing");
  rememberRedisKeys(created.employeeId);
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/ai/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${fixture.employeeApiKeyRaw}`,
        "Content-Type": "application/json",
        "User-Agent": "TokenHub-M2-mock-integration",
        "X-Request-ID": fixture.clientRequestHeader,
      },
      body: JSON.stringify({
        model: fixture.clientModel,
        messages: [{ role: "user", content: "Reply with mock output." }],
        stream: fixture.stream,
      }),
    });
  } finally {
    rememberRedisKeys(created.employeeId);
  }

  const body = await response.text();
  const requestId = response.headers.get("x-tokenhub-request-id");
  assert(requestId, "relay response omitted x-tokenhub-request-id");
  trackedRequestIds.add(requestId);
  return {
    status: response.status,
    contentType: response.headers.get("content-type") ?? "",
    body,
    requestId,
  };
}

async function selectPersistedAudit(requestId: string): Promise<PersistedAudit | null> {
  const [row] = await db
    .select({
      requestId: requestAudits.requestId,
      credentialId: requestAudits.credentialId,
      isStream: requestAudits.isStream,
      status: requestAudits.status,
      httpStatus: requestAudits.httpStatus,
      upstreamStatus: requestAudits.upstreamStatus,
      promptTokens: requestAudits.promptTokens,
      completionTokens: requestAudits.completionTokens,
      totalTokens: requestAudits.totalTokens,
      usageSource: requestAudits.usageSource,
      retryCount: requestAudits.retryCount,
      retryTrace: requestAudits.retryTrace,
      requestHeaders: requestAuditBodies.requestHeaders,
      responseBody: requestAuditBodies.responseBody,
    })
    .from(requestAudits)
    .innerJoin(requestAuditBodies, eq(requestAuditBodies.requestId, requestAudits.requestId))
    .where(eq(requestAudits.requestId, requestId))
    .limit(1);
  return row ?? null;
}

async function waitForAudit(requestId: string): Promise<PersistedAudit> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const row = await selectPersistedAudit(requestId);
    if (row) return row;
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("relay audit was not persisted before timeout");
}

async function waitForTrackedAuditsForCleanup(): Promise<void> {
  if (trackedRequestIds.size === 0) return;
  const expected = new Set(trackedRequestIds);
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const rows = await db
      .select({ requestId: requestAudits.requestId })
      .from(requestAudits)
      .where(inArray(requestAudits.requestId, [...expected]));
    if (rows.length === expected.size) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("tracked relay audits were not persisted before cleanup timeout");
}

function assertAuditHeaders(audit: PersistedAudit, fixture: ScenarioFixture): void {
  assert(isRecord(audit.requestHeaders), "audit request headers are missing");
  const serialized = JSON.stringify(audit.requestHeaders);
  assert.equal(
    serialized.toLowerCase().includes("authorization"),
    false,
    "audit request headers retained Authorization",
  );
  assert.equal(
    audit.requestHeaders["x-request-id"],
    fixture.clientRequestHeader,
    "audit omitted the allowlisted client request header",
  );
  for (const sensitive of sensitiveValues) {
    assert.equal(serialized.includes(sensitive), false, "audit headers retained secret material");
  }
}

function assertRetryTrace(audit: PersistedAudit, expectedStatuses: number[]): void {
  assert(Array.isArray(audit.retryTrace), "audit retryTrace is not an array");
  assert.equal(audit.retryTrace.length, expectedStatuses.length);
  assert.deepEqual(
    audit.retryTrace.map((item) => (isRecord(item) ? item.status : undefined)),
    expectedStatuses,
  );
}

async function assertCredentialHealth(): Promise<void> {
  const auth = requireFixture("auth");
  const rateLimit = requireFixture("rate-limit");
  const stream = requireFixture("stream");
  const ids = [
    auth.firstCredentialId,
    auth.secondCredentialId,
    rateLimit.firstCredentialId,
    rateLimit.secondCredentialId,
    stream.firstCredentialId,
    stream.secondCredentialId,
  ];
  const rows = await db
    .select({
      id: upstreamCredentials.id,
      status: upstreamCredentials.status,
      coolUntil: upstreamCredentials.coolUntil,
      successCount: upstreamCredentials.successCount,
      errorCount: upstreamCredentials.errorCount,
    })
    .from(upstreamCredentials)
    .where(inArray(upstreamCredentials.id, ids));
  const byId = new Map(rows.map((row) => [row.id, row]));

  assert.equal(byId.get(auth.firstCredentialId)?.status, "auto_disabled");
  assert.equal(byId.get(auth.firstCredentialId)?.errorCount, 1);
  assert.equal(byId.get(auth.secondCredentialId)?.successCount, 1);

  const cooled = byId.get(rateLimit.firstCredentialId);
  assert.equal(cooled?.status, "cooling");
  assert(cooled?.coolUntil && cooled.coolUntil.getTime() > Date.now());
  assert.equal(cooled.errorCount, 1);
  assert.equal(byId.get(rateLimit.secondCredentialId)?.successCount, 1);

  assert.equal(byId.get(stream.firstCredentialId)?.errorCount, 1);
  assert.equal(byId.get(stream.secondCredentialId)?.successCount, 1);
}

async function runAssertions(tokenHubBaseUrl: string): Promise<void> {
  const auth = requireFixture("auth");
  const badRequest = requireFixture("bad-request");
  const rateLimit = requireFixture("rate-limit");
  const stream = requireFixture("stream");

  const authResult = await callRelay(tokenHubBaseUrl, auth);
  assert.equal(authResult.status, 200, "401 retry did not reach the second credential");
  assert.match(authResult.contentType, /application\/json/i);
  const authBody = JSON.parse(authResult.body) as Record<string, unknown>;
  assert.equal(authBody.model, auth.upstreamModel);
  assert.equal(auth.firstPlan.calls, 1);
  assert.equal(auth.secondPlan.calls, 1);

  const badRequestResult = await callRelay(tokenHubBaseUrl, badRequest);
  assert.equal(badRequestResult.status, 400, "upstream 400 was not returned to the client");
  const badRequestBody = JSON.parse(badRequestResult.body) as {
    error?: { code?: unknown };
  };
  assert.equal(badRequestBody.error?.code, "mock_bad_request");
  assert.equal(badRequest.firstPlan.calls, 1);
  assert.equal(badRequest.secondPlan.calls, 0, "upstream 400 incorrectly retried another key");

  const rateLimitResult = await callRelay(tokenHubBaseUrl, rateLimit);
  assert.equal(rateLimitResult.status, 200, "429 retry did not reach the second credential");
  assert.equal(rateLimit.firstPlan.calls, 1);
  assert.equal(rateLimit.secondPlan.calls, 1);

  const streamResult = await callRelay(tokenHubBaseUrl, stream);
  assert.equal(streamResult.status, 200, "500 retry did not reach the SSE credential");
  assert.match(streamResult.contentType, /text\/event-stream/i);
  assert.match(streamResult.body, /"content":"mock "/);
  assert.match(streamResult.body, /"content":"stream ok"/);
  assert.match(streamResult.body, /data: \[DONE\]/);
  assert.equal(stream.firstPlan.calls, 1);
  assert.equal(stream.secondPlan.calls, 1);

  assert.deepEqual(mockHandlerFailures, [], "local mock upstream observed invalid requests");

  const [authAudit, badRequestAudit, rateLimitAudit, streamAudit] = await Promise.all([
    waitForAudit(authResult.requestId),
    waitForAudit(badRequestResult.requestId),
    waitForAudit(rateLimitResult.requestId),
    waitForAudit(streamResult.requestId),
  ]);

  assert.equal(authAudit.status, "success");
  assert.equal(authAudit.retryCount, 1);
  assert.equal(authAudit.totalTokens, auth.usage.total_tokens);
  assert.equal(authAudit.usageSource, "upstream");
  assert.equal(authAudit.credentialId, auth.secondCredentialId);
  assertRetryTrace(authAudit, [401, 200]);

  assert.equal(badRequestAudit.status, "client_error");
  assert.equal(badRequestAudit.retryCount, 0);
  assert.equal(badRequestAudit.totalTokens, null);
  assert.equal(badRequestAudit.usageSource, "none");
  assert.equal(badRequestAudit.credentialId, badRequest.firstCredentialId);
  assertRetryTrace(badRequestAudit, [400]);

  assert.equal(rateLimitAudit.status, "success");
  assert.equal(rateLimitAudit.retryCount, 1);
  assert.equal(rateLimitAudit.promptTokens, rateLimit.usage.prompt_tokens);
  assert.equal(rateLimitAudit.completionTokens, rateLimit.usage.completion_tokens);
  assert.equal(rateLimitAudit.totalTokens, rateLimit.usage.total_tokens);
  assert.equal(rateLimitAudit.usageSource, "upstream");
  assert.equal(rateLimitAudit.credentialId, rateLimit.secondCredentialId);
  assertRetryTrace(rateLimitAudit, [429, 200]);

  assert.equal(streamAudit.status, "success");
  assert.equal(streamAudit.isStream, true);
  assert.equal(streamAudit.retryCount, 1);
  assert.equal(streamAudit.promptTokens, stream.usage.prompt_tokens);
  assert.equal(streamAudit.completionTokens, stream.usage.completion_tokens);
  assert.equal(streamAudit.totalTokens, stream.usage.total_tokens);
  assert.equal(streamAudit.usageSource, "upstream");
  assert.equal(streamAudit.credentialId, stream.secondCredentialId);
  assertRetryTrace(streamAudit, [500, 200]);

  for (const [audit, fixture] of [
    [authAudit, auth],
    [badRequestAudit, badRequest],
    [rateLimitAudit, rateLimit],
    [streamAudit, stream],
  ] as const) {
    assertAuditHeaders(audit, fixture);
  }

  const persisted = JSON.stringify([
    authAudit,
    badRequestAudit,
    rateLimitAudit,
    streamAudit,
  ]);
  for (const sensitive of sensitiveValues) {
    assert.equal(persisted.includes(sensitive), false, "persisted audit retained secret material");
  }

  await assertCredentialHealth();

  console.log(
    JSON.stringify(
      {
        ok: true,
        scenarios: {
          auth401ThenSuccess: authResult.status,
          badRequestNoRetry: badRequestResult.status,
          rateLimitThenSuccess: rateLimitResult.status,
          serverErrorThenSse: streamResult.status,
        },
        auditRetryCounts: [
          authAudit.retryCount,
          badRequestAudit.retryCount,
          rateLimitAudit.retryCount,
          streamAudit.retryCount,
        ],
        auditedTotalTokens: [
          authAudit.totalTokens,
          badRequestAudit.totalTokens,
          rateLimitAudit.totalTokens,
          streamAudit.totalTokens,
        ],
        authorizationPersisted: false,
      },
      null,
      2,
    ),
  );
}

async function deleteIds(
  values: number[],
  remove: (ids: number[]) => Promise<unknown>,
): Promise<void> {
  if (values.length > 0) await remove([...new Set(values)]);
}

async function cleanupFixtures(): Promise<void> {
  if (redis.status === "ready" && trackedRedisKeys.size > 0) {
    await redis.del(...trackedRedisKeys);
  }

  if (created.employeeId !== null) {
    const auditRows = await db
      .select({ requestId: requestAudits.requestId })
      .from(requestAudits)
      .where(eq(requestAudits.employeeId, created.employeeId));
    for (const row of auditRows) trackedRequestIds.add(row.requestId);
  }

  if (trackedRequestIds.size > 0) {
    await db
      .delete(requestAuditBodies)
      .where(inArray(requestAuditBodies.requestId, [...trackedRequestIds]));
  }
  if (created.employeeId !== null) {
    await db.delete(requestAudits).where(eq(requestAudits.employeeId, created.employeeId));
    await db
      .delete(usageCountersDaily)
      .where(eq(usageCountersDaily.employeeId, created.employeeId));
  }

  await deleteIds(created.grantIds, (ids) =>
    db.delete(credentialEmployeeGrants).where(inArray(credentialEmployeeGrants.id, ids)),
  );
  await deleteIds(created.employeeApiKeyIds, (ids) =>
    db.delete(employeeApiKeys).where(inArray(employeeApiKeys.id, ids)),
  );
  await deleteIds(created.routeIds, (ids) =>
    db.delete(modelRoutes).where(inArray(modelRoutes.id, ids)),
  );
  await deleteIds(created.credentialIds, (ids) =>
    db.delete(upstreamCredentials).where(inArray(upstreamCredentials.id, ids)),
  );
  await deleteIds(created.productLineIds, (ids) =>
    db.delete(productLines).where(inArray(productLines.id, ids)),
  );
  await deleteIds(created.providerIds, (ids) =>
    db.delete(providers).where(inArray(providers.id, ids)),
  );
  if (created.employeeId !== null) {
    await db
      .delete(employees)
      .where(and(eq(employees.id, created.employeeId), eq(employees.phone, employeePhone)));
  }
}

async function main(): Promise<void> {
  assert.equal(await redis.ping(), "PONG", "local Redis is unavailable");
  await sql`select 1`;

  upstreamServer = createMockServer();
  const upstreamBaseUrl = await listenLocal(upstreamServer);
  await insertFixtures(upstreamBaseUrl);

  tokenHubApp = await buildApp();
  await tokenHubApp.listen({ host: "127.0.0.1", port: 0 });
  const tokenHubAddress = tokenHubApp.server.address();
  assert(
    tokenHubAddress && typeof tokenHubAddress !== "string",
    "TokenHub test app has no TCP address",
  );
  await runAssertions(`http://127.0.0.1:${(tokenHubAddress as AddressInfo).port}`);
}

let primaryError: unknown = null;
try {
  await main();
} catch (error) {
  primaryError = error;
} finally {
  const cleanupErrors: unknown[] = [];
  try {
    // Streaming audit finalization deliberately runs after reply handoff. Wait
    // for every observed request before stopping the app or deleting parents.
    await waitForTrackedAuditsForCleanup();
  } catch (error) {
    cleanupErrors.push(error);
  }
  try {
    await closeTokenHubApp();
  } catch (error) {
    cleanupErrors.push(error);
  }
  try {
    await closeLocalServer(upstreamServer);
  } catch (error) {
    cleanupErrors.push(error);
  }
  try {
    await cleanupFixtures();
  } catch (error) {
    cleanupErrors.push(error);
  }
  try {
    if (redis.status !== "end") await redis.quit();
  } catch (error) {
    redis.disconnect();
    cleanupErrors.push(error);
  }
  try {
    await sql.end({ timeout: 5 });
  } catch (error) {
    cleanupErrors.push(error);
  }

  if (primaryError) {
    if (cleanupErrors.length > 0) {
      throw new AggregateError([primaryError, ...cleanupErrors], "mock relay test and cleanup failed");
    }
    throw primaryError;
  }
  if (cleanupErrors.length > 0) {
    throw new AggregateError(cleanupErrors, "mock relay integration cleanup failed");
  }
}
