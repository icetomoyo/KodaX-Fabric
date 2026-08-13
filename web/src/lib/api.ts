export type HttpMethod = "GET" | "POST";

export type RequestSpec<TBody = Record<string, unknown>> = {
  method: HttpMethod;
  path: string;
  body?: TBody;
};

export type Envelope<T> = { ok: boolean; data: T };

export type Session = {
  role: string;
  phone: string;
  name?: string;
};

export const requests = {
  login(phone: string, password: string): RequestSpec<{ phone: string; password: string }> {
    return { method: "POST", path: "/api/v1/auth/login", body: { phone, password } };
  },
  register(phone: string, password: string, name: string): RequestSpec<{ phone: string; password: string; name: string }> {
    return { method: "POST", path: "/api/v1/auth/register", body: { phone, password, name } };
  },
  me(): RequestSpec {
    return { method: "GET", path: "/api/v1/auth/me" };
  },
  listProviders(): RequestSpec {
    return { method: "GET", path: "/api/v1/providers" };
  },
  createProvider(input: { code: string; name: string; default_base_url: string }): RequestSpec {
    return { method: "POST", path: "/api/v1/providers", body: input };
  },
  listProviderKeys(): RequestSpec {
    return { method: "GET", path: "/api/v1/provider-keys" };
  },
  createProviderKey(input: { provider_code: string; label: string; secret: string; status?: string }): RequestSpec {
    return { method: "POST", path: "/api/v1/provider-keys", body: input };
  },
  setProviderKeyStatus(id: number | string, status: string): RequestSpec<{ status: string }> {
    return { method: "POST", path: `/api/v1/provider-keys/${id}/status`, body: { status } };
  },
  listPools(): RequestSpec {
    return { method: "GET", path: "/api/v1/pools" };
  },
  createPool(input: { name: string; group_name: string }): RequestSpec {
    return { method: "POST", path: "/api/v1/pools", body: input };
  },
  listChannels(): RequestSpec {
    return { method: "GET", path: "/api/v1/channels" };
  },
  createChannel(input: {
    pool_id: number;
    provider_key_id: number;
    protocol: string;
    base_url: string;
    status?: string;
    priority: number;
    weight: number;
  }): RequestSpec {
    return { method: "POST", path: "/api/v1/channels", body: input };
  },
  updateChannel(id: number | string, input: { status: string; priority: number; weight: number }): RequestSpec {
    return { method: "POST", path: `/api/v1/channels/${id}`, body: input };
  },
  listVirtualKeys(): RequestSpec {
    return { method: "GET", path: "/api/v1/virtual-keys" };
  },
  createVirtualKey(input: {
    name: string;
    model_scope: string;
    ip_whitelist?: string;
    pool_id: number;
    rpm_limit: number;
    monthly_token_limit: number;
  }): RequestSpec {
    return { method: "POST", path: "/api/v1/virtual-keys", body: input };
  },
  revokeVirtualKey(id: number | string): RequestSpec {
    return { method: "POST", path: `/api/v1/virtual-keys/${id}/revoke` };
  },
  listVkApplications(): RequestSpec {
    return { method: "GET", path: "/api/v1/vk-applications" };
  },
  approveVkApplication(id: number | string): RequestSpec {
    return { method: "POST", path: `/api/v1/vk-applications/${id}/approve` };
  },
  createMyVkApplication(input: { pool_id: number; name: string }): RequestSpec {
    return { method: "POST", path: "/api/v1/me/vk-applications", body: input };
  },
  listMyVkApplications(): RequestSpec {
    return { method: "GET", path: "/api/v1/me/vk-applications" };
  },
  revealMyVkApplication(id: number | string): RequestSpec {
    return { method: "POST", path: `/api/v1/me/vk-applications/${id}/reveal` };
  },
};

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export async function callApi<T>(spec: RequestSpec, fetchImpl: FetchLike = fetch): Promise<Envelope<T>> {
  const init: RequestInit = {
    method: spec.method,
    credentials: "include",
    headers: spec.body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: spec.body !== undefined ? JSON.stringify(spec.body) : undefined,
  };
  const res = await fetchImpl(spec.path, init);
  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(text || `HTTP ${res.status}`);
  }
  if (!res.ok) {
    const err = parsed as { error?: string; raw?: string };
    throw new Error(err.error || err.raw || text || `HTTP ${res.status}`);
  }
  return parsed as Envelope<T>;
}
