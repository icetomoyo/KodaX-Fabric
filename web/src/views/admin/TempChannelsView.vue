<template>
  <div class="temp-channels-page">
    <section class="page-card temp-channels-shell">
      <div class="page-head">
        <div class="head-actions">
          <el-button :loading="loading" @click="refresh">刷新</el-button>
        </div>
      </div>

      <div v-loading="loading" class="split-layout">
        <aside class="list-pane">
          <div class="pane-label">
            <span>渠道</span>
            <span class="pane-count">{{ channels.length }}</span>
          </div>
          <el-button class="pane-add" @click="openCreateChannel">新增渠道</el-button>
          <el-empty
            v-if="!loading && !channels.length"
            description="还没有上游渠道"
            :image-size="64"
          />
          <div v-else class="item-list">
            <button
              v-for="channel in channels"
              :key="channel.id"
              type="button"
              class="item-card"
              :class="{ selected: selectedChannelId === channel.id }"
              @click="selectChannel(channel.id)"
            >
              <strong class="item-title">{{ channel.name }}</strong>
              <span class="item-meta">{{ channelMeta(channel.id) }}</span>
            </button>
          </div>
        </aside>

        <aside class="list-pane">
          <div class="pane-label">
            <span>模式</span>
            <span class="pane-count">{{ packagesOfChannel.length }}</span>
          </div>
          <el-button class="pane-add" type="primary" :disabled="!selectedChannel" @click="openCreatePackage">
            新增模式
          </el-button>
          <el-empty
            v-if="!loading && selectedChannel && !packagesOfChannel.length"
            description="还没有模式"
            :image-size="64"
          />
          <el-empty
            v-else-if="!loading && !selectedChannel"
            description="请先选择渠道"
            :image-size="64"
          />
          <div v-else class="item-list">
            <button
              v-for="pkg in packagesOfChannel"
              :key="pkg.id"
              type="button"
              class="item-card"
              :class="{ selected: selectedPackageId === pkg.id }"
              @click="selectedPackageId = pkg.id"
            >
              <div class="item-card-top">
                <strong class="item-title">{{ pkg.name }}</strong>
                <span class="item-card-actions" @click.stop>
                  <el-tag effect="plain">{{ packageKindLabel(pkg.productType) }}</el-tag>
                  <el-button link type="primary" @click="openEditPackage(pkg)">编辑</el-button>
                </span>
              </div>
              <span class="item-meta">{{ packageMeta(pkg) }}</span>
            </button>
          </div>
        </aside>

        <main class="detail-pane">
          <div class="pane-label">
            <span>{{ selectedPackage?.productType === "api" ? "KEY" : "席位" }}</span>
            <span class="pane-count">{{ rightPaneCount }}</span>
          </div>
          <template v-if="selectedPackage?.productType === 'api'">
            <div class="detail-header">
              <h3 class="detail-title">
                {{ selectedPackage.name }}
                <el-tag effect="plain">充值</el-tag>
              </h3>
              <el-button type="primary" @click="openCreateKey">添加 KEY</el-button>
            </div>
            <div class="seats-table-wrap">
              <el-table
                :data="pagedKeys"
                stripe
                empty-text="还没有 KEY，管理员可以直接粘贴添加"
                height="100%"
              >
                <el-table-column label="名称" min-width="140" prop="label" />
                <el-table-column label="KEY" min-width="120">
                  <template #default="{ row }">•••• {{ row.secretSuffix }}</template>
                </el-table-column>
                <el-table-column label="状态" width="100">
                  <template #default="{ row }">{{ credentialStatusLabel(row.status) }}</template>
                </el-table-column>
                <el-table-column label="添加时间" min-width="160">
                  <template #default="{ row }">{{ formatDateTime(row.createdAt) }}</template>
                </el-table-column>
                <el-table-column label="操作" width="140" align="center">
                  <template #default="{ row }">
                    <el-button link type="primary" @click="openEditKey(row)">编辑</el-button>
                    <el-button
                      link
                      type="danger"
                      :loading="removingKeyId === row.id"
                      @click="removeKey(row)"
                    >
                      删除
                    </el-button>
                  </template>
                </el-table-column>
              </el-table>
            </div>
            <div v-if="keyTotal > 0" class="pager">
              <el-pagination
                v-model:current-page="keyPage"
                background
                layout="total, prev, pager, next"
                :total="keyTotal"
                :page-size="keyPageSize"
              />
            </div>
          </template>
          <template v-else-if="selectedPackage">
            <div class="detail-header">
              <h3 class="detail-title">
                {{ selectedPackage.name }}
                <el-tag effect="plain">{{ packageKindLabel(selectedPackage.productType) }}</el-tag>
              </h3>
              <div class="seat-toolbar">
                <el-input
                  v-model="seatNameQuery"
                  clearable
                  placeholder="按姓名查找"
                  class="seat-filter-input"
                />
                <el-checkbox v-model="onlyUnsubmitted">只看未提交</el-checkbox>
                <el-button type="primary" :disabled="packageFull" @click="openCreateSeat">
                  新增席位
                </el-button>
              </div>
            </div>
            <div class="seats-table-wrap">
              <el-table :data="pagedSeats" stripe :empty-text="seatEmptyText" height="100%">
                <el-table-column label="员工" min-width="120" prop="employeeName" />
                <el-table-column label="手机号" min-width="120" prop="employeePhone" />
                <el-table-column label="企业" min-width="120">
                  <template #default="{ row }">{{ row.enterpriseName || "—" }}</template>
                </el-table-column>
                <el-table-column label="是否提交 KEY" width="120" align="center">
                  <template #default="{ row }">
                    <el-tag :type="row.secretSuffix ? 'success' : 'warning'" effect="plain">
                      {{ row.secretSuffix ? "已提交" : "未提交" }}
                    </el-tag>
                  </template>
                </el-table-column>
                <el-table-column label="登记时间" min-width="160">
                  <template #default="{ row }">{{ formatDateTime(row.createdAt) }}</template>
                </el-table-column>
                <el-table-column label="操作" width="140" align="center">
                  <template #default="{ row }">
                    <el-button link type="primary" @click="openEditSeat(row)">编辑</el-button>
                    <el-button
                      link
                      type="danger"
                      :loading="removingSeatId === row.id"
                      @click="removeSeat(row)"
                    >
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
            :description="selectedChannel ? '请选择模式' : '请先选择渠道'"
            :image-size="80"
          />
        </main>
      </div>
    </section>

    <el-dialog v-model="showCreateChannel" title="新增渠道" width="480px" destroy-on-close>
      <p class="muted dialog-lead">先选厂商。智谱可挂套餐和充值，DeepSeek 只有充值。</p>
      <div class="provider-grid">
        <button
          v-for="option in channelOptions"
          :key="option.code"
          type="button"
          class="provider-card"
          :class="{ selected: createChannelCode === option.code, configured: option.exists }"
          @click="createChannelCode = option.code"
        >
          <strong>{{ option.title }}</strong>
          <small>{{ option.exists ? "已添加，选中即可" : option.hint }}</small>
        </button>
      </div>
      <template #footer>
        <el-button @click="showCreateChannel = false">取消</el-button>
        <el-button type="primary" :loading="channelSaving" @click="saveChannel">确定</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="showCreatePackage" title="新增模式" width="520px" destroy-on-close>
      <el-form label-width="100px">
        <el-form-item label="渠道">
          <el-input :model-value="selectedChannel?.name ?? ''" disabled />
        </el-form-item>
        <el-form-item label="模式" required>
          <el-radio-group v-model="packageForm.productType" :disabled="!selectedChannelAllowsCodingPlan">
            <el-radio-button v-if="selectedChannelAllowsCodingPlan" value="coding_plan">套餐</el-radio-button>
            <el-radio-button value="api">充值</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="名称" required>
          <el-input v-model="packageForm.name" maxlength="100" show-word-limit placeholder="例如 GLM-50" />
        </el-form-item>
        <el-form-item label="标签">
          <el-input v-model="packageForm.tag" maxlength="32" show-word-limit placeholder="国内、国际" />
        </el-form-item>
        <el-form-item v-if="packageForm.productType === 'coding_plan' && selectedChannel?.code === 'glm'" label="地区">
          <el-radio-group v-model="packageForm.variant">
            <el-radio-button value="domestic">国内</el-radio-button>
            <el-radio-button value="international">国际</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item v-if="packageForm.productType === 'coding_plan'" label="席位数量" required>
          <el-input-number v-model="packageForm.seatCount" :min="0" :max="100000" controls-position="right" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showCreatePackage = false">取消</el-button>
        <el-button type="primary" :loading="packageSaving" @click="savePackage">创建</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="showEditPackage" title="编辑模式" width="520px" destroy-on-close>
      <el-form label-width="100px">
        <el-form-item label="模式">
          <el-input :model-value="packageKindLabel(editPackageForm.productType)" disabled />
        </el-form-item>
        <el-form-item label="名称" required>
          <el-input v-model="editPackageForm.name" maxlength="100" show-word-limit />
        </el-form-item>
        <el-form-item label="标签">
          <el-input v-model="editPackageForm.tag" maxlength="32" show-word-limit placeholder="国内、国际" />
        </el-form-item>
        <el-form-item v-if="editPackageForm.productType === 'coding_plan'" label="席位数量" required>
          <el-input-number v-model="editPackageForm.seatCount" :min="0" :max="100000" controls-position="right" />
        </el-form-item>
        <el-form-item label="状态">
          <el-radio-group v-model="editPackageForm.status">
            <el-radio-button value="active">启用</el-radio-button>
            <el-radio-button value="disabled">停用</el-radio-button>
          </el-radio-group>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showEditPackage = false">取消</el-button>
        <el-button type="primary" :loading="packageSaving" @click="saveEditPackage">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="showCreateSeat" title="新增席位" width="480px" destroy-on-close>
      <el-form label-width="90px">
        <el-form-item label="模式">
          <el-input :model-value="selectedPackage?.name ?? ''" disabled />
        </el-form-item>
        <el-form-item label="员工" required>
          <el-select
            v-model="seatForm.employeeId"
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
          <el-input v-model="seatForm.tag" maxlength="32" show-word-limit placeholder="可选" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showCreateSeat = false">取消</el-button>
        <el-button type="primary" :loading="seatSaving" @click="saveSeat">登记</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="showCreateKey" title="添加 KEY" width="480px" destroy-on-close>
      <el-form label-width="90px">
        <el-form-item label="充值">
          <el-input :model-value="selectedPackage?.name ?? ''" disabled />
        </el-form-item>
        <el-form-item label="名称">
          <el-input v-model="keyForm.label" maxlength="200" placeholder="可选，默认用模式名" />
        </el-form-item>
        <el-form-item label="KEY" required>
          <el-input
            v-model="keyForm.secret"
            type="textarea"
            :rows="4"
            placeholder="粘贴管理员手里的 API KEY"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showCreateKey = false">取消</el-button>
        <el-button type="primary" :loading="keySaving" @click="saveKey">添加</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="showEditSeat" title="编辑席位" width="480px" destroy-on-close>
      <el-form label-width="90px">
        <el-form-item label="模式">
          <el-input :model-value="selectedPackage?.name ?? ''" disabled />
        </el-form-item>
        <el-form-item label="员工" required>
          <el-select
            v-model="editSeatForm.employeeId"
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
          <el-input v-model="editSeatForm.tag" maxlength="32" show-word-limit placeholder="可选" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showEditSeat = false">取消</el-button>
        <el-button type="primary" :loading="seatSaving" @click="saveEditSeat">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="showEditKey" title="编辑 KEY" width="480px" destroy-on-close>
      <el-form label-width="90px">
        <el-form-item label="充值">
          <el-input :model-value="selectedPackage?.name ?? ''" disabled />
        </el-form-item>
        <el-form-item label="名称" required>
          <el-input v-model="editKeyForm.label" maxlength="200" show-word-limit />
        </el-form-item>
        <el-form-item label="KEY">
          <el-input
            v-model="editKeyForm.secret"
            type="textarea"
            :rows="4"
            :placeholder="`当前 •••• ${editKeyForm.secretSuffix}，留空则不更换`"
          />
        </el-form-item>
        <el-form-item label="状态">
          <el-radio-group v-model="editKeyForm.status">
            <el-radio-button value="active">可用</el-radio-button>
            <el-radio-button value="disabled">停用</el-radio-button>
          </el-radio-group>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showEditKey = false">取消</el-button>
        <el-button type="primary" :loading="keySaving" @click="saveEditKey">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { http } from "@/api/http";
