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
  planChannelSeatCreate,
  planChannelSeatUpdate,
  planSeatCapacity,
  SEAT_CHANNEL_FULL_MESSAGE,
  SEAT_ALREADY_SUBMITTED_MESSAGE,
  SEAT_CONFLICT_MESSAGE,
  SEAT_MISSING_MESSAGE,
  SEAT_REQUIRED_MESSAGE,
  SEAT_TAG_INVALID_MESSAGE,
  seatCreateError,
  seatUpdateError,
} = await import("../src/lib/channel-seats.js");
const { adminChannelSeatRoutes } = await import("../src/routes/admin/channel-seats.js");

test("seat create plan accepts super admin and rejects missing rows, duplicates, and invalid tags", () => {
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
    "accepted",
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
  assert.equal(seatCreateError("tag_invalid").message, SEAT_TAG_INVALID_MESSAGE);
});

test("seat update plan accepts employee or tag changes and rejects missing or conflicting seats", () => {
  assert.deepEqual(
    planChannelSeatUpdate({
      seatExists: true,
      employeeExists: true,
      alreadySeated: false,
      nextEmployeeId: 2,
      currentEmployeeId: 1,
      nextTag: "备用",
      currentTag: "",
      tagValid: true,
    }),
    { kind: "accepted", employeeId: 2, tag: "备用" },
  );
  assert.equal(
    planChannelSeatUpdate({
      seatExists: true,
      employeeExists: true,
      alreadySeated: false,
      nextEmployeeId: 1,
      currentEmployeeId: 1,
      nextTag: "",
      currentTag: "",
      tagValid: true,
    }).kind,
    "unchanged",
  );
  assert.equal(
    planChannelSeatUpdate({
      seatExists: false,
      employeeExists: true,
      alreadySeated: false,
      nextEmployeeId: 1,
      currentEmployeeId: 1,
      nextTag: "",
      currentTag: "",
      tagValid: true,
    }).kind,
    "not_found",
  );
  assert.equal(
    planChannelSeatUpdate({
      seatExists: true,
      employeeExists: false,
      alreadySeated: false,
      nextEmployeeId: 9,
      currentEmployeeId: 1,
      nextTag: "",
      currentTag: "",
      tagValid: true,
    }).kind,
    "employee_missing",
  );
  assert.equal(
    planChannelSeatUpdate({
      seatExists: true,
      employeeExists: true,
      alreadySeated: true,
      nextEmployeeId: 2,
      currentEmployeeId: 1,
      nextTag: "",
      currentTag: "",
      tagValid: true,
    }).kind,
    "conflict",
  );
  assert.equal(
    planChannelSeatUpdate({
      seatExists: true,
      employeeExists: true,
      alreadySeated: false,
      nextEmployeeId: 1,
      currentEmployeeId: 1,
      nextTag: "",
      currentTag: "",
      tagValid: false,
    }).kind,
    "tag_invalid",
  );
  assert.equal(seatUpdateError("not_found").message, SEAT_MISSING_MESSAGE);
  assert.equal(seatUpdateError("conflict").status, 409);
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
  const removed = await app.inject({
    method: "DELETE",
    url: "/api/admin/channel-seats/1",
  });
  assert.equal(removed.statusCode, 401);
  const updated = await app.inject({
    method: "PATCH",
    url: "/api/admin/channel-seats/1",
    payload: { tag: "备用" },
  });
  assert.equal(updated.statusCode, 401);
  await app.close();
});

test("seat registry and personal-center gate use the product language", async () => {
  const { readFileSync } = await import("node:fs");
  const { dirname, resolve } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const profile = readFileSync(resolve(root, "web/src/views/admin/ProfileView.vue"), "utf8");
  const credentials = readFileSync(resolve(root, "web/src/views/admin/CredentialsView.vue"), "utf8");
  const me = readFileSync(resolve(root, "server/src/routes/me.ts"), "utf8");
  const adminSeats = readFileSync(resolve(root, "server/src/routes/admin/channel-seats.ts"), "utf8");

  const channelFields = readFileSync(resolve(root, "web/src/views/admin/ChannelConfigFields.vue"), "utf8");
  assert.match(channelFields, /席位数量/);
  assert.match(channelFields, /v-model="seatCount"/);
  assert.match(channelFields, /标签/);
  assert.match(credentials, /from ["']@\/lib\/channel-display["']/);
  assert.match(profile, /没有席位，无需提交渠道 KEY/);
  assert.match(profile, /channelKeyForm.seatId/);
  assert.match(profile, /seatOptionLabel/);
  assert.match(credentials, /pageKind === 'channels'/);
  assert.match(credentials, /pageKind === 'keys'/);
  assert.match(me, /SEAT_REQUIRED_MESSAGE/);
  assert.match(me, /seatId/);
  assert.match(me, /for\("update"\)/);
  assert.match(adminSeats, /tx.delete\(upstreamCredentials\)/);
  assert.doesNotMatch(adminSeats, /channel-seats\/bulk/);
  assert.match(adminSeats, /app.patch\(/);
  assert.match(adminSeats, /channel_seat.update/);

  const tempChannels = readFileSync(resolve(root, "web/src/views/admin/TempChannelsView.vue"), "utf8");
  assert.match(tempChannels, /class="split-layout"/);
  assert.match(tempChannels, /按姓名查找/);
  assert.match(tempChannels, /只看未提交/);
  assert.match(tempChannels, /是否提交 KEY/);
  assert.match(tempChannels, /已提交/);
  assert.match(tempChannels, /onlyUnsubmitted/);
  assert.match(tempChannels, /useTablePage/);
  assert.match(tempChannels, /el-pagination/);
  assert.match(tempChannels, /pagedSeats/);
  assert.match(tempChannels, /openEditSeat/);
  assert.match(tempChannels, /removeSeat/);
  assert.match(tempChannels, /openEditKey/);
  assert.match(tempChannels, /removeKey/);
  assert.match(tempChannels, /回收/);
  assert.match(tempChannels, /销毁已提交的渠道 KEY/);
  assert.doesNotMatch(tempChannels, /class="page-title"/);
  assert.match(tempChannels, /销毁已提交的渠道 KEY/);
  assert.match(tempChannels, /title="编辑席位"/);
  assert.match(tempChannels, /title="编辑 KEY"/);
  assert.match(tempChannels, /\/api\/admin\/channel-seats\/\$\{editSeatForm.id\}/);
  assert.match(tempChannels, /\/api\/admin\/credentials\/\$\{editKeyForm.id\}/);
});
