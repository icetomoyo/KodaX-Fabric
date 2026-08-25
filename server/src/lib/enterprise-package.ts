export const ENTERPRISE_PACKAGE_PLANS = {
  plus: { plan: "plus", label: "Plus", monthlyYuan: 10_000 },
  pro: { plan: "pro", label: "Pro", monthlyYuan: 50_000 },
  max: { plan: "max", label: "Max", monthlyYuan: 200_000 },
} as const;

export type EnterprisePackagePlan = keyof typeof ENTERPRISE_PACKAGE_PLANS;

export const ENTERPRISE_PACKAGE_PLAN_LIST = [
  ENTERPRISE_PACKAGE_PLANS.plus,
  ENTERPRISE_PACKAGE_PLANS.pro,
  ENTERPRISE_PACKAGE_PLANS.max,
] as const;

export function isEnterprisePackagePlan(value: unknown): value is EnterprisePackagePlan {
  return value === "plus" || value === "pro" || value === "max";
}

export function packageMonthlyYuan(plan: EnterprisePackagePlan | null | undefined): number {
  if (!isEnterprisePackagePlan(plan)) return 0;
  return ENTERPRISE_PACKAGE_PLANS[plan].monthlyYuan;
}

export function parseYuanNumber(value: string | number | null | undefined): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const raw = String(value ?? "").trim();
  if (!raw || !/^-?\d+(\.\d+)?$/.test(raw)) return 0;
  return Number(raw);
}

export function yuanToCents(value: string | number | null | undefined): number {
  return Math.round(parseYuanNumber(value) * 100);
}

export function isYuanQuota(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 1_000_000_000;
}

export function teamQuotaFitsPackage(
  packageYuan: number,
  otherTeamsAssigned: number,
  nextTeamQuota: number,
): string | null {
  if (nextTeamQuota < 0) return "额度不能为负";
  if (packageYuan <= 0 && nextTeamQuota > 0) {
    return "企业尚未获得套餐，无法给团队分配额度";
  }
  if (otherTeamsAssigned + nextTeamQuota > packageYuan) {
    return "团队额度合计不能超过企业套餐金额";
  }
  return null;
}
