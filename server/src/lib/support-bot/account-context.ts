import { and, desc, eq, gt, inArray } from "drizzle-orm";
import { db } from "../../db/client.js";
import {
  employeeApiKeys,
  employees,
  enterprises,
  productLines,
  providers,
  requestAudits,
  requestErrorLogs,
  teamMembers,
  teams,
  upstreamCredentials,
} from "../../db/schema/index.js";
import { groupDiscoveredModelsByChannel } from "../discovered-models.js";
import type { SessionActAs, SessionRole } from "../jwt.js";
import { RELAY_BASE_PATH } from "../relay/protocol.js";
import { getEmployeeUpstreamChannels } from "../upstream-channel-metadata.js";

export const ACCOUNT_ERROR_MESSAGE_MAX = 400;

export type SupportAccountKey = {
  id: number;
  name: string;
  keyPrefix: string;
  protocol: string;
  status: string;
  teamName: string | null;
  lastUsedAt: string | null;
};

export type SupportAccountCall = {
  requestId: string;
  status: string;
  clientModel: string;
  createdAt: string;
  errorCode: string | null;
  errorMessage: string | null;
};

export type SupportAccountSnapshot = {
  role: string;
  bareAdmin: boolean;
  enterpriseName: string | null;
  teamName: string | null;
  hasTeam: boolean;
  keys: SupportAccountKey[];
  recentCalls: SupportAccountCall[];
  modelsByChannel: Array<{ channel: string; models: string[] }>;
  relayBaseUrl: string;
};

export function isBareSuperAdmin(session: {
  role: string;
  trueRole?: string;
  actAs?: { role?: string };
}): boolean {
  const trueRole = session.trueRole ?? session.role;
  return trueRole === "admin" && session.actAs?.role !== "employee";
}

export function buildPublicRelayBaseUrl(request: { protocol: string; host: string }): string {
  return `${request.protocol}://${request.host}${RELAY_BASE_PATH}`;
}

export function publicSiteOrigin(relayBaseUrl: string): string {
  return relayBaseUrl.replace(/\/+$/, "").replace(/\/ai$/i, "");
}

