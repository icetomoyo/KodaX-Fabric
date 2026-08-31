import assert from "node:assert/strict";
import test from "node:test";
import type {
  KeyBindingBindingInput,
  KeyBindingCredentialInput,
  KeyBindingEmployeeInput,
  KeyBindingVirtualKeyInput,
} from "../src/lib/key-binding-graph.js";
import { effectiveUsageTier } from "../src/lib/usage-tier.js";

process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:5432/test";
process.env.REDIS_URL ??= "redis://127.0.0.1:6379/15";
process.env.JWT_SECRET ??= "unit-test-jwt-secret";
process.env.CREDENTIAL_ENCRYPT_KEY ??= "unit-test-credential-secret";

const { buildKeyBindingGraph, usageTierForKeyBindingGraph } = await import(
  "../src/lib/key-binding-graph.js"
);

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

function binding(
  credentialId: number,
  scopeType: KeyBindingBindingInput["scopeType"],
  scopeId: number,
): KeyBindingBindingInput {
  return { credentialId, scopeType, scopeId };
}

function useEdges(graph: ReturnType<typeof buildKeyBindingGraph>) {
  return graph.edges
    .filter(
      (edge) =>
        edge.kind === "dedicated" ||
        edge.kind === "team_shared" ||
        edge.kind === "enterprise_shared" ||
        edge.kind === "open_shared",
    )
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
    bindings: [],
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
    bindings: [],
  });

  assert.deepEqual(orgEdges(graph), ["enterprise:1->employee:1"]);
  assert.deepEqual(graph.teams, []);
});

test("employees without usage default to the heavy tier", () => {
  const graph = buildKeyBindingGraph({
    employees: [employee({ id: 1, name: "张三" })],
    virtualKeys: [virtualKey({ id: 11, employeeId: 1, productLineId: 100 })],
    credentials: [credential({ id: 21, productLineId: 100 })],
    bindings: [],
  });
  assert.equal(graph.employees[0]?.usageTier, "heavy");
});

