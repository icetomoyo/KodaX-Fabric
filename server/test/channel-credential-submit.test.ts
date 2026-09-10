import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";

process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:5432/test";
process.env.REDIS_URL ??= "redis://127.0.0.1:6379/15";
process.env.JWT_SECRET ??= "unit-test-jwt-secret";
process.env.CREDENTIAL_ENCRYPT_KEY ??= "unit-test-credential-secret";

const {
  buildEmployeeSubmittedCredentialLabel,
  collectSubmitableChannels,
  isEmployeeSubmittedCredentialMeta,
  partitionCredentialSubmitRoster,
  planEmployeeChannelCredentialSubmit,
  presentEmployeeSubmittedCredentials,
  submittedByEmployeeIdFromMeta,
} = await import("../src/lib/channel-credential-submit.js");
const { meRoutes } = await import("../src/routes/me.js");

const openaiChatConfig = {
  openai_chat: { baseUrl: "https://example.test/v1", authStyle: "bearer" as const },
};

function channelRow(
  overrides: Partial<Parameters<typeof collectSubmitableChannels>[0][number]> = {},
) {
  return {
    id: 1,
    name: "GLM Coding Plan",
    code: "coding_plan",
    productType: "coding_plan" as const,
    status: "active",
    providerCode: "glm",
    providerName: "智谱",
    providerStatus: "active",
    ...overrides,
  };
}

test("submitable channels keep only active product lines on active providers", () => {
  const channels = collectSubmitableChannels([
    channelRow({ id: 3, name: "Disabled line", status: "disabled" }),
    channelRow({ id: 2, name: "Dead provider", providerStatus: "disabled" }),
    channelRow({ id: 4, name: "API", code: "api", productType: "api" }),
    channelRow(),
  ]);

  assert.deepEqual(
    channels.map((channel) => channel.id),
    [1, 4],
  );
  assert.deepEqual(channels[0], {
    id: 1,
    name: "GLM Coding Plan",
    code: "coding_plan",
    productType: "coding_plan",
    providerCode: "glm",
    providerName: "智谱",
  });
  assert.equal(JSON.stringify(channels).includes("status"), false);
  assert.equal(JSON.stringify(channels).includes("secret"), false);
  assert.equal(JSON.stringify(channels).includes("baseUrl"), false);
});

test("employee submitted labels name the channel and the submitter without overflowing", () => {
  assert.equal(
    buildEmployeeSubmittedCredentialLabel("GLM Coding Plan", "张三"),
    "GLM Coding Plan · 张三",
  );
  const longChannel = "渠".repeat(180);
  const longName = "员".repeat(40);
  const label = buildEmployeeSubmittedCredentialLabel(longChannel, longName);
  assert.equal(label.length, 200);
  assert.equal(label.endsWith(` · ${longName}`), true);
  assert.equal(label.includes("渠"), true);
});

test("employee submit inherits channel protocols and rejects unsafe or duplicate secrets", () => {
  const accepted = planEmployeeChannelCredentialSubmit({
    productLineStatus: "active",
    providerStatus: "active",
    channelName: "GLM Coding Plan",
    employeeName: "李四",
    protocolConfigs: openaiChatConfig,
    existingCredentials: [],
    existingSecrets: ["already-in-pool"],
    unreadableCredentialIds: [],
    secret: "brand-new-upstream-key",
  });
  assert.deepEqual(accepted, {
    kind: "accepted",
    protocols: ["openai_chat"],
    label: "GLM Coding Plan · 李四",
  });

  assert.equal(
    planEmployeeChannelCredentialSubmit({
      productLineStatus: "disabled",
      providerStatus: "active",
      channelName: "GLM Coding Plan",
      employeeName: "李四",
      protocolConfigs: openaiChatConfig,
      existingCredentials: [],
      existingSecrets: [],
      unreadableCredentialIds: [],
      secret: "brand-new-upstream-key",
    }).kind,
    "channel_unavailable",
  );
  assert.equal(
    planEmployeeChannelCredentialSubmit({
      productLineStatus: "active",
      providerStatus: "disabled",
      channelName: "GLM Coding Plan",
      employeeName: "李四",
      protocolConfigs: openaiChatConfig,
      existingCredentials: [],
      existingSecrets: [],
      unreadableCredentialIds: [],
      secret: "brand-new-upstream-key",
    }).kind,
    "channel_unavailable",
  );
  assert.equal(
    planEmployeeChannelCredentialSubmit({
      productLineStatus: "active",
      providerStatus: "active",
      channelName: "GLM Coding Plan",
      employeeName: "李四",
      protocolConfigs: null,
      existingCredentials: [],
      existingSecrets: [],
      unreadableCredentialIds: [],
      secret: "brand-new-upstream-key",
    }).kind,
    "channel_protocol_unset",
  );
  assert.deepEqual(
    planEmployeeChannelCredentialSubmit({
      productLineStatus: "active",
      providerStatus: "active",
      channelName: "GLM Coding Plan",
      employeeName: "李四",
      protocolConfigs: openaiChatConfig,
      existingCredentials: [],
      existingSecrets: ["brand-new-upstream-key"],
      unreadableCredentialIds: [],
      secret: "brand-new-upstream-key",
    }),
    { kind: "existing_duplicate" },
  );
  assert.deepEqual(
    planEmployeeChannelCredentialSubmit({
      productLineStatus: "active",
      providerStatus: "active",
      channelName: "GLM Coding Plan",
      employeeName: "李四",
      protocolConfigs: openaiChatConfig,
      existingCredentials: [],
      existingSecrets: ["brand-new-upstream-key"],
      unreadableCredentialIds: [9],
      secret: "brand-new-upstream-key",
    }),
    { kind: "existing_secret_unreadable", credentialIds: [9] },
  );
});

