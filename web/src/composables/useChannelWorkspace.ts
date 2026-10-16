import { computed, reactive, ref, watch, type MaybeRefOrGetter, toValue } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { http } from "@/api/http";
import { useTablePage } from "@/lib/table-page";
import { requestMessage } from "@/lib/request-error";
import type {
  CreateProductInput,
  CredentialRow,
  EditProductForm,
  EmployeeOption,
  ProductRow,
  ProductType,
  SeatRow,
} from "@/components/channel/types";

type ApiEnvelope<T> = { success: boolean; message?: string; data?: T; code?: string };

type ProductLineApiRow = {
  id: number;
  providerId: number;
  providerCode?: string;
  name: string;
  code: string;
  productType?: ProductType;
  seatCount?: number;
  tag?: string | null;
  status: string;
  configVersion?: number;
  weeklyWindowResetAt?: string | null;
  monthlyWindowResetAt?: string | null;
  fiveHourCreditLimit?: string | number | null;
  weeklyCreditLimit?: string | number | null;
  monthlyCreditLimit?: string | number | null;
  zhipuOrganizationId?: string | null;
  zhipuProjectId?: string | null;
  officialQuotaQueryEnabled?: boolean;
  keyMaxMembers?: number | null;
  keyMaxConcurrency?: number | null;
};

function storedCreditLimit(value: string | number | null | undefined): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseCreditLimitInput(raw: string): number | null | undefined {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(trimmed)) return undefined;
  const value = Number(trimmed);
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

function parseCountInput(raw: string, min: number, max: number): number | null | undefined {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  if (!/^[1-9]\d*$/.test(trimmed)) return undefined;
  const value = Number(trimmed);
  return Number.isInteger(value) && value >= min && value <= max ? value : undefined;
}

function normalizeSeatTag(value: string): string | null {
  const tag = value.trim();
  if (tag.length > 32) return null;
  return tag;
}

function emptyEditForm(): EditProductForm {
  return {
    id: 0,
    configVersion: 1,
    productType: "coding_plan",
    providerCode: "",
    name: "",
    tag: "",
    seatCount: 0,
    status: "active",
    weeklyWindowResetAt: null,
    monthlyWindowResetAt: null,
    fiveHourCreditLimit: "",
    weeklyCreditLimit: "",
    monthlyCreditLimit: "",
    zhipuOrganizationId: "",
    zhipuProjectId: "",
    officialQuotaQueryEnabled: false,
    keyMaxMembers: "",
    keyMaxConcurrency: "",
  };
}

