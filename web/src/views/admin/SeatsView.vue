<template>
  <div class="seats-page">
    <section class="page-card seats-shell">
      <div class="page-head">
        <p class="muted">登记智谱后台已分配的套餐名额。本系统不在智谱开通席位，只用来知道谁该提交渠道 KEY。</p>
        <div class="head-actions">
          <el-button :loading="loading" @click="refresh">刷新</el-button>
          <el-button :disabled="!selectedChannel || channelFull" @click="openBulk">批量添加</el-button>
          <el-button :disabled="!selectedChannel" @click="openBulkKeys">批量添加 KEY</el-button>
          <el-button type="primary" :disabled="!selectedChannel || channelFull" @click="openCreate">登记席位</el-button>
        </div>
      </div>

      <div v-loading="loading" class="split-layout">
        <aside class="channel-list-pane">
          <div class="pane-label">
            <span>渠道列表</span>
            <span class="pane-count">{{ channels.length }}</span>
          </div>
          <el-empty
            v-if="!loading && !channels.length"
            description="暂无上游渠道"
            :image-size="72"
          />
          <div v-else class="channel-list">
            <button
              v-for="channel in channels"
              :key="channel.id"
              type="button"
              class="channel-card"
              :class="{ selected: selectedProductLineId === channel.id }"
              @click="selectedProductLineId = channel.id"
            >
              <div class="channel-card-top">
                <div class="channel-card-copy">
                  <strong class="channel-card-title">{{ channelTitle(channel) }}</strong>
                  <el-tag v-if="channel.tag" effect="plain" class="channel-tag">{{ channel.tag }}</el-tag>
                </div>
              </div>
              <div class="channel-card-bottom">
                <span>{{ registeredSeatLabel(channel) }}</span>
              </div>
            </button>
          </div>
        </aside>

        <main class="channel-detail-pane">
          <template v-if="selectedChannel">
            <div class="detail-header">
              <div>
                <h3 class="detail-title">
                  {{ channelTitle(selectedChannel) }}
                  <el-tag v-if="selectedChannel.tag" effect="plain" class="channel-tag">{{ selectedChannel.tag }}</el-tag>
                </h3>
                <p class="muted">{{ registeredSeatLabel(selectedChannel) }}</p>
              </div>
              <div class="seat-filters">
                <el-input
                  v-model="seatNameQuery"
                  clearable
                  placeholder="按姓名查找"
                  class="seat-filter-input"
                />
                <el-input
                  v-model="seatPhoneQuery"
                  clearable
                  placeholder="按手机号查找"
                  class="seat-filter-input"
                />
                <el-checkbox v-model="onlyUnsubmitted">只看未提交</el-checkbox>
              </div>
            </div>

            <div class="seats-table-wrap">
            <el-table
              ref="seatsTableRef"
              :data="pagedSeats"
              stripe
              :empty-text="seatTableEmptyText"
              class="seats-table"
              height="100%"
            >
              <el-table-column label="员工" min-width="140">
                <template #default="{ row }">{{ row.employeeName }}</template>
              </el-table-column>
              <el-table-column label="手机号" min-width="130" prop="employeePhone" />
              <el-table-column label="企业" min-width="140">
                <template #default="{ row }">{{ row.enterpriseName || "—" }}</template>
              </el-table-column>
              <el-table-column label="标签" min-width="120">
                <template #default="{ row }">
                  <el-tag v-if="row.tag" effect="plain">{{ row.tag }}</el-tag>
                  <span v-else class="muted-cell">—</span>
                </template>
              </el-table-column>
              <el-table-column label="是否提交" width="112" align="center">
                <template #default="{ row }">
                  <el-tag
                    class="submit-status-tag"
                    :type="row.secretSuffix ? 'success' : 'warning'"
                    effect="plain"
                  >
                    {{ row.secretSuffix ? "已提交" : "未提交" }}
                  </el-tag>
                </template>
              </el-table-column>
              <el-table-column label="登记时间" min-width="170">
                <template #default="{ row }">{{ formatDateTime(row.createdAt) }}</template>
              </el-table-column>
              <el-table-column label="操作" width="100" align="center">
                <template #default="{ row }">
                  <el-button link type="danger" :loading="removingId === row.id" @click="removeSeat(row)">
                    回收
                  </el-button>
                </template>
              </el-table-column>
            </el-table>
            </div>
            <div v-if="seatTotal > 0" class="pager">
              <el-pagination
                v-model:current-page="seatPage"
                background
                layout="total, prev, pager, next"
                :total="seatTotal"
                :page-size="seatPageSize"
              />
            </div>
          </template>
          <el-empty
            v-else-if="!loading"
            class="detail-empty"
            :description="channels.length ? '请从左侧选择一个渠道' : '暂无上游渠道'"
            :image-size="96"
          />
        </main>
      </div>
    </section>

    <el-dialog v-model="showCreate" title="登记席位" width="480px" destroy-on-close>
      <el-form label-width="90px">
        <el-form-item label="渠道">
          <el-input :model-value="selectedChannelLabel" disabled />
        </el-form-item>
        <el-form-item label="员工" required>
          <el-select
            v-model="createForm.employeeId"
            filterable
            remote
            :remote-method="searchEmployees"
            :loading="employeeLoading"
            placeholder="姓名或手机号"
            style="width: 100%"
          >
            <el-option
              v-for="item in employees"
              :key="item.id"
              :label="`${item.name} · ${item.phone}`"
              :value="item.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="标签">
          <el-input
            v-model="createForm.tag"
            maxlength="32"
            show-word-limit
            placeholder="可选，用来区分同一员工的多个席位"
          />
        </el-form-item>
        <el-alert
          type="info"
          :closable="false"
          show-icon
          title="手动登记可以给同一员工在本渠道加多个席位，用标签区分。回收时会销毁对应渠道 KEY。"
        />
      </el-form>
      <template #footer>
        <el-button @click="showCreate = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="createSeat">登记</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="showBulk" title="批量添加席位" width="560px" destroy-on-close>
      <el-form label-position="top">
        <el-form-item label="渠道">
          <el-input :model-value="selectedChannelLabel" disabled />
        </el-form-item>
        <el-form-item label="姓名和手机号" required>
          <el-input
            v-model="bulkRaw"
            type="textarea"
            :rows="10"
            resize="vertical"
            placeholder="每行一人：姓名,手机号&#10;也支持用空格或 Tab 分隔"
          />
          <el-text class="form-help" type="info" size="small">
            批量添加时每人在本渠道默认一个席位，不加标签。只登记已注册员工。单次最多 200 人。
            <b v-if="bulkParse.users.length">已识别 {{ bulkParse.users.length }} 人</b>
          </el-text>
          <el-alert
            v-if="bulkParse.errors.length"
            class="parse-errors"
            type="error"
            :closable="false"
            show-icon
          >
            <div v-for="error in bulkParse.errors.slice(0, 4)" :key="error">{{ error }}</div>
            <div v-if="bulkParse.errors.length > 4">
              另有 {{ bulkParse.errors.length - 4 }} 项格式错误
            </div>
          </el-alert>
        </el-form-item>
        <el-table
          v-if="bulkParse.users.length"
          :data="bulkParse.users.slice(0, 5)"
          size="small"
          stripe
        >
          <el-table-column prop="name" label="姓名" />
          <el-table-column prop="phone" label="手机号" />
        </el-table>
        <el-text v-if="bulkParse.users.length > 5" class="form-help" type="info" size="small">
          其余 {{ bulkParse.users.length - 5 }} 人将一并登记
        </el-text>
      </el-form>
      <template #footer>
        <el-button @click="showBulk = false">取消</el-button>
        <el-button
          type="primary"
          :loading="bulkSaving"
          :disabled="!bulkParse.users.length || Boolean(bulkParse.errors.length)"
          @click="createBulkSeats"
        >
          登记 {{ bulkParse.users.length || "" }} 人
        </el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="showBulkKeys" title="批量添加 KEY" width="560px" destroy-on-close>
      <el-form label-position="top">
        <el-form-item label="渠道">
          <el-input :model-value="selectedChannelLabel" disabled />
        </el-form-item>
        <el-form-item label="姓名和渠道 KEY" required>
          <el-input
            v-model="bulkKeysRaw"
            type="textarea"
            :rows="10"
            resize="vertical"
            placeholder="每行一人：姓名 渠道KEY&#10;也支持用逗号或 Tab 分隔"
          />
          <el-text class="form-help" type="info" size="small">
            按姓名匹配当前渠道已登记席位。已提交的会跳过。同名多个席位无法自动匹配。单次最多 200 把。
            <b v-if="bulkKeysParse.entries.length">已识别 {{ bulkKeysParse.entries.length }} 把</b>
          </el-text>
          <el-alert
            v-if="bulkKeysParse.errors.length"
            class="parse-errors"
            type="error"
            :closable="false"
            show-icon
          >
            <div v-for="error in bulkKeysParse.errors.slice(0, 4)" :key="error">{{ error }}</div>
            <div v-if="bulkKeysParse.errors.length > 4">
              另有 {{ bulkKeysParse.errors.length - 4 }} 项格式错误
            </div>
          </el-alert>
        </el-form-item>
        <el-table
          v-if="bulkKeysParse.entries.length"
          :data="bulkKeysParse.entries.slice(0, 5)"
          size="small"
          stripe
        >
          <el-table-column prop="name" label="姓名" />
          <el-table-column label="KEY">
            <template #default="{ row }">{{ maskSeatKeySecret(row.secret) }}</template>
          </el-table-column>
        </el-table>
        <el-text v-if="bulkKeysParse.entries.length > 5" class="form-help" type="info" size="small">
          其余 {{ bulkKeysParse.entries.length - 5 }} 把将一并导入
        </el-text>
      </el-form>
      <template #footer>
        <el-button @click="showBulkKeys = false">取消</el-button>
        <el-button
          type="primary"
          :loading="bulkKeysSaving"
          :disabled="!bulkKeysParse.entries.length || Boolean(bulkKeysParse.errors.length)"
          @click="createBulkKeys"
        >
          导入 {{ bulkKeysParse.entries.length || "" }} 把 KEY
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, watch } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { http } from "@/api/http";
import { parseBulkRegisterText } from "@/lib/bulk-register-users";
import { maskSeatKeySecret, parseBulkSeatKeysText } from "@/lib/bulk-seat-keys";
import { channelDisplayName } from "@/lib/channel-display";
import { formatDateTime } from "@/lib/date-time";
import { useTablePage } from "@/lib/table-page";

