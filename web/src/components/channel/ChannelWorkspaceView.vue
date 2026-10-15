<template>
  <ChannelPageLayout v-loading="ws.loading">
    <template #products>
      <ProductList
        :products="ws.products"
        :selected-id="ws.selectedProductId"
        :loading="ws.loading"
        :add-label="addLabel"
        :product-kind-label="kindLabel"
        :meta-of="ws.productMeta"
        @create="ws.openCreateProduct({ tag: createTagDefault })"
        @select="ws.selectedProductId = $event"
        @edit="ws.openEditProduct"
      />
    </template>

    <div v-if="ws.selectedProduct" class="detail-stack">
      <SeatTable
        v-if="showSeats"
        :product-name="ws.selectedProduct.name"
        :kind-label="kindLabel"
        :rows="ws.pagedSeats"
        :total="ws.seatTotal"
        :page="ws.seatPage"
        :page-size="ws.seatPageSize"
        :name-query="ws.seatNameQuery"
        :only-unsubmitted="ws.onlyUnsubmitted"
        :full="ws.packageFull"
        :empty-text="ws.seatEmptyText"
        :removing-id="ws.removingSeatId"
        @create="ws.openCreateSeat"
        @edit="ws.openEditSeat"
        @remove="ws.removeSeat"
        @update:name-query="ws.seatNameQuery = $event"
        @update:only-unsubmitted="ws.onlyUnsubmitted = $event"
        @update:page="ws.seatPage = $event"
      />
      <CredentialList
        v-if="showKeys"
        :product-name="ws.selectedProduct.name"
        :kind-label="kindLabel"
        :rows="ws.pagedKeys"
        :total="ws.keyTotal"
        :page="ws.keyPage"
        :page-size="ws.keyPageSize"
        :removing-id="ws.removingKeyId"
        @create="ws.openCreateKey"
        @edit="ws.openEditKey"
        @remove="ws.removeKey"
        @tested="ws.refresh"
        @update:page="ws.keyPage = $event"
      />
    </div>
    <el-empty
      v-else-if="!ws.loading"
      description="请选择产品"
      :image-size="80"
    />

    <ProductDialog
      :visible="ws.showCreateProduct"
      mode="create"
      :title="addLabel"
      :channel-name="channel.company"
      :kind-label="kindLabel"
      :name="ws.createForm.name"
      :tag="ws.createForm.tag"
      :seat-count="ws.createForm.seatCount"
      :show-seat-count="showSeatCount"
      :show-credit-limits="false"
      five-hour-credit-limit=""
      weekly-credit-limit=""
      monthly-credit-limit=""
      :weekly-window-reset-at="null"
      :monthly-window-reset-at="null"
      status="active"
      :saving="ws.productSaving"
      :name-placeholder="namePlaceholder"
      @update:visible="ws.showCreateProduct = $event"
      @update:name="ws.createForm.name = $event"
      @update:tag="ws.createForm.tag = $event"
      @update:seat-count="ws.createForm.seatCount = $event"
      @submit="onCreate"
    >
      <slot name="create-extra" :form="ws.createForm" />
    </ProductDialog>

    <ProductDialog
      :visible="ws.showEditProduct"
      mode="edit"
      title="编辑产品"
      :channel-name="channel.company"
      :kind-label="kindLabel"
      :name="ws.editForm.name"
      :tag="ws.editForm.tag"
      :seat-count="ws.editForm.seatCount"
      :show-seat-count="showSeatCount"
      :show-credit-limits="showSeatCount"
      :five-hour-credit-limit="ws.editForm.fiveHourCreditLimit"
      :weekly-credit-limit="ws.editForm.weeklyCreditLimit"
      :monthly-credit-limit="ws.editForm.monthlyCreditLimit"
      :weekly-window-reset-at="ws.editForm.weeklyWindowResetAt"
      :monthly-window-reset-at="ws.editForm.monthlyWindowResetAt"
      :status="ws.editForm.status"
      :saving="ws.productSaving"
      @update:visible="ws.showEditProduct = $event"
      @update:name="ws.editForm.name = $event"
      @update:tag="ws.editForm.tag = $event"
      @update:seat-count="ws.editForm.seatCount = $event"
      @update:five-hour-credit-limit="ws.editForm.fiveHourCreditLimit = $event"
      @update:weekly-credit-limit="ws.editForm.weeklyCreditLimit = $event"
      @update:monthly-credit-limit="ws.editForm.monthlyCreditLimit = $event"
      @update:weekly-window-reset-at="onWeeklyReset"
      @update:monthly-window-reset-at="onMonthlyReset"
      @update:status="onStatus"
      @submit="onEdit"
    >
      <template #extra-edit>
        <slot name="edit-extra" :form="ws.editForm" />
      </template>
    </ProductDialog>

    <SeatDialog
      :visible="ws.showCreateSeat"
      mode="create"
      :product-name="ws.selectedProduct?.name ?? ''"
      :employee-id="ws.seatForm.employeeId"
      :tag="ws.seatForm.tag"
      :tag-required="ws.createSeatTagRequired"
      :employees="ws.employees"
      :employee-loading="ws.employeeLoading"
      :saving="ws.seatSaving"
      @update:visible="ws.showCreateSeat = $event"
      @update:employee-id="ws.seatForm.employeeId = $event"
      @update:tag="ws.seatForm.tag = $event"
      @search="ws.searchEmployees"
      @submit="ws.saveSeat"
    />
    <SeatDialog
      :visible="ws.showEditSeat"
      mode="edit"
      :product-name="ws.selectedProduct?.name ?? ''"
      :employee-id="ws.editSeatForm.employeeId"
      :tag="ws.editSeatForm.tag"
      :tag-required="ws.editSeatTagRequired"
      :employees="ws.employees"
      :employee-loading="ws.employeeLoading"
      :saving="ws.seatSaving"
      @update:visible="ws.showEditSeat = $event"
      @update:employee-id="ws.editSeatForm.employeeId = $event"
      @update:tag="ws.editSeatForm.tag = $event"
      @search="ws.searchEmployees"
      @submit="ws.saveEditSeat"
    />

    <CredentialDialog
      :visible="ws.showCreateKey"
      mode="create"
      :product-name="ws.selectedProduct?.name ?? ''"
      :product-label="kindLabel"
      :label="ws.keyForm.label"
      :secret="ws.keyForm.secret"
      status="active"
      :saving="ws.keySaving"
      @update:visible="ws.showCreateKey = $event"
      @update:label="ws.keyForm.label = $event"
      @update:secret="ws.keyForm.secret = $event"
      @submit="ws.saveKey"
    />
    <CredentialDialog
      :visible="ws.showEditKey"
      mode="edit"
      :product-name="ws.selectedProduct?.name ?? ''"
      :product-label="kindLabel"
      :label="ws.editKeyForm.label"
      :secret="ws.editKeyForm.secret"
      :secret-suffix="ws.editKeyForm.secretSuffix"
      :status="ws.editKeyForm.status"
      :saving="ws.keySaving"
      @update:visible="ws.showEditKey = $event"
      @update:label="ws.editKeyForm.label = $event"
      @update:secret="ws.editKeyForm.secret = $event"
      @update:status="ws.editKeyForm.status = $event"
      @submit="ws.saveEditKey"
    />
  </ChannelPageLayout>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, watch } from "vue";
