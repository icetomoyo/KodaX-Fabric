<template>
  <div class="product-list">
    <div class="pane-label">
      <span>产品</span>
      <span class="pane-count">{{ products.length }}</span>
    </div>
    <el-button class="pane-add" type="primary" @click="$emit('create')">
      {{ addLabel }}
    </el-button>
    <el-empty
      v-if="!loading && !products.length"
      description="还没有产品"
      :image-size="64"
    />
    <div v-else class="item-list">
      <button
        v-for="pkg in products"
        :key="pkg.id"
        type="button"
        class="item-card"
        :class="{ selected: selectedId === pkg.id }"
        @click="$emit('select', pkg.id)"
      >
        <div class="item-card-top">
          <strong class="item-title">{{ pkg.name }}</strong>
          <span class="item-card-actions" @click.stop>
            <el-tag effect="plain">{{ productKindLabel }}</el-tag>
            <el-button link type="primary" @click="$emit('edit', pkg)">编辑</el-button>
          </span>
        </div>
        <span class="item-meta">{{ metaOf(pkg) }}</span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { ProductRow } from "./types";

const props = defineProps<{
  products: ProductRow[];
  selectedId: number | null;
  loading: boolean;
  addLabel: string;
  productKindLabel: string;
  metaOf: (pkg: ProductRow) => string;
}>();

defineEmits<{
  create: [];
  select: [id: number];
  edit: [pkg: ProductRow];
}>();

void props;
</script>

<style scoped>
.product-list {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
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
</style>