export function useChannelWorkspace(channelCode: MaybeRefOrGetter<string>) {
  const loading = ref(false);
  const products = ref<ProductRow[]>([]);
  const seats = ref<SeatRow[]>([]);
  const credentials = ref<CredentialRow[]>([]);
  const selectedProductId = ref<number | null>(null);
  const seatNameQuery = ref("");
  const onlyUnsubmitted = ref(false);

  const showCreateProduct = ref(false);
  const showEditProduct = ref(false);
  const showCreateSeat = ref(false);
  const showEditSeat = ref(false);
  const showCreateKey = ref(false);
  const showEditKey = ref(false);
  const productSaving = ref(false);
  const seatSaving = ref(false);
  const keySaving = ref(false);
  const removingKeyId = ref<number | null>(null);
  const removingSeatId = ref<number | null>(null);
  const employeeLoading = ref(false);
  const employees = ref<EmployeeOption[]>([]);
  const editSeatCurrentEmployee = ref<EmployeeOption | null>(null);

  const createForm = reactive({
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
  const editForm = reactive<EditProductForm>(emptyEditForm());
  const editOriginal = reactive({
    name: "",
    tag: "",
    seatCount: 0,
    status: "active" as "active" | "disabled",
    weeklyWindowResetAt: null as string | null,
    monthlyWindowResetAt: null as string | null,
    fiveHourCreditLimit: null as number | null,
    weeklyCreditLimit: null as number | null,
    monthlyCreditLimit: null as number | null,
    zhipuOrganizationId: null as string | null,
    zhipuProjectId: null as string | null,
    officialQuotaQueryEnabled: false,
    keyMaxMembers: null as number | null,
    keyMaxConcurrency: null as number | null,
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

  const selectedProduct = computed(
    () => products.value.find((row) => row.id === selectedProductId.value) ?? null,
  );

  const isSeatManaged = computed(
    () => Boolean(selectedProduct.value && selectedProduct.value.productType === "coding_plan"),
  );

  function employeeSeatCountOnProduct(employeeId: number | undefined, excludeSeatId?: number) {
    if (!employeeId || selectedProductId.value == null) return 0;
    return seats.value.filter((seat) => (
      seat.employeeId === employeeId
      && seat.productLineId === selectedProductId.value
      && seat.id !== excludeSeatId
    )).length;
  }

  const selectedSeats = computed(() => {
    const nameQuery = seatNameQuery.value.trim();
    return seats.value.filter((seat) => {
      if (seat.productLineId !== selectedProductId.value) return false;
      if (onlyUnsubmitted.value && seat.secretSuffix) return false;
      if (
        nameQuery
        && !seat.employeeName.includes(nameQuery)
        && !seat.employeePhone.includes(nameQuery)
        && !seat.tag.includes(nameQuery)
      ) {
        return false;
      }
      return true;
    });
  });

  const createSeatTagRequired = computed(
    () => employeeSeatCountOnProduct(seatForm.employeeId) > 0,
  );
  const editSeatTagRequired = computed(
    () => employeeSeatCountOnProduct(editSeatForm.employeeId, editSeatForm.id) > 0,
  );

  const {
    page: seatPage,
    paged: pagedSeats,
    total: seatTotal,
    pageSize: seatPageSize,
    resetPage: resetSeatPage,
  } = useTablePage(selectedSeats);

  const selectedKeys = computed(() =>
    credentials.value.filter((row) => row.productLineId === selectedProductId.value),
  );

  const {
    page: keyPage,
    paged: pagedKeys,
    total: keyTotal,
    pageSize: keyPageSize,
    resetPage: resetKeyPage,
  } = useTablePage(selectedKeys);

  const seatEmptyText = computed(() => {
    if (!seats.value.some((seat) => seat.productLineId === selectedProductId.value)) {
      return "这个产品还没有登记席位";
    }
    return "没有符合条件的席位";
  });

  const packageFull = computed(() => {
    const pkg = selectedProduct.value;
    if (!pkg || pkg.seatCount <= 0) return false;
    return registeredCount(pkg.id) >= pkg.seatCount;
  });

  function registeredCount(productLineId: number) {
    return seats.value.filter((seat) => seat.productLineId === productLineId).length;
  }

  function credentialCount(productLineId: number) {
    return credentials.value.filter((row) => row.productLineId === productLineId).length;
  }

  function productMeta(pkg: ProductRow) {
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

  function rememberSelection() {
    const inChannel = products.value;
    if (
      selectedProductId.value == null
      || !inChannel.some((row) => row.id === selectedProductId.value)
    ) {
      selectedProductId.value = inChannel[0]?.id ?? null;
    }
  }

  watch([selectedProductId, seatNameQuery, onlyUnsubmitted], () => {
    resetSeatPage();
    resetKeyPage();
  });

  async function refresh() {
    const code = toValue(channelCode);
    loading.value = true;
    try {
      const [lineRes, seatRes, credentialRes] = await Promise.all([
        http.get<ApiEnvelope<ProductLineApiRow[]>>("/api/admin/product-lines"),
        http.get<ApiEnvelope<SeatRow[]>>("/api/admin/channel-seats"),
        http.get<ApiEnvelope<CredentialRow[]>>("/api/admin/credentials"),
      ]);
      if (!lineRes.data.success) throw new Error(lineRes.data.message || "加载产品失败");
      if (!seatRes.data.success) throw new Error(seatRes.data.message || "加载席位失败");
      if (!credentialRes.data.success) throw new Error(credentialRes.data.message || "加载 KEY 失败");
      products.value = Array.isArray(lineRes.data.data)
        ? lineRes.data.data
          .filter((row) => row.providerCode === code)
          .map((row) => ({
            id: row.id,
            providerId: row.providerId,
            providerCode: row.providerCode ?? "",
            name: row.name,
            code: row.code,
            productType: row.productType === "api" ? "api" : "coding_plan",
            seatCount: Number(row.seatCount) || 0,
            tag: row.tag ?? "",
            status: row.status,
            configVersion: Number(row.configVersion) || 1,
            weeklyWindowResetAt: row.weeklyWindowResetAt ?? null,
            monthlyWindowResetAt: row.monthlyWindowResetAt ?? null,
            fiveHourCreditLimit: storedCreditLimit(row.fiveHourCreditLimit),
            weeklyCreditLimit: storedCreditLimit(row.weeklyCreditLimit),
            monthlyCreditLimit: storedCreditLimit(row.monthlyCreditLimit),
            zhipuOrganizationId: row.zhipuOrganizationId ?? null,
            zhipuProjectId: row.zhipuProjectId ?? null,
            officialQuotaQueryEnabled: Boolean(row.officialQuotaQueryEnabled),
            keyMaxMembers: storedCreditLimit(row.keyMaxMembers),
            keyMaxConcurrency: storedCreditLimit(row.keyMaxConcurrency),
          }))
        : [];
      seats.value = Array.isArray(seatRes.data.data)
        ? seatRes.data.data.map((row) => ({
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
        ? credentialRes.data.data.map((row) => ({
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

  function resetCreateForm(defaults?: { tag?: string }) {
    createForm.name = "";
    createForm.tag = defaults?.tag ?? "";
    createForm.variant = "domestic";
    createForm.seatCount = 0;
  }

  function openCreateProduct(defaults?: { tag?: string }) {
    resetCreateForm(defaults);
    showCreateProduct.value = true;
  }

  async function saveProduct(extra?: Pick<CreateProductInput, "variant">) {
    const name = createForm.name.trim();
    if (!name) {
      ElMessage.warning("请填写名称");
      return false;
    }
    if (createForm.seatCount < 0) {
      ElMessage.warning("请填写席位数量");
      return false;
    }
    const provider = toValue(channelCode);
    productSaving.value = true;
    try {
      const payload: Record<string, string | number | string[]> = {
        name,
        tag: createForm.tag.trim(),
        seatCount: createForm.seatCount,
        status: "active",
        supportedProtocols: ["anthropic_messages", "openai_chat", "openai_responses"],
        provider,
      };
      const variant = extra?.variant ?? createForm.variant;
      if (provider === "glm") payload.variant = variant;
      const { data } = await http.post<ApiEnvelope<ProductRow>>("/api/admin/product-lines", payload);
      if (!data.success) throw new Error(data.message || "创建产品失败");
      showCreateProduct.value = false;
      await refresh();
      const createdId = Number(data.data?.id);
      if (Number.isInteger(createdId)) selectedProductId.value = createdId;
      ElMessage.success("产品已创建");
      return true;
    } catch (error) {
      ElMessage.error(requestMessage(error, "创建产品失败"));
      return false;
    } finally {
      productSaving.value = false;
    }
  }

  function openEditProduct(pkg: ProductRow) {
    selectedProductId.value = pkg.id;
    editForm.id = pkg.id;
    editForm.configVersion = pkg.configVersion;
    editForm.productType = pkg.productType;
    editForm.providerCode = pkg.providerCode;
    editForm.name = pkg.name;
    editForm.tag = pkg.tag;
    editForm.seatCount = pkg.seatCount;
    editForm.status = pkg.status === "disabled" ? "disabled" : "active";
    editForm.weeklyWindowResetAt = pkg.weeklyWindowResetAt
      ? new Date(pkg.weeklyWindowResetAt)
      : null;
    editOriginal.weeklyWindowResetAt = pkg.weeklyWindowResetAt;
    editForm.monthlyWindowResetAt = pkg.monthlyWindowResetAt
      ? new Date(pkg.monthlyWindowResetAt)
      : null;
    editOriginal.monthlyWindowResetAt = pkg.monthlyWindowResetAt;
    editForm.fiveHourCreditLimit = pkg.fiveHourCreditLimit == null ? "" : String(pkg.fiveHourCreditLimit);
    editForm.weeklyCreditLimit = pkg.weeklyCreditLimit == null ? "" : String(pkg.weeklyCreditLimit);
    editForm.monthlyCreditLimit = pkg.monthlyCreditLimit == null ? "" : String(pkg.monthlyCreditLimit);
    editOriginal.fiveHourCreditLimit = pkg.fiveHourCreditLimit;
    editOriginal.weeklyCreditLimit = pkg.weeklyCreditLimit;
    editOriginal.monthlyCreditLimit = pkg.monthlyCreditLimit;
    editForm.zhipuOrganizationId = pkg.zhipuOrganizationId ?? "";
    editForm.zhipuProjectId = pkg.zhipuProjectId ?? "";
    editOriginal.zhipuOrganizationId = pkg.zhipuOrganizationId;
    editOriginal.zhipuProjectId = pkg.zhipuProjectId;
    editForm.officialQuotaQueryEnabled = pkg.officialQuotaQueryEnabled;
    editOriginal.officialQuotaQueryEnabled = pkg.officialQuotaQueryEnabled;
    editForm.keyMaxMembers = pkg.keyMaxMembers == null ? "" : String(pkg.keyMaxMembers);
    editForm.keyMaxConcurrency = pkg.keyMaxConcurrency == null ? "" : String(pkg.keyMaxConcurrency);
    editOriginal.keyMaxMembers = pkg.keyMaxMembers;
    editOriginal.keyMaxConcurrency = pkg.keyMaxConcurrency;
    editOriginal.name = pkg.name;
    editOriginal.tag = pkg.tag;
    editOriginal.seatCount = pkg.seatCount;
    editOriginal.status = pkg.status === "disabled" ? "disabled" : "active";
    showEditProduct.value = true;
  }

  async function saveEditProduct() {
    const name = editForm.name.trim();
    if (!name) {
      ElMessage.warning("请填写名称");
      return false;
    }
    if (editForm.productType === "coding_plan" && editForm.seatCount < 0) {
      ElMessage.warning("请填写席位数量");
      return false;
    }
    const payload: Record<string, unknown> = {
      expectedConfigVersion: editForm.configVersion,
    };
    if (name !== editOriginal.name) payload.name = name;
    if (editForm.tag.trim() !== editOriginal.tag) payload.tag = editForm.tag.trim();
    if (editForm.status !== editOriginal.status) payload.status = editForm.status;
    if (editForm.officialQuotaQueryEnabled !== editOriginal.officialQuotaQueryEnabled) {
      payload.officialQuotaQueryEnabled = editForm.officialQuotaQueryEnabled;
    }
    if (
      editForm.productType === "coding_plan"
      && editForm.seatCount !== editOriginal.seatCount
    ) {
      payload.seatCount = editForm.seatCount;
    }
    if (editForm.productType === "coding_plan") {
      const nextReset = editForm.weeklyWindowResetAt;
      const previousMs = editOriginal.weeklyWindowResetAt
        ? new Date(editOriginal.weeklyWindowResetAt).getTime()
        : null;
      if ((nextReset?.getTime() ?? null) !== previousMs) {
        payload.weeklyWindowResetAt = nextReset ? nextReset.toISOString() : null;
      }
      const fiveHourLimit = parseCreditLimitInput(editForm.fiveHourCreditLimit);
      const weeklyLimit = parseCreditLimitInput(editForm.weeklyCreditLimit);
      const monthlyLimit = parseCreditLimitInput(editForm.monthlyCreditLimit);
      if (fiveHourLimit === undefined || weeklyLimit === undefined || monthlyLimit === undefined) {
        ElMessage.warning("积分上限须为非负数，留空表示不限");
        return false;
      }
      if (fiveHourLimit !== editOriginal.fiveHourCreditLimit) {
        payload.fiveHourCreditLimit = fiveHourLimit;
      }
      if (weeklyLimit !== editOriginal.weeklyCreditLimit) {
        payload.weeklyCreditLimit = weeklyLimit;
      }
      if (monthlyLimit !== editOriginal.monthlyCreditLimit) {
        payload.monthlyCreditLimit = monthlyLimit;
      }
      const keyMaxMembers = parseCountInput(editForm.keyMaxMembers, 1, 100);
      const keyMaxConcurrency = parseCountInput(editForm.keyMaxConcurrency, 1, 1000);
      if (keyMaxMembers === undefined) {
        ElMessage.warning("可挂员工数须为 1–100 的整数，留空走全局默认");
        return false;
      }
      if (keyMaxConcurrency === undefined) {
        ElMessage.warning("KEY 并发须为 1–1000 的整数，留空走全局默认");
        return false;
      }
      if (keyMaxMembers !== editOriginal.keyMaxMembers) {
        payload.keyMaxMembers = keyMaxMembers;
      }
      if (keyMaxConcurrency !== editOriginal.keyMaxConcurrency) {
        payload.keyMaxConcurrency = keyMaxConcurrency;
      }
      const nextMonthlyReset = editForm.monthlyWindowResetAt;
      const previousMonthlyMs = editOriginal.monthlyWindowResetAt
        ? new Date(editOriginal.monthlyWindowResetAt).getTime()
        : null;
      if ((nextMonthlyReset?.getTime() ?? null) !== previousMonthlyMs) {
        payload.monthlyWindowResetAt = nextMonthlyReset ? nextMonthlyReset.toISOString() : null;
      }
      if (editForm.providerCode === "glm") {
        const nextOrgId = editForm.zhipuOrganizationId.trim() || null;
        const nextProjectId = editForm.zhipuProjectId.trim() || null;
        if (nextOrgId !== editOriginal.zhipuOrganizationId) {
          payload.zhipuOrganizationId = nextOrgId;
        }
        if (nextProjectId !== editOriginal.zhipuProjectId) {
          payload.zhipuProjectId = nextProjectId;
        }
      }
    }
    if (Object.keys(payload).length === 1) {
      ElMessage.info("未检测到需要保存的修改");
      return false;
    }
    productSaving.value = true;
    try {
      await http.patch(`/api/admin/product-lines/${editForm.id}`, payload);
      showEditProduct.value = false;
      await refresh();
      selectedProductId.value = editForm.id;
      ElMessage.success("产品已更新");
      return true;
    } catch (error) {
      const code = (error as { response?: { data?: { code?: string } } }).response?.data?.code;
      if (code === "CHANNEL_CONFIG_STALE") {
        showEditProduct.value = false;
        await refresh();
        ElMessage.warning("产品已被其他管理员更新，请刷新后重试");
      } else {
        ElMessage.error(requestMessage(error, "产品更新失败"));
      }
      return false;
    } finally {
      productSaving.value = false;
    }
  }

  function openCreateKey() {
    if (!selectedProduct.value) {
      ElMessage.warning("请先选择产品");
      return;
    }
    keyForm.label = selectedProduct.value.name;
    keyForm.secret = "";
    showCreateKey.value = true;
  }

  async function saveKey() {
    if (!selectedProductId.value) {
      ElMessage.warning("请先选择产品");
      return;
    }
    const secret = keyForm.secret.trim();
    if (!secret) {
      ElMessage.warning("请粘贴 API KEY");
      return;
    }
    keySaving.value = true;
    try {
      const { data } = await http.post<ApiEnvelope<CredentialRow>>("/api/admin/credentials", {
        productLineId: selectedProductId.value,
        label: keyForm.label.trim() || selectedProduct.value?.name || "KEY",
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
    if (!selectedProduct.value) {
      ElMessage.warning("请先选择产品");
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
      const { data } = await http.get<ApiEnvelope<EmployeeOption[]>>("/api/admin/users", {
        params: { q: query.trim() || undefined, limit: 30, status: "active" },
      });
      if (!data.success) throw new Error(data.message || "搜索员工失败");
      employees.value = Array.isArray(data.data)
        ? data.data.map((row) => ({ id: row.id, name: row.name, phone: row.phone }))
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
    if (!selectedProductId.value) {
      ElMessage.warning("请先选择产品");
      return;
    }
    if (!seatForm.employeeId) {
      ElMessage.warning("请选择员工");
      return;
    }
    const tag = normalizeSeatTag(seatForm.tag);
    if (tag == null) {
      ElMessage.warning("席位标签最多 32 个字符");
      return;
    }
    if (createSeatTagRequired.value && !tag) {
      ElMessage.warning("同一人在此产品下已有席位，请填写标签");
      return;
    }
    seatSaving.value = true;
    try {
      const { data } = await http.post<ApiEnvelope<SeatRow>>("/api/admin/channel-seats", {
        employeeId: seatForm.employeeId,
        productLineId: selectedProductId.value,
        tag,
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
    const tag = normalizeSeatTag(editSeatForm.tag);
    if (tag == null) {
      ElMessage.warning("席位标签最多 32 个字符");
      return;
    }
    if (editSeatTagRequired.value && !tag) {
      ElMessage.warning("同一人在此产品下已有席位，请填写标签");
      return;
    }
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
      const { data } = await http.patch<ApiEnvelope<SeatRow>>(
        `/api/admin/channel-seats/${editSeatForm.id}`,
        payload,
      );
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
      const { data } = await http.delete<ApiEnvelope<{ credentialDestroyed?: boolean }>>(
        `/api/admin/channel-seats/${row.id}`,
      );
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
      const { data } = await http.patch<ApiEnvelope<CredentialRow>>(
        `/api/admin/credentials/${editKeyForm.id}`,
        payload,
      );
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

  return {
    loading,
    products,
    seats,
    credentials,
    selectedProductId,
    selectedProduct,
    isSeatManaged,
    seatNameQuery,
    onlyUnsubmitted,
    showCreateProduct,
    showEditProduct,
    showCreateSeat,
    showEditSeat,
    showCreateKey,
    showEditKey,
    productSaving,
    seatSaving,
    keySaving,
    removingKeyId,
    removingSeatId,
    employeeLoading,
    employees,
    createForm,
    seatForm,
    keyForm,
    editForm,
    editSeatForm,
    editKeyForm,
    createSeatTagRequired,
    editSeatTagRequired,
    pagedSeats,
    seatTotal,
    seatPage,
    seatPageSize,
    pagedKeys,
    keyTotal,
    keyPage,
    keyPageSize,
    seatEmptyText,
    packageFull,
    productMeta,
    refresh,
    openCreateProduct,
    saveProduct,
    openEditProduct,
    saveEditProduct,
    openCreateKey,
    saveKey,
    removeKey,
    openCreateSeat,
    searchEmployees,
    saveSeat,
    openEditSeat,
    saveEditSeat,
    removeSeat,
    openEditKey,
    saveEditKey,
  };
}
