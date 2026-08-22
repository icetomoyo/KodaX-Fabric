<template>
  <div class="page-card">
    <h2 class="page-title">我的工作台</h2>
    <el-alert
      v-if="!hasEnterprise"
      class="join-alert"
      title="当前未加入企业，没有 Token 额度"
      type="warning"
      show-icon
      :closable="false"
    >
      <p>请向企业管理员索取企业编号并加入后，才能创建 API Key 和调用模型。</p>
      <el-form inline @submit.prevent="onJoin">
        <el-form-item>
          <el-input v-model="joinCode" placeholder="企业编号，例如 E7K2M9QX" maxlength="16" />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :loading="joining" native-type="submit">加入企业</el-button>
        </el-form-item>
      </el-form>
    </el-alert>
    <el-alert
      v-else
      class="join-alert"
      :title="`已加入 ${membershipName}（编号 ${membershipCode}）`"
      type="success"
      show-icon
      :closable="false"
    />
    <section v-if="orgTeams.length" class="org-section">
      <h3 class="guide-title">我的团队</h3>
      <el-table :data="orgTeams" stripe>
        <el-table-column prop="name" label="团队" min-width="140" />
        <el-table-column label="角色" width="120">
          <template #default="{ row }">
            {{ row.role === "team_admin" ? "团队管理员" : "成员" }}
          </template>
        </el-table-column>
        <el-table-column label="项目" min-width="220">
          <template #default="{ row }">
            {{ projectNames(row) }}
          </template>
        </el-table-column>
      </el-table>
    </section>
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
import { useAuthStore } from "@/stores/auth";
import {
  RELAY_BASE_PATH,
  relayClientBaseUrl,
} from "@/views/relay-protocol";

const auth = useAuthStore();
const joinCode = ref("");
const joining = ref(false);
const orgTeams = ref<
  Array<{
    id: number;
    name: string;
    role: string;
    projects: Array<{ id: number; name: string }>;
  }>
>([]);
const usage = ref<{
  today?: { totalTokens: number; requestCount: number };
  month?: { totalTokens: number; requestCount: number };
  membership?: {
    enterpriseId: number | null;
    enterpriseName: string | null;
    enterpriseCode: string | null;
    hasQuota: boolean;
  };
  quota?: { dailyTokenLimit: number };
  relay?: { baseUrl: string };
} | null>(null);

function projectNames(row: { projects: Array<{ name: string }> }) {
  return row.projects.map((item) => item.name).join("、") || "尚未加入项目";
}

const hasEnterprise = computed(
  () => Boolean(usage.value?.membership?.enterpriseId || auth.user?.enterpriseId),
);
const membershipName = computed(
  () => usage.value?.membership?.enterpriseName || auth.user?.enterprise?.name || "",
);
const membershipCode = computed(
  () => usage.value?.membership?.enterpriseCode || auth.user?.enterprise?.code || "",
);

const relayBaseUrl = computed(
  () => usage.value?.relay?.baseUrl || `${window.location.origin}${RELAY_BASE_PATH}`,
);
const clientBaseUrl = computed(() => relayClientBaseUrl(relayBaseUrl.value));

async function loadUsage() {
  const { data } = await http.get("/api/me/usage");
  if (data.success) usage.value = data.data;
  if (auth.user?.enterpriseId) {
    const org = await http.get("/api/me/org");
    if (org.data.success) orgTeams.value = org.data.data.teams;
  } else {
    orgTeams.value = [];
  }
}

async function onJoin() {
  const code = joinCode.value.trim();
  if (!code) {
    ElMessage.warning("请填写企业编号");
    return;
  }
  joining.value = true;
  try {
    const enterprise = await auth.joinEnterprise(code);
    ElMessage.success(`已加入 ${enterprise.name}，现已获得 Token 额度`);
    joinCode.value = "";
    await loadUsage();
  } catch (e: unknown) {
    const message = (e as { response?: { data?: { message?: string } } }).response?.data?.message
      || (e as Error).message
      || "加入失败";
    ElMessage.error(message);
  } finally {
    joining.value = false;
  }
}

onMounted(loadUsage);
</script>

<style scoped>
.guide-title {
  margin: 0;
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
code {
  overflow-wrap: anywhere;
  color: #334155;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}
</style>
