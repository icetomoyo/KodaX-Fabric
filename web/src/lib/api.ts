import { request } from "./http";
import type { Health, Model, Operator, Price, Project, Provider, UsageCell, VirtualKey } from "@/types/api";

export const authApi = {
  login: (username: string, password: string) =>
    request<{ status: string; username: string }>("/admin/api/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),
  logout: () => request<{ status: string }>("/admin/api/logout", { method: "POST" }),
  me: () => request<Operator>("/admin/api/me"),
};

export const healthApi = () => fetch("/health").then((r) => r.json() as Promise<Health>);

export const adminApi = {
  projects: () => request<{ projects: Project[] }>("/admin/api/projects"),
  createProject: (name: string) =>
    request<Project>("/admin/api/projects", { method: "POST", body: JSON.stringify({ name }) }),

  virtualKeys: () => request<{ keys: VirtualKey[] }>("/admin/api/virtual-keys"),
  createVK: (project: string) =>
    request<VirtualKey>("/admin/api/virtual-keys", {
      method: "POST",
      body: JSON.stringify({ project }),
    }),
  disableVK: (hash: string) =>
    request<{ status: string }>(`/admin/api/virtual-keys/${hash}/disable`, { method: "POST" }),

  providers: () => request<{ providers: Provider[] }>("/admin/api/providers"),
  createProvider: (body: { name: string; family: string; base_url: string; api_key: string }) =>
    request<Provider>("/admin/api/providers", { method: "POST", body: JSON.stringify(body) }),
  disableProvider: (name: string) =>
    request<{ status: string }>(`/admin/api/providers/${name}/disable`, { method: "POST" }),

  models: () => request<{ models: Model[] }>("/admin/api/models"),
  createModel: (body: { name: string; family: string; provider: string }) =>
    request<Model>("/admin/api/models", { method: "POST", body: JSON.stringify(body) }),
  disableModel: (name: string) =>
    request<{ status: string }>(`/admin/api/models/${name}/disable`, { method: "POST" }),

  prices: () => request<{ prices: Price[] }>("/admin/api/prices"),
  upsertPrice: (model: string, body: { input_cny: number; output_cny: number; cached_cny: number }) =>
    request<Price>(`/admin/api/prices/${model}`, { method: "PUT", body: JSON.stringify(body) }),
  deletePrice: (model: string) =>
    request<{ status: string }>(`/admin/api/prices/${model}`, { method: "DELETE" }),

  usage: (day?: string, project?: string) => {
    const q = new URLSearchParams();
    if (day) q.set("day", day);
    if (project) q.set("project", project);
    const s = q.toString();
    return request<{ day: string; project: string; rows: UsageCell[] }>(
      `/admin/api/usage${s ? `?${s}` : ""}`,
    );
  },
};
