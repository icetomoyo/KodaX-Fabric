export type Operator = {
  id: number;
  phone: string;
  name: string;
  role: "admin" | "developer" | string;
  status: string;
  created_at: string;
};

export type Overview = {
  operators: number;
  provider_keys: number;
  active_keys: number;
  disabled_keys: number;
  pools: number;
  channels: number;
  virtual_keys: number;
};

export type ProviderKey = {
  id: number;
  provider_code: string;
  status: string;
};

export type Pool = {
  id: number;
  name: string;
  group_name: string;
};

export type Channel = {
  id: number;
  pool_id: number;
  provider_key_id: number;
  protocol: string;
  base_url: string;
  status: string;
};

export type VirtualKey = {
  id: number;
  pool_id: number;
  owner_id: number;
  status: string;
  key_prefix: string;
  key_masked: string;
  secret?: string;
};

export type Health = {
  ok: boolean;
  service?: string;
  postgres?: boolean;
};

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const res = await fetch(path, { ...init, headers, credentials: "include" });
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
    const msg = typeof err?.error === "string" ? err.error : err?.error?.message || res.statusText;
    const e = new Error(msg || `HTTP ${res.status}`);
    (e as Error & { status?: number }).status = res.status;
    throw e;
  }
  return data as T;
}

export const api = {
  health: () => fetch("/health").then((r) => r.json() as Promise<Health>),
  login: (phone: string, password: string) =>
    req<{ operator: Operator }>("/console/v1/login", {
      method: "POST",
      body: JSON.stringify({ phone, password }),
    }),
  logout: () => req<{ ok: boolean }>("/console/v1/logout", { method: "POST" }),
  me: () => req<{ operator: Operator }>("/console/v1/me"),
  patchMe: (body: { name?: string; password?: string }) =>
    req<{ operator: Operator }>("/console/v1/me", { method: "PATCH", body: JSON.stringify(body) }),
  myKeys: () => req<{ virtual_keys: VirtualKey[] }>("/console/v1/me/keys"),

  overview: () => req<Overview>("/console/v1/overview"),
  users: () => req<{ users: Operator[] }>("/console/v1/users"),
  createUser: (body: { phone: string; name: string; role: string; password: string }) =>
    req<{ user: Operator }>("/console/v1/users", { method: "POST", body: JSON.stringify(body) }),
  patchUser: (id: number, body: Record<string, unknown>) =>
    req<{ user: Operator }>(`/console/v1/users/${id}`, { method: "PATCH", body: JSON.stringify(body) }),

  providerKeys: () => req<{ provider_keys: ProviderKey[] }>("/console/v1/provider-keys"),
  createProviderKey: (body: { provider_code: string; secret: string }) =>
    req<ProviderKey>("/console/v1/provider-keys", { method: "POST", body: JSON.stringify(body) }),
  patchProviderKey: (id: number, body: Record<string, unknown>) =>
    req<ProviderKey>(`/console/v1/provider-keys/${id}`, { method: "PATCH", body: JSON.stringify(body) }),

  pools: () => req<{ pools: Pool[] }>("/console/v1/pools"),
  createPool: (body: { name: string; group_name: string }) =>
    req<Pool>("/console/v1/pools", { method: "POST", body: JSON.stringify(body) }),

  channels: () => req<{ channels: Channel[] }>("/console/v1/channels"),
  createChannel: (body: Record<string, unknown>) =>
    req<Channel>("/console/v1/channels", { method: "POST", body: JSON.stringify(body) }),
  patchChannel: (id: number, body: Record<string, unknown>) =>
    req<Channel>(`/console/v1/channels/${id}`, { method: "PATCH", body: JSON.stringify(body) }),

  virtualKeys: () => req<{ virtual_keys: VirtualKey[] }>("/console/v1/virtual-keys"),
  createVK: (body: { pool_id: number; owner_id: number }) =>
    req<VirtualKey>("/console/v1/virtual-keys", { method: "POST", body: JSON.stringify(body) }),
  patchVK: (id: number, body: Record<string, unknown>) =>
    req<VirtualKey>(`/console/v1/virtual-keys/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
};
