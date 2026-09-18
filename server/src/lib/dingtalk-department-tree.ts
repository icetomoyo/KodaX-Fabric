export const DINGTALK_ROOT_DEPT_ID = 1;
export const DINGTALK_SCHOOL_DEPT_ID = -7;
export const DINGTALK_API_BASE_URL = "https://oapi.dingtalk.com";

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

export type DingtalkDeptUser = {
  userid: string;
  name: string;
  mobile: string | null;
};

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
      const userid = typeof row.userid === "string" ? row.userid.trim() : "";
      const name = typeof row.name === "string" ? row.name.trim() : "";
      if (!userid || !name) continue;
      const mobile = typeof row.mobile === "string" && row.mobile.trim() ? row.mobile.trim() : null;
      users.push({ userid, name, mobile });
    }
    if (!truthy(result?.has_more)) break;
    const next = Number(result?.next_cursor);
    if (!Number.isFinite(next) || next === cursor) break;
    cursor = next;
  }
  return users;
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

async function dingtalkPost(
  fetchImpl: FetchImpl,
  url: URL,
  payload: Record<string, unknown>,
): Promise<DingtalkJson> {
  return parseDingtalkResponse(
    await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json;charset=utf-8" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20_000),
    }),
  );
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
