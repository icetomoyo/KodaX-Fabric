<template>
  <div class="page-card">
    <h2 class="page-title">我的工作台</h2>
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
      v-else-if="hasTeam"
      class="join-alert"
      :title="`已加入 ${membershipName}（编号 ${membershipCode}）`"
      type="success"
      show-icon
      :closable="false"
    />
    <section v-if="teamQuotas.length" class="org-section">
      <h3 class="guide-title">我的团队配额</h3>
      <div class="team-quota-grid">
        <article v-for="team in teamQuotas" :key="team.teamId" class="team-quota-card">
          <div class="team-quota-head">
            <strong>{{ team.teamName }}</strong>
            <el-tag v-if="teamRoleLabel(team.teamId)" size="small" effect="plain">
              {{ teamRoleLabel(team.teamId) }}
            </el-tag>
          </div>
          <el-alert
            v-if="team.teamQuota === 0"
            title="该团队未分配额度，暂不可调用"
            type="warning"
            :closable="false"
            show-icon
          />
          <template v-else>
            <div class="quota-row">
              <span>团队每月额度</span>
              <b>{{ formatYuan(team.teamQuota) }}</b>
            </div>
            <div class="quota-row">
              <span>团队本月已用</span>
              <b>{{ formatYuan(team.teamUsedMonth) }}</b>
            </div>
            <el-progress
              :percentage="usagePercent(team.teamUsedMonth, team.teamQuota)"
              :status="usageProgressStatus(team.teamUsedMonth, team.teamQuota)"
            />
            <div class="quota-row">
              <span>我的上限</span>
              <b>{{ team.myLimit == null ? "不限（受团队池约束）" : formatTokenMillion(team.myLimit) }}</b>
            </div>
            <div class="quota-row">
              <span>我的今日已用</span>
              <b>{{ formatTokenMillion(team.myUsedToday) }}</b>
            </div>
            <el-progress
              v-if="team.myLimit != null"
              :percentage="usagePercent(team.myUsedToday, team.myLimit)"
              :status="usageProgressStatus(team.myUsedToday, team.myLimit)"
            />
          </template>
        </article>
      </div>
    </section>
    <el-alert
      v-else-if="hasEnterprise && !hasTeam"
      class="join-alert"
      title="尚未加入团队，仍是普通注册用户。被邀请进团队后才有员工权限（API Key / 调用）。"
      type="info"
      show-icon
      :closable="false"
    />
    <el-row :gutter="16">
      <el-col :span="8">
        <el-statistic title="今日 Tokens" :value="usage?.today?.totalTokens ?? 0" />
      </el-col>
      <el-col :span="8">
        <el-statistic title="今日请求" :value="usage?.today?.requestCount ?? 0" />
      </el-col>
      <el-col :span="8">
        <el-statistic title="本月 Tokens" :value="usage?.month?.totalTokens ?? 0" />
      </el-col>
    </el-row>
    <el-divider />
    <div class="guide-heading">
      <h3 class="guide-title">接入说明</h3>
      <router-link class="guide-link" to="/me/guide">查看完整接入教程 →</router-link>
    </div>
    <el-descriptions :column="1" border>
      <el-descriptions-item label="Base URL">
        <code>{{ clientBaseUrl }}</code>
      </el-descriptions-item>
      <el-descriptions-item label="Claude Code">
        创建 Key 时选 <strong>Anthropic Messages</strong>，详见接入教程「Claude Code」页签
      </el-descriptions-item>
      <el-descriptions-item label="Cursor">
        创建 Key 时选 <strong>OpenAI Chat Completions</strong>，与 Claude Code 请各用一把 Key
      </el-descriptions-item>
    </el-descriptions>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { ElMessage } from "element-plus";
import { http } from "@/api/http";
import { formatTokenMillion, formatYuan, usagePercent, usageProgressStatus } from "@/lib/tokens";
import { useAuthStore } from "@/stores/auth";
import {
  RELAY_BASE_PATH,
  relayClientBaseUrl,
} from "@/views/relay-protocol";

type TeamQuota = {
  teamId: number;
  teamName: string;
  teamQuota: number;
  teamUsedMonth: number;
  myLimit: number | null;
  myUsedToday: number;
};

type UsageResponse = {
  today?: { totalTokens: number; requestCount: number };
  month?: { totalTokens: number; requestCount: number };
  membership?: {
    enterpriseId: number | null;
    enterpriseName: string | null;
    enterpriseCode: string | null;
    hasQuota: boolean;
  };
  teams?: TeamQuota[];
  relay?: { baseUrl: string };
};

const auth = useAuthStore();
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

const teamQuotas = computed(() => usage.value?.teams ?? []);
const pendingApplication = computed(() =>
  orgEnterprise.value?.status === "pending" ? orgEnterprise.value : null,
);
const hasEnterprise = computed(() => orgEnterprise.value?.status === "active");
const hasTeam = computed(() => teamQuotas.value.length > 0 || orgTeams.value.length > 0);
const membershipName = computed(
  () => orgEnterprise.value?.name || usage.value?.membership?.enterpriseName || auth.user?.enterprise?.name || "",
);
const membershipCode = computed(
  () => orgEnterprise.value?.code || usage.value?.membership?.enterpriseCode || auth.user?.enterprise?.code || "",
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

async function loadUsage() {
  const { data } = await http.get("/api/me/usage");
  if (data.success) usage.value = data.data;
  const org = await http.get("/api/me/org");
  if (org.data.success) {
    orgEnterprise.value = org.data.data.enterprise ?? null;
    orgTeams.value = org.data.data.teams ?? [];
  } else {
    orgEnterprise.value = null;
    orgTeams.value = [];
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
.guide-title {
  margin: 0 0 12px;
}
.guide-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 12px;
}
.guide-link {
  color: #2563eb;
  font-size: 13px;
  font-weight: 600;
}
.join-alert {
  margin-bottom: 16px;
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
@media (max-width: 760px) {
  .team-quota-grid {
    grid-template-columns: 1fr;
  }
}
</style>