type SeatRow = {
  id: number;
  employeeId: number;
  employeeName: string;
  employeePhone: string;
  enterpriseName: string | null;
  productLineId: number;
  channelName: string;
  providerName: string;
  tag: string;
  credentialId: number | null;
  secretSuffix: string | null;
  createdAt: string;
};

type EmployeeOption = {
  id: number;
  name: string;
  phone: string;
};

type ChannelOption = {
  id: number;
  name: string;
  providerCode: string;
  providerName: string;
  productLineCode: string;
  tag: string;
  seatCount: number;
};

const seatsTableRef = ref<{ doLayout?: () => void } | null>(null);
const loading = ref(false);
const saving = ref(false);
const bulkSaving = ref(false);
const employeeLoading = ref(false);
const removingId = ref<number | null>(null);
const showCreate = ref(false);
const showBulk = ref(false);
const showBulkKeys = ref(false);
const bulkKeysSaving = ref(false);
const bulkKeysRaw = ref("");
const seats = ref<SeatRow[]>([]);
const employees = ref<EmployeeOption[]>([]);
const channels = ref<ChannelOption[]>([]);
const selectedProductLineId = ref<number | null>(null);
const seatNameQuery = ref("");
const seatPhoneQuery = ref("");
const onlyUnsubmitted = ref(false);
const bulkRaw = ref("");
const createForm = reactive({
  employeeId: undefined as number | undefined,
  tag: "",
});

