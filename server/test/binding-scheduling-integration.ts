/**
 * Binding-model scheduling integration test.
 *
 * Covers the three tier scopes that replaced grants / public-pool routing:
 *   a) heavy employees get an exclusive Key that others do not share
 *   b) two standard teammates share one team Key
 *   c) exhausting a bound Key's 5-hour quota cools it and rebinds from the pool
 *
 * Uses local PostgreSQL, Redis, and a temporary node:http upstream.
 * Run explicitly:
 *
 *   npm run test:binding:scheduling --workspace=@kodax-fabric/server
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
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

process.env.RELAY_MAX_ATTEMPTS = "2";
process.env.RELAY_UPSTREAM_TIMEOUT_MS = "10000";
process.env.RELAY_COOLDOWN_SECONDS = "30";

const [
  { buildApp },
  { db, sql },
  schema,
  { encryptEmployeeApiKey, generateApiKey },
  { encryptSecret, secretSuffix },
  { redis },
  { getDefaultEnterpriseId, ensureDefaultDepartment },
  { hourStartOf },
  { env },
  { quotaDayAt },
  { USAGE_TIER_PROTECTION_MS },
] = await Promise.all([
  import("../src/app.js"),
  import("../src/db/client.js"),
  import("../src/db/schema/index.js"),
  import("../src/lib/api-key.js"),
  import("../src/lib/crypto-secret.js"),
  import("../src/redis.js"),
  import("../src/lib/enterprise.js"),
  import("../src/lib/relay/credential-quota.js"),
  import("../src/config.js"),
  import("../src/lib/quota-time.js"),
  import("../src/lib/usage-tier.js"),
]);

const {
  credentialBindings,
  credentialUsageHourly,
  employeeApiKeys,
  employees,
  enterprises,
  modelRoutes,
  productLines,
  providers,
  requestAudits,
  requestErrorLogs,
  teams,
  teamMembers,
  upstreamCredentials,
  usageCountersDaily,
  usageCountersTeamDaily,
} = schema;

type UsageTier = "standard" | "heavy";

const PEAK_TOKENS_BY_TIER: Record<UsageTier, number> = {
  standard: 12_000_000,
  heavy: 80_000_000,
};

type CreatedEmployee = {
  id: number;
  phone: string;
  apiKeyRaw: string;
};

type ChannelFixture = {
  productLineId: number;
  clientModel: string;
  firstCredentialId: number;
  secondCredentialId: number;
};

const runToken = randomUUID().replaceAll("-", "");
const marker = `bindsch_${runToken.slice(0, 14)}`;
const plansByAuthorization = new Map<string, { name: string; calls: number }>();
const mockFailures: string[] = [];
const trackedRequestIds = new Set<string>();
const trackedRedisKeys = new Set<string>();
const created = {
  employeeIds: [] as number[],
  teamIds: [] as number[],
  providerIds: [] as number[],
  productLineIds: [] as number[],
  credentialIds: [] as number[],
  apiKeyIds: [] as number[],
  routeIds: [] as number[],
  usageHourlyIds: [] as number[],
};

let app: FastifyInstance | null = null;
let upstream: Server | null = null;
let exclusive: ChannelFixture | null = null;
let teamShare: ChannelFixture | null = null;
let quotaRebind: ChannelFixture | null = null;
let heavyA: CreatedEmployee | null = null;
let heavyB: CreatedEmployee | null = null;
let standardA: CreatedEmployee | null = null;
let standardB: CreatedEmployee | null = null;
let quotaHeavy: CreatedEmployee | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function serverUrl(server: Server): string {
  const address = server.address();
  assert(address && typeof address !== "string", "server has no TCP address");
  return `http://127.0.0.1:${(address as AddressInfo).port}`;
}

async function listen(server: Server): Promise<string> {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return serverUrl(server);
}

async function closeServer(server: Server | null): Promise<void> {
  if (!server?.listening) return;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
    server.closeIdleConnections();
  });
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const raw = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": String(Buffer.byteLength(raw)),
  });
  res.end(raw);
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const value = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  assert(isRecord(value), "mock upstream body must be an object");
  return value;
}

function createMockUpstream(): Server {
  return createServer((req, res) => {
    void (async () => {
      if (req.method !== "POST" || req.url !== "/v1/chat/completions") {
        mockFailures.push(`unexpected ${req.method} ${req.url}`);
        sendJson(res, 404, { error: { message: "not found" } });
        return;
      }
      const authorization = Array.isArray(req.headers.authorization)
        ? req.headers.authorization[0]
        : req.headers.authorization;
      const plan = authorization ? plansByAuthorization.get(authorization) : undefined;
      if (!plan) {
        mockFailures.push("unknown upstream authorization");
        sendJson(res, 401, { error: { message: "unknown credential" } });
        return;
      }
      plan.calls += 1;
      const body = await readJson(req);
      sendJson(res, 200, {
        id: `bindsch_${plan.name}`,
        object: "chat.completion",
        created: 0,
        model: body.model,
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: `${plan.name} ok` },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
      });
    })().catch((error) => {
      mockFailures.push(error instanceof Error ? error.message : "mock handler failed");
      if (!res.headersSent) sendJson(res, 500, { error: { message: "mock failure" } });
      else if (!res.writableEnded) res.end();
    });
  });
}

async function insertEmployee(input: {
  suffix: string;
  enterpriseId: number;
  teamId: number;
  usageTier: UsageTier;
}): Promise<CreatedEmployee> {
  const phone = `${input.suffix}${runToken.slice(0, 14)}`.slice(0, 20);
  const [employee] = await db
    .insert(employees)
    .values({
      name: `${input.suffix} ${marker}`,
      phone,
      passwordHash: "binding-scheduling-password-not-used",
      dept: marker,
      role: "employee",
      status: "active",
      enterpriseId: input.enterpriseId,
      usageTier: input.usageTier,
      mustChangePassword: false,
      createdAt: new Date(Date.now() - USAGE_TIER_PROTECTION_MS - 60_000),
    })
    .returning({ id: employees.id });
  created.employeeIds.push(employee.id);
  await db.insert(teamMembers).values({
    teamId: input.teamId,
    employeeId: employee.id,
    role: "member",
  });
  await db.insert(usageCountersDaily).values({
    day: quotaDayAt(new Date(), env.QUOTA_TIMEZONE),
    employeeId: employee.id,
    totalTokens: PEAK_TOKENS_BY_TIER[input.usageTier],
    requestCount: 1,
  });
  return { id: employee.id, phone, apiKeyRaw: "" };
}

async function insertApiKey(
  employee: CreatedEmployee,
  productLineId: number,
  teamId: number,
  name: string,
): Promise<void> {
  const generated = generateApiKey();
  const [row] = await db
    .insert(employeeApiKeys)
    .values({
      employeeId: employee.id,
      name,
      keyPrefix: generated.prefix,
      keyHash: generated.hash,
      keyEncrypted: encryptEmployeeApiKey(generated.raw),
      protocol: "openai_chat",
      productLineId,
      teamId,
      expiresAt: new Date(Date.now() + 30 * 60_000),
    })
    .returning({ id: employeeApiKeys.id });
  created.apiKeyIds.push(row.id);
  employee.apiKeyRaw = generated.raw;
}

async function insertChannel(
  tag: string,
  upstreamBaseUrl: string,
  options: { firstFiveHourCreditLimit?: number } = {},
): Promise<ChannelFixture> {
  const clientModel = tag === "quota" ? "glm-5.3" : `glm-${tag}-${marker}`;
  const [provider] = await db
    .insert(providers)
    .values({
      code: `prov_${tag}_${marker}`.slice(0, 64),
      name: `Provider ${tag} ${marker}`,
      defaultBaseUrl: `${upstreamBaseUrl}/v1`,
      authStyle: "bearer",
      openaiCompatLevel: "full",
      status: "active",
    })
    .returning({ id: providers.id });
  created.providerIds.push(provider.id);

  const [line] = await db
    .insert(productLines)
    .values({
      providerId: provider.id,
      code: `line_${tag}_${marker}`.slice(0, 64),
      name: `Line ${tag} ${marker}`,
      productType: "api",
      allowAutoRoute: false,
      status: "active",
    })
    .returning({ id: productLines.id });
  created.productLineIds.push(line.id);

  const firstSecret = `bindsch_${tag}_first_${runToken}`;
  const secondSecret = `bindsch_${tag}_second_${runToken}`;
  const [firstCredential, secondCredential] = await db
    .insert(upstreamCredentials)
    .values([
      {
        productLineId: line.id,
        label: `${tag} first ${marker}`,
        secretEncrypted: encryptSecret(firstSecret),
        secretSuffix: secretSuffix(firstSecret),
        supportedProtocols: ["openai_chat"],
        priority: 200,
        weight: 100,
        status: "active" as const,
        fiveHourCreditLimit: options.firstFiveHourCreditLimit != null
          ? String(options.firstFiveHourCreditLimit)
          : null,
      },
      {
        productLineId: line.id,
        label: `${tag} second ${marker}`,
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
  plansByAuthorization.set(`Bearer ${firstSecret}`, { name: `${tag}-first`, calls: 0 });
  plansByAuthorization.set(`Bearer ${secondSecret}`, { name: `${tag}-second`, calls: 0 });

  const [route] = await db
    .insert(modelRoutes)
    .values({
      clientModel,
      productLineId: line.id,
      upstreamModel: `upstream-${tag}-${marker}`,
      enabled: true,
      priority: 100,
      weight: 100,
    })
    .returning({ id: modelRoutes.id });
  created.routeIds.push(route.id);

  return {
    productLineId: line.id,
    clientModel,
    firstCredentialId: firstCredential.id,
    secondCredentialId: secondCredential.id,
  };
}

async function insertBinding(
  credentialId: number,
  productLineId: number,
  scopeType: "employee" | "team" | "enterprise",
  scopeId: number,
): Promise<void> {
  await db.insert(credentialBindings).values({
    credentialId,
    productLineId,
    scopeType,
    scopeId,
  });
}

async function insertFixtures(upstreamBaseUrl: string): Promise<void> {
  const enterpriseId = await getDefaultEnterpriseId();
  const departmentId = await ensureDefaultDepartment(enterpriseId);

  const [exclusiveTeam] = await db
    .insert(teams)
    .values({
      enterpriseId,
      departmentId,
      name: `exclusive-${marker}`,
      status: "active",

    })
    .returning({ id: teams.id });
  const [shareTeam] = await db
    .insert(teams)
    .values({
      enterpriseId,
      departmentId,
      name: `share-${marker}`,
      status: "active",

    })
    .returning({ id: teams.id });
  const [quotaTeam] = await db
    .insert(teams)
    .values({
      enterpriseId,
      departmentId,
      name: `quota-${marker}`,
      status: "active",

    })
    .returning({ id: teams.id });
  created.teamIds.push(exclusiveTeam.id, shareTeam.id, quotaTeam.id);

  heavyA = await insertEmployee({
    suffix: "ha",
    enterpriseId,
    teamId: exclusiveTeam.id,
    usageTier: "heavy",
  });
  heavyB = await insertEmployee({
    suffix: "hb",
    enterpriseId,
    teamId: exclusiveTeam.id,
    usageTier: "heavy",
  });
  standardA = await insertEmployee({
    suffix: "sa",
    enterpriseId,
    teamId: shareTeam.id,
    usageTier: "standard",
  });
  standardB = await insertEmployee({
    suffix: "sb",
    enterpriseId,
    teamId: shareTeam.id,
    usageTier: "standard",
  });
  quotaHeavy = await insertEmployee({
    suffix: "qh",
    enterpriseId,
    teamId: quotaTeam.id,
    usageTier: "heavy",
  });

  exclusive = await insertChannel("excl", upstreamBaseUrl);
  teamShare = await insertChannel("share", upstreamBaseUrl);
  quotaRebind = await insertChannel("quota", upstreamBaseUrl, { firstFiveHourCreditLimit: 10 });

  await insertApiKey(heavyA, exclusive.productLineId, exclusiveTeam.id, `excl-a ${marker}`);
  await insertApiKey(heavyB, exclusive.productLineId, exclusiveTeam.id, `excl-b ${marker}`);
  await insertApiKey(standardA, teamShare.productLineId, shareTeam.id, `share-a ${marker}`);
  await insertApiKey(standardB, teamShare.productLineId, shareTeam.id, `share-b ${marker}`);
  await insertApiKey(quotaHeavy, quotaRebind.productLineId, quotaTeam.id, `quota ${marker}`);

  await insertBinding(exclusive.firstCredentialId, exclusive.productLineId, "employee", heavyA.id);
  await insertBinding(teamShare.firstCredentialId, teamShare.productLineId, "team", shareTeam.id);
  await insertBinding(
    quotaRebind.firstCredentialId,
    quotaRebind.productLineId,
    "employee",
    quotaHeavy.id,
  );

  const [usage] = await db
    .insert(credentialUsageHourly)
    .values({
      credentialId: quotaRebind.firstCredentialId,
      hourStart: hourStartOf(new Date()),
      totalTokens: 10,
      totalCredits: "10",
      requestCount: 1,
    })
    .returning({ id: credentialUsageHourly.id });
  created.usageHourlyIds.push(usage.id);
}

function rememberQuotaKeys(employeeId: number): void {
  trackedRedisKeys.add(`tokenhub:relay:rpm:${employeeId}:${Math.floor(Date.now() / 60_000)}`);
  trackedRedisKeys.add(`tokenhub:relay:concurrency:v2:${employeeId}`);
}

async function callChat(
  baseUrl: string,
  employee: CreatedEmployee,
  clientModel: string,
): Promise<{ status: number; requestId: string }> {
  rememberQuotaKeys(employee.id);
  const response = await fetch(`${baseUrl}/ai/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${employee.apiKeyRaw}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: clientModel,
      messages: [{ role: "user", content: "binding scheduling" }],
      stream: false,
    }),
  });
  rememberQuotaKeys(employee.id);
  const requestId = response.headers.get("x-tokenhub-request-id");
  assert(requestId, "relay omitted x-tokenhub-request-id");
  trackedRequestIds.add(requestId);
  await response.text();
  return { status: response.status, requestId };
}

async function waitForAudit(requestId: string): Promise<{ credentialId: number | null }> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const [row] = await db
      .select({ credentialId: requestAudits.credentialId })
      .from(requestAudits)
      .where(eq(requestAudits.requestId, requestId))
      .limit(1);
    if (row) return row;
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`audit ${requestId} was not persisted`);
}

async function selectBinding(
  productLineId: number,
  scopeType: "employee" | "team" | "enterprise",
  scopeId: number,
): Promise<number | null> {
  const [row] = await db
    .select({ credentialId: credentialBindings.credentialId })
    .from(credentialBindings)
    .where(
      and(
        eq(credentialBindings.productLineId, productLineId),
        eq(credentialBindings.scopeType, scopeType),
        eq(credentialBindings.scopeId, scopeId),
      ),
    )
    .limit(1);
  return row?.credentialId ?? null;
}

async function assertExclusive(baseUrl: string): Promise<void> {
  assert(exclusive && heavyA && heavyB);
  const first = await callChat(baseUrl, heavyA, exclusive.clientModel);
  const second = await callChat(baseUrl, heavyB, exclusive.clientModel);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);

  const [firstAudit, secondAudit] = await Promise.all([
    waitForAudit(first.requestId),
    waitForAudit(second.requestId),
  ]);
  assert.equal(firstAudit.credentialId, exclusive.firstCredentialId, "heavy A must keep the exclusive Key");
  assert.equal(secondAudit.credentialId, exclusive.secondCredentialId, "heavy B must not share A's Key");
  assert.equal(
    await selectBinding(exclusive.productLineId, "employee", heavyA.id),
    exclusive.firstCredentialId,
  );
  assert.equal(
    await selectBinding(exclusive.productLineId, "employee", heavyB.id),
    exclusive.secondCredentialId,
  );
}

async function assertTeamShare(baseUrl: string): Promise<void> {
  assert(teamShare && standardA && standardB && created.teamIds[1]);
  const first = await callChat(baseUrl, standardA, teamShare.clientModel);
  const second = await callChat(baseUrl, standardB, teamShare.clientModel);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);

  const [firstAudit, secondAudit] = await Promise.all([
    waitForAudit(first.requestId),
    waitForAudit(second.requestId),
  ]);
  assert.equal(firstAudit.credentialId, teamShare.firstCredentialId);
  assert.equal(secondAudit.credentialId, teamShare.firstCredentialId, "teammates must share the team Key");
  assert.equal(
    await selectBinding(teamShare.productLineId, "team", created.teamIds[1]),
    teamShare.firstCredentialId,
  );
  assert.equal(await selectBinding(teamShare.productLineId, "employee", standardA.id), null);
  assert.equal(await selectBinding(teamShare.productLineId, "employee", standardB.id), null);
}

async function assertQuotaRebind(baseUrl: string): Promise<void> {
  assert(quotaRebind && quotaHeavy);
  const result = await callChat(baseUrl, quotaHeavy, quotaRebind.clientModel);
  assert.equal(result.status, 200);
  const audit = await waitForAudit(result.requestId);
  assert.equal(audit.credentialId, quotaRebind.secondCredentialId, "exhausted Key was not replaced");
  assert.equal(
    await selectBinding(quotaRebind.productLineId, "employee", quotaHeavy.id),
    quotaRebind.secondCredentialId,
  );

  const [cooled] = await db
    .select({
      status: upstreamCredentials.status,
      coolUntil: upstreamCredentials.coolUntil,
    })
    .from(upstreamCredentials)
    .where(eq(upstreamCredentials.id, quotaRebind.firstCredentialId))
    .limit(1);
  assert.equal(cooled?.status, "cooling");
  assert(cooled?.coolUntil && cooled.coolUntil.getTime() > Date.now());
}

async function runAssertions(baseUrl: string): Promise<void> {
  await assertExclusive(baseUrl);
  await assertTeamShare(baseUrl);
  await assertQuotaRebind(baseUrl);
  assert.deepEqual(mockFailures, []);
  console.log(JSON.stringify({
    ok: true,
    exclusiveHeavyKeys: true,
    standardTeamShare: true,
    quotaExhaustRebind: true,
  }, null, 2));
}

async function deleteIds(
  ids: number[],
  remove: (uniqueIds: number[]) => Promise<unknown>,
): Promise<void> {
  if (ids.length > 0) await remove([...new Set(ids)]);
}

async function cleanup(): Promise<void> {
  if (redis.status === "ready" && trackedRedisKeys.size > 0) {
    await redis.del(...trackedRedisKeys);
  }
  if (created.employeeIds.length > 0) {
    await db.delete(requestAudits).where(inArray(requestAudits.employeeId, created.employeeIds));
    await db.delete(requestErrorLogs).where(inArray(requestErrorLogs.employeeId, created.employeeIds));
    await db
      .delete(usageCountersDaily)
      .where(inArray(usageCountersDaily.employeeId, created.employeeIds));
    await db
      .delete(usageCountersTeamDaily)
      .where(inArray(usageCountersTeamDaily.employeeId, created.employeeIds));
  }
  await deleteIds(created.usageHourlyIds, (ids) =>
    db.delete(credentialUsageHourly).where(inArray(credentialUsageHourly.id, ids)));
  await deleteIds(created.productLineIds, (ids) =>
    db.delete(credentialBindings).where(inArray(credentialBindings.productLineId, ids)));
  await deleteIds(created.apiKeyIds, (ids) =>
    db.delete(employeeApiKeys).where(inArray(employeeApiKeys.id, ids)));
  await deleteIds(created.routeIds, (ids) =>
    db.delete(modelRoutes).where(inArray(modelRoutes.id, ids)));
  await deleteIds(created.credentialIds, (ids) =>
    db.delete(upstreamCredentials).where(inArray(upstreamCredentials.id, ids)));
  await deleteIds(created.productLineIds, (ids) =>
    db.delete(productLines).where(inArray(productLines.id, ids)));
  await deleteIds(created.providerIds, (ids) =>
    db.delete(providers).where(inArray(providers.id, ids)));
  if (created.teamIds.length > 0) {
    await db.delete(teamMembers).where(inArray(teamMembers.teamId, created.teamIds));
    await db.delete(teams).where(inArray(teams.id, created.teamIds));
  }
  await deleteIds(created.employeeIds, (ids) =>
    db.delete(employees).where(inArray(employees.id, ids)));
}

let primaryError: unknown = null;
try {
  assert.equal(await redis.ping(), "PONG", "local Redis is unavailable");
  await sql`select 1`;
  upstream = createMockUpstream();
  const upstreamBaseUrl = await listen(upstream);
  await insertFixtures(upstreamBaseUrl);
  app = await buildApp();
  await app.listen({ host: "127.0.0.1", port: 0 });
  await runAssertions(serverUrl(app.server));
} catch (error) {
  primaryError = error;
} finally {
  const cleanupErrors: unknown[] = [];
  try {
    if (app) await app.close();
  } catch (error) {
    cleanupErrors.push(error);
  }
  try {
    await closeServer(upstream);
  } catch (error) {
    cleanupErrors.push(error);
  }
  try {
    await cleanup();
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
    throw cleanupErrors.length > 0
      ? new AggregateError([primaryError, ...cleanupErrors], "binding scheduling test and cleanup failed")
      : primaryError;
  }
  if (cleanupErrors.length > 0) {
    throw new AggregateError(cleanupErrors, "binding scheduling cleanup failed");
  }
}
