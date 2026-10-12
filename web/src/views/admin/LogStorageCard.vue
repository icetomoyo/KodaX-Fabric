<template>
  <section v-if="report" class="page-card storage-card" data-testid="log-storage">
    <div class="storage-head">
      <h3 class="storage-title">日志存储空间</h3>
      <span class="storage-meta">
        <template v-if="report.scanning">统计中…</template>
        <template v-else-if="report.logs">统计于 {{ formatDateTime(report.logs.scannedAt) }}</template>
        <template v-else>尚未统计</template>
      </span>
      <el-button link type="primary" :loading="report.scanning" @click="rescan">重新统计</el-button>
    </div>

    <div v-if="report.disk" class="storage-bar" :class="level" aria-label="磁盘用量">
      <span class="seg logs" :style="{ width: percent(logBytes, report.disk.totalBytes) }" />
      <span class="seg other" :style="{ width: percent(otherBytes, report.disk.totalBytes) }" />
    </div>

    <div class="storage-stats">
      <div v-if="report.disk" class="storage-stat">
        <span class="stat-label">磁盘已用</span>
        <strong class="stat-value" :class="level">
          {{ formatBytes(report.disk.usedBytes) }} / {{ formatBytes(report.disk.totalBytes) }}
        </strong>
        <span class="stat-foot">{{ percent(report.disk.usedBytes, report.disk.totalBytes) }}</span>
      </div>
      <div v-if="report.disk" class="storage-stat">
        <span class="stat-label">剩余</span>
        <strong class="stat-value">{{ formatBytes(report.disk.freeBytes) }}</strong>
        <span class="stat-foot">请求日志与数据库共用这块盘</span>
      </div>
      <div class="storage-stat">
        <span class="stat-label"><i class="dot logs" />请求日志占用</span>
        <strong class="stat-value">{{ report.logs ? formatBytes(report.logs.bytes) : "—" }}</strong>
        <span class="stat-foot">
          {{ report.logs ? `${report.logs.files.toLocaleString("zh-CN")} 个文件` : "首次统计需要几分钟" }}
        </span>
      </div>
      <div class="storage-stat">
        <span class="stat-label">近 7 天日均增长</span>
        <strong class="stat-value">
          {{ report.logs?.dailyGrowthBytes != null ? formatBytes(report.logs.dailyGrowthBytes) : "—" }}
        </strong>
        <span class="stat-foot">
          {{ report.logs?.daysLeft != null ? `按此速度约可再用 ${report.logs.daysLeft > 999 ? "999+" : report.logs.daysLeft} 天（估算）` : "数据不足，暂无法估算" }}
        </span>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { ElMessage } from "element-plus";
import { http } from "@/api/http";
import { formatDateTime } from "@/lib/date-time";

type StorageReport = {
  disk: { totalBytes: number; usedBytes: number; freeBytes: number } | null;
  logs: {
    bytes: number;
    files: number;
    scannedAt: string;
    dailyGrowthBytes: number | null;
    daysLeft: number | null;
  } | null;
  scanning: boolean;
};

const POLL_MS = 5000;
const report = ref<StorageReport | null>(null);
let pollTimer: ReturnType<typeof setTimeout> | null = null;

const logBytes = computed(() => report.value?.logs?.bytes ?? 0);
const otherBytes = computed(() => Math.max(0, (report.value?.disk?.usedBytes ?? 0) - logBytes.value));
const level = computed(() => {
  const disk = report.value?.disk;
  if (!disk || disk.totalBytes <= 0) return "";
  const ratio = disk.usedBytes / disk.totalBytes;
  return ratio >= 0.9 ? "danger" : ratio >= 0.8 ? "warning" : "";
});

function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 100 || unit === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}

function percent(part: number, total: number): string {
  return total > 0 ? `${((part / total) * 100).toFixed(1)}%` : "0%";
}

function apply(next: StorageReport) {
  report.value = next;
  if (pollTimer) clearTimeout(pollTimer);
  // 统计在后台跑，跑完之前隔几秒再取一次。
  pollTimer = next.scanning ? setTimeout(load, POLL_MS) : null;
}

async function load() {
  try {
    const res = await http.get("/api/admin/storage");
    if (res.data.success) apply(res.data.data);
  } catch {
    // 这块只是辅助信息，取不到就不显示，不打断工作台。
  }
}

async function rescan() {
  try {
    const res = await http.post("/api/admin/storage/rescan");
    if (res.data.success) apply(res.data.data);
  } catch {
    ElMessage.error("触发统计失败");
  }
}

onMounted(load);
onBeforeUnmount(() => {
  if (pollTimer) clearTimeout(pollTimer);
});
</script>

<style scoped>
.storage-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px 20px;
}
.storage-head {
  display: flex;
  align-items: center;
  gap: 12px;
}
.storage-title {
  margin: 0;
  color: #0f172a;
  font-size: 15px;
  font-weight: 600;
}
.storage-meta {
  margin-left: auto;
  color: #94a3b8;
  font-size: 12px;
}
.storage-bar {
  display: flex;
  height: 8px;
  overflow: hidden;
  border-radius: 999px;
  background: #e5e7eb;
}
.seg.logs { background: #2563eb; }
.seg.other { background: #94a3b8; }
.storage-bar.warning .seg.other { background: #d97706; }
.storage-bar.danger .seg.other { background: #dc2626; }
.storage-stats {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}
.storage-stat {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.stat-label {
  color: #64748b;
  font-size: 12px;
  font-weight: 600;
}
.stat-value {
  color: #0f172a;
  font-size: 18px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.stat-value.warning { color: #b45309; }
.stat-value.danger { color: #b91c1c; }
.stat-foot {
  color: #94a3b8;
  font-size: 12px;
}
.dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  margin-right: 6px;
  border-radius: 50%;
}
.dot.logs { background: #2563eb; }
@media (max-width: 1100px) {
  .storage-stats {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
