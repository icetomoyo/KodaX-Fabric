<template>
  <div class="dashboard-page">
    <el-alert
      v-if="pendingApplication"
      class="join-alert"
      :title="`合作企业「${pendingApplication.name}」审核中`"
      type="info"
      show-icon
      :closable="false"
    >
      <p>超级管理员通过后，你将成为该企业的企业管理员。现在还是普通注册用户，没有员工权限。</p>
    </el-alert>
    <el-alert
      v-else-if="!hasEnterprise"
      class="join-alert"
      title="当前是普通注册用户，没有员工权限"
      type="warning"
      show-icon
      :closable="false"
    >
      <p>可申请成为合作企业，或等待已有企业的团队管理员用你的注册手机号邀请入团。</p>
      <el-form inline @submit.prevent="onApply">
        <el-form-item>
          <el-input v-model="applyName" placeholder="合作企业名称" maxlength="100" />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :loading="applying" native-type="submit">申请合作企业</el-button>
        </el-form-item>
      </el-form>
    </el-alert>
    <el-alert
      v-else-if="hasEnterprise && !hasTeam"
      class="join-alert"
      title="尚未加入团队，仍是普通注册用户。被邀请进团队后才有员工权限（API Key / 调用）。"
      type="info"
      show-icon
      :closable="false"
    />

    <section class="page-card hero-card">
      <div class="page-head">
        <div>
          <h2 class="page-title">工作台</h2>
          <p class="page-subtitle">今日用量、配额与接入入口</p>
        </div>
        <div class="head-actions">
          <el-button :loading="loading" @click="loadUsage">刷新</el-button>
          <el-button type="primary" @click="router.push('/me/keys')">创建 Key</el-button>
        </div>
      </div>

      <div v-loading="loading" class="kpi-grid">
        <div class="kpi-card">
          <span class="kpi-label">今日请求</span>
          <strong class="kpi-value">{{ formatNumber(usage?.today?.requestCount) }}</strong>
          <span class="kpi-foot">
            失败
            <b :class="{ danger: (usage?.today?.errorCount ?? 0) > 0 }">
              {{ formatNumber(usage?.today?.errorCount) }}
            </b>
          </span>
        </div>
        <div class="kpi-card accent">
          <span class="kpi-label">今日 Tokens</span>
          <strong class="kpi-value">{{ formatCompact(usage?.today?.totalTokens) }}</strong>
          <span class="kpi-foot">本人合计消耗</span>
        </div>
        <div class="kpi-card">
          <span class="kpi-label">本月 Tokens</span>
          <strong class="kpi-value">{{ formatCompact(usage?.month?.totalTokens) }}</strong>
          <span class="kpi-foot">本月请求 {{ formatNumber(usage?.month?.requestCount) }}</span>
        </div>
        <div class="kpi-card success">
          <span class="kpi-label">API Key</span>
          <strong class="kpi-value">{{ formatNumber(keyCount) }}</strong>
          <span class="kpi-foot">已创建的员工 Key</span>
        </div>
        <div class="kpi-card">
          <span class="kpi-label">所属团队</span>
          <strong class="kpi-value">{{ formatNumber(teamUsage.length) }}</strong>
          <span class="kpi-foot">{{ hasTeam ? "已加入" : "尚未加入" }}</span>
        </div>
        <div class="kpi-card muted">
          <span class="kpi-label">企业</span>
          <strong class="kpi-value">{{ hasEnterprise ? "已加入" : "未加入" }}</strong>
          <span class="kpi-foot">{{ membershipName || "普通注册用户" }}</span>
        </div>
      </div>

      <div class="quick-links">
        <button type="button" class="quick-link" @click="router.push('/me/keys')">
          <span class="quick-dot blue" />
          <span>
            <strong>API Key</strong>
            <small>创建 Key · 绑定渠道</small>
          </span>
        </button>
        <button type="button" class="quick-link" @click="router.push('/me/models')">
          <span class="quick-dot indigo" />
          <span>
            <strong>模型</strong>
            <small>可用模型</small>
          </span>
        </button>
        <button type="button" class="quick-link" @click="router.push('/me/guide')">
          <span class="quick-dot violet" />
          <span>
            <strong>接入教程</strong>
            <small>三种协议 · Base URL</small>
          </span>
        </button>
        <button type="button" class="quick-link" @click="router.push('/me/logs')">
          <span class="quick-dot teal" />
          <span>
            <strong>我的调用</strong>
            <small>请求与消耗明细</small>
          </span>
        </button>
        <button type="button" class="quick-link" @click="router.push('/me/tickets')">
          <span class="quick-dot amber" />
          <span>
            <strong>我的工单</strong>
            <small>问题反馈</small>
          </span>
        </button>
      </div>
    </section>

    <section v-if="teamUsage.length" class="page-card panel-card">
      <div class="panel-head">
        <div>
          <h3 class="panel-title">我的用量</h3>
          <p class="panel-desc">按团队统计 Token 消耗</p>
        </div>
      </div>
      <div class="team-quota-grid">
        <article v-for="team in teamUsage" :key="team.teamId" class="team-quota-card">
          <div class="team-quota-head">
            <strong>{{ team.teamName }}</strong>
            <el-tag v-if="teamRoleLabel(team.teamId)" size="small" effect="plain">
              {{ teamRoleLabel(team.teamId) }}
            </el-tag>
          </div>
          <div class="quota-row">
            <span>团队本月已用</span>
            <b>{{ formatTokenCompact(team.teamUsedMonth) }}</b>
          </div>
          <div class="quota-row">
            <span>我的今日已用</span>
            <b>{{ formatTokenMillion(team.myUsedToday) }}</b>
          </div>
        </article>
      </div>
    </section>

    <section class="page-card panel-card">
      <div class="panel-head">
        <div>
          <h3 class="panel-title">接入说明</h3>
          <p class="panel-desc">员工 Key 绑定渠道与协议，原生转发三种协议</p>
        </div>
        <router-link class="guide-link" to="/me/guide">完整教程 →</router-link>
      </div>
      <el-descriptions :column="1" border>
        <el-descriptions-item label="Base URL">
          <code>{{ clientBaseUrl }}</code>
        </el-descriptions-item>
        <el-descriptions-item
          v-for="option in relayProtocolOptions"
          :key="option.value"
          :label="option.shortLabel"
        >
          {{ option.endpoint }}
        </el-descriptions-item>
      </el-descriptions>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import { http } from "@/api/http";
