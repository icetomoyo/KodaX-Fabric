import { describe, expect, it } from "vitest";
import { callApi, requests, type RequestSpec } from "./api";

function bodyKeys(spec: RequestSpec | { body?: Record<string, unknown> }): string[] {
  return spec.body ? Object.keys(spec.body).sort() : [];
}

describe("request builders match Go admin handlers", () => {
  it("POST /api/v1/auth/login", () => {
    const spec = requests.login("18612243416", "Hz@123456");
    expect(spec).toEqual({
      method: "POST",
      path: "/api/v1/auth/login",
      body: { phone: "18612243416", password: "Hz@123456" },
    });
    expect(bodyKeys(spec)).toEqual(["password", "phone"]);
  });

  it("POST /api/v1/auth/register", () => {
    const spec = requests.register("13900000000", "secret", "dev");
    expect(spec.method).toBe("POST");
    expect(spec.path).toBe("/api/v1/auth/register");
    expect(spec.body).toEqual({ phone: "13900000000", password: "secret", name: "dev" });
    expect(bodyKeys(spec)).toEqual(["name", "password", "phone"]);
  });

  it("GET /api/v1/auth/me", () => {
    expect(requests.me()).toEqual({ method: "GET", path: "/api/v1/auth/me" });
  });

  it("GET/POST /api/v1/providers", () => {
    expect(requests.listProviders()).toEqual({ method: "GET", path: "/api/v1/providers" });
    const spec = requests.createProvider({
      code: "deepseek",
      name: "DeepSeek",
      default_base_url: "https://api.deepseek.com",
    });
    expect(spec.method).toBe("POST");
    expect(spec.path).toBe("/api/v1/providers");
    expect(bodyKeys(spec)).toEqual(["code", "default_base_url", "name"]);
  });

  it("GET/POST /api/v1/provider-keys and status", () => {
    expect(requests.listProviderKeys()).toEqual({ method: "GET", path: "/api/v1/provider-keys" });
    const create = requests.createProviderKey({
      provider_code: "deepseek",
      label: "prod",
      secret: "sk-never-echo",
    });
    expect(create.method).toBe("POST");
    expect(create.path).toBe("/api/v1/provider-keys");
    expect(bodyKeys(create)).toEqual(["label", "provider_code", "secret"]);
    expect(create.body).toMatchObject({ secret: "sk-never-echo" });
    const status = requests.setProviderKeyStatus(3, "disabled");
    expect(status).toEqual({
      method: "POST",
      path: "/api/v1/provider-keys/3/status",
      body: { status: "disabled" },
    });
  });

  it("GET/POST /api/v1/pools", () => {
    expect(requests.listPools()).toEqual({ method: "GET", path: "/api/v1/pools" });
    const spec = requests.createPool({ name: "std", group_name: "standard" });
    expect(spec.path).toBe("/api/v1/pools");
    expect(bodyKeys(spec)).toEqual(["group_name", "name"]);
  });

  it("GET/POST /api/v1/channels and update", () => {
    expect(requests.listChannels()).toEqual({ method: "GET", path: "/api/v1/channels" });
    const create = requests.createChannel({
      pool_id: 1,
      provider_key_id: 2,
      protocol: "openai_chat",
      base_url: "https://api.deepseek.com",
      priority: 0,
      weight: 100,
    });
    expect(create.method).toBe("POST");
    expect(create.path).toBe("/api/v1/channels");
    expect(bodyKeys(create)).toEqual(["base_url", "pool_id", "priority", "protocol", "provider_key_id", "weight"]);
    const update = requests.updateChannel(9, { status: "disabled", priority: 1, weight: 50 });
    expect(update.path).toBe("/api/v1/channels/9");
    expect(bodyKeys(update)).toEqual(["priority", "status", "weight"]);
  });

  it("GET/POST /api/v1/virtual-keys and revoke", () => {
    expect(requests.listVirtualKeys()).toEqual({ method: "GET", path: "/api/v1/virtual-keys" });
    const create = requests.createVirtualKey({
      name: "cursor",
      model_scope: "",
      ip_whitelist: "",
      pool_id: 1,
      rpm_limit: 60,
      monthly_token_limit: 0,
    });
    expect(create.method).toBe("POST");
    expect(create.path).toBe("/api/v1/virtual-keys");
    expect(bodyKeys(create)).toEqual([
      "ip_whitelist",
      "model_scope",
      "monthly_token_limit",
      "name",
      "pool_id",
      "rpm_limit",
    ]);
    expect(requests.revokeVirtualKey(4)).toEqual({
      method: "POST",
      path: "/api/v1/virtual-keys/4/revoke",
    });
  });

  it("vk applications admin + developer", () => {
    expect(requests.listVkApplications()).toEqual({ method: "GET", path: "/api/v1/vk-applications" });
    expect(requests.approveVkApplication(7)).toEqual({
      method: "POST",
      path: "/api/v1/vk-applications/7/approve",
    });
    const apply = requests.createMyVkApplication({ pool_id: 1, name: "dev-key" });
    expect(apply.method).toBe("POST");
    expect(apply.path).toBe("/api/v1/me/vk-applications");
    expect(bodyKeys(apply)).toEqual(["name", "pool_id"]);
    expect(requests.listMyVkApplications()).toEqual({ method: "GET", path: "/api/v1/me/vk-applications" });
    expect(requests.revealMyVkApplication(8)).toEqual({
      method: "POST",
      path: "/api/v1/me/vk-applications/8/reveal",
    });
  });
});

