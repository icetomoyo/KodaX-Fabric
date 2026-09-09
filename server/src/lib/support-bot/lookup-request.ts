import { eq } from "drizzle-orm";
import { db } from "../../db/client.js";
import { employeeApiKeys, employees, requestAudits, requestErrorLogs } from "../../db/schema/index.js";
import { REQUEST_CONTEXT_ID_PATTERN } from "../relay/request-context.js";
import { truncateErrorMessage } from "./account-context.js";

export type SupportRequestSnapshot = {
  requestId: string;
  status: string;
  clientModel: string;
  providerCode: string | null;
  protocol: string | null;
  createdAt: string;
  httpStatus: number | null;
  upstreamStatus: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  ownerName: string | null;
};

export function extractSupportRequestId(raw: string): string | null {
  const match = raw.trim().match(/[A-Za-z0-9_-]{8,96}/);
  if (!match) return null;
  return REQUEST_CONTEXT_ID_PATTERN.test(match[0]) ? match[0] : null;
}

export function formatRequestLookup(snapshot: SupportRequestSnapshot | null): string {
  if (!snapshot) {
    return "找不到这条调用，或不是当前用户的记录。请到「我的调用」复制自己的 Request ID 再问。不要编造错误原因。";
  }
  const lines = [
    `Request ID：${snapshot.requestId}`,
    `时间：${snapshot.createdAt}`,
    `状态：${snapshot.status}`,
    `模型：${snapshot.clientModel}`,
  ];
  if (snapshot.providerCode) lines.push(`渠道：${snapshot.providerCode}`);
  if (snapshot.protocol) lines.push(`协议：${snapshot.protocol}`);
  if (snapshot.ownerName) lines.push(`员工：${snapshot.ownerName}`);
  if (snapshot.httpStatus != null) lines.push(`HTTP：${snapshot.httpStatus}`);
  if (snapshot.upstreamStatus != null) lines.push(`上游 HTTP：${snapshot.upstreamStatus}`);
  if (snapshot.errorCode) lines.push(`errorCode：${snapshot.errorCode}`);
  if (snapshot.errorMessage) lines.push(`errorMessage：${snapshot.errorMessage}`);
  if (snapshot.status === "success") {
    lines.push("这次调用成功。若客户端仍报错，多半是客户端配置或协议路径问题，不要把成功记录说成失败。");
  }
  return lines.join("\n");
}

export async function lookupSupportRequest(input: {
  requestId: string;
  employeeId: number;
  bareAdmin: boolean;
}): Promise<string> {
  const requestId = extractSupportRequestId(input.requestId);
  if (!requestId) {
    return "Request ID 格式不对。请到「我的调用」复制完整 ID 再问，不要手打。";
  }

  const [row] = await db
    .select({
      requestId: requestAudits.requestId,
      employeeId: requestAudits.employeeId,
      status: requestAudits.status,
      clientModel: requestAudits.clientModel,
      providerCode: requestAudits.providerCode,
      protocol: employeeApiKeys.protocol,
      createdAt: requestAudits.createdAt,
      httpStatus: requestErrorLogs.httpStatus,
      upstreamStatus: requestErrorLogs.upstreamStatus,
      errorCode: requestErrorLogs.errorCode,
      errorMessage: requestErrorLogs.errorMessage,
      ownerName: employees.name,
    })
    .from(requestAudits)
    .innerJoin(employees, eq(employees.id, requestAudits.employeeId))
    .leftJoin(requestErrorLogs, eq(requestErrorLogs.requestId, requestAudits.requestId))
    .leftJoin(employeeApiKeys, eq(employeeApiKeys.id, requestAudits.employeeApiKeyId))
    .where(eq(requestAudits.requestId, requestId))
    .limit(1);

  if (!row || (!input.bareAdmin && row.employeeId !== input.employeeId)) {
    return formatRequestLookup(null);
  }

  return formatRequestLookup({
    requestId: row.requestId,
    status: row.status,
    clientModel: row.clientModel,
    providerCode: row.providerCode,
    protocol: row.protocol,
    createdAt: row.createdAt.toISOString(),
    httpStatus: row.httpStatus,
    upstreamStatus: row.upstreamStatus,
    errorCode: row.errorCode,
    errorMessage: truncateErrorMessage(row.errorMessage),
    ownerName: input.bareAdmin ? row.ownerName : null,
  });
}
