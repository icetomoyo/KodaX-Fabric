export const DINGTALK_ROOT_DEPT_ID = 1;
export const DINGTALK_SCHOOL_DEPT_ID = -7;
export const DINGTALK_API_BASE_URL = "https://oapi.dingtalk.com";
export const DINGTALK_CONTACT_API_BASE_URL = "https://api.dingtalk.com";

export class DingtalkNotConfiguredError extends Error {
  readonly code = "DINGTALK_NOT_CONFIGURED";
  constructor() {
    super("未配置钉钉 AppKey / AppSecret");
    this.name = "DingtalkNotConfiguredError";
  }
}

export class DingtalkApiError extends Error {
  readonly errcode: number;
  constructor(message: string, errcode = -1) {
    super(message);
    this.name = "DingtalkApiError";
    this.errcode = errcode;
  }
}

export type DingtalkDepartmentNode = {
  deptId: number;
  name: string;
  parentId: number;
  children: DingtalkDepartmentNode[];
};

export function collectDingtalkDeptIds(node: DingtalkDepartmentNode): number[] {
  const ids: number[] = [];
  const walk = (current: DingtalkDepartmentNode) => {
    ids.push(current.deptId);
    for (const child of current.children) walk(child);
  };
  walk(node);
  return ids;
}

export function findDingtalkNode(
  node: DingtalkDepartmentNode,
  deptId: number,
): DingtalkDepartmentNode | null {
  if (node.deptId === deptId) return node;
  for (const child of node.children) {
    const found = findDingtalkNode(child, deptId);
    if (found) return found;
  }
  return null;
}

export type DingtalkCredentials = {
  appKey: string;
  appSecret: string;
};

type DingtalkJson = {
  errcode?: number;
  errmsg?: string;
  access_token?: string;
  result?: unknown;
};

type ListSubItem = {
  dept_id: number;
  name: string;
  parent_id: number;
};

type FetchImpl = typeof fetch;

export function readDingtalkCredentials(source: {
  DINGTALK_APP_KEY?: string;
  DINGTALK_APP_SECRET?: string;
}): DingtalkCredentials | null {
  const appKey = source.DINGTALK_APP_KEY?.trim();
  const appSecret = source.DINGTALK_APP_SECRET?.trim();
  if (!appKey || !appSecret) return null;
  return { appKey, appSecret };
}

export async function fetchDingtalkDepartmentTree(options: {
  appKey: string;
  appSecret: string;
  fetchImpl?: FetchImpl;
  baseUrl?: string;
}): Promise<DingtalkDepartmentNode> {
  const appKey = options.appKey.trim();
  const appSecret = options.appSecret.trim();
  if (!appKey || !appSecret) throw new DingtalkNotConfiguredError();

  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = (options.baseUrl ?? DINGTALK_API_BASE_URL).replace(/\/$/, "");
  const token = await fetchDingtalkAccessToken({ fetchImpl, baseUrl, appKey, appSecret });
  const root = await getDepartment({
    fetchImpl,
    baseUrl,
    token,
    deptId: DINGTALK_ROOT_DEPT_ID,
  });
  const visited = new Set<number>();
  return buildNode({
    fetchImpl,
    baseUrl,
    token,
    deptId: root.deptId,
    name: root.name,
    parentId: root.parentId,
    visited,
  });
}

export async function fetchDingtalkAccessToken(args: {
  fetchImpl?: FetchImpl;
  baseUrl?: string;
  appKey: string;
  appSecret: string;
}): Promise<string> {
  const fetchImpl = args.fetchImpl ?? fetch;
  const baseUrl = (args.baseUrl ?? DINGTALK_API_BASE_URL).replace(/\/$/, "");
  const url = new URL(`${baseUrl}/gettoken`);
  url.searchParams.set("appkey", args.appKey);
  url.searchParams.set("appsecret", args.appSecret);
  const body = await dingtalkGet(fetchImpl, url);
  const token = typeof body.access_token === "string" ? body.access_token.trim() : "";
  if (!token) {
    throw new DingtalkApiError(body.errmsg || "钉钉 access_token 为空", body.errcode ?? -1);
  }
  return token;
}

export type DingtalkDeptOrder = {
  deptId: number;
  order: number;
};

export type DingtalkLeaderInDept = {
  deptId: number;
  leader: boolean;
};

export type DingtalkRole = {
  id: number;
  name: string;
  groupName: string;
};

