import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";

process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:5432/test";
process.env.REDIS_URL ??= "redis://127.0.0.1:6379/15";
process.env.JWT_SECRET ??= "unit-test-jwt-secret";
process.env.CREDENTIAL_ENCRYPT_KEY ??= "unit-test-credential-secret";

const {
  collectSubmitableChannels,
} = await import("../src/lib/channel-credential-submit.js");
const {
  collectSubmitableChannelIds,
  collectSubmitableSeats,
  normalizeSeatTag,
  planBulkChannelSeats,
  planChannelSeatCreate,
  planSeatCapacity,
  SEAT_CHANNEL_FULL_MESSAGE,
  SEAT_ALREADY_SUBMITTED_MESSAGE,
  SEAT_CONFLICT_MESSAGE,
  SEAT_REQUIRED_MESSAGE,
  SEAT_SUPER_ADMIN_MESSAGE,
  SEAT_TAG_INVALID_MESSAGE,
  seatCreateError,
} = await import("../src/lib/channel-seats.js");
const { adminChannelSeatRoutes } = await import("../src/routes/admin/channel-seats.js");

test("seat create plan rejects super admin, missing rows, duplicates, and invalid tags", () => {
  assert.deepEqual(
    planChannelSeatCreate({
      employeeExists: true,
      employeeRole: "employee",
      channelExists: true,
      alreadySeated: false,
    }),
    { kind: "accepted" },
  );
  assert.equal(
    planChannelSeatCreate({
      employeeExists: true,
      employeeRole: "admin",
      channelExists: true,
      alreadySeated: false,
    }).kind,
    "super_admin",
  );
  assert.equal(
    planChannelSeatCreate({
      employeeExists: false,
      employeeRole: null,
      channelExists: true,
      alreadySeated: false,
    }).kind,
    "employee_missing",
  );
  assert.equal(
    planChannelSeatCreate({
      employeeExists: true,
      employeeRole: "employee",
      channelExists: false,
      alreadySeated: false,
    }).kind,
    "channel_missing",
  );
  assert.equal(
    planChannelSeatCreate({
      employeeExists: true,
      employeeRole: "org_admin",
      channelExists: true,
      alreadySeated: true,
    }).kind,
    "conflict",
  );
  assert.equal(
    planChannelSeatCreate({
      employeeExists: true,
      employeeRole: "employee",
      channelExists: true,
      alreadySeated: false,
      tagValid: false,
    }).kind,
    "tag_invalid",
  );
  assert.equal(seatCreateError("conflict").status, 409);
  assert.equal(seatCreateError("conflict").message, SEAT_CONFLICT_MESSAGE);
  assert.equal(seatCreateError("super_admin").message, SEAT_SUPER_ADMIN_MESSAGE);
  assert.equal(seatCreateError("tag_invalid").message, SEAT_TAG_INVALID_MESSAGE);
});

test("channel seat capacity accepts unconfigured channels and rejects overflow", () => {
  assert.deepEqual(
    planSeatCapacity({ seatCount: 0, registered: 3, adding: 2 }),
    { kind: "accepted", remaining: Number.POSITIVE_INFINITY },
  );
  assert.deepEqual(
    planSeatCapacity({ seatCount: 5, registered: 3, adding: 2 }),
    { kind: "accepted", remaining: 2 },
  );
  assert.deepEqual(
    planSeatCapacity({ seatCount: 5, registered: 5, adding: 1 }),
    { kind: "full", remaining: 0 },
  );
  assert.deepEqual(
    planSeatCapacity({ seatCount: 5, registered: 4, adding: 2 }),
    { kind: "full", remaining: 1 },
  );
  assert.match(SEAT_CHANNEL_FULL_MESSAGE, /席位已满/);
});

test("seat tags trim and reject overlong identifiers", () => {
  assert.equal(normalizeSeatTag(undefined), "");
  assert.equal(normalizeSeatTag("  备用  "), "备用");
  assert.equal(normalizeSeatTag("x".repeat(33)), null);
  assert.equal(normalizeSeatTag("x".repeat(32)), "x".repeat(32));
});

test("submitable channels shrink to seated product lines", () => {
  const rows = [
    {
      id: 1,
      name: "GLM",
      code: "api",
      productType: "coding_plan" as const,
      status: "active",
      providerCode: "glm",
      providerName: "智谱",
      providerStatus: "active",
    },
    {
      id: 2,
      name: "自定义",
      code: "custom",
      productType: "api" as const,
      status: "active",
      providerCode: "custom",
      providerName: "自定义",
      providerStatus: "active",
    },
  ];
  const seated = collectSubmitableChannelIds([1]);
  assert.deepEqual(
    collectSubmitableChannels(rows, seated).map((row) => row.id),
    [1],
  );
  assert.deepEqual(collectSubmitableChannels(rows, collectSubmitableChannelIds([])), []);
});

test("submitable seats keep unsubmitted tagged seats on active channels", () => {
  const rows = [
    {
      id: 1,
      name: "GLM",
      code: "api",
      productType: "coding_plan" as const,
      status: "active",
      providerCode: "glm",
      providerName: "智谱",
      providerStatus: "active",
    },
    {
      id: 2,
      name: "停用",
      code: "off",
      productType: "api" as const,
      status: "disabled",
      providerCode: "glm",
      providerName: "智谱",
      providerStatus: "active",
    },
  ];
  const seats = collectSubmitableSeats(rows, [
    { id: 11, productLineId: 1, tag: "B", credentialId: null },
    { id: 10, productLineId: 1, tag: "", credentialId: null },
    { id: 12, productLineId: 1, tag: "done", credentialId: 99 },
    { id: 13, productLineId: 2, tag: "", credentialId: null },
  ]);
  assert.deepEqual(
    seats.map((seat) => ({ seatId: seat.seatId, tag: seat.tag, productLineId: seat.productLineId })),
    [
      { seatId: 10, tag: "", productLineId: 1 },
      { seatId: 11, tag: "B", productLineId: 1 },
    ],
  );
});

