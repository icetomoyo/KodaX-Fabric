import { request } from "./http";
import type {
  Health,
  Model,
  Operator,
  Price,
  Project,
  Provider,
  RequestRow,
  UsageCell,
  VirtualKey,
} from "@/types/api";

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

function apiRoot(): string {
  if (typeof window === "undefined") return "/admin/api";
  const p = window.location.pathname;
  if (p.startsWith("/platform")) return "/platform/api";
  if (p.startsWith("/enterprise")) return "/enterprise/api";
  if (p.startsWith("/team")) return "/team/api";
  return "/admin/api";
}

export const adminApi = {
  projects: () => request<{ projects: Project[] }>(`${apiRoot()}/projects`),
  createProject: (name: string) =>
    request<Project>(`${apiRoot()}/projects`, { method: "POST", body: JSON.stringify({ name }) }),

  virtualKeys: () => request<{ keys: VirtualKey[] }>(`${apiRoot()}/virtual-keys`),
  createVK: (project: string) =>
    request<VirtualKey>(`${apiRoot()}/virtual-keys`, {
      method: "POST",
      body: JSON.stringify({ project }),
    }),
  disableVK: (hash: string) =>
    request<{ status: string }>(`${apiRoot()}/virtual-keys/${hash}/disable`, { method: "POST" }),

  providers: () => request<{ providers: Provider[] }>(`${apiRoot()}/providers`),
  createProvider: (body: { name: string; family: string; base_url: string; api_key: string }) =>
    request<Provider>(`${apiRoot()}/providers`, { method: "POST", body: JSON.stringify(body) }),
  disableProvider: (name: string) =>
    request<{ status: string }>(`${apiRoot()}/providers/${name}/disable`, { method: "POST" }),

  models: () => request<{ models: Model[] }>(`${apiRoot()}/models`),
  createModel: (body: { name: string; family: string; provider: string }) =>
    request<Model>(`${apiRoot()}/models`, { method: "POST", body: JSON.stringify(body) }),
  disableModel: (name: string) =>
    request<{ status: string }>(`${apiRoot()}/models/${name}/disable`, { method: "POST" }),

  prices: () => request<{ prices: Price[] }>(`${apiRoot()}/prices`),
  upsertPrice: (
    model: string,
    body: { input_cny: number; output_cny: number; cached_cny: number },
  ) => request<Price>(`${apiRoot()}/prices/${model}`, { method: "PUT", body: JSON.stringify(body) }),
  deletePrice: (model: string) =>
    request<{ status: string }>(`${apiRoot()}/prices/${model}`, { method: "DELETE" }),

  requests: (project?: string) => {
    const q = new URLSearchParams();
    if (project) q.set("project", project);
    const s = q.toString();
    return request<{ project: string; requests: RequestRow[] }>(
      `${apiRoot()}/requests${s ? `?${s}` : ""}`,
    );
  },

  usage: (day?: string, project?: string) => {
    const q = new URLSearchParams();
    if (day) q.set("day", day);
    if (project) q.set("project", project);
    const s = q.toString();
    return request<{ day: string; project: string; rows: UsageCell[] }>(
      `${apiRoot()}/usage${s ? `?${s}` : ""}`,
    );
  },

  markup: () => request<{ markup: number }>(`${apiRoot()}/markup`),
  setMarkup: (markup: number) =>
    request<{ markup: number }>(`${apiRoot()}/markup`, {
      method: "PUT",
      body: JSON.stringify({ markup }),
    }),
  addMember: (team: string, username: string) =>
    request<{ username: string; team: string }>(`${apiRoot()}/teams/${team}/members`, {
      method: "POST",
      body: JSON.stringify({ username }),
    }),
};
