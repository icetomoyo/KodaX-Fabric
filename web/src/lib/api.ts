import { request } from "./http";
import type {
  Channel,
  Health,
  Operator,
  Overview,
  Pool,
  Project,
  ProviderKey,
  RouteDecision,
  Team,
  VirtualKey,
} from "@/types/api";

// --- auth / self ---
export const authApi = {
  login: (phone: string, password: string) =>
    request<{ operator: Operator }>("/console/v1/login", {
      method: "POST",
      body: JSON.stringify({ phone, password }),
    }),
  logout: () => request<{ ok: boolean }>("/console/v1/logout", { method: "POST" }),
  me: () => request<{ operator: Operator }>("/console/v1/me"),
  patchMe: (body: { name?: string; password?: string }) =>
    request<{ operator: Operator }>("/console/v1/me", {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  myKeys: () => request<{ virtual_keys: VirtualKey[] }>("/console/v1/me/keys"),
};

export const healthApi = () => fetch("/health").then((r) => r.json() as Promise<Health>);

// --- admin catalog ---
export const adminApi = {
  overview: () => request<Overview>("/console/v1/overview"),

  teams: () => request<{ teams: Team[] }>("/console/v1/teams"),
  createTeam: (body: { name: string }) =>
    request<Team>("/console/v1/teams", { method: "POST", body: JSON.stringify(body) }),
  projects: () => request<{ projects: Project[] }>("/console/v1/projects"),
  createProject: (body: { team_id: number; name: string }) =>
    request<Project>("/console/v1/projects", { method: "POST", body: JSON.stringify(body) }),
  routeDecisions: () =>
    request<{ route_decisions: RouteDecision[] }>("/console/v1/route-decisions"),

  users: () => request<{ users: Operator[] }>("/console/v1/users"),
  createUser: (body: { phone: string; name: string; role: string; password: string }) =>
    request<{ user: Operator }>("/console/v1/users", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  patchUser: (id: number, body: Record<string, unknown>) =>
    request<{ user: Operator }>(`/console/v1/users/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  providerKeys: () => request<{ provider_keys: ProviderKey[] }>("/console/v1/provider-keys"),
  createProviderKey: (body: { provider_code: string; secret: string; team_id?: number }) =>
    request<ProviderKey>("/console/v1/provider-keys", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  patchProviderKey: (id: number, body: Record<string, unknown>) =>
    request<ProviderKey>(`/console/v1/provider-keys/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  pools: () => request<{ pools: Pool[] }>("/console/v1/pools"),
  createPool: (body: { name: string; group_name: string; team_id?: number }) =>
    request<Pool>("/console/v1/pools", { method: "POST", body: JSON.stringify(body) }),
  patchPool: (id: number, body: Record<string, unknown>) =>
    request<Pool>(`/console/v1/pools/${id}`, { method: "PATCH", body: JSON.stringify(body) }),

  channels: () => request<{ channels: Channel[] }>("/console/v1/channels"),
  createChannel: (body: {
    pool_id: number;
    provider_key_id: number;
    protocol: string;
    base_url: string;
  }) => request<Channel>("/console/v1/channels", { method: "POST", body: JSON.stringify(body) }),
  patchChannel: (id: number, body: Record<string, unknown>) =>
    request<Channel>(`/console/v1/channels/${id}`, { method: "PATCH", body: JSON.stringify(body) }),

  virtualKeys: () => request<{ virtual_keys: VirtualKey[] }>("/console/v1/virtual-keys"),
  createVK: (body: { pool_id: number; owner_id: number; project_id?: number }) =>
    request<VirtualKey>("/console/v1/virtual-keys", { method: "POST", body: JSON.stringify(body) }),
  patchVK: (id: number, body: Record<string, unknown>) =>
    request<VirtualKey>(`/console/v1/virtual-keys/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
};