const selectedChannel = computed(
  () => channels.value.find((channel) => channel.id === selectedProductLineId.value) ?? null,
);
const selectedChannelLabel = computed(() => {
  const channel = selectedChannel.value;
  if (!channel) return "";
  const title = channelTitle(channel);
  return channel.tag ? `${title} · ${channel.tag}` : title;
});
const selectedSeats = computed(() => {
  const nameQuery = seatNameQuery.value.trim();
  const phoneQuery = seatPhoneQuery.value.trim();
  return seats.value.filter((seat) => {
    if (seat.productLineId !== selectedProductLineId.value) return false;
    if (onlyUnsubmitted.value && seat.secretSuffix) return false;
    if (nameQuery && !seat.employeeName.includes(nameQuery)) return false;
    if (phoneQuery && !seat.employeePhone.includes(phoneQuery)) return false;
    return true;
  });
});
const {
  page: seatPage,
  paged: pagedSeats,
  total: seatTotal,
  pageSize: seatPageSize,
  resetPage: resetSeatPage,
} = useTablePage(selectedSeats);
const seatTableEmptyText = computed(() => {
  if (!seats.value.some((seat) => seat.productLineId === selectedProductLineId.value)) {
    return "这个渠道还没有登记席位";
  }
  return "没有符合条件的席位";
});
const channelFull = computed(() => {
  const channel = selectedChannel.value;
  if (!channel || channel.seatCount <= 0) return false;
  return registeredCount(channel.id) >= channel.seatCount;
});
const bulkParse = computed(() => parseBulkRegisterText(bulkRaw.value));
const bulkKeysParse = computed(() => parseBulkSeatKeysText(bulkKeysRaw.value));

