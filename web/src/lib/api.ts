const TOKEN_KEY = "th_admin_token";

export function getToken(): string {
  return sessionStorage.getItem(TOKEN_KEY) ?? "";
}

export function setToken(t: string) {
  if (t) sessionStorage.setItem(TOKEN_KEY, t);
  else sessionStorage.removeItem(TOKEN_KEY);
}

export type ProviderKey = {
  id: number;
  provider_code: string;
  status: string;
  team_id: number;
  rpm_limit: number;
  rpm_burst: number;
  has_replacement: boolean;
  activate_at?: string;
  retire_at?: string;
};

export type ChannelPool = {
  id: number;
  name: string;
  group_name: string;
  team_id: number;
};

export type ChannelAdmin = {
  id: number;
  pool_id: number;
  provider_key_id: number;
  protocol: string;
  base_url: string;
  status: string;
  priority: number;
  weight: number;
  models?: string[];
};

export type VirtualKey = {
  id: number;
  pool_id: number;
  project_id: number;
  status: string;
  key_prefix?: string;
  key_masked?: string;
  expires_at?: string;
  model_scope?: string[];
  ip_allow?: string[];
  rpm_limit: number;
  rpm_burst: number;
  monthly_hard: number;
  monthly_soft: number;
};

export type VKApplication = {
  id: number;
  team_id: number;
  project_id: number;
  pool_id: number;
  purpose: string;
  monthly_hard: number;
  monthly_soft: number;
  model_scope?: string[];
  expires_at?: string;
  ip_allow?: string[];
  status: string;
  reject_reason?: string;
  virtual_key_id?: number;
  key_prefix?: string;
  key_masked?: string;
  created_at: string;
};

export type Health = {
  ok: boolean;
  service?: string;
  postgres?: boolean;
  redis?: boolean;
  version?: string;
  commit?: string;
};

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const tok = getToken();
  if (tok) headers.set("X-Admin-Token", tok);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const res = await fetch(path, { ...init, headers });
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
  }
  if (!res.ok) {
    const err = data as { error?: { message?: string } | string };
    const msg =
      typeof err?.error === "string" ? err.error : err?.error?.message || res.statusText;
    throw new Error(msg || `HTTP ${res.status}`);
  }
  return data as T;
}

export const api = {
  health: () => fetch("/health").then((r) => r.json() as Promise<Health>),
  live: () => fetch("/live").then((r) => r.json() as Promise<{ ok: boolean }>),

  listProviders: () => req<{ providers: ProviderKey[] }>("/admin/v1/providers"),
  createProvider: (body: Record<string, unknown>) =>
    req<ProviderKey>("/admin/v1/providers", { method: "POST", body: JSON.stringify(body) }),
  patchProvider: (id: number, body: Record<string, unknown>) =>
    req<ProviderKey>(`/admin/v1/providers/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  disableProvider: (id: number) =>
    req<{ ok: boolean }>(`/admin/v1/providers/${id}/disable`, { method: "POST" }),
  rotateKey: (id: number, secret: string) =>
    req<{ ok: boolean }>(`/admin/v1/provider-keys/${id}/rotate`, {
      method: "POST",
      body: JSON.stringify({ secret }),
    }),
  activateRotate: (id: number) =>
    req<{ ok: boolean }>(`/admin/v1/provider-keys/${id}/rotate/activate`, { method: "POST" }),

  listPools: () => req<{ pools: ChannelPool[] }>("/admin/v1/pools"),
  createPool: (body: Record<string, unknown>) =>
    req<ChannelPool>("/admin/v1/pools", { method: "POST", body: JSON.stringify(body) }),
  patchPool: (id: number, body: Record<string, unknown>) =>
    req<ChannelPool>(`/admin/v1/pools/${id}`, { method: "PATCH", body: JSON.stringify(body) }),

  listChannels: () => req<{ channels: ChannelAdmin[] }>("/admin/v1/channels"),
  createChannel: (body: Record<string, unknown>) =>
    req<ChannelAdmin>("/admin/v1/channels", { method: "POST", body: JSON.stringify(body) }),
  patchChannel: (id: number, body: Record<string, unknown>) =>
    req<ChannelAdmin>(`/admin/v1/channels/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  disableChannel: (id: number) =>
    req<{ ok: boolean }>(`/admin/v1/channels/${id}/disable`, { method: "POST" }),

  listVKs: () => req<{ virtual_keys: VirtualKey[] }>("/admin/v1/virtual-keys"),
  createVK: (body: Record<string, unknown>) =>
    req<{ virtual_key: VirtualKey; plaintext: string }>("/admin/v1/virtual-keys", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  patchVK: (id: number, body: Record<string, unknown>) =>
    req<VirtualKey>(`/admin/v1/virtual-keys/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  disableVK: (id: number) =>
    req<{ ok: boolean }>(`/admin/v1/virtual-keys/${id}/disable`, { method: "POST" }),

  listApps: () => req<{ applications: VKApplication[] }>("/admin/v1/vk-applications"),
  createApp: (body: Record<string, unknown>) =>
    req<VKApplication>("/admin/v1/vk-applications", { method: "POST", body: JSON.stringify(body) }),
  approveApp: (id: number) =>
    req<{ application: VKApplication; virtual_key: string }>(`/admin/v1/vk-applications/${id}/approve`, {
      method: "POST",
    }),
  rejectApp: (id: number, reason: string) =>
    req<VKApplication>(`/admin/v1/vk-applications/${id}/reject`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    }),
};

export async function probeAdmin(token: string): Promise<boolean> {
  const headers = new Headers({ "X-Admin-Token": token });
  const res = await fetch("/admin/v1/pools", { headers });
  return res.ok;
}