test("employee submit never echoes the secret in the plan result", () => {
  const secret = "do-not-leak-this-secret";
  const result = planEmployeeChannelCredentialSubmit({
    productLineStatus: "active",
    providerStatus: "active",
    channelName: "GLM Coding Plan",
    employeeName: "李四",
    protocolConfigs: openaiChatConfig,
    existingCredentials: [],
    existingSecrets: [secret],
    unreadableCredentialIds: [],
    secret,
  });
  assert.equal(JSON.stringify(result).includes(secret), false);
});

test("employee submit history is scoped to the submitter and never includes secrets", () => {
  assert.equal(
    isEmployeeSubmittedCredentialMeta(
      { createdBy: "employee_submit", submittedByEmployeeId: 3 },
      3,
    ),
    true,
  );
  assert.equal(
    isEmployeeSubmittedCredentialMeta(
      { createdBy: "employee_submit", submittedByEmployeeId: 3 },
      9,
    ),
    false,
  );
  assert.equal(
    isEmployeeSubmittedCredentialMeta({ createdBy: "bulk_create" }, 3),
    false,
  );

  const secret = "do-not-leak-this-secret";
  const views = presentEmployeeSubmittedCredentials([
    {
      id: 12,
      productLineId: 1,
      productLineName: "GLM",
      providerName: "智谱",
      providerCode: "glm",
      label: "GLM · 赵云龙",
      secretSuffix: "key1",
      status: "cooling",
      coolUntil: new Date("2026-09-10T03:00:00.000Z"),
      createdAt: new Date("2026-09-10T02:00:00.000Z"),
    },
  ], new Date("2026-09-10T02:30:00.000Z"));
  assert.deepEqual(views, [
    {
      id: 12,
      productLineId: 1,
      productLineName: "GLM",
      providerName: "智谱",
      providerCode: "glm",
      label: "GLM · 赵云龙",
      secretSuffix: "key1",
      status: "cooling",
      createdAt: "2026-09-10T02:00:00.000Z",
    },
  ]);
  assert.equal(JSON.stringify(views).includes(secret), false);
  assert.equal(JSON.stringify(views).includes("secretEncrypted"), false);
});

test("admin submit roster splits employees who submitted from those who have not", () => {
  assert.equal(
    submittedByEmployeeIdFromMeta({ createdBy: "employee_submit", submittedByEmployeeId: 7 }),
    7,
  );
  assert.equal(submittedByEmployeeIdFromMeta({ createdBy: "bulk_create" }), null);

  const roster = partitionCredentialSubmitRoster(
    [
      { id: 3, name: "已交", phone: "13800000003", role: "employee", status: "active", enterpriseName: "海致" },
      { id: 4, name: "未交", phone: "13800000004", role: "employee", status: "active", enterpriseName: null },
    ],
    [
      {
        credentialId: 12,
        employeeId: 3,
        productLineId: 1,
        productLineName: "GLM",
        providerName: "智谱",
        secretSuffix: "ab12",
        status: "active",
        createdAt: "2026-09-10T02:00:00.000Z",
      },
    ],
  );
  assert.equal(roster.submitted.length, 1);
  assert.equal(roster.submitted[0]?.id, 3);
  assert.equal(roster.submitted[0]?.submissions.length, 1);
  assert.equal(roster.unsubmitted.length, 1);
  assert.equal(roster.unsubmitted[0]?.id, 4);
});

test("personal center exposes channel-key submit for every non-super-admin role", () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const profile = readFileSync(resolve(root, "web/src/views/admin/ProfileView.vue"), "utf8");
  assert.match(profile, /提交渠道 KEY/);
  assert.match(profile, /profileNavItems/);
  assert.match(profile, /canSubmitChannelKey/);
  assert.match(profile, /!auth\.isSuperAdmin/);
  assert.match(profile, /\/api\/me\/upstream-credential-channels/);
  assert.match(profile, /\/api\/me\/upstream-credentials/);
  assert.match(profile, /提交记录/);
  assert.doesNotMatch(profile, /\/api\/admin\/credentials\/bulk-create/);
});

test("upstream channel page exposes employee submit records for super-admin", () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const credentials = readFileSync(
    resolve(root, "web/src/views/admin/CredentialsView.vue"),
    "utf8",
  );
  assert.match(credentials, /渠道 KEY 提交记录/);
  assert.match(credentials, /\/api\/admin\/credential-submissions/);
  assert.match(credentials, /已提交/);
  assert.match(credentials, /未提交/);
});

test("me channel-key submit routes exist and reject anonymous callers", async () => {
  const app = Fastify();
  await app.register(meRoutes);
  await app.ready();
  try {
    assert.equal(
      app.hasRoute({ method: "GET", url: "/api/me/upstream-credential-channels" }),
      true,
    );
    assert.equal(
      app.hasRoute({ method: "POST", url: "/api/me/upstream-credentials" }),
      true,
    );
    assert.equal(
      app.hasRoute({ method: "GET", url: "/api/me/upstream-credentials" }),
      true,
    );
    const list = await app.inject({
      method: "GET",
      url: "/api/me/upstream-credential-channels",
    });
    const history = await app.inject({
      method: "GET",
      url: "/api/me/upstream-credentials",
    });
    const created = await app.inject({
      method: "POST",
      url: "/api/me/upstream-credentials",
      payload: { productLineId: 1, secret: "12345678" },
    });
    assert.equal(list.statusCode, 401);
    assert.equal(history.statusCode, 401);
    assert.equal(created.statusCode, 401);
  } finally {
    await app.close();
  }
});
