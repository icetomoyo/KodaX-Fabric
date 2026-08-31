import assert from "node:assert/strict";
import test from "node:test";
import type {
  KeyBindingCredentialInput,
  KeyBindingEmployeeInput,
  KeyBindingGrantInput,
  KeyBindingVirtualKeyInput,
} from "../src/lib/key-binding-graph.js";

process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:5432/test";
process.env.REDIS_URL ??= "redis://127.0.0.1:6379/15";
process.env.JWT_SECRET ??= "unit-test-jwt-secret";
process.env.CREDENTIAL_ENCRYPT_KEY ??= "unit-test-credential-secret";

const { buildKeyBindingGraph } = await import("../src/lib/key-binding-graph.js");

function employee(
  partial: Partial<KeyBindingEmployeeInput> & Pick<KeyBindingEmployeeInput, "id" | "name">,
): KeyBindingEmployeeInput {
  return {
    enterpriseId: 1,
    enterpriseName: "海致",
    teamId: 10,
    teamName: "平台",
    ...partial,
  };
}

function virtualKey(
  partial: Partial<KeyBindingVirtualKeyInput> &
    Pick<KeyBindingVirtualKeyInput, "id" | "employeeId" | "productLineId">,
): KeyBindingVirtualKeyInput {
  return {
    name: `vk-${partial.id}`,
    keyPrefix: `th-vk${partial.id}`,
    protocol: "openai_chat",
    productLineName: `渠道${partial.productLineId}`,
    teamId: 10,
    teamName: "平台",
    status: "active",
    ...partial,
  };
}

function credential(
  partial: Partial<KeyBindingCredentialInput> &
    Pick<KeyBindingCredentialInput, "id" | "productLineId">,
): KeyBindingCredentialInput {
  return {
    label: `glm-${partial.id}`,
    secretSuffix: String(partial.id).padStart(4, "0"),
    productLineName: `渠道${partial.productLineId}`,
    providerCode: "glm",
    providerName: "智谱",
    status: "active",
    supportedProtocols: ["openai_chat", "anthropic_messages"],
    ...partial,
  };
}

function grant(employeeId: number, credentialId: number): KeyBindingGrantInput {
  return { employeeId, credentialId };
}

function useEdges(graph: ReturnType<typeof buildKeyBindingGraph>) {
  return graph.edges
    .filter((edge) => edge.kind === "grant" || edge.kind === "pool")
    .map((edge) => `${edge.sourceId}->${edge.targetId}:${edge.kind}`)
    .sort();
}

function orgEdges(graph: ReturnType<typeof buildKeyBindingGraph>) {
  return graph.edges
    .filter((edge) => edge.kind === "org")
    .map((edge) => `${edge.sourceType}:${edge.sourceId}->${edge.targetType}:${edge.targetId}`)
    .sort();
}

test("org chain links enterprise to team to employee", () => {
  const graph = buildKeyBindingGraph({
    employees: [employee({ id: 1, name: "张三" })],
    virtualKeys: [virtualKey({ id: 11, employeeId: 1, productLineId: 100 })],
    credentials: [credential({ id: 21, productLineId: 100 })],
    grants: [],
  });

  assert.deepEqual(orgEdges(graph), [
    "enterprise:1->team:10",
    "team:10->employee:1",
  ]);
  assert.deepEqual(
    graph.teams.map((row) => row.id),
    [10],
  );
});

test("employee without a team hangs directly under the enterprise", () => {
  const graph = buildKeyBindingGraph({
    employees: [employee({ id: 1, name: "张三", teamId: null, teamName: null })],
    virtualKeys: [virtualKey({ id: 11, employeeId: 1, productLineId: 100 })],
    credentials: [credential({ id: 21, productLineId: 100 })],
    grants: [],
  });

  assert.deepEqual(orgEdges(graph), ["enterprise:1->employee:1"]);
  assert.deepEqual(graph.teams, []);
});