function channelTitle(channel: ChannelOption) {
  return channelDisplayName({
    providerCode: channel.providerCode,
    providerName: channel.providerName,
    productLineCode: channel.productLineCode,
    productLineName: channel.name,
  });
}

function registeredCount(productLineId: number) {
  return seats.value.filter((seat) => seat.productLineId === productLineId).length;
}

function registeredSeatLabel(channel: ChannelOption) {
  const registered = registeredCount(channel.id);
  if (channel.seatCount > 0) return `已登记 ${registered} / ${channel.seatCount} 个席位`;
  return registered ? `已登记 ${registered} 个席位 · 未填写总数` : "未填写席位数量";
}

function requestMessage(error: unknown, fallback: string): string {
  if (error && typeof error === "object" && "response" in error) {
    const message = (error as { response?: { data?: { message?: string } } }).response?.data?.message;
    if (message) return message;
  }
  return error instanceof Error ? error.message : fallback;
}

watch(selectedProductLineId, () => {
  seatNameQuery.value = "";
  seatPhoneQuery.value = "";
  onlyUnsubmitted.value = false;
  resetSeatPage();
});

watch([seatNameQuery, seatPhoneQuery, onlyUnsubmitted], () => {
  resetSeatPage();
});

function rememberSelectedChannel() {
  if (selectedProductLineId.value != null
    && channels.value.some((channel) => channel.id === selectedProductLineId.value)) {
    return;
  }
  selectedProductLineId.value = channels.value[0]?.id ?? null;
}

async function refresh() {
  loading.value = true;
  try {
    const [seatRes, channelRes] = await Promise.all([
      http.get("/api/admin/channel-seats"),
      http.get("/api/admin/product-lines"),
    ]);
    if (!seatRes.data.success) throw new Error(seatRes.data.message || "加载席位失败");
    if (!channelRes.data.success) throw new Error(channelRes.data.message || "加载渠道失败");
    seats.value = Array.isArray(seatRes.data.data) ? seatRes.data.data : [];
    channels.value = Array.isArray(channelRes.data.data)
      ? channelRes.data.data.map((row: {
        id: number;
        name: string;
        code?: string;
        providerCode?: string;
        providerName: string;
        seatCount?: number;
        tag?: string | null;
      }) => ({
          id: row.id,
          name: row.name,
          providerCode: row.providerCode ?? "",
          providerName: row.providerName,
          productLineCode: row.code ?? "",
          tag: row.tag ?? "",
          seatCount: Number(row.seatCount) || 0,
        }))
      : [];
    rememberSelectedChannel();
  } catch (error) {
    ElMessage.error(requestMessage(error, "加载席位失败"));
  } finally {
    loading.value = false;
    await nextTick();
    seatsTableRef.value?.doLayout?.();
  }
}

async function searchEmployees(query: string) {
  employeeLoading.value = true;
  try {
    const { data } = await http.get("/api/admin/users", {
      params: { q: query.trim() || undefined, limit: 30, status: "active" },
    });
    if (!data.success) throw new Error(data.message || "搜索员工失败");
    employees.value = Array.isArray(data.data)
      ? data.data
          .map((row: EmployeeOption) => ({ id: row.id, name: row.name, phone: row.phone }))
      : [];
  } catch (error) {
    employees.value = [];
    ElMessage.error(requestMessage(error, "搜索员工失败"));
  } finally {
    employeeLoading.value = false;
  }
}

function openCreate() {
  if (!selectedProductLineId.value) {
    ElMessage.warning("请先选择渠道");
    return;
  }
  createForm.employeeId = undefined;
  createForm.tag = "";
  employees.value = [];
  showCreate.value = true;
  void searchEmployees("");
}

function openBulk() {
  if (!selectedProductLineId.value) {
    ElMessage.warning("请先选择渠道");
    return;
  }
  bulkRaw.value = "";
  showBulk.value = true;
}

