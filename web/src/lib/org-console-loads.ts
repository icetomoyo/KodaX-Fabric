import { TABLE_PAGE_SIZE } from "./table-page.ts";

export const ORG_CONSOLE_PAGE_SIZE = TABLE_PAGE_SIZE;

export function orgConsoleUserListParams(input: {
  enterpriseId: number;
  departmentId: number | null;
  page: number;
  q?: string;
}): {
  enterpriseId: number;
  departmentId?: number;
  q?: string;
  limit: number;
  offset: number;
} {
  const page = Math.max(1, input.page);
  const q = input.q?.trim();
  return {
    enterpriseId: input.enterpriseId,
    ...(q
      ? { q }
      : input.departmentId != null
        ? { departmentId: input.departmentId }
        : {}),
    limit: ORG_CONSOLE_PAGE_SIZE,
    offset: (page - 1) * ORG_CONSOLE_PAGE_SIZE,
  };
}