import { formatTokenCompact, formatTokenMillion } from "@/lib/tokens";
import { useAuthStore } from "@/stores/auth";
import {
  RELAY_BASE_PATH,
  relayClientBaseUrl,
  relayProtocolOptions,
} from "@/views/relay-protocol";

type TeamUsage = {
  teamId: number;
  teamName: string;
  teamUsedMonth: number;
  myUsedToday: number;
};

type UsageResponse = {
  today?: { totalTokens: number; requestCount: number; errorCount?: number };
  month?: { totalTokens: number; requestCount: number };
  membership?: {
    enterpriseId: number | null;
    enterpriseName: string | null;
    enterpriseCode: string | null;
  };
  teams?: TeamUsage[];
  relay?: { baseUrl: string };
};

const auth = useAuthStore();
const router = useRouter();
const loading = ref(false);
const keyCount = ref(0);
const applyName = ref("");
const applying = ref(false);
const orgEnterprise = ref<{
  id: number;
  name: string;
  code: string;
  status: string;
} | null>(null);
const orgTeams = ref<
  Array<{
    id: number;
    name: string;
    role: string;
  }>
>([]);
const usage = ref<UsageResponse | null>(null);

const teamUsage = computed(() => usage.value?.teams ?? []);
const pendingApplication = computed(() =>
  orgEnterprise.value?.status === "pending" ? orgEnterprise.value : null,
);
const hasEnterprise = computed(() => orgEnterprise.value?.status === "active");
const hasTeam = computed(() => teamUsage.value.length > 0 || orgTeams.value.length > 0);
const membershipName = computed(
  () => orgEnterprise.value?.name || usage.value?.membership?.enterpriseName || auth.user?.enterprise?.name || "",
);

const relayBaseUrl = computed(
  () => usage.value?.relay?.baseUrl || `${window.location.origin}${RELAY_BASE_PATH}`,
);
const clientBaseUrl = computed(() => relayClientBaseUrl(relayBaseUrl.value));

function teamRoleLabel(teamId: number): string {
  const row = orgTeams.value.find((item) => item.id === teamId);
  if (!row) return "";
  return row.role === "team_admin" ? "团队管理员" : "成员";
}

function formatNumber(value: unknown): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return "0";
  return new Intl.NumberFormat("zh-CN").format(n);
}

function formatCompact(value: unknown): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return "0";
  if (Math.abs(n) < 1000) return formatNumber(n);
  return new Intl.NumberFormat("zh-CN", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n);
}