describe("callApi drives the shipped fetch path", () => {
  it("serializes login to the Go handler", async () => {
    const seen: { url: string; init?: RequestInit }[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      seen.push({ url: String(input), init });
      return new Response(JSON.stringify({ ok: true, data: { role: "admin", phone: "18612243416" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };
    const spec = requests.login("18612243416", "Hz@123456");
    const out = await callApi<{ role: string; phone: string }>(spec, fetchImpl);
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe("/api/v1/auth/login");
    expect(seen[0].init?.method).toBe("POST");
    expect(seen[0].init?.credentials).toBe("include");
    expect(JSON.parse(String(seen[0].init?.body))).toEqual({
      phone: "18612243416",
      password: "Hz@123456",
    });
    expect(out.data.role).toBe("admin");
  });

  it("POSTs create/revoke/approve/reveal without inventing keys", async () => {
    const seen: { url: string; method?: string; body?: string }[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      seen.push({ url: String(input), method: init?.method, body: init?.body ? String(init.body) : undefined });
      return new Response(JSON.stringify({ ok: true, data: { id: 1, virtual_key: "fab-x" } }), { status: 200 });
    };
    await callApi(requests.createProvider({ code: "a", name: "A", default_base_url: "https://x" }), fetchImpl);
    await callApi(requests.createProviderKey({ provider_code: "a", label: "k", secret: "sk" }), fetchImpl);
    await callApi(requests.createPool({ name: "p", group_name: "standard" }), fetchImpl);
    await callApi(
      requests.createChannel({
        pool_id: 1,
        provider_key_id: 2,
        protocol: "anthropic_messages",
        base_url: "https://x",
        priority: 0,
        weight: 100,
      }),
      fetchImpl,
    );
    await callApi(
      requests.createVirtualKey({
        name: "vk",
        model_scope: "",
        pool_id: 1,
        rpm_limit: 60,
        monthly_token_limit: 0,
      }),
      fetchImpl,
    );
    await callApi(requests.revokeVirtualKey(11), fetchImpl);
    await callApi(requests.approveVkApplication(12), fetchImpl);
    await callApi(requests.createMyVkApplication({ pool_id: 1, name: "mine" }), fetchImpl);
    await callApi(requests.revealMyVkApplication(13), fetchImpl);

    expect(seen.map((s) => `${s.method} ${s.url}`)).toEqual([
      "POST /api/v1/providers",
      "POST /api/v1/provider-keys",
      "POST /api/v1/pools",
      "POST /api/v1/channels",
      "POST /api/v1/virtual-keys",
      "POST /api/v1/virtual-keys/11/revoke",
      "POST /api/v1/vk-applications/12/approve",
      "POST /api/v1/me/vk-applications",
      "POST /api/v1/me/vk-applications/13/reveal",
    ]);
    expect(JSON.parse(seen[1].body || "{}")).toEqual({
      provider_code: "a",
      label: "k",
      secret: "sk",
    });
    expect(seen[5].body).toBeUndefined();
    expect(seen[6].body).toBeUndefined();
    expect(seen[8].body).toBeUndefined();
  });
});