function openBulkKeys() {
  if (!selectedProductLineId.value) {
    ElMessage.warning("请先选择渠道");
    return;
  }
  bulkKeysRaw.value = "";
  showBulkKeys.value = true;
}

async function createSeat() {
  if (!selectedProductLineId.value) {
    ElMessage.warning("请先选择渠道");
    return;
  }
  if (!createForm.employeeId) {
    ElMessage.warning("请选择员工");
    return;
  }
  saving.value = true;
  try {
    const { data } = await http.post("/api/admin/channel-seats", {
      employeeId: createForm.employeeId,
      productLineId: selectedProductLineId.value,
      tag: createForm.tag.trim(),
    });
    if (!data.success) throw new Error(data.message || "登记失败");
    ElMessage.success("已登记席位");
    showCreate.value = false;
    await refresh();
  } catch (error) {
    ElMessage.error(requestMessage(error, "登记失败"));
  } finally {
    saving.value = false;
  }
}

async function createBulkSeats() {
  if (!selectedProductLineId.value) {
    ElMessage.warning("请先选择渠道");
    return;
  }
  const parsed = bulkParse.value;
  if (!parsed.users.length) {
    ElMessage.warning("请粘贴姓名和手机号");
    return;
  }
  if (parsed.errors.length) {
    ElMessage.warning("请先修正格式错误");
    return;
  }
  bulkSaving.value = true;
  try {
    const { data } = await http.post("/api/admin/channel-seats/bulk", {
      productLineId: selectedProductLineId.value,
      people: parsed.users.map((row) => ({ name: row.name, phone: row.phone })),
    });
    if (!data.success) throw new Error(data.message || "批量登记失败");
    const created = Array.isArray(data.data?.created) ? data.data.created.length : 0;
    const skipped = Array.isArray(data.data?.skipped) ? data.data.skipped.length : 0;
    const failed = Array.isArray(data.data?.failed) ? data.data.failed.length : 0;
    if (failed) {
      const first = data.data.failed[0];
      ElMessage.warning(
        `已登记 ${created} 人，跳过 ${skipped} 人，失败 ${failed} 人${first?.phone ? `（${first.phone} ${first.message}）` : ""}`,
      );
    } else if (skipped && created) {
      ElMessage.success(`已登记 ${created} 人，跳过 ${skipped} 人`);
    } else if (created) {
      ElMessage.success(`已登记 ${created} 人`);
    } else {
      ElMessage.warning(skipped ? `没有新增席位，跳过 ${skipped} 人` : "没有新增席位");
    }
    showBulk.value = false;
    await refresh();
  } catch (error) {
    ElMessage.error(requestMessage(error, "批量登记失败"));
  } finally {
    bulkSaving.value = false;
  }
}

async function createBulkKeys() {
  if (!selectedProductLineId.value) {
    ElMessage.warning("请先选择渠道");
    return;
  }
  const parsed = bulkKeysParse.value;
  if (!parsed.entries.length) {
    ElMessage.warning("请粘贴姓名和渠道 KEY");
    return;
  }
  if (parsed.errors.length) {
    ElMessage.warning("请先修正格式错误");
    return;
  }
  bulkKeysSaving.value = true;
  try {
    const { data } = await http.post("/api/admin/channel-seats/bulk-keys", {
      productLineId: selectedProductLineId.value,
      entries: parsed.entries.map((row) => ({ name: row.name, secret: row.secret })),
    });
    if (!data.success) throw new Error(data.message || "批量添加 KEY 失败");
    const assigned = Array.isArray(data.data?.assigned) ? data.data.assigned.length : 0;
    const skipped = Array.isArray(data.data?.skipped) ? data.data.skipped.length : 0;
    const failed = Array.isArray(data.data?.failed) ? data.data.failed.length : 0;
    if (failed) {
      const first = data.data.failed[0];
      ElMessage.warning(
        `已导入 ${assigned} 把，跳过 ${skipped} 把，失败 ${failed} 把${first?.name ? `（${first.name} ${first.message}）` : ""}`,
      );
    } else if (skipped && assigned) {
      ElMessage.success(`已导入 ${assigned} 把，跳过 ${skipped} 把`);
    } else if (assigned) {
      ElMessage.success(`已导入 ${assigned} 把 KEY`);
    } else {
      ElMessage.warning(skipped ? `没有新增 KEY，跳过 ${skipped} 把` : "没有新增 KEY");
    }
    showBulkKeys.value = false;
    await refresh();
  } catch (error) {
    ElMessage.error(requestMessage(error, "批量添加 KEY 失败"));
  } finally {
    bulkKeysSaving.value = false;
  }
}