test("employee owns each of their virtual keys", () => {
  const graph = buildKeyBindingGraph({
    employees: [employee({ id: 1, name: "张三" })],
    virtualKeys: [
      virtualKey({ id: 11, employeeId: 1, productLineId: 100 }),
      virtualKey({ id: 12, employeeId: 1, productLineId: 100 }),
    ],
    credentials: [credential({ id: 21, productLineId: 100 })],
    bindings: [],
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

test("credential coolingKind and coolUntil pass through to the graph", () => {
  const graph = buildKeyBindingGraph({
    employees: [employee({ id: 1, name: "张三" })],
    virtualKeys: [virtualKey({ id: 11, employeeId: 1, productLineId: 100 })],
    credentials: [
      credential({
        id: 21,
        productLineId: 100,
        status: "cooling",
        coolingKind: "weekly",
        coolUntil: "2026-09-03T11:00:00.000Z",
      }),
      credential({
        id: 22,
        productLineId: 100,
        status: "cooling",
        coolingKind: "five_hour",
        coolUntil: "2026-08-31T14:00:00.000Z",
      }),
    ],
    bindings: [],
  });

  assert.equal(graph.credentials.find((row) => row.id === 21)?.coolingKind, "weekly");
  assert.equal(graph.credentials.find((row) => row.id === 21)?.coolUntil, "2026-09-03T11:00:00.000Z");
  assert.equal(graph.credentials.find((row) => row.id === 22)?.coolingKind, "five_hour");
});

test("unbound credentials stay in the graph with no virtual-key edges", () => {
  const graph = buildKeyBindingGraph({
    employees: [employee({ id: 1, name: "张三" })],
    virtualKeys: [virtualKey({ id: 11, employeeId: 1, productLineId: 100 })],
    credentials: [
      credential({ id: 21, productLineId: 100 }),
      credential({ id: 22, productLineId: 100 }),
      credential({ id: 23, productLineId: 200 }),
    ],
    bindings: [],
  });

  assert.deepEqual(useEdges(graph), []);
  assert.deepEqual(
    graph.credentials.map((row) => [row.id, row.bound]),
    [
      [21, false],
      [22, false],
      [23, false],
    ],
  );
});

test("self-hosted custom credentials connect every virtual key on the channel", () => {
  const graph = buildKeyBindingGraph({
    employees: [
      employee({ id: 1, name: "甲", usageTier: "heavy" }),
      employee({ id: 2, name: "乙", usageTier: "light" }),
    ],
    virtualKeys: [
      virtualKey({
        id: 11,
        employeeId: 1,
        productLineId: 3,
        protocol: "openai_chat",
      }),
      virtualKey({
        id: 12,
        employeeId: 2,
        productLineId: 3,
        protocol: "openai_chat",
      }),
    ],
    credentials: [
      credential({
        id: 71,
        productLineId: 3,
        providerCode: "custom",
        providerName: "自定义",
        label: "公司qwen",
      }),
    ],
    bindings: [binding(71, "employee", 1)],
  });

  assert.deepEqual(useEdges(graph), ["11->71:open_shared", "12->71:open_shared"]);
  assert.equal(graph.credentials[0]?.bound, true);
});

test("employee binding links that employee's virtual keys as dedicated", () => {
  const graph = buildKeyBindingGraph({
    employees: [employee({ id: 1, name: "张三", usageTier: "heavy" })],
    virtualKeys: [virtualKey({ id: 11, employeeId: 1, productLineId: 100 })],
    credentials: [
      credential({ id: 21, productLineId: 100 }),
      credential({ id: 22, productLineId: 100 }),
    ],
    bindings: [binding(22, "employee", 1)],
  });

  assert.deepEqual(useEdges(graph), ["11->22:dedicated"]);
  assert.equal(graph.credentials.find((row) => row.id === 21)?.bound, false);
  assert.equal(graph.credentials.find((row) => row.id === 22)?.bound, true);
});

test("quiet first-day usage must not hide an exclusive Key still bound at stored heavy", () => {
  // 144: 张闯 created VK cc during the 7×24h protection window; first request
  // bound GLM Key 01 at employee scope. Live classification of 33_060 tokens
  // is light, but the canvas must follow the committed heavy row.
  const peakTokens = 33_060;
  const createdAt = new Date();
  assert.equal(effectiveUsageTier(peakTokens, createdAt, createdAt), "heavy");
  const usageTier = usageTierForKeyBindingGraph("heavy");
  const graph = buildKeyBindingGraph({
    employees: [
      employee({
        id: 26,
        name: "张闯",
        teamId: 4,
        teamName: "前沿",
        usageTier,
      }),
    ],
    virtualKeys: [
      virtualKey({
        id: 74,
        employeeId: 26,
        productLineId: 1,
        name: "cc",
        protocol: "anthropic_messages",
      }),
    ],
    credentials: [credential({ id: 94, productLineId: 1, label: "GLM Key 01" })],
    bindings: [binding(94, "employee", 26)],
  });

  assert.equal(usageTier, "heavy");
  assert.deepEqual(useEdges(graph), ["74->94:dedicated"]);
});

test("team binding links every team member's virtual keys as team_shared", () => {
  const graph = buildKeyBindingGraph({
    employees: [
      employee({ id: 1, name: "张三", teamId: 10, teamName: "平台", usageTier: "standard" }),
      employee({ id: 2, name: "李四", teamId: 10, teamName: "平台", usageTier: "standard" }),
      employee({ id: 3, name: "王五", teamId: 20, teamName: "销售", usageTier: "standard" }),
    ],
    virtualKeys: [
      virtualKey({ id: 11, employeeId: 1, productLineId: 100 }),
      virtualKey({ id: 12, employeeId: 2, productLineId: 100 }),
      virtualKey({ id: 13, employeeId: 3, productLineId: 100 }),
    ],
    credentials: [credential({ id: 21, productLineId: 100 })],
    bindings: [binding(21, "team", 10)],
  });

  assert.deepEqual(useEdges(graph), ["11->21:team_shared", "12->21:team_shared"]);
});

test("enterprise binding links that enterprise's employee virtual keys", () => {
  const graph = buildKeyBindingGraph({
    employees: [
      employee({ id: 1, name: "张三", enterpriseId: 1, enterpriseName: "海致", usageTier: "light" }),
      employee({ id: 2, name: "王五", enterpriseId: 2, enterpriseName: "星图", usageTier: "light" }),
    ],
    virtualKeys: [
      virtualKey({ id: 11, employeeId: 1, productLineId: 100 }),
      virtualKey({ id: 12, employeeId: 2, productLineId: 100 }),
    ],
    credentials: [credential({ id: 21, productLineId: 100 })],
    bindings: [binding(21, "enterprise", 1)],
  });

  assert.deepEqual(useEdges(graph), ["11->21:enterprise_shared"]);
});

test("standard employee without a team uses the enterprise binding", () => {
  const graph = buildKeyBindingGraph({
    employees: [
      employee({
        id: 1,
        name: "无团队标准",
        teamId: null,
        teamName: null,
        usageTier: "standard",
      }),
    ],
    virtualKeys: [virtualKey({ id: 11, employeeId: 1, productLineId: 100, teamId: null, teamName: null })],
    credentials: [credential({ id: 21, productLineId: 100 })],
    bindings: [binding(21, "enterprise", 1)],
  });

  assert.deepEqual(useEdges(graph), ["11->21:enterprise_shared"]);
});

test("enterprise binding skips standard and heavy employees in the same enterprise", () => {
  const graph = buildKeyBindingGraph({
    employees: [
      employee({ id: 1, name: "轻度", usageTier: "light" }),
      employee({ id: 2, name: "标准", usageTier: "standard" }),
      employee({ id: 3, name: "重度", usageTier: "heavy" }),
    ],
    virtualKeys: [
      virtualKey({ id: 11, employeeId: 1, productLineId: 100 }),
      virtualKey({ id: 12, employeeId: 2, productLineId: 100 }),
      virtualKey({ id: 13, employeeId: 3, productLineId: 100 }),
    ],
    credentials: [credential({ id: 21, productLineId: 100 })],
    bindings: [binding(21, "enterprise", 1)],
  });

  assert.deepEqual(useEdges(graph), ["11->21:enterprise_shared"]);
});

test("team binding skips light and heavy teammates", () => {
  const graph = buildKeyBindingGraph({
    employees: [
      employee({ id: 1, name: "标准", teamId: 10, teamName: "平台", usageTier: "standard" }),
      employee({ id: 2, name: "轻度", teamId: 10, teamName: "平台", usageTier: "light" }),
      employee({ id: 3, name: "重度", teamId: 10, teamName: "平台", usageTier: "heavy" }),
    ],
    virtualKeys: [
      virtualKey({ id: 11, employeeId: 1, productLineId: 100 }),
      virtualKey({ id: 12, employeeId: 2, productLineId: 100 }),
      virtualKey({ id: 13, employeeId: 3, productLineId: 100 }),
    ],
    credentials: [credential({ id: 21, productLineId: 100 })],
    bindings: [binding(21, "team", 10)],
  });

  assert.deepEqual(useEdges(graph), ["11->21:team_shared"]);
});

test("a binding on another product line does not connect this channel", () => {
  const graph = buildKeyBindingGraph({
    employees: [employee({ id: 1, name: "张三", usageTier: "heavy" })],
    virtualKeys: [
      virtualKey({ id: 11, employeeId: 1, productLineId: 100 }),
      virtualKey({ id: 12, employeeId: 1, productLineId: 200 }),
    ],
    credentials: [
      credential({ id: 21, productLineId: 100 }),
      credential({ id: 22, productLineId: 200 }),
      credential({ id: 23, productLineId: 200 }),
    ],
    bindings: [binding(22, "employee", 1)],
  });

  assert.deepEqual(useEdges(graph), ["12->22:dedicated"]);
});

test("protocol mismatch drops a credential even when it is bound", () => {
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
    bindings: [binding(21, "employee", 1)],
  });

  assert.deepEqual(useEdges(graph), []);
  assert.equal(graph.credentials.find((row) => row.id === 21)?.bound, true);
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
    bindings: [],
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
    bindings: [],
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
    bindings: [],
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
    bindings: [],
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
      employee({ id: 1, name: "张三", usageTier: "heavy" }),
      employee({ id: 2, name: "李四", usageTier: "heavy" }),
    ],
    virtualKeys: [
      virtualKey({ id: 11, employeeId: 1, productLineId: 100, keyPrefix: "th-aaa" }),
      virtualKey({ id: 12, employeeId: 2, productLineId: 100, keyPrefix: "th-bbb" }),
    ],
    credentials: [
      credential({ id: 21, productLineId: 100, label: "glm-prod" }),
      credential({ id: 22, productLineId: 100, label: "glm-spare" }),
    ],
    bindings: [binding(21, "employee", 1)],
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
