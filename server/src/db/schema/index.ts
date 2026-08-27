import {
  bigint,
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

export const employeeRoleEnum = pgEnum("employee_role", ["employee", "admin", "org_admin", "team_admin"]);
export const employeeStatusEnum = pgEnum("employee_status", ["pending", "active", "disabled"]);
export const enterpriseStatusEnum = pgEnum("enterprise_status", ["pending", "active", "disabled"]);
export const enterprisePackageEnum = pgEnum("enterprise_package", ["plus", "pro", "max"]);
export const orgUnitStatusEnum = pgEnum("org_unit_status", ["active", "disabled"]);
export const teamMemberRoleEnum = pgEnum("team_member_role", ["member", "team_admin"]);
export const apiKeyStatusEnum = pgEnum("api_key_status", ["active", "revoked"]);
export const relayProtocolEnum = pgEnum("relay_protocol", [
  "openai_chat",
  "anthropic_messages",
  "openai_responses",
]);
export const productTypeEnum = pgEnum("product_type", ["api", "coding_plan"]);
export const shareModeEnum = pgEnum("share_mode", ["public_pool", "grant_only", "disabled"]);
export const credentialStatusEnum = pgEnum("credential_status", [
  "active",
  "disabled",
  "auto_disabled",
  "cooling",
]);
export const auditStatusEnum = pgEnum("audit_status", [
  "success",
  "upstream_error",
  "client_error",
  "cancelled",
]);

export const enterprises = pgTable(
  "enterprises",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    name: varchar("name", { length: 100 }).notNull(),
    code: varchar("code", { length: 16 }).notNull(),
    status: enterpriseStatusEnum("status").notNull().default("active"),
    // Null means the platform has not granted a monthly package.
    packagePlan: enterprisePackageEnum("package_plan"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("enterprises_name_uidx").on(t.name),
    uniqueIndex("enterprises_code_uidx").on(t.code),
  ],
);

export const employees = pgTable(
  "employees",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    name: varchar("name", { length: 100 }).notNull(),
    phone: varchar("phone", { length: 20 }).notNull(),
    passwordHash: text("password_hash").notNull(),
    dept: varchar("dept", { length: 100 }),
    role: employeeRoleEnum("role").notNull().default("employee"),
    status: employeeStatusEnum("status").notNull().default("active"),
    enterpriseId: bigint("enterprise_id", { mode: "number" }).references(() => enterprises.id, {
      onDelete: "restrict",
      onUpdate: "no action",
    }),
    mustChangePassword: boolean("must_change_password").notNull().default(true),
    passwordChangedAt: timestamp("password_changed_at", { withTimezone: true }),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    createdBy: bigint("created_by", { mode: "number" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("employees_phone_uidx").on(t.phone),
    index("employees_enterprise_idx").on(t.enterpriseId),
  ],
);

export const teams = pgTable(
  "teams",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    enterpriseId: bigint("enterprise_id", { mode: "number" })
      .notNull()
      .references(() => enterprises.id, { onDelete: "restrict", onUpdate: "no action" }),
    name: varchar("name", { length: 100 }).notNull(),
    status: orgUnitStatusEnum("status").notNull().default("active"),
    // 0 means unassigned: every Key on this team is denied at relay time.
    monthlyYuanQuota: numeric("monthly_yuan_quota", { precision: 12, scale: 2 }).notNull().default("0"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("teams_enterprise_name_uidx").on(t.enterpriseId, t.name),
    index("teams_enterprise_idx").on(t.enterpriseId),
  ],
);

export const teamMembers = pgTable(
  "team_members",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    teamId: bigint("team_id", { mode: "number" })
      .notNull()
      .references(() => teams.id, { onDelete: "cascade", onUpdate: "no action" }),
    employeeId: bigint("employee_id", { mode: "number" })
      .notNull()
      .references(() => employees.id, { onDelete: "cascade", onUpdate: "no action" }),
    role: teamMemberRoleEnum("role").notNull().default("member"),
    // Null means no per-member cap; only the team pool applies.
    dailyTokenLimit: bigint("daily_token_limit", { mode: "number" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("team_members_team_employee_uidx").on(t.teamId, t.employeeId),
    // One employee belongs to at most one team at a time.
    uniqueIndex("team_members_employee_uidx").on(t.employeeId),
  ],
);

export const projects = pgTable(
  "projects",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    teamId: bigint("team_id", { mode: "number" })
      .notNull()
      .references(() => teams.id, { onDelete: "cascade", onUpdate: "no action" }),
    name: varchar("name", { length: 100 }).notNull(),
    status: orgUnitStatusEnum("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("projects_team_name_uidx").on(t.teamId, t.name),
    index("projects_team_idx").on(t.teamId),
  ],
);

export const projectMembers = pgTable(
  "project_members",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    projectId: bigint("project_id", { mode: "number" })
      .notNull()
      .references(() => projects.id, { onDelete: "cascade", onUpdate: "no action" }),
    employeeId: bigint("employee_id", { mode: "number" })
      .notNull()
      .references(() => employees.id, { onDelete: "cascade", onUpdate: "no action" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("project_members_project_employee_uidx").on(t.projectId, t.employeeId),
    index("project_members_employee_idx").on(t.employeeId),
  ],
);

export const tickets = pgTable(
  "tickets",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    ticketNo: varchar("ticket_no", { length: 32 }).notNull(),
    employeeId: bigint("employee_id", { mode: "number" })
      .notNull()
      .references(() => employees.id),
    subject: varchar("subject", { length: 100 }).notNull(),
    content: text("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("tickets_ticket_no_uidx").on(t.ticketNo),
    index("tickets_employee_created_idx").on(t.employeeId, t.createdAt),
    index("tickets_created_idx").on(t.createdAt),
  ],
);

export const employeeApiKeys = pgTable(
  "employee_api_keys",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    employeeId: bigint("employee_id", { mode: "number" })
      .notNull()
      .references(() => employees.id),
    name: varchar("name", { length: 100 }).notNull(),
    keyPrefix: varchar("key_prefix", { length: 32 }).notNull(),
    keyHash: varchar("key_hash", { length: 128 }).notNull(),
    keyEncrypted: text("key_encrypted").notNull(),
    protocol: relayProtocolEnum("protocol").notNull(),
    productLineId: bigint("product_line_id", { mode: "number" })
      .notNull()
      .references(() => productLines.id, {
        onDelete: "restrict",
        onUpdate: "no action",
      }),
    teamId: bigint("team_id", { mode: "number" }).references(() => teams.id, {
      onDelete: "restrict",
      onUpdate: "no action",
    }),
    status: apiKeyStatusEnum("status").notNull().default("active"),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("employee_api_keys_hash_uidx").on(t.keyHash),
    index("employee_api_keys_employee_idx").on(t.employeeId),
    index("employee_api_keys_product_line_idx").on(t.productLineId),
    index("employee_api_keys_employee_product_line_idx").on(t.employeeId, t.productLineId),
    index("employee_api_keys_team_idx").on(t.teamId),
  ],
);

export const providers = pgTable(
  "providers",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    code: varchar("code", { length: 64 }).notNull(),
    name: varchar("name", { length: 100 }).notNull(),
    defaultBaseUrl: text("default_base_url").notNull(),
    authStyle: varchar("auth_style", { length: 32 }).notNull().default("bearer"),
    openaiCompatLevel: varchar("openai_compat_level", { length: 32 }).notNull().default("full"),
    status: varchar("status", { length: 32 }).notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("providers_code_uidx").on(t.code)],
);

export const productLines = pgTable(
  "product_lines",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    providerId: bigint("provider_id", { mode: "number" })
      .notNull()
      .references(() => providers.id),
    code: varchar("code", { length: 64 }).notNull(),
    name: varchar("name", { length: 100 }).notNull(),
    productType: productTypeEnum("product_type").notNull(),
    baseUrlOverride: text("base_url_override"),
    protocolConfigs: jsonb("protocol_configs"),
    configVersion: integer("config_version").notNull().default(1),
    shareMode: shareModeEnum("share_mode").notNull().default("public_pool"),
    allowAutoRoute: boolean("allow_auto_route").notNull().default(true),
    retryPolicy: jsonb("retry_policy"),
    status: varchar("status", { length: 32 }).notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("product_lines_provider_code_uidx").on(t.providerId, t.code)],
);

export const upstreamCredentials = pgTable(
  "upstream_credentials",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    productLineId: bigint("product_line_id", { mode: "number" })
      .notNull()
      .references(() => productLines.id),
    label: varchar("label", { length: 200 }).notNull(),
    secretEncrypted: text("secret_encrypted").notNull(),
    secretSuffix: varchar("secret_suffix", { length: 8 }).notNull(),
    supportedProtocols: relayProtocolEnum("supported_protocols")
      .array()
      .notNull()
      .default(["openai_chat"]),
    weight: integer("weight").notNull().default(100),
    priority: integer("priority").notNull().default(0),
    status: credentialStatusEnum("status").notNull().default("active"),
    coolUntil: timestamp("cool_until", { withTimezone: true }),
    lastError: text("last_error"),
    lastErrorAt: timestamp("last_error_at", { withTimezone: true }),
    successCount: bigint("success_count", { mode: "number" }).notNull().default(0),
    errorCount: bigint("error_count", { mode: "number" }).notNull().default(0),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    meta: jsonb("meta"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("upstream_credentials_pl_idx").on(t.productLineId, t.status)],
);

export const credentialEmployeeGrants = pgTable(
  "credential_employee_grants",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    credentialId: bigint("credential_id", { mode: "number" })
      .notNull()
      .references(() => upstreamCredentials.id),
    employeeId: bigint("employee_id", { mode: "number" })
      .notNull()
      .references(() => employees.id),
    grantedBy: bigint("granted_by", { mode: "number" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("credential_employee_grants_uidx").on(t.credentialId, t.employeeId),
  ],
);

export const modelRoutes = pgTable(
  "model_routes",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    clientModel: varchar("client_model", { length: 128 }).notNull(),
    productLineId: bigint("product_line_id", { mode: "number" })
      .notNull()
      .references(() => productLines.id),
    upstreamModel: varchar("upstream_model", { length: 128 }).notNull(),
    enabled: boolean("enabled").notNull().default(true),
    priority: integer("priority").notNull().default(0),
    weight: integer("weight").notNull().default(100),
    config: jsonb("config"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("model_routes_client_idx").on(t.clientModel, t.enabled)],
);

export const usageCountersDaily = pgTable(
  "usage_counters_daily",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    day: date("day").notNull(),
    employeeId: bigint("employee_id", { mode: "number" })
      .notNull()
      .references(() => employees.id),
    promptTokens: bigint("prompt_tokens", { mode: "number" }).notNull().default(0),
    completionTokens: bigint("completion_tokens", { mode: "number" }).notNull().default(0),
    totalTokens: bigint("total_tokens", { mode: "number" }).notNull().default(0),
    requestCount: bigint("request_count", { mode: "number" }).notNull().default(0),
    errorCount: bigint("error_count", { mode: "number" }).notNull().default(0),
  },
  (t) => [
    uniqueIndex("usage_counters_daily_uidx").on(t.day, t.employeeId),
    index("usage_counters_daily_employee_day_idx").on(t.employeeId, t.day),
  ],
);

export const usageCountersTeamDaily = pgTable(
  "usage_counters_team_daily",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    day: date("day").notNull(),
    teamId: bigint("team_id", { mode: "number" })
      .notNull()
      .references(() => teams.id),
    employeeId: bigint("employee_id", { mode: "number" })
      .notNull()
      .references(() => employees.id),
    promptTokens: bigint("prompt_tokens", { mode: "number" }).notNull().default(0),
    completionTokens: bigint("completion_tokens", { mode: "number" }).notNull().default(0),
    totalTokens: bigint("total_tokens", { mode: "number" }).notNull().default(0),
    requestCount: bigint("request_count", { mode: "number" }).notNull().default(0),
    errorCount: bigint("error_count", { mode: "number" }).notNull().default(0),
  },
  (t) => [
    uniqueIndex("usage_counters_team_daily_uidx").on(t.day, t.teamId, t.employeeId),
    index("usage_counters_team_daily_team_day_idx").on(t.teamId, t.day),
    index("usage_counters_team_daily_employee_day_idx").on(t.employeeId, t.day),
  ],
);

