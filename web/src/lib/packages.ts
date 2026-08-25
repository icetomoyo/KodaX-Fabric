export const ENTERPRISE_PACKAGES = [
  { plan: "plus", label: "Plus", monthlyYuan: 10_000 },
  { plan: "pro", label: "Pro", monthlyYuan: 50_000 },
  { plan: "max", label: "Max", monthlyYuan: 200_000 },
] as const;

export type EnterprisePackagePlan = (typeof ENTERPRISE_PACKAGES)[number]["plan"];

export function packageLabel(plan: string | null | undefined): string {
  const found = ENTERPRISE_PACKAGES.find((item) => item.plan === plan);
  return found?.label ?? "未发放";
}

export function packageMonthlyYuan(plan: string | null | undefined): number {
  const found = ENTERPRISE_PACKAGES.find((item) => item.plan === plan);
  return found?.monthlyYuan ?? 0;
}
