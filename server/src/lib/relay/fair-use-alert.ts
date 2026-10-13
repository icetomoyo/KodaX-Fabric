import { eq } from "drizzle-orm";
import { env } from "../../config.js";
import { db } from "../../db/client.js";
import {
  credentialBindingMembers,
  credentialBindings,
  employees,
  productLines,
} from "../../db/schema/index.js";

/** Why the upstream reply made us take a Key out of rotation. */
export type KeyDisabledAlertKind = "fair_use" | "plan_expired";

export type FairUseAlertInput = {
  /** Defaults to the fair-use restriction. */
  kind?: KeyDisabledAlertKind;
  credentialId: number;
  credentialSuffix: string;
  productLineId: number;
  vendorCode: string | null;
  vendorMessage: string | null;
  at?: Date;
};

export function formatFairUseAlertContent(input: {
  kind?: KeyDisabledAlertKind;
  credentialSuffix: string;
  productLineName: string;
  vendorCode: string | null;
  vendorMessage: string | null;
  memberNames: readonly string[];
  at: Date;
  timeZone: string;
}): string {
  const time = new Intl.DateTimeFormat("zh-CN", {
    timeZone: input.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(input.at);
  const users = input.memberNames.length > 0 ? input.memberNames.join("、") : "无";
  const code = input.vendorCode ? `（${input.vendorCode}）` : "";
  const detail = input.vendorMessage ? `上游原文：${input.vendorMessage.slice(0, 200)}。` : "";
  if (input.kind === "plan_expired") {
    return (
      `【套餐告警】渠道「${input.productLineName}」的渠道 Key 尾号 ${input.credentialSuffix} ` +
      `所在套餐已到期或失效${code}，已自动停用，续订后需管理员手动启用。` +
      `当时在用这把 Key 的人：${users}。${detail}时间：${time}`
    );
  }
  return (
    `【风控告警】渠道「${input.productLineName}」的渠道 Key 尾号 ${input.credentialSuffix} ` +
    `被上游判定不符合公平使用策略${code}，已自动停用，需管理员确认解除限制后手动启用。` +
    `当时在用这把 Key 的人：${users}。${detail}时间：${time}`
  );
}

/**
 * 上游回复让一把 Key 被自动停用时（公平使用风控、套餐到期失效）通知管理员。只发通知，不影响请求处理：
 * 任何失败都只记日志。成员名单要在他们下一次请求换 Key 之前读出来。
 */
export async function notifyFairUseRestriction(input: FairUseAlertInput): Promise<void> {
  try {
    const [line] = await db
      .select({ name: productLines.name })
      .from(productLines)
      .where(eq(productLines.id, input.productLineId))
      .limit(1);
    const members = await db
      .select({ name: employees.name })
      .from(credentialBindingMembers)
      .innerJoin(
        credentialBindings,
        eq(credentialBindings.id, credentialBindingMembers.bindingId),
      )
      .innerJoin(employees, eq(employees.id, credentialBindingMembers.employeeId))
      .where(eq(credentialBindings.credentialId, input.credentialId));
    const content = formatFairUseAlertContent({
      kind: input.kind,
      credentialSuffix: input.credentialSuffix,
      productLineName: line?.name ?? String(input.productLineId),
      vendorCode: input.vendorCode,
      vendorMessage: input.vendorMessage,
      memberNames: members.map((row) => row.name),
      at: input.at ?? new Date(),
      timeZone: env.QUOTA_TIMEZONE,
    });
    console.error(`[fair-use-alert] ${content}`);

    const url = env.ALERT_WEBHOOK_URL;
    if (!url) return;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ msgtype: "text", text: { content } }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      console.error("[fair-use-alert] webhook failed", {
        credentialId: input.credentialId,
        status: response.status,
      });
    }
  } catch (error) {
    console.error("[fair-use-alert] failed to notify", { credentialId: input.credentialId }, error);
  }
}
