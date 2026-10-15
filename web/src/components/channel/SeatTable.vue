<template>
  <div class="detail-block">
    <div class="pane-label">
      <span>席位</span>
      <span class="pane-count">{{ total }}</span>
    </div>
    <div class="detail-header">
      <h3 class="detail-title">
        {{ productName }}
        <el-tag effect="plain">{{ kindLabel }}</el-tag>
      </h3>
      <div class="seat-toolbar">
        <el-input
          :model-value="nameQuery"
          clearable
          placeholder="按姓名或手机号查找"
          class="seat-filter-input"
          @update:model-value="$emit('update:nameQuery', $event)"
        />
        <el-checkbox
          :model-value="onlyUnsubmitted"
          @update:model-value="$emit('update:onlyUnsubmitted', $event)"
        >
          只看未提交
        </el-checkbox>
        <el-button type="primary" :disabled="full" @click="$emit('create')">
          新增席位
        </el-button>
      </div>
    </div>
    <div class="seats-table-wrap">
      <el-table :data="rows" stripe :empty-text="emptyText" height="100%">
        <el-table-column label="员工" min-width="120" prop="employeeName" />
        <el-table-column label="手机号" min-width="120" prop="employeePhone" />
        <el-table-column label="标签" min-width="120">
          <template #default="{ row }">{{ row.tag || "—" }}</template>
        </el-table-column>
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
        <el-table-column label="登记时间" min-width="200" width="200" class-name="datetime-cell">
          <template #default="{ row }">{{ formatDateTime(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="140" align="center">
          <template #default="{ row }">
            <el-button link type="primary" @click="$emit('edit', row)">编辑</el-button>
            <el-button
              link
              type="danger"
              :loading="removingId === row.id"
              @click="$emit('remove', row)"
            >
              回收
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
import type { SeatRow } from "./types";

defineProps<{
  productName: string;
  kindLabel: string;
  rows: SeatRow[];
  total: number;
  page: number;
  pageSize: number;
  nameQuery: string;
  onlyUnsubmitted: boolean;
  full: boolean;
  emptyText: string;
  removingId: number | null;
}>();

defineEmits<{
  create: [];
  edit: [row: SeatRow];
  remove: [row: SeatRow];
  "update:nameQuery": [value: string];
  "update:onlyUnsubmitted": [value: boolean];
  "update:page": [value: number];
}>();
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