export const requestAudits = pgTable(
  "request_audits",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    requestId: varchar("request_id", { length: 64 }).notNull(),
    employeeId: bigint("employee_id", { mode: "number" })
      .notNull()
      .references(() => employees.id),
    employeeApiKeyId: bigint("employee_api_key_id", { mode: "number" }),
    teamId: bigint("team_id", { mode: "number" }).references(() => teams.id, {
      onDelete: "restrict",
      onUpdate: "no action",
    }),
    clientModel: varchar("client_model", { length: 128 }).notNull(),
    providerCode: varchar("provider_code", { length: 64 }),
    productLineId: bigint("product_line_id", { mode: "number" }),
    productType: productTypeEnum("product_type"),
    credentialId: bigint("credential_id", { mode: "number" }),
    status: auditStatusEnum("status").notNull(),
    promptTokens: integer("prompt_tokens"),
    completionTokens: integer("completion_tokens"),
    totalTokens: integer("total_tokens"),
    cacheReadTokens: integer("cache_read_tokens"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("request_audits_request_id_uidx").on(t.requestId),
    index("request_audits_employee_created_idx").on(t.employeeId, t.createdAt),
    index("request_audits_created_idx").on(t.createdAt),
    index("request_audits_team_created_idx").on(t.teamId, t.createdAt),
  ],
);

