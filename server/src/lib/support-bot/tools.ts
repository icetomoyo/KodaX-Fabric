import { Type } from "@earendil-works/pi-ai";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import {
  formatAccountContext,
  isBareSuperAdmin,
  loadSupportAccountSnapshot,
  type LoadSupportAccountContextInput,
} from "./account-context.js";
import { lookupInviteContacts } from "./invite-contacts.js";
import { joinDepartmentForEmployee } from "./join-department.js";
import { lookupSupportRequest } from "./lookup-request.js";

export const SUPPORT_BOT_TOOL_NAMES = [
  "lookup_my_account",
  "lookup_request",
  "lookup_invite_contacts",
  "join_department",
] as const;

export type SupportBotToolName = (typeof SUPPORT_BOT_TOOL_NAMES)[number];

export type SupportAgentToolContext = {
  account: LoadSupportAccountContextInput;
  lookupAccount?: () => Promise<string>;
  lookupRequest?: (requestId: string) => Promise<string>;
  lookupInvite?: (input: {
    enterpriseName?: string;
    teamName?: string;
    departmentName?: string;
  }) => Promise<string>;
  joinDepartment?: (input: {
    departmentName?: string;
    enterpriseName?: string;
  }) => Promise<string>;
};

function textResult(text: string) {
  return {
    content: [{ type: "text" as const, text }],
    details: {},
  };
}

function readString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

export function createSupportAgentTools(ctx: SupportAgentToolContext): AgentTool[] {
  const lookupAccount =
    ctx.lookupAccount ??
    (async () => formatAccountContext(await loadSupportAccountSnapshot(ctx.account)));
  const lookupRequest =
    ctx.lookupRequest ??
    ((requestId: string) =>
      lookupSupportRequest({
        requestId,
        employeeId: ctx.account.employeeId,
        bareAdmin: isBareSuperAdmin(ctx.account),
      }));
  const lookupInviteFn = ctx.lookupInvite ?? lookupInviteContacts;
  const joinDepartmentFn =
    ctx.joinDepartment ??
    ((input: { departmentName?: string; enterpriseName?: string }) =>
      joinDepartmentForEmployee({
        employeeId: ctx.account.employeeId,
        departmentName: input.departmentName,
        enterpriseName: input.enterpriseName,
      }));

  const lookupMyAccount: AgentTool = {
    name: "lookup_my_account",
    label: "查当前账号",
    description:
      "只读查询当前提问用户的 Key 前缀、协议、状态、最近调用和是否已加入团队。不要用它查别人。",
    parameters: Type.Object({}),
    execute: async () => textResult(await lookupAccount()),
  };

  const lookupRequestTool: AgentTool = {
    name: "lookup_request",
    label: "查调用",
    description:
      "用用户提供的 Request ID 查询该次调用的状态、模型、错误码和错误信息。没有 ID 时先让用户到「我的调用」复制。不要编造错误原因。",
    parameters: Type.Object({
      requestId: Type.String({ description: "用户给出的 Request ID" }),
    }),
    execute: async (_toolCallId, params) => {
      const requestId = readString((params as { requestId?: unknown }).requestId) ?? "";
      return textResult(await lookupRequest(requestId));
    },
  };

  const lookupInvite: AgentTool = {
    name: "lookup_invite_contacts",
    label: "查邀请人",
    description:
      "仅当用户明确要找管理员邀请时使用。用户说出自己的部门并想加入时，改用 join_department。按企业名、部门名只读查找管理员姓名与角色，不含手机号。",
    parameters: Type.Object({
      enterpriseName: Type.Optional(Type.String({ description: "企业名" })),
      teamName: Type.Optional(Type.String({ description: "团队名" })),
      departmentName: Type.Optional(Type.String({ description: "部门名" })),
    }),
    execute: async (_toolCallId, params) => {
      const raw = params as {
        enterpriseName?: unknown;
        teamName?: unknown;
        departmentName?: unknown;
      };
      return textResult(
        await lookupInviteFn({
          enterpriseName: readString(raw.enterpriseName),
          teamName: readString(raw.teamName),
          departmentName: readString(raw.departmentName),
        }),
      );
    },
  };

  const joinDepartment: AgentTool = {
    name: "join_department",
    label: "加入部门",
    description:
      "把当前提问用户加入他说出的部门。用户说「我是某某部门的」「帮我加入某某部门」或给出部门名时必须调用。departmentName 必填；多家企业同名时再带 enterpriseName。不要替别人加入。",
    parameters: Type.Object({
      departmentName: Type.String({ description: "用户说出的部门名，可带路径如 业务产品技术部/产品组" }),
      enterpriseName: Type.Optional(Type.String({ description: "企业名，同名部门时需要" })),
    }),
    execute: async (_toolCallId, params) => {
      const raw = params as {
        departmentName?: unknown;
        enterpriseName?: unknown;
      };
      return textResult(
        await joinDepartmentFn({
          departmentName: readString(raw.departmentName),
          enterpriseName: readString(raw.enterpriseName),
        }),
      );
    },
  };

  return [lookupMyAccount, lookupRequestTool, lookupInvite, joinDepartment];
}

export function isSupportBotToolName(name: string): name is SupportBotToolName {
  return (SUPPORT_BOT_TOOL_NAMES as readonly string[]).includes(name);
}
