<template>
  <div class="detail-block">
    <div class="pane-label">
      <span>KEY</span>
      <span class="pane-count">{{ total }}</span>
    </div>
    <div class="detail-header">
      <h3 class="detail-title">
        {{ productName }}
        <el-tag effect="plain">{{ kindLabel }}</el-tag>
      </h3>
      <el-button type="primary" @click="$emit('create')">添加 KEY</el-button>
    </div>
    <div class="seats-table-wrap">
      <el-table
        :data="rows"
        stripe
        empty-text="还没有 KEY，管理员可以直接粘贴添加"
        height="100%"
      >
        <el-table-column label="名称" min-width="140" prop="label" />
        <el-table-column label="KEY" min-width="120">
          <template #default="{ row }">•••• {{ row.secretSuffix }}</template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }">{{ statusLabel(row.status) }}</template>
        </el-table-column>
        <el-table-column label="添加时间" min-width="200" width="200" class-name="datetime-cell">
          <template #default="{ row }">{{ formatDateTime(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="200" align="center">
          <template #default="{ row }">
            <ConnectionTestButton :credential-id="row.id" @done="$emit('tested')" />
            <el-button link type="primary" @click="$emit('edit', row)">编辑</el-button>
            <el-button
              link
              type="danger"
              :loading="removingId === row.id"
              @click="$emit('remove', row)"
            >
              删除
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>
    <div v-if="total > 0" class="pager">
      <el-pagination
        :current-page="page"
        background
        layout="total, prev, pager, next"
        :total="total"
        :page-size="pageSize"
        @update:current-page="$emit('update:page', $event)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { formatDateTime } from "@/lib/date-time";
import ConnectionTestButton from "./ConnectionTestButton.vue";
import type { CredentialRow } from "./types";

defineProps<{
  productName: string;
  kindLabel: string;
  rows: CredentialRow[];
  total: number;
  page: number;
  pageSize: number;
  removingId: number | null;
}>();

defineEmits<{
  create: [];
  edit: [row: CredentialRow];
  remove: [row: CredentialRow];
  tested: [];
  "update:page": [value: number];
}>();

function statusLabel(status: string) {
  if (status === "cooling") return "冷却";
  if (status === "disabled") return "停用";
  return "可用";
}
</script>

<style scoped>
.detail-block {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
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

.seats-table-wrap {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

:deep(.datetime-cell .cell) {
  white-space: nowrap;
}

.pager {
  display: flex;
  flex-shrink: 0;
  justify-content: flex-end;
  margin-top: 12px;
}
</style>