export type DingtalkUserDetail = {
  userid: string;
  name: string;
  mobile: string | null;
  email: string | null;
  deptIds: number[];
  title: string | null;
  hiredAt: string | null;
  jobNumber: string | null;
  workPlace: string | null;
  remark: string | null;
  managerUserid: string | null;
  deptOrderList: DingtalkDeptOrder[];
  leaderInDept: DingtalkLeaderInDept[];
  roleList: DingtalkRole[];
};

export type DingtalkDeptUser = DingtalkUserDetail;

export function dingtalkOrgEmployeePatch(profile: DingtalkUserDetail) {
  return {
    dingtalkUserid: profile.userid,
    jobTitle: profile.title,
    hiredAt: profile.hiredAt,
    jobNumber: profile.jobNumber,
    workPlace: profile.workPlace,
    dingtalkRemark: profile.remark,
    managerUserid: profile.managerUserid,
    dingtalkDeptIds: profile.deptIds,
    deptOrderList: profile.deptOrderList,
    leaderInDept: profile.leaderInDept,
    roleList: profile.roleList,
  };
}

export function mergeDingtalkUserDetails(
  base: DingtalkUserDetail,
  extra: DingtalkUserDetail,
  mode: "union" | "overlay" = "union",
): DingtalkUserDetail {
  const overlay = mode === "overlay";
  return {
    userid: extra.userid || base.userid,
    name: extra.name || base.name,
    mobile: extra.mobile ?? base.mobile,
    email: extra.email ?? base.email,
    title: extra.title ?? base.title,
    hiredAt: extra.hiredAt ?? base.hiredAt,
    jobNumber: extra.jobNumber ?? base.jobNumber,
    workPlace: extra.workPlace ?? base.workPlace,
    remark: extra.remark ?? base.remark,
    managerUserid: extra.managerUserid ?? base.managerUserid,
    deptIds: unionPositiveInts(base.deptIds, extra.deptIds),
    deptOrderList:
      overlay && extra.deptOrderList.length > 0
        ? extra.deptOrderList
        : mergeByDeptId(base.deptOrderList, extra.deptOrderList),
    leaderInDept:
      overlay && extra.leaderInDept.length > 0
        ? extra.leaderInDept
        : mergeByDeptId(base.leaderInDept, extra.leaderInDept),
    roleList: extra.roleList.length > 0 ? extra.roleList : base.roleList,
  };
}

const ABSENT_DINGTALK_USER_CODES = new Set([60121, 40104]);

export async function fetchDingtalkDeptUsers(options: {
  token: string;
  deptId: number;
  fetchImpl?: FetchImpl;
  baseUrl?: string;
}): Promise<DingtalkDeptUser[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = (options.baseUrl ?? DINGTALK_API_BASE_URL).replace(/\/$/, "");
  const users: DingtalkDeptUser[] = [];
  let cursor = 0;
  for (let page = 0; page < 50; page += 1) {
    const body = await dingtalkPost(fetchImpl, topapiUrl(baseUrl, options.token, "/topapi/v2/user/list"), {
      dept_id: options.deptId,
      cursor,
      size: 100,
      language: "zh_CN",
    });
    const result = asRecord(body.result);
    const list = Array.isArray(result?.list) ? result.list : [];
    for (const item of list) {
      const row = asRecord(item);
      if (!row) continue;
      const parsed = parseDingtalkUserDetail(row, options.deptId);
      if (!parsed) continue;
      users.push(parsed);
    }
    if (!truthy(result?.has_more)) break;
    const next = Number(result?.next_cursor);
    if (!Number.isFinite(next) || next === cursor) break;
    cursor = next;
  }
  return users;
}

export async function fetchDingtalkUser(options: {
  token: string;
  userid: string;
  fetchImpl?: FetchImpl;
  baseUrl?: string;
}): Promise<DingtalkUserDetail | null> {
  const userid = options.userid.trim();
  if (!userid) return null;
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = (options.baseUrl ?? DINGTALK_API_BASE_URL).replace(/\/$/, "");
  try {
    const body = await dingtalkPost(fetchImpl, topapiUrl(baseUrl, options.token, "/topapi/v2/user/get"), {
      userid,
      language: "zh_CN",
    });
    return parseDingtalkUserDetail(body.result);
  } catch (error) {
    if (isAbsentDingtalkUser(error)) return null;
    throw error;
  }
}