import { formatDateTime } from "@/lib/date-time";
import { useTablePage } from "@/lib/table-page";

type ProductType = "api" | "coding_plan";
type ChannelTemplateCode = "glm" | "deepseek";

const CHANNEL_OPTIONS: Array<{
  code: ChannelTemplateCode;
  title: string;
  name: string;
  hint: string;
  defaultBaseUrl: string;
}> = [
  {
    code: "glm",
    title: "智谱 / GLM",
    name: "智谱",
    hint: "支持套餐和充值",
    defaultBaseUrl: "https://open.bigmodel.cn/api/coding/paas/v4",
  },
  {
    code: "deepseek",
    title: "深度求索 / DeepSeek",
    name: "深度求索",
    hint: "仅充值",
    defaultBaseUrl: "https://api.deepseek.com",
  },
];

type ChannelRow = {
  id: number;
  name: string;
  code: string;
  status: string;
};

type PackageRow = {
  id: number;
  providerId: number;
  name: string;
  code: string;
  productType: ProductType;
  seatCount: number;
  tag: string;
  status: string;
  configVersion: number;
};

type SeatRow = {
  id: number;
  employeeId: number;
  employeeName: string;
  employeePhone: string;
  enterpriseName: string | null;
  productLineId: number;
  tag: string;
  secretSuffix: string | null;
  createdAt: string;
};

