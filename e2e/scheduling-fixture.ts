import { createHash } from "node:crypto";

/**
 * 渠道 Key 调度 E2E 夹具定义：seed-scheduling.ts 按它写库，
 * key-scheduling.spec.ts 按它推导 API Key 明文与渠道 Key 明文。
 * 这里只放纯数据，不 import server 代码（用例进程不能连到 dev 库）。
 */
export const SCHED_ENTERPRISE = { name: "调度E2E企业" } as const;
export const SCHED_EXTERNAL_ENTERPRISE = { name: "调度E2E外部企业" } as const;

/**
 * 编制树（同一企业内）：
 *   d1 一部（一级部门）
 *     d1a 平台组
 *       d1a1 网关小组
 *       d1a2 存储小组
 *     d1b 应用组
 *   d2 二部（一级部门）
 * ext 属于另一家企业。
 */
export type SchedDeptKey = "d1" | "d1a" | "d1a1" | "d1a2" | "d1b" | "d2" | "ext";

export const SCHED_DEPARTMENTS: Record<
  SchedDeptKey,
  { name: string; parent: SchedDeptKey | null; external?: boolean }
> = {
  d1: { name: "调度一部", parent: null },
  d1a: { name: "调度平台组", parent: "d1" },
  d1a1: { name: "调度网关小组", parent: "d1a" },
  d1a2: { name: "调度存储小组", parent: "d1a" },
  d1b: { name: "调度应用组", parent: "d1" },
  d2: { name: "调度二部", parent: null },
  ext: { name: "调度外部部门", parent: null, external: true },
};

export type SchedPerson = { name: string; phone: string; depts: SchedDeptKey[] };

function person(index: number, name: string, depts: SchedDeptKey[]): SchedPerson {
  return { name, phone: `1390000${String(index).padStart(4, "0")}`, depts };
}

/** 人员按「相对网关小组的远近」命名，方便读用例。 */
export const SCHED_PEOPLE = {
  // 亲和度阶梯
  self: person(1, "调度-本人", ["d1a1"]),
  leafMate: person(2, "调度-同组同事", ["d1a1"]),
  subMate: person(3, "调度-同部门同事", ["d1a2"]),
  firstMate: person(4, "调度-同一级部门同事", ["d1b"]),
  entMate: person(5, "调度-同企业同事", ["d2"]),
  outsider: person(6, "调度-外部企业员工", ["ext"]),
  // 一人多部门：二部 + 存储小组
  multi: person(7, "调度-多部门员工", ["d2", "d1a2"]),
  // 无席位的网关小组成员
  guest1: person(11, "调度-借用甲", ["d1a1"]),
  guest2: person(12, "调度-借用乙", ["d1a1"]),
  guest3: person(13, "调度-借用丙", ["d1a1"]),
  guest4: person(14, "调度-借用丁", ["d1a1"]),
  // 各场景的席位主人
  ownerCap: person(21, "调度-容量主人", ["d1a1"]),
  ownerBurst: person(22, "调度-并发主人", ["d1a1"]),
  ownerQuota: person(23, "调度-额度主人", ["d1a1"]),
  ownerIdle: person(24, "调度-闲置主人", ["d1a1"]),
  ownerIso: person(25, "调度-隔离主人", ["d1a1"]),
  ownerHome: person(26, "调度-回家主人", ["d1a1"]),
  ownerWin5: person(27, "调度-五小时主人", ["d1a1"]),
  ownerWeek: person(28, "调度-周窗口主人", ["d1a1"]),
} as const satisfies Record<string, SchedPerson>;

export type SchedPersonKey = keyof typeof SCHED_PEOPLE;

export type SchedKeyDef = {
  /** 渠道 Key 标签，也是明文后缀（4 个字符），用来在 mock 上游回显里认出是哪把 Key。 */
  label: string;
  owner?: SchedPersonKey;
  fiveHourCreditLimit?: number;
  weeklyCreditLimit?: number;
};

export type SchedPoolDef = {
  name: string;
  keys: readonly SchedKeyDef[];
  /** 在这个池子里有 API Key 的人。 */
  users: readonly SchedPersonKey[];
};