test("employees without usage default to the standard tier", () => {
  const graph = buildKeyBindingGraph({
    employees: [employee({ id: 1, name: "张三" })],
    virtualKeys: [virtualKey({ id: 11, employeeId: 1, productLineId: 100 })],
    credentials: [credential({ id: 21, productLineId: 100 })],
    grants: [],
  });
  assert.equal(graph.employees[0]?.usageTier, "standard");
});

test("employee owns each of their virtual keys", () => {
  const graph = buildKeyBindingGraph({
    employees: [employee({ id: 1, name: "张三" })],
    virtualKeys: [
      virtualKey({ id: 11, employeeId: 1, productLineId: 100 }),
      virtualKey({ id: 12, employeeId: 1, productLineId: 100 }),
    ],
    credentials: [credential({ id: 21, productLineId: 100 })],
    grants: [],
  });

  assert.deepEqual(
    graph.edges
      .filter((edge) => edge.kind === "owns")
      .map((edge) => `${edge.sourceId}->${edge.targetId}`),
    ["1->11", "1->12"],
  );
  assert.equal(graph.employees.length, 1);
  assert.equal(graph.virtualKeys.length, 2);
});

test("empty grants keep the full same-channel credential pool", () => {
  const graph = buildKeyBindingGraph({
    employees: [employee({ id: 1, name: "张三" })],
    virtualKeys: [virtualKey({ id: 11, employeeId: 1, productLineId: 100 })],
    credentials: [
      credential({ id: 21, productLineId: 100 }),
      credential({ id: 22, productLineId: 100 }),
      credential({ id: 23, productLineId: 200 }),
    ],
    grants: [],
  });

  assert.deepEqual(useEdges(graph), ["11->21:pool", "11->22:pool"]);
});

test("grants on the product line restrict the virtual key to those credentials", () => {
  const graph = buildKeyBindingGraph({
    employees: [employee({ id: 1, name: "张三" })],
    virtualKeys: [virtualKey({ id: 11, employeeId: 1, productLineId: 100 })],
    credentials: [
      credential({ id: 21, productLineId: 100 }),
      credential({ id: 22, productLineId: 100 }),
    ],
    grants: [grant(1, 22)],
  });

  assert.deepEqual(useEdges(graph), ["11->22:grant"]);
});

test("grants on another product line do not restrict this channel", () => {
  const graph = buildKeyBindingGraph({
    employees: [employee({ id: 1, name: "张三" })],
    virtualKeys: [
      virtualKey({ id: 11, employeeId: 1, productLineId: 100 }),
      virtualKey({ id: 12, employeeId: 1, productLineId: 200 }),
    ],
    credentials: [
      credential({ id: 21, productLineId: 100 }),
      credential({ id: 22, productLineId: 200 }),
      credential({ id: 23, productLineId: 200 }),
    ],
    grants: [grant(1, 22)],
  });

  assert.deepEqual(useEdges(graph), ["11->21:pool", "12->22:grant"]);
});

test("protocol mismatch drops a credential even when it is granted", () => {
  const graph = buildKeyBindingGraph({
    employees: [employee({ id: 1, name: "张三" })],
    virtualKeys: [
      virtualKey({
        id: 11,
        employeeId: 1,
        productLineId: 100,
        protocol: "openai_chat",
      }),
    ],
    credentials: [
      credential({
        id: 21,
        productLineId: 100,
        supportedProtocols: ["anthropic_messages"],
      }),
      credential({
        id: 22,
        productLineId: 100,
        supportedProtocols: ["openai_chat"],
      }),
    ],
    grants: [grant(1, 21)],
  });

  assert.deepEqual(useEdges(graph), []);
});

test("employees without virtual keys are omitted; orphan credentials remain", () => {
  const graph = buildKeyBindingGraph({
    employees: [
      employee({ id: 1, name: "张三" }),
      employee({ id: 2, name: "李四" }),
    ],
    virtualKeys: [virtualKey({ id: 11, employeeId: 1, productLineId: 100 })],
    credentials: [
      credential({ id: 21, productLineId: 100 }),
      credential({ id: 22, productLineId: 200 }),
    ],
    grants: [],
  });

  assert.deepEqual(
    graph.employees.map((row) => row.id),
    [1],
  );
  assert.deepEqual(
    graph.credentials.map((row) => row.id),
    [21, 22],
  );
});

