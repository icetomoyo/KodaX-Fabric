export type Operator = {
  username: string;
  name: string;
  role: string;
};

export type Project = { name: string };

export type VirtualKey = {
  hash: string;
  project: string;
  disabled: boolean;
  plaintext?: string;
};

export type Provider = {
  name: string;
  family: string;
  base_url: string;
  disabled: boolean;
};

export type Model = {
  name: string;
  family: string;
  provider: string;
  disabled: boolean;
};

export type Price = {
  model: string;
  input_cny: number;
  output_cny: number;
  cached_cny: number;
};

export type RequestRow = {
  virtual_key_hash: string;
  project: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cached_tokens: number;
  cost_cny: number;
  customer_cny?: number;
  profit_cny?: number;
  status: number;
  latency_ms: number;
  run_id: string;
  task_type: string;
  created_at: string;
};

export type UsageCell = {
  project: string;
  model: string;
  day: string;
  calls: number;
  failed_calls: number;
  zero_usage_calls: number;
  input_tokens: number;
  output_tokens: number;
  cached_tokens: number;
  cost_cny: number;
  customer_cny?: number;
  profit_cny?: number;
};

export type Health = { ok: boolean; service?: string };
