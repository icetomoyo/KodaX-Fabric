<template>
  <div>
    <div class="page-card">
      <el-button link type="primary" @click="router.push('/admin/teams')">← 返回团队列表</el-button>
      <div class="title-row">
        <h2 class="page-title">{{ team?.name || "团队详情" }}</h2>
      </div>
      <div v-if="team" class="quota-stats">
        <div>
          <span>本月 Tokens</span>
          <strong>{{ formatTokenCompact(team.monthTotalTokens) }}</strong>
        </div>
      </div>
    </div>

    <div class="page-card">
      <div class="range-head">
        <div>
          <h3 class="section-title">用量</h3>
          <p class="section-desc">按日统计 Token 消耗</p>
        </div>
        <el-date-picker
          v-model="usageRange"
          type="daterange"
          value-format="YYYY-MM-DD"
          range-separator="至"
          start-placeholder="开始日期"
          end-placeholder="结束日期"
          :clearable="false"
          :disabled-date="disableFutureDate"
          @change="onUsageRangeChange"
        />
      </div>
      <div v-loading="usageLoading">
        <UsageChart :option="usageChartOption" />
        <el-table :data="usage?.byModel ?? []" stripe class="model-table">
          <el-table-column prop="model" label="模型" min-width="180" show-overflow-tooltip />
          <el-table-column label="Tokens" min-width="140">
            <template #default="{ row }">
              <span class="mono-num">{{ formatTokenCompact(row.totalTokens) }}</span>
            </template>
          </el-table-column>
        </el-table>
      </div>
    </div>

    <div class="page-card">
      <div class="head">
        <h3 class="section-title">团队成员</h3>
        <el-button type="primary" @click="openAddMember">添加成员</el-button>
      </div>
      <el-table :data="members" stripe>
        <el-table-column prop="name" label="姓名" width="140" />
        <el-table-column prop="phone" label="手机号" width="140" />
        <el-table-column prop="dept" label="部门" min-width="140" />
        <el-table-column label="团队角色" width="140">
          <template #default="{ row }">
            {{ row.role === "team_admin" ? "团队管理员" : "成员" }}
          </template>
        </el-table-column>
        <el-table-column label="今日已用" width="120">
          <template #default="{ row }">
            <span class="mono-num">{{ formatTokenMillion(row.todayTotalTokens) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="本月 Tokens" width="130">
          <template #default="{ row }">
            <span class="mono-num">{{ formatTokenCompact(row.monthTotalTokens) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="280">
          <template #default="{ row }">
            <el-button
              v-if="canAssignAdmin && row.role !== 'team_admin'"
              link
              type="primary"
              @click="setMemberRole(row, 'team_admin')"
            >
              设为团队管理员
            </el-button>
            <el-button
              v-if="canAssignAdmin && row.role === 'team_admin'"
              link
              type="warning"
              @click="setMemberRole(row, 'member')"
            >
              取消管理员
            </el-button>
            <el-button link type="danger" @click="removeMember(row)">移除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <el-dialog v-model="showAddMember" title="邀请已注册用户" width="480px">
      <el-form label-width="90px">
        <el-form-item label="手机号" required>
          <el-input v-model="addPhone" placeholder="已注册用户的手机号" />
        </el-form-item>
        <el-form-item v-if="canAssignAdmin" label="角色">
          <el-select v-model="addRole" style="width: 100%">
            <el-option label="成员" value="member" />
            <el-option label="团队管理员" value="team_admin" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showAddMember = false">取消</el-button>
        <el-button type="primary" :loading="addingMember" @click="addMember">添加</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage, ElMessageBox } from "element-plus";
import type { EChartsCoreOption } from "echarts/core";
import { http } from "@/api/http";
import UsageChart from "@/components/UsageChart.vue";
import { formatTokenCompact, formatTokenMillion } from "@/lib/tokens";
import { useAuthStore } from "@/stores/auth";

type TeamInfo = {
  id: number;
  name: string;
  todayTotalTokens: number;
  monthTotalTokens: number;
};

type MemberRow = {
  id: number;
  employeeId: number;
  name: string;
  phone: string;
  dept: string | null;
  role: "member" | "team_admin";
  todayTotalTokens: number;
  monthTotalTokens: number;
};

type TeamUsageDaily = {
  day: string;
  totalTokens: number;
  requestCount: number;
};

type TeamUsageByModel = {
  model: string;
  totalTokens: number;
};

type TeamUsage = {
  from: string;
  to: string;
  daily: TeamUsageDaily[];
  byModel: TeamUsageByModel[];
};

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();
const teamId = computed(() => Number(route.params.id));
const team = ref<TeamInfo | null>(null);
const members = ref<MemberRow[]>([]);
const showAddMember = ref(false);
const addingMember = ref(false);
const addPhone = ref("");
const addRole = ref<"member" | "team_admin">("member");
const canAssignAdmin = computed(() => auth.isSuperAdmin || auth.isOrgAdmin);
const usage = ref<TeamUsage | null>(null);
const usageLoading = ref(false);
const usageRange = ref<[string, string]>(defaultUsageRange());

function padDatePart(value: number): string {
  return String(value).padStart(2, "0");
}

function toDateOnly(date: Date): string {
  return `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())}`;
}

function defaultUsageRange(): [string, string] {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - 29);
  return [toDateOnly(start), toDateOnly(end)];
}

function inclusiveDays(start: string, end: string): number {
  const first = new Date(`${start}T00:00:00`).getTime();
  const last = new Date(`${end}T00:00:00`).getTime();
  return Math.floor((last - first) / 86_400_000) + 1;
}

function disableFutureDate(date: Date): boolean {
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  return date.getTime() > today.getTime();
}

async function loadTeam() {
  const { data } = await http.get("/api/admin/teams");
  if (data.success) {
    const rows = Array.isArray(data.data) ? (data.data as TeamInfo[]) : [];
    team.value = rows.find((item) => item.id === teamId.value) ?? null;
  }
}

async function loadMembers() {
  const { data } = await http.get(`/api/admin/teams/${teamId.value}/members`);
  if (data.success) members.value = data.data;
}

async function loadUsage() {
  if (!Number.isSafeInteger(teamId.value)) return;
  const [from, to] = usageRange.value;
  usageLoading.value = true;
  try {
    const { data } = await http.get<{ success: boolean; data: TeamUsage; message?: string }>(
      `/api/admin/teams/${teamId.value}/usage`,
      { params: { from, to } },
    );
    if (data.success) usage.value = data.data;
  } catch (error: unknown) {
    usage.value = null;
    ElMessage.error(requestMessage(error, "用量加载失败"));
  } finally {
    usageLoading.value = false;
  }
}

function onUsageRangeChange(value: [string, string] | null) {
  if (!value) return;
  const days = inclusiveDays(value[0], value[1]);
  if (days < 1 || days > 366) {
    ElMessage.warning("日期范围最多 366 天");
    return;
  }
  loadUsage();
}

const usageChartOption = computed<EChartsCoreOption>(() => ({
  color: ["#2563eb"],
  tooltip: { trigger: "axis", confine: true },
  grid: { left: 20, right: 20, bottom: 20, top: 28, containLabel: true },
  xAxis: {
    type: "category",
    data: usage.value?.daily.map((row) => row.day.slice(5)) ?? [],
  },
  yAxis: { type: "value", name: "Tokens" },
  series: [
    {
      name: "Tokens",
      type: "line",
      smooth: true,
      data: usage.value?.daily.map((row) => row.totalTokens) ?? [],
    },
  ],
}));

function openAddMember() {
  addPhone.value = "";
  addRole.value = "member";
  showAddMember.value = true;
}

async function addMember() {
  const phone = addPhone.value.trim();
  if (phone.length < 5) {
    ElMessage.warning("请填写已注册用户的手机号");
    return;
  }
  addingMember.value = true;
  try {
    const { data } = await http.post(`/api/admin/teams/${teamId.value}/members`, {
      phone,
      role: canAssignAdmin.value ? addRole.value : "member",
    });
    if (!data.success) throw new Error(data.message);
    ElMessage.success("已添加");
    showAddMember.value = false;
    await loadMembers();
  } catch (e: unknown) {
    ElMessage.error(requestMessage(e, "添加失败"));
  } finally {
    addingMember.value = false;
  }
}

async function setMemberRole(row: MemberRow, role: "member" | "team_admin") {
  await http.patch(`/api/admin/teams/${teamId.value}/members/${row.employeeId}`, { role });
  ElMessage.success("已更新");
  await loadMembers();
}

async function removeMember(row: MemberRow) {
  try {
    await ElMessageBox.confirm(`将 ${row.name} 移出团队？`, "移除成员", { type: "warning" });
  } catch {
    return;
  }
  await http.delete(`/api/admin/teams/${teamId.value}/members/${row.employeeId}`);
  ElMessage.success("已移除");
  await loadMembers();
}

function requestMessage(error: unknown, fallback: string) {
  const requestError = error as { message?: string; response?: { data?: { message?: string } } };
  return requestError.response?.data?.message || requestError.message || fallback;
}

watch(teamId, async () => {
  if (!Number.isSafeInteger(teamId.value)) return;
  usageRange.value = defaultUsageRange();
  await Promise.all([loadTeam(), loadMembers(), loadUsage()]);
}, { immediate: true });
</script>

<style scoped>
.page-card {
  margin-bottom: 16px;
}
.title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.page-title {
  margin: 8px 0 0;
}
.quota-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 16px;
}
.quota-stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
}
@media (max-width: 768px) {
  .quota-stats {
    grid-template-columns: 1fr;
  }
}
.quota-stats span {
  display: block;
  margin-bottom: 6px;
  color: #64748b;
  font-size: 12px;
}
.quota-stats strong {
  color: #0f172a;
  font-size: 22px;
  font-variant-numeric: tabular-nums;
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.section-title {
  margin: 0;
  font-size: 16px;
}
.section-desc {
  margin: 6px 0 0;
  color: #94a3b8;
  font-size: 12px;
}
.range-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}
.model-table {
  margin-top: 12px;
}
.unpriced-tag {
  margin-left: 8px;
}
.mono-num {
  font-variant-numeric: tabular-nums;
}
.form-help {
  margin-top: 6px;
  color: #94a3b8;
  font-size: 12px;
  line-height: 1.5;
}
</style>
