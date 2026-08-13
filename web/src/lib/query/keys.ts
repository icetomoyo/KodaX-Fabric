/**
 * Central query-key factory. Keeping keys in one place makes cache
 * invalidation precise (e.g. `qk.admin.all` wipes every admin list after a
 * mutation) and avoids hand-rolled key strings scattered across features.
 */
export const qk = {
  me: ["me"] as const,
  myKeys: ["me", "keys"] as const,
  health: ["health"] as const,
  admin: {
    all: ["admin"] as const,
    overview: () => [...qk.admin.all, "overview"] as const,
    users: () => [...qk.admin.all, "users"] as const,
    providerKeys: () => [...qk.admin.all, "provider-keys"] as const,
    pools: () => [...qk.admin.all, "pools"] as const,
    channels: () => [...qk.admin.all, "channels"] as const,
    virtualKeys: () => [...qk.admin.all, "virtual-keys"] as const,
  },
};