export const requestErrorLogs = pgTable(
  "request_error_logs",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    requestId: varchar("request_id", { length: 64 }).notNull(),
    employeeId: bigint("employee_id", { mode: "number" })
      .notNull()
      .references(() => employees.id),
    teamId: bigint("team_id", { mode: "number" }).references(() => teams.id, {
      onDelete: "restrict",
      onUpdate: "no action",
    }),
    clientModel: varchar("client_model", { length: 128 }).notNull(),
    providerCode: varchar("provider_code", { length: 64 }),
    productLineId: bigint("product_line_id", { mode: "number" }),
    productType: productTypeEnum("product_type"),
    credentialId: bigint("credential_id", { mode: "number" }),
    status: auditStatusEnum("status").notNull(),
    httpStatus: integer("http_status"),
    upstreamStatus: integer("upstream_status"),
    errorCode: varchar("error_code", { length: 64 }),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("request_error_logs_request_id_uidx").on(t.requestId),
    index("request_error_logs_created_idx").on(t.createdAt),
    index("request_error_logs_team_created_idx").on(t.teamId, t.createdAt),
    index("request_error_logs_code_created_idx").on(t.errorCode, t.createdAt),
  ],
);

export const opsAuditLogs = pgTable(
  "ops_audit_logs",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    actorEmployeeId: bigint("actor_employee_id", { mode: "number" }),
    action: varchar("action", { length: 100 }).notNull(),
    targetType: varchar("target_type", { length: 64 }),
    targetId: varchar("target_id", { length: 64 }),
    detail: jsonb("detail"),
    ip: varchar("ip", { length: 64 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ops_audit_logs_created_idx").on(t.createdAt)],
);

export const systemSettings = pgTable("system_settings", {
  key: varchar("key", { length: 128 }).primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Unit prices in CNY, keyed by the public client model name. */
export const modelPrices = pgTable(
  "model_prices",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    model: varchar("model", { length: 128 }).notNull(),
    promptPricePerMillion: numeric("prompt_price_per_million", { precision: 12, scale: 4 }).notNull(),
    completionPricePerMillion: numeric("completion_price_per_million", { precision: 12, scale: 4 }).notNull(),
    cacheHitPricePerMillion: numeric("cache_hit_price_per_million", { precision: 12, scale: 4 })
      .notNull()
      .default("0"),
    /** CNY per million cached tokens per hour. Not applied to per-request cost. */
    cacheStoragePricePerMillionPerHour: numeric("cache_storage_price_per_million_per_hour", {
      precision: 12,
      scale: 4,
    })
      .notNull()
      .default("0"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("model_prices_model_uidx").on(t.model)],
);