async function removeSeat(row: SeatRow) {
  const tagLabel = row.tag ? `（${row.tag}）` : "";
  try {
    await ElMessageBox.confirm(
      row.secretSuffix
        ? `回收 ${row.employeeName}${tagLabel} 的席位，并销毁已提交的渠道 KEY（•••• ${row.secretSuffix}）。`
        : `回收 ${row.employeeName}${tagLabel} 的席位。`,
      "回收席位",
      { type: "warning", confirmButtonText: "回收", cancelButtonText: "取消" },
    );
  } catch {
    return;
  }
  removingId.value = row.id;
  try {
    const { data } = await http.delete(`/api/admin/channel-seats/${row.id}`);
    if (!data.success) throw new Error(data.message || "回收失败");
    ElMessage.success(data.data?.credentialDestroyed ? "已回收席位并销毁渠道 KEY" : "已回收席位");
    await refresh();
  } catch (error) {
    ElMessage.error(requestMessage(error, "回收失败"));
  } finally {
    removingId.value = null;
  }
}

onMounted(() => {
  void refresh();
});
</script>

<style scoped>
.seats-page {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  height: 100%;
  overflow: hidden;
}

.seats-shell {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  height: 100%;
  overflow: hidden;
}

.page-head {
  display: flex;
  flex-shrink: 0;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 12px;
}

.muted {
  margin: 0;
  color: #64748b;
  font-size: 13px;
  line-height: 1.5;
}

.head-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.split-layout {
  display: grid;
  grid-template-columns: minmax(260px, 340px) minmax(0, 1fr);
  gap: 16px;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.channel-list-pane,
.channel-detail-pane {
  min-width: 0;
  min-height: 0;
  height: 100%;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
}

.channel-list-pane {
  display: flex;
  flex-direction: column;
  padding: 12px;
  overflow: hidden;
  background: #f8fafc;
}

.pane-label {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
  padding: 0 4px;
  color: #64748b;
  font-size: 12px;
  font-weight: 600;
}

.pane-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 22px;
  height: 20px;
  padding: 0 6px;
  border-radius: 999px;
  background: #e2e8f0;
}

.channel-list {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
  overflow-y: auto;
}

.channel-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 100%;
  padding: 12px;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  background: #fff;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.channel-card:hover {
  border-color: #93c5fd;
}

.channel-card.selected {
  border-color: #3b82f6;
  background: #eff6ff;
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.12);
}

.channel-card-top {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}

.channel-card-copy {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  gap: 2px;
}

.channel-tag {
  width: fit-content;
  max-width: 100%;
}

.channel-card-title {
  display: -webkit-box;
  overflow: hidden;
  color: #0f172a;
  font-size: 14px;
  font-weight: 650;
  line-height: 1.35;
  white-space: normal;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.channel-card-bottom {
  color: #94a3b8;
  font-size: 12px;
}

.channel-detail-pane {
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding: 18px 20px;
  background: #fff;
  overflow: hidden;
}

.detail-header {
  display: flex;
  flex-shrink: 0;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 14px;
}

.seat-filters {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.seat-filter-input {
  width: 168px;
}

.detail-title {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin: 0;
  color: #0f172a;
  font-size: 20px;
  font-weight: 650;
}

.seats-table-wrap {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.seats-table {
  width: 100%;
  height: 100%;
}

.seats-table :deep(.el-table__header),
.seats-table :deep(.el-table__body) {
  table-layout: fixed;
}

.submit-status-tag {
  box-sizing: border-box;
  justify-content: center;
  min-width: 64px;
}

.pager {
  display: flex;
  flex-shrink: 0;
  justify-content: flex-end;
  margin-top: 12px;
}

.muted-cell {
  color: #94a3b8;
}

.form-help {
  display: block;
  margin-top: 6px;
}

.parse-errors {
  margin-top: 8px;
}

.detail-empty {
  margin: auto;
}

@media (max-width: 900px) {
  .split-layout {
    grid-template-columns: 1fr;
    grid-template-rows: minmax(0, 35%) minmax(0, 1fr);
  }

  .page-head,
  .detail-header {
    flex-direction: column;
  }
}
</style>