import type { ChannelType } from "@/composables/useChannelTypes";
import { useChannelWorkspace } from "@/composables/useChannelWorkspace";
import ChannelPageLayout from "./ChannelPageLayout.vue";
import CredentialDialog from "./CredentialDialog.vue";
import CredentialList from "./CredentialList.vue";
import ProductDialog from "./ProductDialog.vue";
import ProductList from "./ProductList.vue";
import SeatDialog from "./SeatDialog.vue";
import SeatTable from "./SeatTable.vue";

const props = defineProps<{
  channel: ChannelType;
  showSeats: boolean;
  showKeys: boolean;
  showSeatCount: boolean;
  createTagDefault?: string;
  namePlaceholder?: string;
}>();

defineSlots<{
  "create-extra": (props: {
    form: {
      name: string;
      tag: string;
      variant: "domestic" | "international";
      seatCount: number;
    };
  }) => unknown;
  "edit-extra": (props: {
    form: {
      zhipuOrganizationId: string;
      zhipuProjectId: string;
    };
  }) => unknown;
}>();

const emit = defineEmits<{
  changed: [];
}>();

const ws = reactive(useChannelWorkspace(() => props.channel.code));
const addLabel = computed(() => `新增${props.channel.productLabel}`);
const kindLabel = computed(() => props.channel.productLabel);

async function onCreate() {
  const ok = await ws.saveProduct();
  if (ok) emit("changed");
}

async function onEdit() {
  const ok = await ws.saveEditProduct();
  if (ok) emit("changed");
}

function asDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

function onWeeklyReset(value: unknown) {
  ws.editForm.weeklyWindowResetAt = asDate(value);
}

function onMonthlyReset(value: unknown) {
  ws.editForm.monthlyWindowResetAt = asDate(value);
}

function onStatus(value: "active" | "disabled") {
  ws.editForm.status = value;
}

watch(
  () => props.channel.code,
  () => {
    void ws.refresh().then(() => emit("changed"));
  },
);

onMounted(() => {
  void ws.refresh();
});
</script>

<style scoped>
.detail-stack {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 16px;
  min-height: 0;
  overflow: auto;
}
</style>
