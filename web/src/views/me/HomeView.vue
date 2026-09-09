<template>
  <div class="dashboard-page">
    <el-alert
      v-if="!hasEnterprise"
      class="join-alert"
      title="当前是普通注册用户，没有员工权限"
      type="warning"
      show-icon
      :closable="false"
    >
      <p>等待已有企业的团队管理员用你的注册手机号邀请进团队。</p>
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
        <div class="head-actions">
          <el-button :loading="loading" @click="loadUsage">刷新</el-button>
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
          <strong class="kpi-value">{{ formatTokenCompact(usage?.today?.totalTokens) }}</strong>
          <span class="kpi-foot">本人合计消耗</span>
        </div>
        <div class="kpi-card">
          <span class="kpi-label">本月 Tokens</span>
          <strong class="kpi-value">{{ formatTokenCompact(usage?.month?.totalTokens) }}</strong>
          <span class="kpi-foot">本月请求 {{ formatNumber(usage?.month?.requestCount) }}</span>
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
            <strong>模型列表</strong>
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
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { http } from "@/api/http";
import { formatTokenCompact } from "@/lib/tokens";

type UsageResponse = {
  today?: { totalTokens: number; requestCount: number; errorCount?: number };
  month?: { totalTokens: number; requestCount: number };
};

const router = useRouter();
const loading = ref(false);
const hasEnterprise = ref(false);
const hasTeam = ref(false);
const usage = ref<UsageResponse | null>(null);

function formatNumber(value: unknown): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return "0";
  return new Intl.NumberFormat("zh-CN").format(n);
}

async function loadUsage() {
  loading.value = true;
  try {
    const { data } = await http.get("/api/me/usage");
    if (data.success) usage.value = data.data;
    const org = await http.get("/api/me/org");
    if (org.data.success) {
      hasEnterprise.value = org.data.data.enterprise?.status === "active";
      hasTeam.value = (org.data.data.teams ?? []).length > 0;
    } else {
      hasEnterprise.value = false;
      hasTeam.value = false;
    }
  } finally {
    loading.value = false;
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
  align-items: center;
  justify-content: flex-end;
  margin-bottom: 18px;
}
.head-actions {
  display: flex;
  flex-shrink: 0;
  gap: 8px;
}
.kpi-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
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
  grid-template-columns: repeat(4, minmax(0, 1fr));
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
.join-alert {
  margin: 0;
}
.join-alert p {
  margin: 8px 0 12px;
}
@media (max-width: 1280px) {
  .quick-links {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 760px) {
  .kpi-grid,
  .quick-links {
    grid-template-columns: 1fr;
  }
}
</style>
