<template>
  <div class="structured-json">
    <el-empty v-if="empty" :description="emptyText" :image-size="64" />
    <template v-else>
      <div class="json-toolbar">
        <span>{{ sizeLabel }}</span>
        <el-button link type="primary" @click="copy">复制 JSON</el-button>
      </div>
      <div v-if="oversized && !expanded" class="large-json-summary">
        <strong>{{ valueSummary }}</strong>
        <span>单个 JSON 节点较大，已暂缓渲染以保持页面流畅。</span>
        <el-button size="small" @click="expanded = true">展开原始 JSON</el-button>
      </div>
      <pre v-else class="json-code">{{ serialized }}</pre>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import { copyText } from "@/lib/clipboard";

const props = withDefaults(defineProps<{
  value: unknown;
  emptyText?: string;
  thresholdBytes?: number;
}>(), {
  emptyText: "暂无结构化内容",
  thresholdBytes: 64 * 1024,
});

const expanded = ref(false);
const serialized = computed(() => {
  try {
    return JSON.stringify(props.value, null, 2);
  } catch {
    return String(props.value);
  }
});
const bytes = computed(() => new TextEncoder().encode(serialized.value).byteLength);
const oversized = computed(() => bytes.value > props.thresholdBytes);
const empty = computed(() => {
  if (props.value == null) return true;
  if (Array.isArray(props.value)) return props.value.length === 0;
  if (typeof props.value === "object") return Object.keys(props.value).length === 0;
  return props.value === "";
});
const sizeLabel = computed(() => bytes.value < 1024
  ? `${bytes.value} B`
  : `${(bytes.value / 1024).toFixed(bytes.value < 10 * 1024 ? 1 : 0)} KB`);
const valueSummary = computed(() => {
  if (Array.isArray(props.value)) return `数组，共 ${props.value.length} 项`;
  if (props.value && typeof props.value === "object") {
    return `对象，共 ${Object.keys(props.value).length} 个字段`;
  }
  return typeof props.value;
});

async function copy() {
  const copied = await copyText(serialized.value);
  if (copied) ElMessage.success("结构化数据已复制");
  else ElMessage.error("复制失败");
}

watch(() => props.value, () => { expanded.value = false; });
</script>

<style scoped>
.json-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 28px;
  color: #98a2b3;
  font-size: 11px;
}
.json-code {
  max-height: 420px;
  margin: 0;
  padding: 12px;
  overflow: auto;
  border-radius: 8px;
  background: #0f172a;
  color: #e2e8f0;
  font-size: 12px;
  line-height: 1.55;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.large-json-summary {
  display: flex;
  align-items: flex-start;
  flex-direction: column;
  gap: 7px;
  padding: 14px;
  border: 1px solid #fde68a;
  border-radius: 8px;
  background: #fffbeb;
  color: #92400e;
  font-size: 12px;
}
</style>
