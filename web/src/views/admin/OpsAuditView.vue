<template>
  <div class="page-card">
    <h2 class="page-title">操作审计</h2>

    <el-form inline class="filters">
      <el-form-item label="动作">
        <el-select
          v-model="action"
          clearable
          filterable
          allow-create
          default-first-option
          placeholder="全部动作"
          style="width: 240px"
        >
          <el-option
            v-for="option in OPS_AUDIT_ACTION_OPTIONS"
            :key="option.value"
            :label="option.label"
            :value="option.value"
          />
        </el-select>
      </el-form-item>
      <el-form-item>
        <el-button type="primary" @click="search">查询</el-button>
      </el-form-item>
    </el-form>

    <el-table :data="items" stripe v-loading="loading">
      <el-table-column label="时间" width="220">
        <template #default="{ row }">{{ formatAuditDate(row.createdAt) }}</template>
      </el-table-column>
      <el-table-column label="操作人" min-width="110">
        <template #default="{ row }">{{ row.actorName || "—" }}</template>
      </el-table-column>
      <el-table-column label="手机" width="130">
        <template #default="{ row }">{{ row.actorPhone || "—" }}</template>
      </el-table-column>
      <el-table-column label="动作" min-width="180">
        <template #default="{ row }">
          <el-tooltip :content="row.action" placement="top">
            <el-tag effect="plain">{{ auditActionLabel(row.action) }}</el-tag>
          </el-tooltip>
        </template>
      </el-table-column>
      <el-table-column label="对象" min-width="180">
        <template #default="{ row }">
          <el-tooltip :content="auditTargetText(row.targetType, row.targetName)" placement="top">
            <span class="target-name">{{ auditTargetText(row.targetType, row.targetName) }}</span>
          </el-tooltip>
        </template>
      </el-table-column>
      <el-table-column label="IP" width="130">
        <template #default="{ row }">{{ row.ip || "—" }}</template>
      </el-table-column>
      <el-table-column label="详情" width="80" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" @click="showDetail(row)">查看</el-button>
        </template>
      </el-table-column>
    </el-table>

    <div class="pager">
      <el-pagination
        v-model:current-page="page"
        background
        small
        layout="total, prev, pager, next"
        :total="total"
        :page-size="limit"
        @current-change="load"
      />
    </div>

    <el-dialog v-model="detailVisible" :title="detailTitle" width="680px">
      <template v-if="selectedItem">
        <el-descriptions :column="2" border size="small">
          <el-descriptions-item label="时间">
            {{ formatAuditDate(selectedItem.createdAt) }}
          </el-descriptions-item>
          <el-descriptions-item label="操作人">
            {{ selectedItem.actorName || "—" }}
          </el-descriptions-item>
          <el-descriptions-item label="手机">
            {{ selectedItem.actorPhone || "—" }}
          </el-descriptions-item>
          <el-descriptions-item label="IP">
            {{ selectedItem.ip || "—" }}
          </el-descriptions-item>
          <el-descriptions-item label="动作">
            {{ auditActionLabel(selectedItem.action) }}
          </el-descriptions-item>
          <el-descriptions-item label="对象">
            {{ auditTargetText(selectedItem.targetType, selectedItem.targetName) }}
          </el-descriptions-item>
        </el-descriptions>

        <el-table
          v-if="selectedDetailRows.length"
          :data="selectedDetailRows"
          border
          size="small"
          class="detail-table"
        >
          <el-table-column prop="label" label="字段" width="180" />
          <el-table-column prop="value" label="内容" />
        </el-table>
        <el-empty v-else description="无详情" :image-size="56" />
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { http } from "@/api/http";
import {
  OPS_AUDIT_ACTION_OPTIONS,
  auditActionLabel,
  auditDetailRows,
  auditTargetText,
  formatAuditDate,
} from "@/lib/ops-audit-dictionary";

type AuditItem = {
  id: number;
  actorEmployeeId: number | null;
  actorName: string | null;
  actorPhone: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  targetName: string | null;
  detail: unknown;
  ip: string | null;
  createdAt: string;
};

const items = ref<AuditItem[]>([]);
const total = ref(0);
const page = ref(1);
/** Align with admin call logs: 10 rows per page. */
const limit = 10;
const loading = ref(false);
const action = ref("");
const detailVisible = ref(false);
const selectedItem = ref<AuditItem | null>(null);

const detailTitle = computed(() =>
  selectedItem.value ? auditActionLabel(selectedItem.value.action) : "操作详情",
);

const selectedDetailRows = computed(() => auditDetailRows(selectedItem.value?.detail));

async function load() {
  loading.value = true;
  try {
    const { data } = await http.get("/api/admin/ops-audit", {
      params: {
        limit,
        offset: (page.value - 1) * limit,
        action: action.value || undefined,
      },
    });
    if (data.success) {
      items.value = data.data.items;
      total.value = data.data.total;
    }
  } finally {
    loading.value = false;
  }
}

function search() {
  page.value = 1;
  load();
}

function showDetail(row: AuditItem) {
  selectedItem.value = row;
  detailVisible.value = true;
}

onMounted(load);
</script>

<style scoped>
.filters {
  margin-bottom: 8px;
}

.pager {
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;
}

.detail-table {
  margin-top: 16px;
}

.detail-table :deep(.cell) {
  word-break: break-word;
}

.target-name {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
