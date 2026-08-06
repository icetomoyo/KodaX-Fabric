import assert from "node:assert/strict";
import test from "node:test";
import type {
  AvailableRelayCredential,
  AvailableRelayModelRoute,
} from "../src/lib/relay/routing.js";

process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:5432/test";
process.env.REDIS_URL ??= "redis://127.0.0.1:6379/15";
process.env.JWT_SECRET ??= "unit-test-jwt-secret";
process.env.CREDENTIAL_ENCRYPT_KEY ??= "unit-test-credential-secret";

const {
  filterRelayItemsToProductLine,
  resolveRelayCandidatesFromSnapshot,
} = await import("../src/lib/relay/routing.js");
const { isValidRelayProductLineId } = await import("../src/lib/relay/types.js");
function credential(
  credentialId: number,
  productLineId: number,
  overrides: Partial<AvailableRelayCredential> = {},
): AvailableRelayCredential {
  return {
    credentialId,
    credentialSuffix: String(credentialId),
    secretEncrypted: "encrypted",
    credentialPriority: 0,
    credentialWeight: 100,
    credentialStatus: "active",
    coolUntil: null,
    meta: { discoveredModels: ["shared-model"] },
    productLineId,
    productType: "api",
    retryPolicy: null,
    providerCode: `provider-${productLineId}`,
    authStyle: "bearer",
    supportedProtocols: ["openai_chat", "anthropic_messages"],
    baseUrl: `https://pl-${productLineId}.example.test/v1`,
    ...overrides,
  };
}

function route(
  routeId: number,
  productLineId: number,
  overrides: Partial<AvailableRelayModelRoute> = {},
): AvailableRelayModelRoute {
  return {
    routeId,
    productLineId,
    upstreamModel: `upstream-${routeId}`,
    routePriority: 0,
    routeWeight: 100,
    ...overrides,
  };
}

test("relay API-key product-line invariant accepts only positive safe integers", () => {
  assert.equal(isValidRelayProductLineId(9), true);
  assert.equal(isValidRelayProductLineId(null), false);
  assert.equal(isValidRelayProductLineId(0), false);
  assert.equal(isValidRelayProductLineId(-1), false);
  assert.equal(isValidRelayProductLineId(1.5), false);
  assert.equal(isValidRelayProductLineId(Number.MAX_SAFE_INTEGER + 1), false);
});

test("product line scopes raw items before routing and ranking", () => {
  const items = [
    { productLineId: 1, id: "a" },
    { productLineId: 2, id: "b" },
  ];
  assert.deepEqual(filterRelayItemsToProductLine(items, 1), [items[0]]);
  assert.deepEqual(filterRelayItemsToProductLine(items, 2), [items[1]]);
  assert.deepEqual(filterRelayItemsToProductLine(items, 0), []);
});

test("routing fails closed when an invalid product line bypasses middleware", () => {
  const result = resolveRelayCandidatesFromSnapshot(
    [credential(11, 1), credential(22, 2)],
    [route(100, 1), route(200, 2)],
    "shared-model",
    "openai_chat",
    0,
  );

  assert.deepEqual(result.candidates, []);
  assert.equal(result.unavailableReason, "bound_channel_unavailable");
});

test("an explicit route in another channel cannot suppress transparent fallback", () => {
  const credentials = [credential(11, 1), credential(22, 2)];
  const routes = [route(200, 2)];

  const result = resolveRelayCandidatesFromSnapshot(
    credentials,
    routes,
    "shared-model",
    "openai_chat",
    1,
  );
  assert.equal(result.unavailableReason, null);
  assert.deepEqual(result.candidates.map((item) => item.productLineId), [1]);
  assert.equal(result.candidates[0]?.routeId, null);
});

test("credentials without an explicit protocol are never scheduled", () => {
  const result = resolveRelayCandidatesFromSnapshot(
    [credential(11, 1, { supportedProtocols: [] })],
    [route(100, 1)],
    "shared-model",
    "openai_chat",
    1,
  );

  assert.deepEqual(result.candidates, []);
  assert.equal(result.unavailableReason, "unavailable");
});

