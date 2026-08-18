export const qk = {
  me: ["me"] as const,
  health: ["health"] as const,
  admin: {
    all: ["admin"] as const,
    projects: () => [...qk.admin.all, "projects"] as const,
    virtualKeys: () => [...qk.admin.all, "virtual-keys"] as const,
    providers: () => [...qk.admin.all, "providers"] as const,
    models: () => [...qk.admin.all, "models"] as const,
    prices: () => [...qk.admin.all, "prices"] as const,
    usage: (day?: string, project?: string) => [...qk.admin.all, "usage", day ?? "", project ?? ""] as const,
  },
};