export async function fetchDingtalkContactUseridsByName(options: {
  token: string;
  name: string;
  fetchImpl?: FetchImpl;
  baseUrl?: string;
}): Promise<string[]> {
  const name = options.name.trim();
  if (!name) return [];
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = (options.baseUrl ?? DINGTALK_CONTACT_API_BASE_URL).replace(/\/$/, "");
  const userids: string[] = [];
  let offset = 0;
  const size = 10;
  for (let page = 0; page < 20; page += 1) {
    const response = await fetchImpl(new URL("/v1.0/contact/users/search", `${baseUrl}/`), {
      method: "POST",
      headers: {
        "content-type": "application/json;charset=utf-8",
        "x-acs-dingtalk-access-token": options.token,
      },
      body: JSON.stringify({
        queryWord: name,
        offset,
        size,
        fullMatchField: 1,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    const text = await response.text();
    let body: {
      code?: string;
      message?: string;
      hasMore?: boolean;
      totalCount?: number;
      list?: unknown;
    };
    try {
      body = JSON.parse(text) as typeof body;
    } catch {
      throw new DingtalkApiError(`钉钉通讯录搜索返回无法解析（HTTP ${response.status}）`);
    }
    if (!response.ok) {
      throw new DingtalkApiError(body.message || body.code || `钉钉通讯录搜索失败（HTTP ${response.status}）`);
    }
    const list = Array.isArray(body.list) ? body.list : [];
    for (const item of list) {
      if (typeof item === "string" && item.trim()) userids.push(item.trim());
    }
    const unique = [...new Set(userids)];
    if (typeof body.totalCount === "number" && body.totalCount > 1) return unique;
    if (unique.length > 1) return unique;
    if (body.hasMore !== true) return unique;
    offset += size;
    if (typeof body.totalCount === "number" && offset >= body.totalCount) return unique;
  }
  return [...new Set(userids)];
}

export async function fetchDingtalkUseridByMobile(options: {
  token: string;
  mobile: string;
  fetchImpl?: FetchImpl;
  baseUrl?: string;
}): Promise<string | null> {
  const mobile = options.mobile.trim();
  if (!mobile) return null;
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = (options.baseUrl ?? DINGTALK_API_BASE_URL).replace(/\/$/, "");
  try {
    const body = await dingtalkPost(
      fetchImpl,
      topapiUrl(baseUrl, options.token, "/topapi/v2/user/getbymobile"),
      { mobile },
    );
    const result = asRecord(body.result);
    const userid = typeof result?.userid === "string" ? result.userid.trim() : "";
    return userid || null;
  } catch (error) {
    if (isAbsentDingtalkUser(error)) return null;
    throw error;
  }
}

export function parseDingtalkTitle(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const title = value.trim().slice(0, 100);
  return title || null;
}

export function parseDingtalkEmail(value: unknown): string | null {
  return parseOptionalString(value, 200);
}

/** DingTalk `hired_date` is a Unix timestamp in milliseconds. Store as YYYY-MM-DD in Asia/Shanghai. */
export function parseDingtalkHiredAt(value: unknown): string | null {
  if (value == null || value === "" || value === 0 || value === "0") return null;
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\d+$/.test(value.trim())
        ? Number(value.trim())
        : NaN;
  if (Number.isFinite(numeric) && numeric > 0) {
    const ms = numeric < 1e12 ? numeric * 1000 : numeric;
    const date = new Date(ms);
    if (Number.isNaN(date.getTime())) return null;
    try {
      return new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Shanghai",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(date);
    } catch {
      return null;
    }
  }
  if (typeof value === "string") {
    const match = value.trim().match(/^(\d{4}-\d{2}-\d{2})/);
    return match?.[1] ?? null;
  }
  return null;
}

export function parseDingtalkUserDetail(value: unknown, listedDeptId?: number): DingtalkUserDetail | null {
  const row = asRecord(value);
  if (!row) return null;
  const userid = typeof row.userid === "string" ? row.userid.trim() : "";
  const name = typeof row.name === "string" ? row.name.trim() : "";
  if (!userid || !name) return null;
  const mobile = typeof row.mobile === "string" && row.mobile.trim() ? row.mobile.trim() : null;
  const deptIds = parsePositiveIntList(row.dept_id_list);
  const deptOrderList = parseDeptOrderList(row.dept_order_list);
  const leaderInDept = parseLeaderInDept(row.leader_in_dept);
  if (listedDeptId != null && listedDeptId > 0) {
    if (!deptIds.includes(listedDeptId)) deptIds.push(listedDeptId);
    if (row.leader !== undefined && row.leader !== null && !leaderInDept.some((item) => item.deptId === listedDeptId)) {
      leaderInDept.push({ deptId: listedDeptId, leader: truthy(row.leader) });
    }
    const listedOrder = parseFiniteNumber(row.dept_order);
    if (listedOrder != null && !deptOrderList.some((item) => item.deptId === listedDeptId)) {
      deptOrderList.push({ deptId: listedDeptId, order: listedOrder });
    }
  }
  return {
    userid,
    name,
    mobile,
    email: parseDingtalkEmail(row.org_email) ?? parseDingtalkEmail(row.email),
    deptIds,
    title: parseDingtalkTitle(row.title),
    hiredAt: parseDingtalkHiredAt(row.hired_date),
    jobNumber: parseOptionalString(row.job_number, 64),
    workPlace: parseOptionalString(row.work_place, 100),
    remark: parseOptionalString(row.remark, 500),
    managerUserid: parseOptionalString(row.manager_userid, 64),
    deptOrderList,
    leaderInDept,
    roleList: parseRoleList(row.role_list),
  };
}

export async function enrichDingtalkUsersWithGet(options: {
  token: string;
  users: readonly DingtalkUserDetail[];
  fetchImpl?: FetchImpl;
  baseUrl?: string;
}): Promise<DingtalkUserDetail[]> {
  const byUserid = new Map<string, DingtalkUserDetail>();
  for (const user of options.users) {
    const existing = byUserid.get(user.userid);
    byUserid.set(user.userid, existing ? mergeDingtalkUserDetails(existing, user) : user);
  }
  const enriched: DingtalkUserDetail[] = [];
  for (const user of byUserid.values()) {
    const detail = await fetchDingtalkUser({
      token: options.token,
      userid: user.userid,
      fetchImpl: options.fetchImpl,
      baseUrl: options.baseUrl,
    });
    enriched.push(detail ? mergeDingtalkUserDetails(user, detail, "overlay") : user);
  }
  return enriched;
}

function isAbsentDingtalkUser(error: unknown): boolean {
  return error instanceof DingtalkApiError && ABSENT_DINGTALK_USER_CODES.has(error.errcode);
}

function topapiUrl(baseUrl: string, token: string, path: string): URL {
  const url = new URL(`${baseUrl}${path}`);
  url.searchParams.set("access_token", token);
  return url;
}

function truthy(value: unknown): boolean {
  return value === true || value === "true" || value === 1 || value === "1";
}

async function getDepartment(args: {
  fetchImpl: FetchImpl;
  baseUrl: string;
  token: string;
  deptId: number;
}): Promise<{ deptId: number; name: string; parentId: number }> {
  const body = await dingtalkPost(args.fetchImpl, departmentUrl(args.baseUrl, args.token, "get"), {
    dept_id: args.deptId,
    language: "zh_CN",
  });
  const result = asRecord(body.result);
  const deptId = Number(result?.dept_id ?? args.deptId);
  const name = typeof result?.name === "string" && result.name.trim() ? result.name.trim() : "根部门";
  const parentId = Number(result?.parent_id ?? 0);
  return { deptId, name, parentId };
}

async function buildNode(args: {
  fetchImpl: FetchImpl;
  baseUrl: string;
  token: string;
  deptId: number;
  name: string;
  parentId: number;
  visited: Set<number>;
}): Promise<DingtalkDepartmentNode> {
  if (args.visited.has(args.deptId)) {
    return { deptId: args.deptId, name: args.name, parentId: args.parentId, children: [] };
  }
  args.visited.add(args.deptId);
  const children: DingtalkDepartmentNode[] = [];
  for (const child of await listSubDepartments(args)) {
    if (child.dept_id === DINGTALK_SCHOOL_DEPT_ID) continue;
    children.push(
      await buildNode({
        ...args,
        deptId: child.dept_id,
        name: child.name,
        parentId: child.parent_id,
      }),
    );
  }
  return {
    deptId: args.deptId,
    name: args.name,
    parentId: args.parentId,
    children,
  };
}

async function listSubDepartments(args: {
  fetchImpl: FetchImpl;
  baseUrl: string;
  token: string;
  deptId: number;
}): Promise<ListSubItem[]> {
  const body = await dingtalkPost(args.fetchImpl, departmentUrl(args.baseUrl, args.token, "listsub"), {
    dept_id: args.deptId,
    language: "zh_CN",
  });
  if (!Array.isArray(body.result)) return [];
  return body.result.flatMap((item) => {
    const row = asRecord(item);
    if (!row) return [];
    const deptId = Number(row.dept_id);
    const name = typeof row.name === "string" ? row.name.trim() : "";
    const parentId = Number(row.parent_id);
    if (!Number.isSafeInteger(deptId) || !name) return [];
    return [{ dept_id: deptId, name, parent_id: Number.isSafeInteger(parentId) ? parentId : args.deptId }];
  });
}

function departmentUrl(baseUrl: string, token: string, method: "get" | "listsub"): URL {
  const url = new URL(`${baseUrl}/topapi/v2/department/${method}`);
  url.searchParams.set("access_token", token);
  return url;
}

async function dingtalkGet(fetchImpl: FetchImpl, url: URL): Promise<DingtalkJson> {
  return parseDingtalkResponse(
    await fetchImpl(url, { method: "GET", signal: AbortSignal.timeout(20_000) }),
  );
}

const DINGTALK_RATE_LIMIT_ERRCODE = 90018;

async function dingtalkPost(
  fetchImpl: FetchImpl,
  url: URL,
  payload: Record<string, unknown>,
): Promise<DingtalkJson> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      return await parseDingtalkResponse(
        await fetchImpl(url, {
          method: "POST",
          headers: { "content-type": "application/json;charset=utf-8" },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(20_000),
        }),
      );
    } catch (error) {
      lastError = error;
      if (
        error instanceof DingtalkApiError
        && error.errcode === DINGTALK_RATE_LIMIT_ERRCODE
        && attempt < 5
      ) {
        await new Promise((resolve) => setTimeout(resolve, 300 * 2 ** attempt));
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

async function parseDingtalkResponse(response: Response): Promise<DingtalkJson> {
  const text = await response.text();
  let body: DingtalkJson;
  try {
    body = JSON.parse(text) as DingtalkJson;
  } catch {
    throw new DingtalkApiError(`钉钉接口返回无法解析（HTTP ${response.status}）`);
  }
  const errcode = Number(body.errcode ?? 0);
  if (!response.ok || errcode !== 0) {
    throw new DingtalkApiError(body.errmsg || `钉钉接口错误（HTTP ${response.status}）`, errcode);
  }
  return body;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseOptionalString(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim().slice(0, maxLength);
  return text || null;
}

function parseFiniteNumber(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(n) ? n : null;
}

function parsePositiveIntList(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  const ids: number[] = [];
  for (const item of value) {
    const id = Number(item);
    if (Number.isSafeInteger(id) && id > 0 && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

function parseDeptOrderList(value: unknown): DingtalkDeptOrder[] {
  if (!Array.isArray(value)) return [];
  const rows: DingtalkDeptOrder[] = [];
  for (const item of value) {
    const row = asRecord(item);
    if (!row) continue;
    const deptId = Number(row.dept_id);
    const order = parseFiniteNumber(row.order);
    if (!Number.isSafeInteger(deptId) || deptId <= 0 || order == null) continue;
    rows.push({ deptId, order });
  }
  return rows;
}

function parseLeaderInDept(value: unknown): DingtalkLeaderInDept[] {
  if (!Array.isArray(value)) return [];
  const rows: DingtalkLeaderInDept[] = [];
  for (const item of value) {
    const row = asRecord(item);
    if (!row) continue;
    const deptId = Number(row.dept_id);
    if (!Number.isSafeInteger(deptId) || deptId <= 0) continue;
    rows.push({ deptId, leader: truthy(row.leader) });
  }
  return rows;
}

function parseRoleList(value: unknown): DingtalkRole[] {
  if (!Array.isArray(value)) return [];
  const rows: DingtalkRole[] = [];
  for (const item of value) {
    const row = asRecord(item);
    if (!row) continue;
    const id = Number(row.id);
    const name = parseOptionalString(row.name, 100);
    if (!Number.isSafeInteger(id) || !name) continue;
    rows.push({
      id,
      name,
      groupName: parseOptionalString(row.group_name, 100) ?? "",
    });
  }
  return rows;
}

function unionPositiveInts(left: readonly number[], right: readonly number[]): number[] {
  const ids: number[] = [];
  for (const id of [...left, ...right]) {
    if (Number.isSafeInteger(id) && id > 0 && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

function mergeByDeptId<T extends { deptId: number }>(base: readonly T[], extra: readonly T[]): T[] {
  const map = new Map<number, T>();
  for (const row of base) map.set(row.deptId, row);
  for (const row of extra) map.set(row.deptId, row);
  return [...map.values()].sort((left, right) => left.deptId - right.deptId);
}
