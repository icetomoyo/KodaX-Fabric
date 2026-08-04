export type RelayPrincipal = {
  employeeId: number;
  employeeApiKeyId: number;
  employeeName: string;
  employeePhone: string;
  employeeDept: string | null;
};

export type RelayCandidate = {
  routeId: number | null;
  routePriority: number;
  routeWeight: number;
  clientModel: string;
  upstreamModel: string;
  providerCode: string;
  authStyle: string;
  productLineId: number;
  productType: "api" | "coding_plan";
  retryPolicy: unknown;
  credentialId: number;
  credentialSuffix: string;
  secretEncrypted: string;
  baseUrl: string;
  credentialPriority: number;
  credentialWeight: number;
};

export type RelayUsage = {
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  raw: Record<string, unknown> | null;
};

export type RelayRetryTraceItem = {
  attempt: number;
  providerCode: string;
  productLineId: number;
  credentialId: number;
  credentialSuffix: string;
  status: number | null;
  latencyMs: number;
  outcome: "success" | "retry" | "failed" | "network_error";
  reason?: string;
};