/**
 * 每个场景独占一条渠道（= 一个调度池），互不影响。
 * 渠道 Key 按数组顺序入库，ID 递增；同分时调度取 ID 小的。
 *
 * 席位套餐的池子里每把 Key 都有席位主人。只有充值模式（管理员直接添加 Key）
 * 的池子里 Key 没有主人：recharge、ratelimit、planDenied、overload、serverError。
 */
export const SCHED_POOLS = {
  affinity: {
    name: "调度E2E-亲和",
    keys: [
      { label: "ent0", owner: "entMate" },
      { label: "fst0", owner: "firstMate" },
      { label: "sub0", owner: "subMate" },
      { label: "leaf", owner: "leafMate" },
      { label: "self", owner: "self" },
      { label: "out0", owner: "outsider" },
    ],
    users: ["self", "guest1", "multi"],
  },
  capacity: {
    name: "调度E2E-容量",
    keys: [{ label: "capo", owner: "ownerCap" }, { label: "capf", owner: "entMate" }],
    users: ["ownerCap", "guest1", "guest2", "guest3", "guest4"],
  },
  burst: {
    name: "调度E2E-并发",
    keys: [{ label: "bsto", owner: "ownerBurst" }, { label: "bstf", owner: "entMate" }],
    users: ["ownerBurst", "guest1", "guest2", "guest3"],
  },
  quota: {
    name: "调度E2E-额度",
    keys: [
      { label: "qtao", owner: "ownerQuota", fiveHourCreditLimit: 100 },
      { label: "qtaf", owner: "entMate" },
    ],
    users: ["ownerQuota", "guest1"],
  },
  ratelimit: {
    name: "调度E2E-限流",
    keys: [{ label: "rl01" }, { label: "rl02" }, { label: "rl03" }, { label: "rl04" }, { label: "rl05" }],
    users: ["guest1"],
  },
  planDenied: {
    name: "调度E2E-套餐",
    keys: [{ label: "pd01" }, { label: "pd02" }],
    users: ["guest1"],
  },
  overload: {
    name: "调度E2E-拥堵",
    keys: [{ label: "ov01" }, { label: "ov02" }],
    users: ["guest1"],
  },
  serverError: {
    name: "调度E2E-故障",
    keys: [{ label: "se01" }, { label: "se02" }, { label: "se03" }],
    users: ["guest1"],
  },
  idle: {
    name: "调度E2E-闲置",
    keys: [{ label: "idlo", owner: "ownerIdle" }],
    users: ["ownerIdle", "guest1"],
  },
  isolation: {
    name: "调度E2E-隔离",
    keys: [{ label: "isoo", owner: "ownerIso" }, { label: "isox", owner: "outsider" }],
    users: ["outsider", "guest1"],
  },
  recharge: {
    name: "调度E2E-充值",
    keys: [{ label: "rc01" }, { label: "rc02" }],
    users: ["outsider", "guest1"],
  },
  window5h: {
    name: "调度E2E-五小时",
    keys: [
      { label: "w5ho", owner: "ownerWin5", fiveHourCreditLimit: 100 },
      { label: "w5hf", owner: "entMate" },
    ],
    users: ["guest1"],
  },
  weekly: {
    name: "调度E2E-周窗口",
    keys: [
      { label: "wkyo", owner: "ownerWeek", weeklyCreditLimit: 100 },
      { label: "wkyf", owner: "entMate" },
    ],
    users: ["guest1", "guest2"],
  },
  homing: {
    name: "调度E2E-回家",
    keys: [{ label: "homo", owner: "ownerHome" }, { label: "homf", owner: "entMate" }],
    users: ["ownerHome", "guest1"],
  },
} as const satisfies Record<string, SchedPoolDef>;

export type SchedPoolKey = keyof typeof SCHED_POOLS;

/** 渠道 Key 明文：mock 上游按 Bearer 认 Key，并在回复里回显。 */
export function schedSecret(pool: SchedPoolKey, label: string): string {
  return `sk-sched-${pool}-${label}`;
}

/** 员工 API Key 明文：确定性派生，格式满足 th_ + 32 位 base64url。 */
export function schedApiKey(pool: SchedPoolKey, personKey: SchedPersonKey): string {
  const digest = createHash("sha256").update(`sched:${pool}:${personKey}`).digest("base64url");
  return `th_${digest.slice(0, 32)}`;
}