test("productLineId filter keeps only that channel's keys and credentials", () => {
  const graph = buildKeyBindingGraph({
    employees: [
      employee({ id: 1, name: "张三" }),
      employee({ id: 2, name: "李四" }),
    ],
    virtualKeys: [
      virtualKey({ id: 11, employeeId: 1, productLineId: 100 }),
      virtualKey({ id: 12, employeeId: 2, productLineId: 200 }),
    ],
    credentials: [
      credential({ id: 21, productLineId: 100 }),
      credential({ id: 22, productLineId: 200 }),
    ],
    grants: [],
    filter: { productLineId: 100 },
  });

  assert.deepEqual(
    graph.employees.map((row) => row.id),
    [1],
  );
  assert.deepEqual(
    graph.virtualKeys.map((row) => row.id),
    [11],
  );
  assert.deepEqual(
    graph.credentials.map((row) => row.id),
    [21],
  );
  assert.deepEqual(
    graph.channels.map((row) => row.id),
    [100, 200],
  );
});

test("enterprise filter keeps that enterprise's employees and reachable channels", () => {
  const graph = buildKeyBindingGraph({
    employees: [
      employee({ id: 1, name: "张三", enterpriseId: 1, enterpriseName: "海致" }),
      employee({ id: 2, name: "王五", enterpriseId: 2, enterpriseName: "星图" }),
    ],
    virtualKeys: [
      virtualKey({ id: 11, employeeId: 1, productLineId: 100 }),
      virtualKey({ id: 12, employeeId: 2, productLineId: 200 }),
    ],
    credentials: [
      credential({ id: 21, productLineId: 100 }),
      credential({ id: 22, productLineId: 100 }),
      credential({ id: 23, productLineId: 200 }),
    ],
    grants: [],
    filter: { enterpriseId: 1 },
  });

  assert.deepEqual(
    graph.employees.map((row) => row.id),
    [1],
  );
  assert.deepEqual(
    graph.credentials.map((row) => row.id).sort(),
    [21, 22],
  );
});

test("search by team name keeps the org path", () => {
  const graph = buildKeyBindingGraph({
    employees: [
      employee({ id: 1, name: "张三", teamId: 10, teamName: "平台" }),
      employee({ id: 2, name: "李四", teamId: 20, teamName: "销售" }),
    ],
    virtualKeys: [
      virtualKey({ id: 11, employeeId: 1, productLineId: 100 }),
      virtualKey({ id: 12, employeeId: 2, productLineId: 100 }),
    ],
    credentials: [credential({ id: 21, productLineId: 100 })],
    grants: [],
    filter: { q: "平台" },
  });

  assert.deepEqual(
    graph.employees.map((row) => row.id),
    [1],
  );
  assert.deepEqual(
    graph.teams.map((row) => row.id),
    [10],
  );
  assert.deepEqual(orgEdges(graph), [
    "enterprise:1->team:10",
    "team:10->employee:1",
  ]);
});

test("search keeps the matched employee and the connected key path", () => {
  const graph = buildKeyBindingGraph({
    employees: [
      employee({ id: 1, name: "张三" }),
      employee({ id: 2, name: "李四" }),
    ],
    virtualKeys: [
      virtualKey({ id: 11, employeeId: 1, productLineId: 100, keyPrefix: "th-aaa" }),
      virtualKey({ id: 12, employeeId: 2, productLineId: 100, keyPrefix: "th-bbb" }),
    ],
    credentials: [
      credential({ id: 21, productLineId: 100, label: "glm-prod" }),
      credential({ id: 22, productLineId: 100, label: "glm-spare" }),
    ],
    grants: [grant(1, 21)],
    filter: { q: "张三" },
  });

  assert.deepEqual(
    graph.employees.map((row) => row.name),
    ["张三"],
  );
  assert.deepEqual(
    graph.virtualKeys.map((row) => row.id),
    [11],
  );
  assert.deepEqual(
    graph.credentials.map((row) => row.id),
    [21],
  );
});
