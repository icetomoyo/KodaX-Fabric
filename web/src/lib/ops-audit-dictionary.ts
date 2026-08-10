import { formatDateTime } from "@/lib/date-time";

export const OPS_AUDIT_ACTION_LABELS: Record<string, string> = {
  "auth.login": "登录系统",
  "auth.register_application": "提交注册申请",
  "auth.change_password": "修改密码",
  "api_key.create": "创建个人 API Key",
  "api_key.reveal": "复制个人 API Key",
  "api_key.delete": "删除个人 API Key",
  "api_key.revoke": "吊销个人 API Key",
  "employee_api_key.reveal": "复制员工 API Key",
  "employee_api_key.create_for_employee": "为员工生成 API Key",
  "user.create": "新建员工",
  "user.registration_approve": "审核通过注册申请",
  "user.import": "批量导入员工",
  "user.update": "编辑员工信息",
  "user.status": "更新员工状态",
  "user.reset_password": "重置员工密码",
  "provider.create": "新建上游平台",
  "provider.update": "更新上游平台",
  "product_line.create": "新建上游渠道",
  "product_line.update": "更新上游渠道",
  "credential.quick_create": "新增上游 Key",
  "credential.create": "新增上游 Key",
  "credential.bulk_create": "批量导入上游 Key",
  "credential.update": "更新上游 Key",
  "credential.bulk_status": "批量更新上游 Key 状态",
  "credential.delete": "删除上游 Key",
  "credential.bulk_delete": "批量删除上游 Key",
  "credential.test": "测试上游 Key",
  "credential.grant": "授权上游 Key",
  "credential.ungrant": "移除 Key 授权",
  "model_route.create": "新建模型路由",
  "model_route.update": "更新模型路由",
  "model_route.delete": "删除模型路由",
  "quota_policy.update": "更新配额策略",
  "log.read_context": "查看结构化调用上下文",
};

export const OPS_AUDIT_TARGET_LABELS: Record<string, string> = {
  employee: "员工",
  employee_api_key: "员工 API Key",
  provider: "上游平台",
  product_line: "上游渠道",
  upstream_credential: "上游 Key",
  upstream_credential_batch: "上游 Key 批次",
  model_route: "模型路由",
  quota_policy: "配额策略",
  request_audit: "调用记录",
};

export const OPS_AUDIT_DETAIL_KEY_LABELS: Record<string, string> = {
  phone: "手机号",
  role: "角色",
  total: "总数",
  success: "成功数",
  failed: "失败数",
  status: "状态",
  code: "编码",
  name: "名称",
  label: "Key 名称",
  withApiLine: "创建 API 线路",
  defaultBaseUrl: "默认 API 地址",
  baseUrlOverride: "API 地址",
  productType: "接入类型",
  shareMode: "共享模式",
  allowAutoRoute: "自动路由",
  providerCode: "平台",
  providerId: "上游平台 ID",
  productLineId: "渠道 ID",
  productLineCode: "渠道编码",
  credentialIds: "Key ID",
  id: "ID",
  labels: "Key 名称",
  secretSuffix: "Key 后缀",
  secretSuffixes: "Key 后缀",
  count: "数量",
  previousStatus: "原状态",
  changes: "变更明细",
  credentials: "Key 明细",
  priority: "优先级",
  weight: "权重",
  secret: "API Key",
  testOk: "连接测试",
  ok: "测试结果",
  httpStatus: "HTTP 状态",
  latencyMs: "延迟",
  modelCount: "模型数",
  employeeId: "员工 ID",
  employeeIds: "员工 ID",
  grantId: "授权 ID",
  coolUntil: "冷却至",
  meta: "扩展配置",
  expiresAt: "过期时间",
  enabled: "启用",
  clientModel: "对外模型",
  upstreamModel: "上游模型",
  config: "配置",
  dailyTokenLimit: "单日 Token 上限",
  ownerEmployeeId: "内容所属员工 ID",
  ownerPhone: "内容所属手机号",
};

const OPS_AUDIT_VALUE_LABELS: Record<string, string> = {
  employee: "员工",
  admin: "管理员",
  pending: "待审核",
  active: "启用",
  disabled: "停用",
  auto_disabled: "自动停用",
  cooling: "冷却中",
  revoked: "已撤销",
  api: "API",
  coding_plan: "Coding Plan",
  public_pool: "公共池",
  grant_only: "仅授权",
  glm: "GLM",
  kimi: "Kimi",
  deepseek: "DeepSeek",
  minimax: "MiniMax",
  "[updated]": "已更新",
};

const TEST_RESULT_KEYS = new Set(["ok", "testOk"]);

export const OPS_AUDIT_ACTION_OPTIONS = Object.entries(OPS_AUDIT_ACTION_LABELS).map(
  ([value, label]) => ({ value, label }),
);

export function auditActionLabel(action: string): string {
  return OPS_AUDIT_ACTION_LABELS[action] ?? action;
}

export function auditTargetLabel(targetType: string | null | undefined): string {
  if (!targetType) return "—";
  return OPS_AUDIT_TARGET_LABELS[targetType] ?? targetType;
}

export function auditTargetText(
  targetType: string | null | undefined,
  targetName: string | null | undefined,
): string {
  return targetName || auditTargetLabel(targetType);
}

export function auditDetailKeyLabel(key: string): string {
  return OPS_AUDIT_DETAIL_KEY_LABELS[key] ?? key;
}

export function formatAuditDate(value: string | Date | null | undefined): string {
  return formatDateTime(value);
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value);
}

export function formatAuditDetailValue(value: unknown, key = ""): string {
  if (value === null || value === undefined || value === "") {
    if (TEST_RESULT_KEYS.has(key)) return "未测试";
    return "—";
  }

  if (typeof value === "boolean") {
    if (TEST_RESULT_KEYS.has(key)) return value ? "成功" : "失败";
    return value ? "是" : "否";
  }

  if (typeof value === "number") {
    return key === "latencyMs" ? `${value} ms` : String(value);
  }

  if (typeof value === "string") {
    if (OPS_AUDIT_VALUE_LABELS[value]) return OPS_AUDIT_VALUE_LABELS[value];
    if (isIsoDate(value)) return formatAuditDate(value);
    return value;
  }

  if (Array.isArray(value)) {
    return value.length
      ? value.map((item) => formatAuditDetailValue(item, key)).join("、")
      : "—";
  }

  if (typeof value === "object") {
    const parts = Object.entries(value as Record<string, unknown>)
      .filter(([, nestedValue]) => nestedValue !== undefined)
      .map(
        ([nestedKey, nestedValue]) =>
          `${auditDetailKeyLabel(nestedKey)}：${formatAuditDetailValue(nestedValue, nestedKey)}`,
      );
    return parts.length ? parts.join("；") : "—";
  }

  return String(value);
}

export function auditDetailRows(detail: unknown): Array<{
  key: string;
  label: string;
  value: string;
}> {
  if (!detail || typeof detail !== "object" || Array.isArray(detail)) return [];
  return Object.entries(detail as Record<string, unknown>)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => ({
      key,
      label: auditDetailKeyLabel(key),
      value: formatAuditDetailValue(value, key),
    }));
}
