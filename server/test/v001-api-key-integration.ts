/**
 * Explicit v0.0.1 employee API-key database integration test.
 *
 * This script uses the real Fastify application and the PostgreSQL configured
 * for the server. It is intentionally not part of the default unit-test suite:
 * run it only against a migrated development/test database with:
 *
 *   pnpm --filter @tokenhub/server exec tsx test/v001-api-key-integration.ts
 *
 * Every fixture is uniquely tagged and cleanup addresses only rows whose IDs
 * were returned while creating this run's fixtures.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";

const [
  { buildApp },
  { db, sql },
  schema,
  { generateApiKey, encryptEmployeeApiKey },
  { encryptSecret, secretSuffix },
  { hashPassword },
  { signSession },
  { redis },
] = await Promise.all([
  import("../src/app.js"),
  import("../src/db/client.js"),
  import("../src/db/schema/index.js"),
  import("../src/lib/api-key.js"),
  import("../src/lib/crypto-secret.js"),
  import("../src/lib/password.js"),
  import("../src/lib/jwt.js"),
  import("../src/redis.js"),
]);

const {
  credentialEmployeeGrants,
  employeeApiKeys,
  employees,
  opsAuditLogs,
  productLines,
  providers,
  upstreamCredentials,
} = schema;

type Role = "employee" | "admin" | "auditor";
type Protocol = "openai_chat" | "openai_responses" | "anthropic_messages";
type CredentialStatus = "active" | "cooling" | "disabled" | "auto_disabled";

type UserFixture = {
  id: number;
  name: string;
  phone: string;
  role: Role;
  token: string;
};

type ChannelResponse = {
  productLineId: number;
  productLineCode: string;
  productLineName: string;
  productType: "api" | "coding_plan";
  shareMode: "public_pool" | "grant_only";
  providerId: number;
  providerCode: string;
  providerName: string;
  compatibleProtocols: Protocol[];
  credentialCount: number;
};

type ApiKeyListItem = {
  id: number;
  name: string;
  keyPrefix: string;
  protocol: Protocol;
  productLineId: number;
  productLineCode?: string;
  productLineName: string;
  providerId?: number;
  providerCode: string;
  providerName: string;
  status: "active" | "revoked";
};

const runId = randomUUID().replaceAll("-", "");
const marker = `v001it_${runId.slice(0, 14)}`;
const fixturePassword = "V001Integration@123";

const created = {
  employeeIds: [] as number[],
  providerIds: [] as number[],
  productLineIds: [] as number[],
  credentialIds: [] as number[],
  grantIds: [] as number[],
  apiKeyIds: [] as number[],
};

const users = new Map<Role, UserFixture>();
const productLineIds = new Map<string, number>();
const credentialIds = new Map<string, number>();
const upstreamSensitiveValues = new Set<string>();

let app: FastifyInstance | null = null;
let createdPlaintextKey = "";
let createdBoundKeyId: number | null = null;
let fkRestrictedKeyId: number | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requiredUser(role: Role): UserFixture {
  const user = users.get(role);
  assert(user, `missing ${role} fixture`);
  return user;
}

function requiredProductLine(name: string): number {
  const id = productLineIds.get(name);
  assert(id, `missing ${name} product-line fixture`);
  return id;
}

function requiredCredential(name: string): number {
  const id = credentialIds.get(name);
  assert(id, `missing ${name} credential fixture`);
  return id;
}

function authHeaders(user: UserFixture): Record<string, string> {
  return { authorization: `Bearer ${user.token}` };
}

function jsonBody<T>(response: LightMyRequestResponse): T {
  assert.match(
    String(response.headers["content-type"] ?? ""),
    /application\/json/i,
    `expected JSON response, received ${response.headers["content-type"] ?? "no content-type"}`,
  );
  return response.json<T>();
}

function assertNoSecretFields(value: unknown): void {
  const forbidden = new Set([
    "secret",
    "secretEncrypted",
    "secretSuffix",
    "key",
    "keyHash",
    "keyEncrypted",
    "defaultBaseUrl",
    "baseUrlOverride",
    "baseUrl",
  ]);

  const visit = (candidate: unknown): void => {
    if (Array.isArray(candidate)) {
      for (const item of candidate) visit(item);
      return;
    }
    if (!isRecord(candidate)) return;
    for (const [key, child] of Object.entries(candidate)) {
      assert.equal(forbidden.has(key), false, `metadata leaked forbidden field ${key}`);
      visit(child);
    }
  };

  visit(value);
}

async function assertMigratedDatabase(): Promise<string> {
  const [database] = await sql<{ databaseName: string }[]>`
    select current_database()::text as "databaseName"
  `;
  const [state] = await sql<{
    tableExists: boolean;
    productLineIdExists: boolean;
    productLineIdNotNull: boolean;
    keyEncryptedNotNull: boolean;
    nameHasNoDefault: boolean;
    protocolHasNoDefault: boolean;
    restrictFkExists: boolean;
  }[]>`
    select
      to_regclass('public.employee_api_keys') is not null as "tableExists",
      exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'employee_api_keys'
          and column_name = 'product_line_id'
      ) as "productLineIdExists",
      exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'employee_api_keys'
          and column_name = 'product_line_id'
          and is_nullable = 'NO'
      ) as "productLineIdNotNull",
      exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'employee_api_keys'
          and column_name = 'key_encrypted'
          and is_nullable = 'NO'
      ) as "keyEncryptedNotNull",
      exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'employee_api_keys'
          and column_name = 'name'
          and column_default is null
      ) as "nameHasNoDefault",
      exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'employee_api_keys'
          and column_name = 'protocol'
          and column_default is null
      ) as "protocolHasNoDefault",
      exists (
        select 1
        from pg_constraint
        where conname = 'employee_api_keys_product_line_id_product_lines_id_fk'
          and contype = 'f'
          and confdeltype = 'r'
      ) as "restrictFkExists"
  `;

  assert(state.tableExists, "employee_api_keys is missing; run database migrations first");
  assert(state.productLineIdExists, "product_line_id is missing; run v0.0.1 migration first");
  assert(state.productLineIdNotNull, "employee_api_keys.product_line_id must be NOT NULL");
  assert(state.keyEncryptedNotNull, "employee_api_keys.key_encrypted must be NOT NULL");
  assert(state.nameHasNoDefault, "employee_api_keys.name must not have a database default");
  assert(state.protocolHasNoDefault, "employee_api_keys.protocol must not have a database default");
  assert(state.restrictFkExists, "employee API-key product-line FK is not ON DELETE RESTRICT");
  return database.databaseName;
}

async function createUsers(): Promise<void> {
  const passwordHash = await hashPassword(fixturePassword);
  for (const [role, suffix] of [
    ["employee", "emp"],
    ["admin", "adm"],
    ["auditor", "aud"],
  ] as const) {
    const phone = `${suffix}${runId.slice(0, 16)}`;
    const name = `${role} ${marker}`;
    const [row] = await db
      .insert(employees)
      .values({
        name,
        phone,
        passwordHash,
        dept: `integration-${marker}`,
        role,
        status: "active",
        mustChangePassword: false,
        passwordChangedAt: new Date(),
      })
      .returning({ id: employees.id });
    created.employeeIds.push(row.id);

    const token = await signSession({
      sub: String(row.id),
      role,
      phone,
      name,
      mustChangePassword: false,
    });
    users.set(role, { id: row.id, name, phone, role, token });
  }
}

async function createProductLine(
  name: string,
  options: {
    shareMode?: "public_pool" | "grant_only" | "disabled";
    status?: string;
    baseUrlOverride?: string | null;
  } = {},
): Promise<number> {
  const providerId = created.providerIds[0];
  assert(providerId, "provider fixture must exist first");
  const [row] = await db
    .insert(productLines)
    .values({
      providerId,
      code: `${name}_${marker}`,
      name: `${name} ${marker}`,
      productType: "api",
      shareMode: options.shareMode ?? "public_pool",
      baseUrlOverride: options.baseUrlOverride ?? null,
      allowAutoRoute: false,
      status: options.status ?? "active",
    })
    .returning({ id: productLines.id });
  created.productLineIds.push(row.id);
  productLineIds.set(name, row.id);
  return row.id;
}

async function createCredential(
  name: string,
  productLineId: number,
  options: {
    protocols: Protocol[];
    status?: CredentialStatus;
    weight?: number;
    coolUntil?: Date | null;
  },
): Promise<number> {
  const secret = `upstream_${name}_${runId}`;
  const encrypted = encryptSecret(secret);
  upstreamSensitiveValues.add(secret);
  upstreamSensitiveValues.add(encrypted);

  const [row] = await db
    .insert(upstreamCredentials)
    .values({
      productLineId,
      label: `${name} ${marker}`,
      secretEncrypted: encrypted,
      secretSuffix: secretSuffix(secret),
      supportedProtocols: options.protocols,
      status: options.status ?? "active",
      weight: options.weight ?? 100,
      priority: 100,
      coolUntil: options.coolUntil ?? null,
    })
    .returning({ id: upstreamCredentials.id });
  created.credentialIds.push(row.id);
  credentialIds.set(name, row.id);
  return row.id;
}

async function createChannelFixtures(): Promise<void> {
  const defaultBaseUrl = `https://${marker}.example.invalid/v1`;
  upstreamSensitiveValues.add(defaultBaseUrl);
  const [provider] = await db
    .insert(providers)
    .values({
      code: `provider_${marker}`,
      name: `Provider ${marker}`,
      defaultBaseUrl,
      authStyle: "bearer",
      openaiCompatLevel: "full",
      status: "active",
    })
    .returning({ id: providers.id });
  created.providerIds.push(provider.id);

  const overrideUrl = `https://${marker}.override.invalid/v1`;
  upstreamSensitiveValues.add(overrideUrl);
  const publicLine = await createProductLine("public", { baseUrlOverride: overrideUrl });
  await createCredential("public-active", publicLine, {
    protocols: ["openai_chat"],
  });
  await createCredential("public-cooling", publicLine, {
    protocols: ["openai_responses"],
    status: "cooling",
    coolUntil: new Date(Date.now() + 60 * 60_000),
  });
  await createCredential("public-disabled", publicLine, {
    protocols: ["anthropic_messages"],
    status: "disabled",
  });
  await createCredential("public-auto-disabled", publicLine, {
    protocols: ["anthropic_messages"],
    status: "auto_disabled",
  });
  await createCredential("public-weight-zero", publicLine, {
    protocols: ["anthropic_messages"],
    weight: 0,
  });

  const grantLine = await createProductLine("grant", { shareMode: "grant_only" });
  const granted = await createCredential("grant-authorized", grantLine, {
    protocols: ["openai_chat"],
  });
  await createCredential("grant-unauthorized-responses", grantLine, {
    protocols: ["openai_responses"],
  });
  await createCredential("grant-unauthorized-messages", grantLine, {
    protocols: ["anthropic_messages"],
    status: "cooling",
    coolUntil: new Date(Date.now() + 60 * 60_000),
  });

  const employee = requiredUser("employee");
  const [grant] = await db
    .insert(credentialEmployeeGrants)
    .values({ credentialId: granted, employeeId: employee.id })
    .returning({ id: credentialEmployeeGrants.id });
  created.grantIds.push(grant.id);

  const invisibleGrantLine = await createProductLine("grant-invisible", {
    shareMode: "grant_only",
  });
  await createCredential("grant-invisible-active", invisibleGrantLine, {
    protocols: ["openai_chat"],
  });

  const disabledLine = await createProductLine("disabled-only");
  await createCredential("disabled-only", disabledLine, {
    protocols: ["openai_chat"],
    status: "disabled",
  });

  const autoDisabledLine = await createProductLine("auto-disabled-only");
  await createCredential("auto-disabled-only", autoDisabledLine, {
    protocols: ["openai_chat"],
    status: "auto_disabled",
  });

  const weightZeroLine = await createProductLine("weight-zero-only");
  await createCredential("weight-zero-only", weightZeroLine, {
    protocols: ["openai_chat"],
    weight: 0,
  });

  // No credentials: this line isolates the employee_api_keys FK from all other
  // product-line child constraints in the ON DELETE RESTRICT assertion.
  await createProductLine("fk-only");
}

async function insertDirectApiKey(options: {
  name: string;
  productLineId: number;
  protocol?: Protocol;
  status?: "active" | "revoked";
}): Promise<{ id: number; raw: string }> {
  const generated = generateApiKey();
  const [row] = await db
    .insert(employeeApiKeys)
    .values({
      employeeId: requiredUser("employee").id,
      name: `${options.name} ${marker}`,
      keyPrefix: generated.prefix,
      keyHash: generated.hash,
      keyEncrypted: encryptEmployeeApiKey(generated.raw),
      protocol: options.protocol ?? "openai_chat",
      productLineId: options.productLineId,
      status: options.status ?? "active",
    })
    .returning({ id: employeeApiKeys.id });
  created.apiKeyIds.push(row.id);
  return { id: row.id, raw: generated.raw };
}

async function createDirectApiKeyFixtures(): Promise<void> {
  const restricted = await insertDirectApiKey({
    name: "fk-restricted",
    productLineId: requiredProductLine("fk-only"),
  });
  fkRestrictedKeyId = restricted.id;
}

async function assertStrictMeRoleBoundary(): Promise<void> {
  const employeeResponse = await app!.inject({
    method: "GET",
    url: "/api/me/upstream-channels",
    headers: authHeaders(requiredUser("employee")),
  });
  assert.equal(employeeResponse.statusCode, 200);

  for (const role of ["admin", "auditor"] as const) {
    const response = await app!.inject({
      method: "GET",
      url: "/api/me/upstream-channels",
      headers: authHeaders(requiredUser(role)),
    });
    assert.equal(response.statusCode, 403, `${role} unexpectedly entered /api/me`);
  }
}

async function assertUpstreamChannelMetadata(): Promise<void> {
  const response = await app!.inject({
    method: "GET",
    url: "/api/me/upstream-channels",
    headers: authHeaders(requiredUser("employee")),
  });
  assert.equal(response.statusCode, 200);
  const body = jsonBody<{ success: boolean; data: ChannelResponse[] }>(response);
  assert.equal(body.success, true);
  assertNoSecretFields(body);

  const serialized = JSON.stringify(body);
  for (const sensitive of upstreamSensitiveValues) {
    assert.equal(serialized.includes(sensitive), false, "channel metadata leaked upstream data");
  }

  const publicChannel = body.data.find(
    (channel) => channel.productLineId === requiredProductLine("public"),
  );
  assert(publicChannel, "public_pool channel was not visible");
  assert.equal(publicChannel.shareMode, "public_pool");
  assert.equal(publicChannel.credentialCount, 2, "invalid-status/weight credentials were counted");
  assert.deepEqual(publicChannel.compatibleProtocols, ["openai_chat", "openai_responses"]);

  const grantChannel = body.data.find(
    (channel) => channel.productLineId === requiredProductLine("grant"),
  );
  assert(grantChannel, "authorized grant_only channel was not visible");
  assert.equal(grantChannel.shareMode, "grant_only");
  assert.equal(grantChannel.credentialCount, 1, "ungranted credentials leaked into count");
  assert.deepEqual(
    grantChannel.compatibleProtocols,
    ["openai_chat"],
    "ungranted credential protocols leaked into metadata",
  );

  for (const hidden of [
    "grant-invisible",
    "disabled-only",
    "auto-disabled-only",
    "weight-zero-only",
    "fk-only",
  ]) {
    assert.equal(
      body.data.some((channel) => channel.productLineId === requiredProductLine(hidden)),
      false,
      `${hidden} channel unexpectedly visible`,
    );
  }

  // Sanity-check that each filtered fixture really exists, so an absent setup
  // cannot make the negative assertions pass vacuously.
  for (const fixture of [
    "public-disabled",
    "public-auto-disabled",
    "public-weight-zero",
    "disabled-only",
    "auto-disabled-only",
    "weight-zero-only",
  ]) {
    assert(requiredCredential(fixture) > 0);
  }
}

async function assertCreateValidationAndBinding(): Promise<void> {
  const employee = requiredUser("employee");
  const headers = authHeaders(employee);

  for (const payload of [
    { name: `missing-channel ${marker}`, protocol: "openai_chat" },
    { name: `missing-protocol ${marker}`, productLineId: requiredProductLine("grant") },
    { productLineId: requiredProductLine("grant"), protocol: "openai_chat" },
  ]) {
    const response = await app!.inject({
      method: "POST",
      url: "/api/me/api-keys",
      headers,
      payload,
    });
    assert.equal(response.statusCode, 400, `required-field validation accepted ${JSON.stringify(payload)}`);
    assert.equal(jsonBody<{ code?: string }>(response).code, "invalid_request");
  }

  const invisible = await app!.inject({
    method: "POST",
    url: "/api/me/api-keys",
    headers,
    payload: {
      name: `invisible ${marker}`,
      productLineId: requiredProductLine("grant-invisible"),
      protocol: "openai_chat",
    },
  });
  assert.equal(invisible.statusCode, 404);
  assert.equal(
    jsonBody<{ code?: string }>(invisible).code,
    "upstream_channel_unavailable",
  );

  const mismatch = await app!.inject({
    method: "POST",
    url: "/api/me/api-keys",
    headers,
    payload: {
      name: `mismatch ${marker}`,
      productLineId: requiredProductLine("public"),
      protocol: "anthropic_messages",
    },
  });
  assert.equal(mismatch.statusCode, 400);
  assert.equal(
    jsonBody<{ code?: string }>(mismatch).code,
    "channel_protocol_incompatible",
  );

  const response = await app!.inject({
    method: "POST",
    url: "/api/me/api-keys",
    headers,
    payload: {
      name: `bound ${marker}`,
      productLineId: requiredProductLine("grant"),
      protocol: "openai_chat",
    },
  });
  assert.equal(response.statusCode, 200);
  assert.match(String(response.headers["cache-control"] ?? ""), /(?:^|,)\s*no-store\s*(?:,|$)/i);
  assert.match(String(response.headers.pragma ?? ""), /no-cache/i);
  const body = jsonBody<{
    success: boolean;
    data: ApiKeyListItem & { key: string };
  }>(response);
  assert.equal(body.success, true);
  assert.match(body.data.key, /^th_[A-Za-z0-9_-]{32}$/);
  assert.equal(body.data.productLineId, requiredProductLine("grant"));
  assert.equal(body.data.productLineName, `grant ${marker}`);
  assert.equal(body.data.providerCode, `provider_${marker}`);
  createdPlaintextKey = body.data.key;
  createdBoundKeyId = body.data.id;
  created.apiKeyIds.push(body.data.id);

  const [persisted] = await db
    .select({
      employeeId: employeeApiKeys.employeeId,
      keyHash: employeeApiKeys.keyHash,
      keyEncrypted: employeeApiKeys.keyEncrypted,
      protocol: employeeApiKeys.protocol,
      productLineId: employeeApiKeys.productLineId,
    })
    .from(employeeApiKeys)
    .where(eq(employeeApiKeys.id, body.data.id))
    .limit(1);
  assert(persisted, "created API Key was not persisted");
  assert.equal(persisted.employeeId, employee.id);
  assert.equal(persisted.protocol, "openai_chat");
  assert.equal(persisted.productLineId, requiredProductLine("grant"));
  assert.notEqual(persisted.keyEncrypted, createdPlaintextKey);
  assert.notEqual(persisted.keyHash, createdPlaintextKey);

  const listResponse = await app!.inject({
    method: "GET",
    url: "/api/me/api-keys",
    headers,
  });
  assert.equal(listResponse.statusCode, 200);
  const listBody = jsonBody<{ success: boolean; data: ApiKeyListItem[] }>(listResponse);
  const listed = listBody.data.find((key) => key.id === body.data.id);
  assert(listed, "new API Key was absent from employee list");
  const serializedList = JSON.stringify(listBody);
  assert.equal(serializedList.includes(createdPlaintextKey), false);
  assertNoSecretFields(listBody);

  const revealResponse = await app!.inject({
    method: "POST",
    url: `/api/me/api-keys/${body.data.id}/reveal`,
    headers,
  });
  assert.equal(revealResponse.statusCode, 404, "employee reveal endpoint is still reachable");
}

async function assertAdminRevealMetadataAndAudit(): Promise<void> {
  assert(createdBoundKeyId, "bound API Key fixture missing");
  const employee = requiredUser("employee");
  const admin = requiredUser("admin");

  const listResponse = await app!.inject({
    method: "GET",
    url: `/api/admin/users/${employee.id}/api-keys`,
    headers: authHeaders(admin),
  });
  assert.equal(listResponse.statusCode, 200);
  const listBody = jsonBody<{ success: boolean; data: ApiKeyListItem[] }>(listResponse);
  const listed = listBody.data.find((key) => key.id === createdBoundKeyId);
  assert(listed, "created API Key was absent from the admin list");
  assert.equal(listed.productLineId, requiredProductLine("grant"));
  assert.equal(listed.productLineCode, `grant_${marker}`);
  assert.equal(listed.productLineName, `grant ${marker}`);
  assert.equal(listed.providerCode, `provider_${marker}`);
  assertNoSecretFields(listBody);

  const before = await db
    .select({ id: opsAuditLogs.id })
    .from(opsAuditLogs)
    .where(
      and(
        eq(opsAuditLogs.action, "employee_api_key.reveal"),
        eq(opsAuditLogs.targetId, String(createdBoundKeyId)),
      ),
    );
  assert.equal(before.length, 0, "reveal audit unexpectedly existed before request");

  const response = await app!.inject({
    method: "POST",
    url: `/api/admin/users/${employee.id}/api-keys/${createdBoundKeyId}/reveal`,
    headers: authHeaders(admin),
  });
  assert.equal(response.statusCode, 200);
  assert.match(String(response.headers["cache-control"] ?? ""), /(?:^|,)\s*no-store\s*(?:,|$)/i);
  assert.match(String(response.headers.pragma ?? ""), /no-cache/i);
  const body = jsonBody<{
    success: boolean;
    data: ApiKeyListItem & { key: string; providerId: number };
  }>(response);
  assert.equal(body.success, true);
  assert.equal(body.data.key, createdPlaintextKey);
  assert.equal(body.data.productLineId, requiredProductLine("grant"));
  assert.equal(body.data.productLineCode, `grant_${marker}`);
  assert.equal(body.data.productLineName, `grant ${marker}`);
  assert.equal(body.data.providerCode, `provider_${marker}`);
  assert.equal(body.data.providerName, `Provider ${marker}`);

  const rows = await db
    .select({
      actorEmployeeId: opsAuditLogs.actorEmployeeId,
      detail: opsAuditLogs.detail,
    })
    .from(opsAuditLogs)
    .where(
      and(
        eq(opsAuditLogs.action, "employee_api_key.reveal"),
        eq(opsAuditLogs.targetId, String(createdBoundKeyId)),
      ),
    );
  assert.equal(rows.length, 1, "admin reveal did not create exactly one audit record");
  assert.equal(rows[0].actorEmployeeId, admin.id);
  assert(isRecord(rows[0].detail));
  assert.equal(rows[0].detail.employeeId, employee.id);
  assert.equal(rows[0].detail.productLineId, requiredProductLine("grant"));
  assert.equal(rows[0].detail.productLineCode, `grant_${marker}`);
  assert.equal(rows[0].detail.providerCode, `provider_${marker}`);
  assert.equal(rows[0].detail.protocol, "openai_chat");
  assert.equal(JSON.stringify(rows[0].detail).includes(createdPlaintextKey), false);
}

function databaseErrorInfo(error: unknown): {
  code?: string;
  constraint?: string;
  column?: string;
  message: string;
} {
  if (!isRecord(error)) return { message: String(error) };
  return {
    code: typeof error.code === "string" ? error.code : undefined,
    constraint: typeof error.constraint_name === "string"
      ? error.constraint_name
      : typeof error.constraint === "string"
        ? error.constraint
        : undefined,
    column: typeof error.column_name === "string"
      ? error.column_name
      : typeof error.column === "string"
        ? error.column
        : undefined,
    message: typeof error.message === "string" ? error.message : String(error),
  };
}

async function expectDatabaseError(
  operation: () => Promise<unknown>,
  expectedCode: string,
  expectedConstraint?: string,
  expectedColumn?: string,
): Promise<void> {
  let caught: unknown = null;
  try {
    await operation();
  } catch (error) {
    caught = error;
  }
  assert(
    caught,
    `database operation unexpectedly bypassed ${expectedConstraint ?? expectedColumn ?? expectedCode}`,
  );
  const info = databaseErrorInfo(caught);
  assert.equal(info.code, expectedCode, info.message);
  if (expectedConstraint) assert.equal(info.constraint, expectedConstraint, info.message);
  if (expectedColumn) assert.equal(info.column, expectedColumn, info.message);
}

async function assertDatabaseInvariants(): Promise<void> {
  const employeeId = requiredUser("employee").id;

  const keyWithoutLine = generateApiKey();
  await expectDatabaseError(
    () => sql`
      insert into employee_api_keys (
        employee_id, name, key_prefix, key_hash, key_encrypted, protocol, product_line_id
      ) values (
        ${employeeId}, ${`missing channel ${marker}`}, ${keyWithoutLine.prefix},
        ${keyWithoutLine.hash}, ${encryptEmployeeApiKey(keyWithoutLine.raw)},
        'openai_chat', null
      )
    `,
    "23502",
    undefined,
    "product_line_id",
  );

  const keyWithoutEncryptedCopy = generateApiKey();
  await expectDatabaseError(
    () => sql`
      insert into employee_api_keys (
        employee_id, name, key_prefix, key_hash, key_encrypted, protocol, product_line_id
      ) values (
        ${employeeId}, ${`missing encrypted copy ${marker}`}, ${keyWithoutEncryptedCopy.prefix},
        ${keyWithoutEncryptedCopy.hash}, null, 'openai_chat', ${requiredProductLine("public")}
      )
    `,
    "23502",
    undefined,
    "key_encrypted",
  );

  assert(fkRestrictedKeyId, "FK-restricted API Key fixture missing");
  const fkLineId = requiredProductLine("fk-only");
  await expectDatabaseError(
    () => sql`delete from product_lines where id = ${fkLineId}`,
    "23503",
    "employee_api_keys_product_line_id_product_lines_id_fk",
  );
  const [stillPresent] = await db
    .select({ id: productLines.id })
    .from(productLines)
    .where(eq(productLines.id, fkLineId))
    .limit(1);
  assert.equal(stillPresent?.id, fkLineId, "restricted product line was deleted");
}

async function assertRoleTransitionRevocation(): Promise<void> {
  const employee = requiredUser("employee");
  const admin = requiredUser("admin");
  const fixtureKeyIds = [...created.apiKeyIds];
  assert(fixtureKeyIds.length >= 2, "role-transition test requires active API keys");

  const activeBefore = await db
    .select({ id: employeeApiKeys.id })
    .from(employeeApiKeys)
    .where(
      and(
        eq(employeeApiKeys.employeeId, employee.id),
        eq(employeeApiKeys.status, "active"),
        inArray(employeeApiKeys.id, fixtureKeyIds),
      ),
    );
  assert.equal(activeBefore.length, fixtureKeyIds.length);

  const toAuditor = await app!.inject({
    method: "PATCH",
    url: `/api/admin/users/${employee.id}`,
    headers: authHeaders(admin),
    payload: { role: "auditor" },
  });
  assert.equal(toAuditor.statusCode, 200);

  const [afterTransition, keysAfterTransition] = await Promise.all([
    db
      .select({ role: employees.role })
      .from(employees)
      .where(eq(employees.id, employee.id))
      .limit(1),
    db
      .select({ id: employeeApiKeys.id, status: employeeApiKeys.status })
      .from(employeeApiKeys)
      .where(inArray(employeeApiKeys.id, fixtureKeyIds)),
  ]);
  assert.equal(afterTransition[0]?.role, "auditor");
  assert.equal(keysAfterTransition.length, fixtureKeyIds.length);
  assert(keysAfterTransition.every((key) => key.status === "revoked"));

  const deniedMe = await app!.inject({
    method: "GET",
    url: "/api/me/api-keys",
    headers: authHeaders(employee),
  });
  assert.equal(deniedMe.statusCode, 403, "stale employee session bypassed live role enforcement");

  const revocationAuditRows = await db
    .select({ detail: opsAuditLogs.detail })
    .from(opsAuditLogs)
    .where(
      and(
        eq(opsAuditLogs.action, "user.update"),
        eq(opsAuditLogs.targetId, String(employee.id)),
      ),
    );
  const revocationAudit = revocationAuditRows.find(
    (row) => isRecord(row.detail) && row.detail.role === "auditor",
  );
  assert(revocationAudit && isRecord(revocationAudit.detail));
  assert.equal(revocationAudit.detail.previousRole, "employee");
  assert.equal(revocationAudit.detail.revokedApiKeyCount, fixtureKeyIds.length);

  const backToEmployee = await app!.inject({
    method: "PATCH",
    url: `/api/admin/users/${employee.id}`,
    headers: authHeaders(admin),
    payload: { role: "employee" },
  });
  assert.equal(backToEmployee.statusCode, 200);

  const [restoredUser, keysAfterRestore] = await Promise.all([
    db
      .select({ role: employees.role })
      .from(employees)
      .where(eq(employees.id, employee.id))
      .limit(1),
    db
      .select({ status: employeeApiKeys.status })
      .from(employeeApiKeys)
      .where(inArray(employeeApiKeys.id, fixtureKeyIds)),
  ]);
  assert.equal(restoredUser[0]?.role, "employee");
  assert.equal(keysAfterRestore.length, fixtureKeyIds.length);
  assert(
    keysAfterRestore.every((key) => key.status === "revoked"),
    "switching back to employee reactivated a revoked API Key",
  );
}

async function deleteTrackedIds(
  ids: number[],
  remove: (uniqueIds: number[]) => Promise<unknown>,
): Promise<void> {
  const uniqueIds = [...new Set(ids)];
  if (uniqueIds.length > 0) await remove(uniqueIds);
}

async function cleanupFixtures(): Promise<void> {
  const employeeIds = [...new Set(created.employeeIds)];
  if (employeeIds.length > 0) {
    await db.delete(opsAuditLogs).where(inArray(opsAuditLogs.actorEmployeeId, employeeIds));
  }
  await deleteTrackedIds(created.grantIds, (ids) =>
    db.delete(credentialEmployeeGrants).where(inArray(credentialEmployeeGrants.id, ids)),
  );
  await deleteTrackedIds(created.apiKeyIds, (ids) =>
    db.delete(employeeApiKeys).where(inArray(employeeApiKeys.id, ids)),
  );
  await deleteTrackedIds(created.credentialIds, (ids) =>
    db.delete(upstreamCredentials).where(inArray(upstreamCredentials.id, ids)),
  );
  await deleteTrackedIds(created.productLineIds, (ids) =>
    db.delete(productLines).where(inArray(productLines.id, ids)),
  );
  await deleteTrackedIds(created.providerIds, (ids) =>
    db.delete(providers).where(inArray(providers.id, ids)),
  );
  await deleteTrackedIds(created.employeeIds, (ids) =>
    db.delete(employees).where(inArray(employees.id, ids)),
  );
}

async function main(): Promise<{ database: string }> {
  const database = await assertMigratedDatabase();
  await createUsers();
  await createChannelFixtures();
  await createDirectApiKeyFixtures();

  app = await buildApp();
  await app.ready();

  await assertStrictMeRoleBoundary();
  await assertUpstreamChannelMetadata();
  await assertCreateValidationAndBinding();
  await assertAdminRevealMetadataAndAudit();
  await assertDatabaseInvariants();
  await assertRoleTransitionRevocation();

  return { database };
}

let primaryError: unknown = null;
let result: { database: string } | null = null;
try {
  result = await main();
} catch (error) {
  primaryError = error;
} finally {
  const cleanupErrors: unknown[] = [];
  try {
    const appToClose = app as FastifyInstance | null;
    if (appToClose) await appToClose.close();
  } catch (error) {
    cleanupErrors.push(error);
  }
  try {
    await cleanupFixtures();
  } catch (error) {
    cleanupErrors.push(error);
  }
  try {
    if (redis.status === "ready") await redis.quit();
    else if (redis.status !== "end") redis.disconnect();
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
      throw new AggregateError(
        [primaryError, ...cleanupErrors],
        "v0.0.1 API-key integration test and cleanup failed",
      );
    }
    throw primaryError;
  }
  if (cleanupErrors.length > 0) {
    throw new AggregateError(cleanupErrors, "v0.0.1 API-key fixture cleanup failed");
  }
}

assert(result, "integration test completed without a result");
console.log(
  JSON.stringify(
    {
      ok: true,
      database: result.database,
      marker,
      assertions: {
        strictMeRoleBoundary: true,
        upstreamChannelVisibilityAndRedaction: true,
        credentialStatusAndWeightFiltering: true,
        boundKeyCreationAndOneTimeEmployeePlaintext: true,
        adminRevealMetadataNoStoreAndAudit: true,
        databaseNotNullAndRestrictFk: true,
        roleTransitionRevocation: true,
      },
      cleanup: "completed",
    },
    null,
    2,
  ),
);