test("a bound enabled zero-weight route suppresses transparent fallback", () => {
  const result = resolveRelayCandidatesFromSnapshot(
    [credential(11, 1)],
    [route(100, 1, { routeWeight: 0 })],
    "shared-model",
    "openai_chat",
    1,
  );

  assert.deepEqual(result.candidates, []);
  assert.equal(result.unavailableReason, "unavailable");
});

test("bound retries contain only distinct credentials from the target channel", () => {
  const result = resolveRelayCandidatesFromSnapshot(
    [credential(11, 1), credential(12, 1), credential(22, 2)],
    [route(100, 1), route(200, 2)],
    "shared-model",
    "openai_chat",
    1,
  );

  assert.equal(result.candidates.length, 2);
  assert.deepEqual(new Set(result.candidates.map((item) => item.productLineId)), new Set([1]));
  assert.deepEqual(
    new Set(result.candidates.map((item) => item.credentialId)),
    new Set([11, 12]),
  );
});

test("only effective cooling in the bound channel produces 429 classification", () => {
  const coolUntil = new Date(Date.now() + 60_000);
  const result = resolveRelayCandidatesFromSnapshot(
    [
      credential(11, 1, { credentialStatus: "cooling", coolUntil }),
      credential(22, 2),
    ],
    [route(100, 1), route(200, 2)],
    "shared-model",
    "openai_chat",
    1,
  );

  assert.deepEqual(result.candidates, []);
  assert.equal(result.unavailableReason, "cooling");
  assert.ok((result.retryAfterSeconds ?? 0) > 0);
});

test("cooling mixed with a permanently unavailable credential produces 503 classification", () => {
  const result = resolveRelayCandidatesFromSnapshot(
    [
      credential(11, 1, {
        credentialStatus: "cooling",
        coolUntil: new Date(Date.now() + 60_000),
      }),
      credential(12, 1, { credentialStatus: "auto_disabled" }),
    ],
    [route(100, 1)],
    "shared-model",
    "openai_chat",
    1,
  );

  assert.deepEqual(result.candidates, []);
  assert.equal(result.unavailableReason, "unavailable");
  assert.equal(result.retryAfterSeconds, null);
});

test("arbitrary client models are forwarded unchanged without discovery metadata", () => {
  const transparent = resolveRelayCandidatesFromSnapshot(
    [credential(11, 1, { meta: { discoveredModels: [] } })],
    [],
    "gpt-5.6",
    "openai_chat",
    1,
  );
  assert.equal(transparent.unavailableReason, null);
  assert.equal(transparent.candidates.length, 1);
  assert.equal(transparent.candidates[0]?.clientModel, "gpt-5.6");
  assert.equal(transparent.candidates[0]?.upstreamModel, "gpt-5.6");
  assert.equal(transparent.candidates[0]?.routeId, null);

  const unavailable = resolveRelayCandidatesFromSnapshot(
    [],
    [],
    "any-model",
    "openai_chat",
    1,
  );
  assert.equal(unavailable.unavailableReason, "unavailable");
});

test("transparent fallback includes every active positive compatible credential", () => {
  const result = resolveRelayCandidatesFromSnapshot(
    [
      credential(11, 1, { meta: null }),
      credential(12, 1, { meta: { discoveredModels: ["different-model"] } }),
      credential(13, 1, { credentialStatus: "disabled" }),
      credential(14, 1, { credentialWeight: 0 }),
      credential(15, 1, { supportedProtocols: ["anthropic_messages"] }),
    ],
    [],
    "glm-5.2",
    "openai_chat",
    1,
  );

  assert.equal(result.unavailableReason, null);
  assert.deepEqual(
    new Set(result.candidates.map((candidate) => candidate.credentialId)),
    new Set([11, 12]),
  );
  assert.ok(result.candidates.every((candidate) => candidate.upstreamModel === "glm-5.2"));
});
