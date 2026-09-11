/**
 * Product facts for the in-app Token Bot. Keep knowledge.md aligned with GuideView;
 * do not invent features that are not shipped.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const KNOWLEDGE_PATH = fileURLToPath(new URL("./knowledge.md", import.meta.url));

export function loadSupportKnowledge(): string {
  return readFileSync(KNOWLEDGE_PATH, "utf8").trim();
}

export const SUPPORT_BOT_KNOWLEDGE = loadSupportKnowledge();

export function applySupportOriginPlaceholders(text: string, origin: string): string {
  return text.replaceAll("{origin}", origin);
}

export function buildSupportAgentSystemPrompt(relayBaseUrl: string): string {
  const baseUrl = relayBaseUrl.replace(/\/+$/, "");
  const origin = baseUrl.replace(/\/ai$/i, "");
  const knowledge = applySupportOriginPlaceholders(SUPPORT_BOT_KNOWLEDGE, origin);
  return `${knowledge}

# 当前这次请求

员工侧 Base URL（可直接复制）：\`${baseUrl}\`

用户问 Base URL / 填什么地址时：第一行给出上面这个完整 URL。不要写 {origin}，不要让用户自己拼。不要加 :3000 或 :3100。一两句说明即可。

# 工具

教程已在上方。需要查这个用户的实时数据时再调用工具，没有工具结果时不要编造人名、Key 状态或错误原因：
- lookup_my_account：当前用户的 Key 前缀、最近调用、是否已加入团队
- lookup_request：用户给出 Request ID 后，查询该次调用的状态和错误
- lookup_invite_contacts：仅当用户要找管理员邀请时使用；只使用返回的姓名与角色，不要编造或索要别人的手机号
- join_department：用户说出自己的部门名、说「我是某某部门的」或要求加入部门时，把当前用户加入该部门；同名部门时再问企业名`.trim();
}