type EmployeeOption = { id: number; name: string; phone: string };

type CredentialRow = {
  id: number;
  productLineId: number;
  label: string;
  secretSuffix: string;
  status: string;
  createdAt: string;
};

const loading = ref(false);
const channels = ref<ChannelRow[]>([]);
const packages = ref<PackageRow[]>([]);
const seats = ref<SeatRow[]>([]);
const credentials = ref<CredentialRow[]>([]);
const selectedChannelId = ref<number | null>(null);
const selectedPackageId = ref<number | null>(null);
const seatNameQuery = ref("");
const onlyUnsubmitted = ref(false);

const showCreateChannel = ref(false);
const showCreatePackage = ref(false);
const showEditPackage = ref(false);
const showCreateSeat = ref(false);
const showEditSeat = ref(false);
const showCreateKey = ref(false);
const showEditKey = ref(false);
const channelSaving = ref(false);
const packageSaving = ref(false);
const seatSaving = ref(false);
const keySaving = ref(false);
const removingKeyId = ref<number | null>(null);
const removingSeatId = ref<number | null>(null);
const employeeLoading = ref(false);
const editSeatCurrentEmployee = ref<EmployeeOption | null>(null);
const createChannelCode = ref<ChannelTemplateCode>("glm");
const employees = ref<EmployeeOption[]>([]);
const packageForm = reactive({
  productType: "coding_plan" as ProductType,
  name: "",
  tag: "",
  variant: "domestic" as "domestic" | "international",
  seatCount: 0,
});
const seatForm = reactive({
  employeeId: undefined as number | undefined,
  tag: "",
});
const keyForm = reactive({
  label: "",
  secret: "",
});
const editPackageForm = reactive({
  id: 0,
  configVersion: 1,
  productType: "coding_plan" as ProductType,
  name: "",
  tag: "",
  seatCount: 0,
  status: "active" as "active" | "disabled",
});
const editPackageOriginal = reactive({
  name: "",
  tag: "",
  seatCount: 0,
  status: "active" as "active" | "disabled",
});
const editSeatForm = reactive({
  id: 0,
  employeeId: undefined as number | undefined,
  tag: "",
});
const editSeatOriginal = reactive({
  employeeId: 0,
  tag: "",
});
const editKeyForm = reactive({
  id: 0,
  label: "",
  secret: "",
  secretSuffix: "",
  status: "active" as "active" | "disabled",
});
const editKeyOriginal = reactive({
  label: "",
  status: "active" as "active" | "disabled",
});

