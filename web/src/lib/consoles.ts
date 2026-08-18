import { Activity, BookOpen, Building2, KeyRound, ListOrdered, Server, Table2, Tags, UserPlus } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type NavItem = { to: string; label: string; icon: LucideIcon; teamAdminOnly?: boolean };

export function homeFor(role?: string | null): string {
  switch (role) {
    case "super_admin":
      return "/platform";
    case "enterprise_admin":
    case "org_admin":
    case "admin":
      return "/enterprise";
    default:
      return "/team";
  }
}

export function navFor(role?: string | null): NavItem[] {
  const home = homeFor(role);
  if (home === "/platform") {
    return [
      { to: "/platform/overview", label: "用量总览", icon: Activity },
      { to: "/platform/requests", label: "请求流水", icon: ListOrdered },
      { to: "/platform/projects", label: "Team", icon: Building2 },
      { to: "/platform/keys", label: "虚拟钥匙", icon: KeyRound },
      { to: "/platform/providers", label: "上游 Provider", icon: Server },
      { to: "/platform/models", label: "Model 映射", icon: Tags },
      { to: "/platform/prices", label: "价格与倍率", icon: Table2 },
      { to: "/platform/docs", label: "接口文档", icon: BookOpen },
    ];
  }
  if (home === "/enterprise") {
    return [
      { to: "/enterprise/overview", label: "用量总览", icon: Activity },
      { to: "/enterprise/requests", label: "请求流水", icon: ListOrdered },
      { to: "/enterprise/projects", label: "Team", icon: Building2 },
      { to: "/enterprise/keys", label: "虚拟钥匙", icon: KeyRound },
    ];
  }
  return [
    { to: "/team/overview", label: "用量总览", icon: Activity },
    { to: "/team/requests", label: "请求流水", icon: ListOrdered },
    { to: "/team/keys", label: "虚拟钥匙", icon: KeyRound },
    { to: "/team/members", label: "加开发者", icon: UserPlus, teamAdminOnly: true },
  ];
}

export function visibleNav(role?: string | null): NavItem[] {
  return navFor(role).filter((item) => !item.teamAdminOnly || role === "team_admin");
}