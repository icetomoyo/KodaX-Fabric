<template>
  <div class="page-card">
    <div class="head">
      <h2 class="page-title" style="margin: 0">团队管理</h2>
      <el-button v-if="canCreate" type="primary" @click="openCreate">新建团队</el-button>
    </div>

    <el-table :data="rows" stripe>
      <el-table-column prop="name" label="团队" min-width="160" />
      <el-table-column v-if="auth.isSuperAdmin" prop="enterpriseName" label="企业" min-width="140" />
      <el-table-column prop="memberCount" label="成员" width="90" />
      <el-table-column label="本月 Tokens" min-width="130">
        <template #default="{ row }">
          <span class="mono-num">{{ formatTokenCompact(row.monthTotalTokens) }}</span>
        </template>
      </el-table-column>
      <el-table-column label="今日 Tokens" min-width="120">
        <template #default="{ row }">
          <span class="mono-num">{{ formatTokenCompact(row.todayTotalTokens) }}</span>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="100">
        <template #default="{ row }">
          <el-tag :type="row.status === 'active' ? 'success' : 'danger'" size="small">
            {{ row.status === "active" ? "正常" : "已停用" }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="240">
        <template #default="{ row }">
          <el-button link type="primary" @click="openDetail(row)">详情</el-button>
          <el-button v-if="canCreate" link type="primary" @click="openEdit(row)">编辑</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="showCreate" title="新建团队" width="440px">
      <el-form label-width="90px">
        <el-form-item v-if="auth.isSuperAdmin" label="所属企业" required>
          <el-select v-model="createEnterpriseId" style="width: 100%">
            <el-option
              v-for="item in enterprises"
              :key="item.id"
              :label="item.name"
              :value="item.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="团队名称" required>
          <el-input v-model="createName" maxlength="100" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showCreate = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="createOne">创建</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="showEdit" :title="`编辑团队 · ${editRow?.name || ''}`" width="440px">
      <el-form label-width="90px">
        <el-form-item label="团队名称" required>
          <el-input v-model="editName" maxlength="100" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showEdit = false">取消</el-button>
        <el-button type="primary" :loading="updating" @click="updateOne">保存</el-button>
      </template>
    </el-dialog>

    <el-drawer
      v-model="showDetail"
      :title="`团队详情 · ${detailRow?.name || ''}`"
      size="640px"
      destroy-on-close
      @opened="chartReady = true"
      @closed="chartReady = false"
    >
      <div v-if="detailRow" v-loading="detailLoading" class="detail-body">
        <div class="quota-stats">
          <div>
            <span>本月 Tokens</span>
            <strong>{{ formatTokenCompact(detailRow.monthTotalTokens) }}</strong>
          </div>
          <div>
            <span>今日 Tokens</span>
            <strong>{{ formatTokenCompact(detailRow.todayTotalTokens) }}</strong>
          </div>
        </div>

        <section>
          <div class="section-head">
            <h3>团队消耗</h3>
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
            <div class="chart-wrap">
              <UsageChart v-if="chartReady" :option="usageChartOption" />
            </div>
            <el-table :data="usage?.byModel ?? []" stripe>
              <el-table-column prop="model" label="模型" min-width="160" show-overflow-tooltip />
              <el-table-column label="Tokens" min-width="110">
                <template #default="{ row }">
                  <span class="mono-num">{{ formatTokenCompact(row.totalTokens) }}</span>
                </template>
              </el-table-column>
            </el-table>
          </div>
        </section>

        <section>
          <h3>成员消耗</h3>
          <el-table :data="members" stripe>
            <el-table-column prop="name" label="姓名" min-width="100" />
            <el-table-column label="团队角色" width="110">
              <template #default="{ row }">
                {{ row.role === "team_admin" ? "团队管理员" : "成员" }}
              </template>
            </el-table-column>
            <el-table-column label="今日 Tokens" min-width="120">
              <template #default="{ row }">
                <span class="mono-num">{{ formatTokenCompact(row.todayTotalTokens) }}</span>
              </template>
            </el-table-column>
            <el-table-column label="本月 Tokens" min-width="120">
              <template #default="{ row }">
                <span class="mono-num">{{ formatTokenCompact(row.monthTotalTokens) }}</span>
              </template>
            </el-table-column>
          </el-table>
        </section>
      </div>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { ElMessage } from "element-plus";
import type { EChartsCoreOption } from "echarts/core";
import { http } from "@/api/http";
import UsageChart from "@/components/UsageChart.vue";
import { formatTokenCompact } from "@/lib/tokens";
import { useAuthStore } from "@/stores/auth";

type TeamRow = {
  id: number;
  name: string;
  status: "active" | "disabled";
  enterpriseId: number;
  enterpriseName: string;
  memberCount: number;
  todayTotalTokens: number;
  monthTotalTokens: number;
};

type MemberRow = {
  id: number;
  name: string;
  role: "member" | "team_admin";
  todayTotalTokens: number;
  monthTotalTokens: number;
};

type TeamUsage = {
  from: string;
  to: string;
  daily: Array<{ day: string; totalTokens: number }>;
  byModel: Array<{ model: string; totalTokens: number }>;
};

const auth = useAuthStore();
const rows = ref<TeamRow[]>([]);
const enterprises = ref<Array<{ id: number; name: string }>>([]);
const showCreate = ref(false);
const showEdit = ref(false);
const saving = ref(false);
const updating = ref(false);
const createName = ref("");
const createEnterpriseId = ref<number | undefined>();
const editName = ref("");
const editRow = ref<TeamRow | null>(null);
const showDetail = ref(false);
const detailLoading = ref(false);
const detailRow = ref<TeamRow | null>(null);
const members = ref<MemberRow[]>([]);
const usage = ref<TeamUsage | null>(null);
const usageLoading = ref(false);
const usageRange = ref<[string, string]>(defaultUsageRange());
const chartReady = ref(false);
const canCreate = computed(() => auth.isOrgAdmin);

async function load() {
  const { data } = await http.get("/api/admin/teams");
  if (data.success) rows.value = data.data;
}

async function loadEnterprises() {
  if (!auth.isSuperAdmin) return;
  const { data } = await http.get("/api/admin/enterprises");
  if (data.success) enterprises.value = data.data;
}

function openCreate() {
  createName.value = "";
  createEnterpriseId.value = auth.user?.enterpriseId ?? enterprises.value[0]?.id;
  showCreate.value = true;
}

function openEdit(row: TeamRow) {
  editRow.value = row;
  editName.value = row.name;
  showEdit.value = true;
}

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

async function openDetail(row: TeamRow) {
  detailRow.value = row;
  usageRange.value = defaultUsageRange();
  usage.value = null;
  members.value = [];
  showDetail.value = true;
  detailLoading.value = true;
  try {
    await Promise.all([loadMembers(row.id), loadUsage(row.id)]);
  } finally {
    detailLoading.value = false;
  }
}

async function loadMembers(teamId: number) {
  const { data } = await http.get(`/api/admin/teams/${teamId}/members`);
  if (data.success) members.value = data.data;
}

async function loadUsage(teamId: number) {
  const [from, to] = usageRange.value;
  usageLoading.value = true;
  try {
    const { data } = await http.get<{ success: boolean; data: TeamUsage; message?: string }>(
      `/api/admin/teams/${teamId}/usage`,
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
  if (!value || !detailRow.value) return;
  const days = inclusiveDays(value[0], value[1]);
  if (days < 1 || days > 366) {
    ElMessage.warning("日期范围最多 366 天");
    return;
  }
  loadUsage(detailRow.value.id);
}

const usageChartOption = computed<EChartsCoreOption>(() => ({
  color: ["#2563eb"],
  tooltip: { trigger: "axis", confine: true },
  grid: { left: 52, right: 24, bottom: 28, top: 28 },
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

async function createOne() {
  const name = createName.value.trim();
  if (!name) {
    ElMessage.warning("请填写团队名称");
    return;
  }
  if (auth.isSuperAdmin && !createEnterpriseId.value) {
    ElMessage.warning("请选择企业");
    return;
  }
  saving.value = true;
  try {
    const { data } = await http.post("/api/admin/teams", {
      name,
      ...(auth.isOrgAdmin ? {} : { enterpriseId: createEnterpriseId.value }),
    });
    if (!data.success) throw new Error(data.message);
    ElMessage.success("已创建");
    showCreate.value = false;
    await load();
  } catch (e: unknown) {
    ElMessage.error(requestMessage(e, "创建失败"));
  } finally {
    saving.value = false;
  }
}

async function updateOne() {
  if (!editRow.value) return;
  const name = editName.value.trim();
  if (!name) {
    ElMessage.warning("请填写团队名称");
    return;
  }
  updating.value = true;
  try {
    const { data } = await http.patch(`/api/admin/teams/${editRow.value.id}`, { name });
    if (!data.success) throw new Error(data.message);
    ElMessage.success("已更新");
    showEdit.value = false;
    await load();
  } catch (e: unknown) {
    ElMessage.error(requestMessage(e, "更新失败"));
  } finally {
    updating.value = false;
  }
}

function requestMessage(error: unknown, fallback: string) {
  const requestError = error as { message?: string; response?: { data?: { message?: string } } };
  return requestError.response?.data?.message || requestError.message || fallback;
}

onMounted(async () => {
  await loadEnterprises();
  await load();
});
</script>

<style scoped>
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
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
.detail-body {
  display: flex;
  flex-direction: column;
  gap: 24px;
}
.quota-stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}
.quota-stats span {
  display: block;
  margin-bottom: 6px;
  color: #64748b;
  font-size: 12px;
}
.quota-stats strong {
  color: #0f172a;
  font-size: 20px;
  font-variant-numeric: tabular-nums;
}
.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}
.detail-body h3 {
  margin: 0 0 12px;
  font-size: 15px;
}
.section-head h3 {
  margin: 0;
}
.chart-wrap {
  width: 100%;
  height: 320px;
}
@media (max-width: 768px) {
  .quota-stats {
    grid-template-columns: 1fr;
  }
}
</style>