test("bulk seat plan matches phones, skips duplicates and super-admins, fails missing accounts", () => {
  const employeesByPhone = new Map([
    ["13800138000", { id: 1, name: "张三", role: "employee", status: "active" }],
    ["13900139000", { id: 2, name: "李四", role: "admin", status: "active" }],
    ["13700137000", { id: 3, name: "王五", role: "employee", status: "disabled" }],
    ["13600136000", { id: 4, name: "赵六", role: "org_admin", status: "active" }],
  ]);
  const plan = planBulkChannelSeats({
    people: [
      { name: "张三", phone: "13800138000" },
      { name: "李四", phone: "13900139000" },
      { name: "王五", phone: "13700137000" },
      { name: "赵六", phone: "13600136000" },
      { name: "钱七", phone: "13500135000" },
      { name: "张三重复", phone: "13800138000" },
    ],
    employeesByPhone,
    seatedEmployeeIds: new Set([4]),
  });
  assert.deepEqual(
    plan.map((item) => item.kind),
    ["create", "skip", "fail", "skip", "fail", "skip"],
  );
  assert.equal(plan[0]?.kind === "create" && plan[0].employeeId, 1);
  assert.equal(plan[1]?.kind === "skip" && plan[1].reason, "super_admin");
  assert.equal(plan[2]?.kind === "fail" && plan[2].reason, "inactive");
  assert.equal(plan[3]?.kind === "skip" && plan[3].reason, "duplicate");
  assert.equal(plan[4]?.kind === "fail" && plan[4].reason, "not_found");
  assert.equal(plan[5]?.kind === "skip" && plan[5].reason, "duplicate");
});

test("seat copy is the product language", () => {
  assert.match(SEAT_REQUIRED_MESSAGE, /席位/);
  assert.match(SEAT_ALREADY_SUBMITTED_MESSAGE, /已提交/);
});

test("admin seat routes exist and require a session", async () => {
  const app = Fastify();
  await app.register(adminChannelSeatRoutes);
  const list = await app.inject({ method: "GET", url: "/api/admin/channel-seats" });
  assert.equal(list.statusCode, 401);
  const create = await app.inject({
    method: "POST",
    url: "/api/admin/channel-seats",
    payload: { employeeId: 1, productLineId: 1, tag: "备用" },
  });
  assert.equal(create.statusCode, 401);
  const bulk = await app.inject({
    method: "POST",
    url: "/api/admin/channel-seats/bulk",
    payload: { productLineId: 1, people: [{ name: "张三", phone: "13800138000" }] },
  });
  assert.equal(bulk.statusCode, 401);
  const removed = await app.inject({
    method: "DELETE",
    url: "/api/admin/channel-seats/1",
  });
  assert.equal(removed.statusCode, 401);
  await app.close();
});

test("seat registry and personal-center gate use the product language", async () => {
  const { readFileSync } = await import("node:fs");
  const { dirname, resolve } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const seatsView = readFileSync(resolve(root, "web/src/views/admin/SeatsView.vue"), "utf8");
  const profile = readFileSync(resolve(root, "web/src/views/admin/ProfileView.vue"), "utf8");
  const credentials = readFileSync(resolve(root, "web/src/views/admin/CredentialsView.vue"), "utf8");
  const me = readFileSync(resolve(root, "server/src/routes/me.ts"), "utf8");
  const adminSeats = readFileSync(resolve(root, "server/src/routes/admin/channel-seats.ts"), "utf8");

  const channelFields = readFileSync(resolve(root, "web/src/views/admin/ChannelConfigFields.vue"), "utf8");
  assert.match(channelFields, /席位数量/);
  assert.match(channelFields, /v-model="seatCount"/);
  assert.match(channelFields, /标签/);
  assert.match(seatsView, /class="split-layout"/);
  assert.match(seatsView, /from ["']@\/lib\/channel-display["']/);
  assert.match(seatsView, /channelTitle/);
  assert.doesNotMatch(seatsView, /providerName \} \/ \{\{ channel\.name/);
  assert.match(credentials, /from ["']@\/lib\/channel-display["']/);
  assert.match(seatsView, /registeredSeatLabel/);
  assert.match(seatsView, /批量添加/);
  assert.match(seatsView, /登记席位/);
  assert.match(seatsView, /标签/);
  assert.match(seatsView, /parseBulkRegisterText/);
  assert.match(seatsView, /\/api\/admin\/channel-seats\/bulk/);
  assert.match(seatsView, /回收/);
  assert.match(seatsView, /销毁已提交的渠道 KEY/);
  assert.doesNotMatch(seatsView, /class="page-title"/);
  assert.match(profile, /没有席位，无需提交渠道 KEY/);
  assert.match(profile, /channelKeyForm.seatId/);
  assert.match(profile, /seatOptionLabel/);
  assert.match(credentials, /pageKind === 'channels'/);
  assert.match(credentials, /pageKind === 'keys'/);
  assert.match(me, /SEAT_REQUIRED_MESSAGE/);
  assert.match(me, /seatId/);
  assert.match(me, /for\("update"\)/);
  assert.match(adminSeats, /tx.delete\(upstreamCredentials\)/);
  assert.match(adminSeats, /channel-seats\/bulk/);
});