export function truncateErrorMessage(
  value: string | null | undefined,
  max = ACCOUNT_ERROR_MESSAGE_MAX,
): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max)}…`;
}

export function formatAccountContext(snapshot: SupportAccountSnapshot): string {
  const lines: string[] = [
    `角色：${snapshot.role}`,
    `员工侧 Base URL：${snapshot.relayBaseUrl}（不要加 :3000/:3100）`,
  ];

  if (snapshot.bareAdmin) {
    lines.push("当前是超级管理员，未代入具体员工，因此没有该员工的 Key / 调用 / 企业数据。");
    lines.push("只根据产品 FAQ 回答；不要猜测其他企业或员工的信息。");
    return lines.join("\n");
  }

  lines.push(`企业：${snapshot.enterpriseName ?? "未加入企业"}`);
  lines.push(snapshot.hasTeam ? `团队：${snapshot.teamName ?? "已加入团队"}` : "团队：没有团队（需等待团队管理员用手机号邀请）");

  if (snapshot.keys.length === 0) {
    lines.push("API Key：无。未加入团队的用户不能创建 Key。");
  } else {
    lines.push("API Key（仅前缀，无明文/哈希）：");
    for (const key of snapshot.keys) {
      const lastUsed = key.lastUsedAt ?? "从未使用";
      const team = key.teamName ?? "未绑定团队";
      lines.push(
        `- id=${key.id} name=${key.name} prefix=${key.keyPrefix} protocol=${key.protocol} status=${key.status} team=${team} lastUsedAt=${lastUsed}`,
      );
    }
  }

  if (snapshot.recentCalls.length === 0) {
    lines.push("最近调用：无");
  } else {
    lines.push("最近调用（最多 8 条，含该用户自己的错误日志）：");
    for (const call of snapshot.recentCalls) {
      const err = call.errorCode || call.errorMessage
        ? ` errorCode=${call.errorCode ?? "-"} errorMessage=${call.errorMessage ?? "-"}`
        : "";
      lines.push(
        `- requestId=${call.requestId} status=${call.status} model=${call.clientModel} at=${call.createdAt}${err}`,
      );
    }
  }

  if (snapshot.modelsByChannel.length === 0) {
    lines.push("可用模型：无（尚未分配上游渠道）");
  } else {
    lines.push("可用模型（按渠道）：");
    for (const group of snapshot.modelsByChannel) {
      const models = group.models.length > 0 ? group.models.join(", ") : "（渠道暂无模型目录）";
      lines.push(`- ${group.channel}: ${models}`);
    }
  }

  return lines.join("\n");
}

export type LoadSupportAccountContextInput = {
  employeeId: number;
  role: SessionRole;
  trueRole?: SessionRole;
  actAs?: SessionActAs;
  relayBaseUrl: string;
};

export async function loadSupportAccountContext(
  input: LoadSupportAccountContextInput,
): Promise<string> {
  const snapshot = await loadSupportAccountSnapshot(input);
  return formatAccountContext(snapshot);
}

export async function loadSupportAccountSnapshot(
  input: LoadSupportAccountContextInput,
): Promise<SupportAccountSnapshot> {
  const bareAdmin = isBareSuperAdmin({
    role: input.role,
    trueRole: input.trueRole,
    actAs: input.actAs,
  });
  if (bareAdmin) {
    return {
      role: input.role,
      bareAdmin: true,
      enterpriseName: null,
      teamName: null,
      hasTeam: false,
      keys: [],
      recentCalls: [],
      modelsByChannel: [],
      relayBaseUrl: input.relayBaseUrl,
    };
  }

  const [employee] = await db
    .select({
      enterpriseName: enterprises.name,
    })
    .from(employees)
    .leftJoin(enterprises, eq(employees.enterpriseId, enterprises.id))
    .where(eq(employees.id, input.employeeId))
    .limit(1);

  const teamRows = await db
    .select({
      name: teams.name,
    })
    .from(teamMembers)
    .innerJoin(teams, eq(teamMembers.teamId, teams.id))
    .where(eq(teamMembers.employeeId, input.employeeId))
    .orderBy(desc(teams.id))
    .limit(1);

  const keyRows = await db
    .select({
      id: employeeApiKeys.id,
      name: employeeApiKeys.name,
      keyPrefix: employeeApiKeys.keyPrefix,
      protocol: employeeApiKeys.protocol,
      status: employeeApiKeys.status,
      teamName: teams.name,
      lastUsedAt: employeeApiKeys.lastUsedAt,
    })
    .from(employeeApiKeys)
    .leftJoin(teams, eq(employeeApiKeys.teamId, teams.id))
    .where(eq(employeeApiKeys.employeeId, input.employeeId))
    .orderBy(desc(employeeApiKeys.id));

  const auditRows = await db
    .select({
      requestId: requestAudits.requestId,
      status: requestAudits.status,
      clientModel: requestAudits.clientModel,
      createdAt: requestAudits.createdAt,
      errorCode: requestErrorLogs.errorCode,
      errorMessage: requestErrorLogs.errorMessage,
    })
    .from(requestAudits)
    .leftJoin(
      requestErrorLogs,
      and(
        eq(requestErrorLogs.requestId, requestAudits.requestId),
        eq(requestErrorLogs.employeeId, requestAudits.employeeId),
      ),
    )
    .where(eq(requestAudits.employeeId, input.employeeId))
    .orderBy(desc(requestAudits.createdAt), desc(requestAudits.id))
    .limit(8);

  const accessible = await getEmployeeUpstreamChannels(input.employeeId);
  let modelsByChannel: SupportAccountSnapshot["modelsByChannel"] = [];
  if (accessible.length > 0) {
    const productLineIds = accessible.map((channel) => channel.productLineId);
    const channelRows = await db
      .select({
        productLineId: productLines.id,
        productLineName: productLines.name,
        productLineCode: productLines.code,
        providerName: providers.name,
        providerCode: providers.code,
        meta: upstreamCredentials.meta,
      })
      .from(productLines)
      .innerJoin(providers, eq(productLines.providerId, providers.id))
      .leftJoin(
        upstreamCredentials,
        and(
          eq(upstreamCredentials.productLineId, productLines.id),
          inArray(upstreamCredentials.status, ["active", "cooling"]),
          gt(upstreamCredentials.weight, 0),
        ),
      )
      .where(inArray(productLines.id, productLineIds));

    const grouped = groupDiscoveredModelsByChannel(channelRows);
    modelsByChannel = accessible.map((channel) => {
      const group = grouped.find((item) => item.id === channel.productLineId);
      return {
        channel: group?.name ?? channel.productLineName,
        models: group?.models ?? [],
      };
    });
  }

  return {
    role: input.role,
    bareAdmin: false,
    enterpriseName: employee?.enterpriseName ?? null,
    teamName: teamRows[0]?.name ?? null,
    hasTeam: teamRows.length > 0,
    keys: keyRows.map((row) => ({
      id: row.id,
      name: row.name,
      keyPrefix: row.keyPrefix,
      protocol: row.protocol,
      status: row.status,
      teamName: row.teamName,
      lastUsedAt: row.lastUsedAt ? row.lastUsedAt.toISOString() : null,
    })),
    recentCalls: auditRows.map((row) => ({
      requestId: row.requestId,
      status: row.status,
      clientModel: row.clientModel,
      createdAt: row.createdAt.toISOString(),
      errorCode: row.errorCode,
      errorMessage: truncateErrorMessage(row.errorMessage),
    })),
    modelsByChannel,
    relayBaseUrl: input.relayBaseUrl,
  };
}