const selectedChannel = computed(
  () => channels.value.find((row) => row.id === selectedChannelId.value) ?? null,
);

const channelOptions = computed(() =>
  CHANNEL_OPTIONS.map((option) => ({
    ...option,
    exists: channels.value.some((row) => row.code === option.code),
  })),
);

const selectedChannelAllowsCodingPlan = computed(
  () => selectedChannel.value?.code === "glm",
);

const packagesOfChannel = computed(() =>
  packages.value.filter((row) => row.providerId === selectedChannelId.value),
);

const selectedPackage = computed(
  () => packagesOfChannel.value.find((row) => row.id === selectedPackageId.value) ?? null,
);

const selectedSeats = computed(() => {
  const nameQuery = seatNameQuery.value.trim();
  return seats.value.filter((seat) => {
    if (seat.productLineId !== selectedPackageId.value) return false;
    if (onlyUnsubmitted.value && seat.secretSuffix) return false;
    if (nameQuery && !seat.employeeName.includes(nameQuery)) return false;
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

const selectedKeys = computed(() =>
  credentials.value.filter((row) => row.productLineId === selectedPackageId.value),
);

const {
  page: keyPage,
  paged: pagedKeys,
  total: keyTotal,
  pageSize: keyPageSize,
  resetPage: resetKeyPage,
} = useTablePage(selectedKeys);

const rightPaneCount = computed(() =>
  selectedPackage.value?.productType === "api" ? selectedKeys.value.length : selectedSeats.value.length,
);

const seatEmptyText = computed(() => {
  if (!seats.value.some((seat) => seat.productLineId === selectedPackageId.value)) {
    return "这个模式还没有登记席位";
  }
  return "没有符合条件的席位";
});

const packageFull = computed(() => {
  const pkg = selectedPackage.value;
  if (!pkg || pkg.seatCount <= 0) return false;
  return registeredCount(pkg.id) >= pkg.seatCount;
});

function packageKindLabel(productType: ProductType) {
  return productType === "api" ? "充值" : "套餐";
}

function registeredCount(productLineId: number) {
  return seats.value.filter((seat) => seat.productLineId === productLineId).length;
}

function channelMeta(channelId: number) {
  const count = packages.value.filter((row) => row.providerId === channelId).length;
  return count ? `${count} 个模式` : "还没有模式";
}

function credentialCount(productLineId: number) {
  return credentials.value.filter((row) => row.productLineId === productLineId).length;
}

function credentialStatusLabel(status: string) {
  if (status === "cooling") return "冷却";
  if (status === "disabled") return "停用";
  return "可用";
}

function packageMeta(pkg: PackageRow) {
  const registered = registeredCount(pkg.id);
  const submitted = seats.value.filter(
    (seat) => seat.productLineId === pkg.id && seat.secretSuffix,
  ).length;
  if (pkg.productType === "api") {
    const count = credentialCount(pkg.id);
    return count ? `${count} 把 KEY` : "未配置 KEY";
  }
  if (pkg.seatCount > 0) {
    return `席位 ${registered} / ${pkg.seatCount} · 已提交 KEY ${submitted}`;
  }
  return registered ? `已登记 ${registered} 个席位 · 已提交 KEY ${submitted}` : "未登记席位";
}

function requestMessage(error: unknown, fallback: string) {
  if (error && typeof error === "object" && "response" in error) {
    const message = (error as { response?: { data?: { message?: string } } }).response?.data?.message;
    if (message) return message;
  }
  return error instanceof Error ? error.message : fallback;
}

function selectChannel(channelId: number) {
  selectedChannelId.value = channelId;
  const first = packages.value.find((row) => row.providerId === channelId);
  selectedPackageId.value = first?.id ?? null;
}

function rememberSelection() {
  if (
    selectedChannelId.value == null
    || !channels.value.some((row) => row.id === selectedChannelId.value)
  ) {
    selectedChannelId.value = channels.value[0]?.id ?? null;
  }
  const inChannel = packages.value.filter((row) => row.providerId === selectedChannelId.value);
  if (
    selectedPackageId.value == null
    || !inChannel.some((row) => row.id === selectedPackageId.value)
  ) {
    selectedPackageId.value = inChannel[0]?.id ?? null;
  }
}

watch([selectedPackageId, seatNameQuery, onlyUnsubmitted], () => {
  resetSeatPage();
  resetKeyPage();
});

async function refresh() {
  loading.value = true;
  try {
    const [providerRes, lineRes, seatRes, credentialRes] = await Promise.all([
      http.get("/api/admin/providers"),
      http.get("/api/admin/product-lines"),
      http.get("/api/admin/channel-seats"),
      http.get("/api/admin/credentials"),
    ]);
    if (!providerRes.data.success) throw new Error(providerRes.data.message || "加载渠道失败");
    if (!lineRes.data.success) throw new Error(lineRes.data.message || "加载模式失败");
    if (!seatRes.data.success) throw new Error(seatRes.data.message || "加载席位失败");
    if (!credentialRes.data.success) throw new Error(credentialRes.data.message || "加载 KEY 失败");
    channels.value = Array.isArray(providerRes.data.data)
      ? providerRes.data.data
        .filter((row: ChannelRow) => row.code !== "custom" && row.code !== "haizhi")
        .map((row: ChannelRow) => ({
          id: row.id,
          name: row.name,
          code: row.code,
          status: row.status,
        }))
      : [];
    packages.value = Array.isArray(lineRes.data.data)
      ? lineRes.data.data.map((row: {
        id: number;
        providerId: number;
        name: string;
        code: string;
        productType?: ProductType;
        seatCount?: number;
        tag?: string | null;
        status: string;
        configVersion?: number;
      }) => ({
          id: row.id,
          providerId: row.providerId,
          name: row.name,
          code: row.code,
          productType: row.productType === "api" ? "api" : "coding_plan",
          seatCount: Number(row.seatCount) || 0,
          tag: row.tag ?? "",
          status: row.status,
          configVersion: Number(row.configVersion) || 1,
        }))
      : [];
    seats.value = Array.isArray(seatRes.data.data)
      ? seatRes.data.data.map((row: SeatRow) => ({
          id: row.id,
          employeeId: Number(row.employeeId) || 0,
          employeeName: row.employeeName,
          employeePhone: row.employeePhone,
          enterpriseName: row.enterpriseName ?? null,
          productLineId: row.productLineId,
          tag: row.tag ?? "",
          secretSuffix: row.secretSuffix ?? null,
          createdAt: row.createdAt,
        }))
      : [];
    credentials.value = Array.isArray(credentialRes.data.data)
      ? credentialRes.data.data.map((row: CredentialRow) => ({
          id: row.id,
          productLineId: row.productLineId,
          label: row.label,
          secretSuffix: row.secretSuffix,
          status: row.status,
          createdAt: row.createdAt,
        }))
      : [];
    rememberSelection();
  } catch (error) {
    ElMessage.error(requestMessage(error, "加载失败"));
  } finally {
    loading.value = false;
  }
}

function openCreateChannel() {
  createChannelCode.value = "glm";
  showCreateChannel.value = true;
}

async function saveChannel() {
  const option = CHANNEL_OPTIONS.find((item) => item.code === createChannelCode.value);
  if (!option) {
    ElMessage.warning("请选择渠道");
    return;
  }
  const existing = channels.value.find((row) => row.code === option.code);
  if (existing) {
    selectChannel(existing.id);
    showCreateChannel.value = false;
    ElMessage.success(`已选择 ${existing.name}`);
    return;
  }
  channelSaving.value = true;
  try {
    const { data } = await http.post("/api/admin/providers", {
      code: option.code,
      name: option.name,
      defaultBaseUrl: option.defaultBaseUrl,
      authStyle: "bearer",
      withApiLine: false,
    });
    if (!data.success) throw new Error(data.message || "新增渠道失败");
    showCreateChannel.value = false;
    await refresh();
    const createdId = Number(data.data?.id);
    if (Number.isInteger(createdId)) selectChannel(createdId);
    ElMessage.success("渠道已添加");
  } catch (error) {
    ElMessage.error(requestMessage(error, "新增渠道失败"));
  } finally {
    channelSaving.value = false;
  }
}

function openCreatePackage() {
  if (!selectedChannel.value) {
    ElMessage.warning("请先选择渠道");
    return;
  }
  if (selectedChannel.value.code !== "glm" && selectedChannel.value.code !== "deepseek") {
    ElMessage.warning("目前只支持给智谱或 DeepSeek 新增模式");
    return;
  }
  packageForm.productType = selectedChannelAllowsCodingPlan.value ? "coding_plan" : "api";
  packageForm.name = "";
  packageForm.tag = selectedChannel.value.code === "glm" ? "国内" : "";
  packageForm.variant = "domestic";
  packageForm.seatCount = 0;
  showCreatePackage.value = true;
}

async function savePackage() {
  const name = packageForm.name.trim();
  if (!name) {
    ElMessage.warning("请填写名称");
    return;
  }
  if (packageForm.productType === "coding_plan" && packageForm.seatCount < 0) {
    ElMessage.warning("请填写席位数量");
    return;
  }
  const provider = selectedChannel.value?.code;
  if (provider !== "glm" && provider !== "deepseek") {
    ElMessage.warning("目前只支持给智谱或 DeepSeek 新增模式");
    return;
  }
  packageSaving.value = true;
  try {
    const payload: Record<string, unknown> = {
      name,
      tag: packageForm.tag.trim(),
      seatCount: packageForm.productType === "api" ? 0 : packageForm.seatCount,
      status: "active",
      supportedProtocols: ["anthropic_messages", "openai_chat", "openai_responses"],
      provider,
      productType: packageForm.productType,
    };
    if (provider === "glm") payload.variant = packageForm.variant;
    const { data } = await http.post("/api/admin/product-lines", payload);
    if (!data.success) throw new Error(data.message || "创建模式失败");
    showCreatePackage.value = false;
    await refresh();
    const createdId = Number(data.data?.id);
    if (Number.isInteger(createdId)) selectedPackageId.value = createdId;
    ElMessage.success("模式已创建");
  } catch (error) {
    ElMessage.error(requestMessage(error, "创建模式失败"));
  } finally {
    packageSaving.value = false;
  }
}

function openEditPackage(pkg: PackageRow) {
  selectedPackageId.value = pkg.id;
  editPackageForm.id = pkg.id;
  editPackageForm.configVersion = pkg.configVersion;
  editPackageForm.productType = pkg.productType;
  editPackageForm.name = pkg.name;
  editPackageForm.tag = pkg.tag;
  editPackageForm.seatCount = pkg.seatCount;
  editPackageForm.status = pkg.status === "disabled" ? "disabled" : "active";
  editPackageOriginal.name = pkg.name;
  editPackageOriginal.tag = pkg.tag;
  editPackageOriginal.seatCount = pkg.seatCount;
  editPackageOriginal.status = pkg.status === "disabled" ? "disabled" : "active";
  showEditPackage.value = true;
}

async function saveEditPackage() {
  const name = editPackageForm.name.trim();
  if (!name) {
    ElMessage.warning("请填写名称");
    return;
  }
  if (editPackageForm.productType === "coding_plan" && editPackageForm.seatCount < 0) {
    ElMessage.warning("请填写席位数量");
    return;
  }
  const payload: Record<string, unknown> = {
    expectedConfigVersion: editPackageForm.configVersion,
  };
  if (name !== editPackageOriginal.name) payload.name = name;
  if (editPackageForm.tag.trim() !== editPackageOriginal.tag) {
    payload.tag = editPackageForm.tag.trim();
  }
  if (editPackageForm.status !== editPackageOriginal.status) {
    payload.status = editPackageForm.status;
  }
  if (
    editPackageForm.productType === "coding_plan"
    && editPackageForm.seatCount !== editPackageOriginal.seatCount
  ) {
    payload.seatCount = editPackageForm.seatCount;
  }
  if (Object.keys(payload).length === 1) {
    ElMessage.info("未检测到需要保存的修改");
    return;
  }
  packageSaving.value = true;
  try {
    await http.patch(`/api/admin/product-lines/${editPackageForm.id}`, payload);
    showEditPackage.value = false;
    await refresh();
    selectedPackageId.value = editPackageForm.id;
    ElMessage.success("模式已更新");
  } catch (error) {
    const code = (error as { response?: { data?: { code?: string } } }).response?.data?.code;
    if (code === "CHANNEL_CONFIG_STALE") {
      showEditPackage.value = false;
      await refresh();
      ElMessage.warning("模式已被其他管理员更新，请刷新后重试");
    } else {
      ElMessage.error(requestMessage(error, "模式更新失败"));
    }
  } finally {
    packageSaving.value = false;
  }
}

function openCreateKey() {
  if (!selectedPackage.value || selectedPackage.value.productType !== "api") {
    ElMessage.warning("请先选择充值模式");
    return;
  }
  keyForm.label = selectedPackage.value.name;
  keyForm.secret = "";
  showCreateKey.value = true;
}

async function saveKey() {
  if (!selectedPackageId.value) {
    ElMessage.warning("请先选择充值模式");
    return;
  }
  const secret = keyForm.secret.trim();
  if (!secret) {
    ElMessage.warning("请粘贴 API KEY");
    return;
  }
  keySaving.value = true;
  try {
    const { data } = await http.post("/api/admin/credentials", {
      productLineId: selectedPackageId.value,
      label: keyForm.label.trim() || selectedPackage.value?.name || "KEY",
      secret,
    });
    if (!data.success) throw new Error(data.message || "添加 KEY 失败");
    ElMessage.success("KEY 已添加");
    showCreateKey.value = false;
    await refresh();
  } catch (error) {
    ElMessage.error(requestMessage(error, "添加 KEY 失败"));
  } finally {
    keySaving.value = false;
  }
}

async function removeKey(row: CredentialRow) {
  try {
    await ElMessageBox.confirm(`删除 KEY •••• ${row.secretSuffix}？`, "删除 KEY", {
      type: "warning",
      confirmButtonText: "删除",
      cancelButtonText: "取消",
    });
  } catch {
    return;
  }
  removingKeyId.value = row.id;
  try {
    await http.delete(`/api/admin/credentials/${row.id}`);
    ElMessage.success("KEY 已删除");
    await refresh();
  } catch (error) {
    ElMessage.error(requestMessage(error, "删除 KEY 失败"));
  } finally {
    removingKeyId.value = null;
  }
}

function openCreateSeat() {
  if (!selectedPackage.value) {
    ElMessage.warning("请先选择模式");
    return;
  }
  seatForm.employeeId = undefined;
  seatForm.tag = "";
  employees.value = [];
  editSeatCurrentEmployee.value = null;
  showCreateSeat.value = true;
  void searchEmployees("");
}

async function searchEmployees(query: string) {
  employeeLoading.value = true;
  try {
    const { data } = await http.get("/api/admin/users", {
      params: { q: query.trim() || undefined, limit: 30, status: "active" },
    });
    if (!data.success) throw new Error(data.message || "搜索员工失败");
    employees.value = Array.isArray(data.data)
      ? data.data.map((row: EmployeeOption) => ({ id: row.id, name: row.name, phone: row.phone }))
      : [];
    const current = editSeatCurrentEmployee.value;
    if (
      showEditSeat.value
      && current
      && !employees.value.some((item) => item.id === current.id)
    ) {
      employees.value.unshift(current);
    }
  } catch (error) {
    employees.value = [];
    ElMessage.error(requestMessage(error, "搜索员工失败"));
  } finally {
    employeeLoading.value = false;
  }
}

async function saveSeat() {
  if (!selectedPackageId.value) {
    ElMessage.warning("请先选择模式");
    return;
  }
  if (!seatForm.employeeId) {
    ElMessage.warning("请选择员工");
    return;
  }
  seatSaving.value = true;
  try {
    const { data } = await http.post("/api/admin/channel-seats", {
      employeeId: seatForm.employeeId,
      productLineId: selectedPackageId.value,
      tag: seatForm.tag.trim(),
    });
    if (!data.success) throw new Error(data.message || "登记失败");
    ElMessage.success("已登记席位");
    showCreateSeat.value = false;
    await refresh();
  } catch (error) {
    ElMessage.error(requestMessage(error, "登记失败"));
  } finally {
    seatSaving.value = false;
  }
}

function openEditSeat(row: SeatRow) {
  editSeatForm.id = row.id;
  editSeatForm.employeeId = row.employeeId;
  editSeatForm.tag = row.tag ?? "";
  editSeatOriginal.employeeId = row.employeeId;
  editSeatOriginal.tag = row.tag ?? "";
  editSeatCurrentEmployee.value = {
    id: row.employeeId,
    name: row.employeeName,
    phone: row.employeePhone,
  };
  employees.value = [editSeatCurrentEmployee.value];
  showEditSeat.value = true;
  void searchEmployees("");
}

async function saveEditSeat() {
  if (!editSeatForm.employeeId) {
    ElMessage.warning("请选择员工");
    return;
  }
  const tag = editSeatForm.tag.trim();
  const payload: Record<string, unknown> = {};
  if (editSeatForm.employeeId !== editSeatOriginal.employeeId) {
    payload.employeeId = editSeatForm.employeeId;
  }
  if (tag !== editSeatOriginal.tag) payload.tag = tag;
  if (!Object.keys(payload).length) {
    ElMessage.info("未检测到需要保存的修改");
    return;
  }
  seatSaving.value = true;
  try {
    const { data } = await http.patch(`/api/admin/channel-seats/${editSeatForm.id}`, payload);
    if (!data.success) throw new Error(data.message || "席位更新失败");
    ElMessage.success("席位已更新");
    showEditSeat.value = false;
    editSeatCurrentEmployee.value = null;
    await refresh();
  } catch (error) {
    ElMessage.error(requestMessage(error, "席位更新失败"));
  } finally {
    seatSaving.value = false;
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
  removingSeatId.value = row.id;
  try {
    const { data } = await http.delete(`/api/admin/channel-seats/${row.id}`);
    if (!data.success) throw new Error(data.message || "回收失败");
    ElMessage.success(data.data?.credentialDestroyed ? "已回收席位并销毁渠道 KEY" : "已回收席位");
    await refresh();
  } catch (error) {
    ElMessage.error(requestMessage(error, "回收失败"));
  } finally {
    removingSeatId.value = null;
  }
}

function openEditKey(row: CredentialRow) {
  editKeyForm.id = row.id;
  editKeyForm.label = row.label;
  editKeyForm.secret = "";
  editKeyForm.secretSuffix = row.secretSuffix;
  editKeyForm.status = row.status === "disabled" ? "disabled" : "active";
  editKeyOriginal.label = row.label;
  editKeyOriginal.status = row.status === "disabled" ? "disabled" : "active";
  showEditKey.value = true;
}

async function saveEditKey() {
  const label = editKeyForm.label.trim();
  if (!label) {
    ElMessage.warning("请填写名称");
    return;
  }
  const secret = editKeyForm.secret.trim();
  if (secret && secret.length < 8) {
    ElMessage.warning("KEY 至少 8 个字符，留空则不更换");
    return;
  }
  const payload: Record<string, unknown> = {};
  if (label !== editKeyOriginal.label) payload.label = label;
  if (editKeyForm.status !== editKeyOriginal.status) payload.status = editKeyForm.status;
  if (secret) payload.secret = secret;
  if (!Object.keys(payload).length) {
    ElMessage.info("未检测到需要保存的修改");
    return;
  }
  keySaving.value = true;
  try {
    const { data } = await http.patch(`/api/admin/credentials/${editKeyForm.id}`, payload);
    if (!data.success) throw new Error(data.message || "KEY 更新失败");
    ElMessage.success("KEY 已更新");
    showEditKey.value = false;
    await refresh();
  } catch (error) {
    ElMessage.error(requestMessage(error, "KEY 更新失败"));
  } finally {
    keySaving.value = false;
  }
}

onMounted(() => {
  void refresh();
});
</script>

<style scoped>
.temp-channels-page {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  height: 100%;
  overflow: hidden;
}

.temp-channels-shell {
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
  align-items: center;
  justify-content: flex-end;
  gap: 16px;
  margin-bottom: 12px;
}

.head-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.muted {
  margin: 0;
  color: #64748b;
  font-size: 13px;
  line-height: 1.5;
}

.split-layout {
  display: grid;
  grid-template-columns: minmax(200px, 260px) minmax(240px, 320px) minmax(0, 1fr);
  gap: 12px;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.list-pane,
.detail-pane {
  min-width: 0;
  min-height: 0;
  height: 100%;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
}

.list-pane {
  display: flex;
  flex-direction: column;
  padding: 12px;
  overflow: hidden;
  background: #f8fafc;
}

.pane-add {
  width: 100%;
  margin-bottom: 10px;
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

.item-list {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
  overflow-y: auto;
}

.item-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
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

.item-card:hover {
  border-color: #93c5fd;
}

.item-card.selected {
  border-color: #3b82f6;
  background: #eff6ff;
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.12);
}

.item-card-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
}

.item-card-actions {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 4px;
}

.item-title {
  color: #0f172a;
  font-size: 14px;
  font-weight: 650;
  line-height: 1.35;
}

.item-meta {
  color: #94a3b8;
  font-size: 12px;
}

.detail-pane {
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding: 12px 16px 16px;
  background: #fff;
  overflow: hidden;
}

.detail-header {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.detail-title {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin: 0;
  color: #0f172a;
  font-size: 18px;
  font-weight: 650;
}

.seat-toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.seat-filter-input {
  width: 160px;
}

.seats-table-wrap {
  flex: 1;
  min-height: 0;
  overflow: hidden;
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

.dialog-lead {
  margin-bottom: 12px;
}

.provider-grid {
  display: grid;
  gap: 8px;
}

.provider-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 100%;
  padding: 14px;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  background: #fff;
  text-align: left;
  cursor: pointer;
}

.provider-card.selected {
  border-color: #3b82f6;
  background: #eff6ff;
}

.provider-card small {
  color: #64748b;
}
</style>
