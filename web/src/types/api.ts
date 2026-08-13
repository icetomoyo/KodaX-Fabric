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
  teams: number;
  projects: number;
};

export type Team = {
  id: number;
  name: string;
};

export type Project = {
  id: number;
  team_id: number;
  name: string;
};

export type RouteDecision = {
  request_id: string;
  channel_id: number;
  reason: string;
  fallback: boolean;
  pool_group: string;
  created_at?: string;
};

export type ProviderKey = {
  id: number;
  provider_code: string;
  status: string;
  team_id: number;
};

export type Pool = {
  id: number;
  name: string;
  group_name: string;
  team_id: number;
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
  project_id: number;
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