async function loadUsage() {
  loading.value = true;
  try {
    const { data } = await http.get("/api/me/usage");
    if (data.success) usage.value = data.data;
    const [org, keys] = await Promise.all([
      http.get("/api/me/org"),
      http.get("/api/me/api-keys").catch(() => ({ data: { success: false } })),
    ]);
    if (org.data.success) {
      orgEnterprise.value = org.data.data.enterprise ?? null;
      orgTeams.value = org.data.data.teams ?? [];
    } else {
      orgEnterprise.value = null;
      orgTeams.value = [];
    }
    keyCount.value = keys.data.success ? (keys.data.data as unknown[]).length : 0;
  } finally {
    loading.value = false;
  }
}

async function onApply() {
  const name = applyName.value.trim();
  if (!name) {
    ElMessage.warning("请填写企业名称");
    return;
  }
  applying.value = true;
  try {
    const enterprise = await auth.applyEnterprise(name);
    ElMessage.success(`已提交「${enterprise.name}」合作申请，请等待超级管理员审核`);
    applyName.value = "";
    await loadUsage();
  } catch (e: unknown) {
    const message = (e as { response?: { data?: { message?: string } } }).response?.data?.message
      || (e as Error).message
      || "提交失败";
    ElMessage.error(message);
  } finally {
    applying.value = false;
  }
}

onMounted(loadUsage);
</script>

<style scoped>
.dashboard-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
}
.hero-card {
  padding-bottom: 18px;
}
.page-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 18px;
}
.page-title {
  margin: 0;
  font-size: 22px;
  font-weight: 650;
  color: #0f172a;
}
.page-subtitle {
  margin: 6px 0 0;
  color: #94a3b8;
  font-size: 13px;
}
.head-actions {
  display: flex;
  flex-shrink: 0;
  gap: 8px;
}
.kpi-grid {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 12px;
}
.kpi-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 112px;
  padding: 14px 16px;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%);
}
.kpi-card.accent {
  border-color: #bfdbfe;
  background: linear-gradient(180deg, #eff6ff 0%, #f8fafc 100%);
}
.kpi-card.success {
  border-color: #bbf7d0;
  background: linear-gradient(180deg, #f0fdf4 0%, #f8fafc 100%);
}
.kpi-card.muted {
  background: linear-gradient(180deg, #ffffff 0%, #f1f5f9 100%);
}
.kpi-label {
  color: #64748b;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.02em;
}
.kpi-value {
  color: #0f172a;
  font-size: 28px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  line-height: 1.1;
}
.kpi-foot {
  margin-top: auto;
  color: #94a3b8;
  font-size: 12px;
}
.kpi-foot b {
  color: #334155;
  font-weight: 650;
}
.kpi-foot b.danger {
  color: #dc2626;
}
.quick-links {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 10px;
  margin-top: 16px;
}
.quick-link {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 72px;
  padding: 12px 14px;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  background: #fff;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.quick-link:hover {
  border-color: #93c5fd;
  background: #f8fbff;
  box-shadow: 0 4px 14px rgba(15, 23, 42, 0.06);
}
.quick-link strong {
  display: block;
  color: #0f172a;
  font-size: 14px;
}
.quick-link small {
  display: block;
  margin-top: 2px;
  color: #94a3b8;
  font-size: 12px;
}
.quick-dot {
  width: 10px;
  height: 10px;
  flex: 0 0 auto;
  border-radius: 50%;
  box-shadow: 0 0 0 4px rgba(148, 163, 184, 0.14);
}
.quick-dot.blue { background: #2563eb; }
.quick-dot.indigo { background: #4f46e5; }
.quick-dot.violet { background: #7c3aed; }
.quick-dot.teal { background: #0d9488; }
.quick-dot.amber { background: #d97706; }
.panel-card { min-width: 0; }
.panel-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}
.panel-title {
  margin: 0;
  color: #0f172a;
  font-size: 16px;
  font-weight: 650;
}
.panel-desc {
  margin: 4px 0 0;
  color: #94a3b8;
  font-size: 12px;
}
.guide-link {
  color: #2563eb;
  font-size: 13px;
  font-weight: 600;
}
.join-alert {
  margin: 0;
}
.join-alert p {
  margin: 8px 0 12px;
}
.org-section {
  margin: 0 0 16px;
}
.team-quota-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}
.team-quota-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px 16px;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  background: #f8fafc;
}
.team-quota-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.team-quota-head strong {
  color: #0f172a;
  font-size: 15px;
}
.quota-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  color: #64748b;
  font-size: 13px;
}
.quota-row b {
  color: #0f172a;
  font-variant-numeric: tabular-nums;
}
code {
  overflow-wrap: anywhere;
  color: #334155;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}
@media (max-width: 1280px) {
  .kpi-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
  .quick-links {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 760px) {
  .kpi-grid,
  .quick-links,
  .team-quota-grid {
    grid-template-columns: 1fr;
  }
}
</style>
