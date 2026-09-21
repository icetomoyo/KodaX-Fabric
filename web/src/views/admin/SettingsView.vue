<template>
  <el-card shadow="never" class="settings-page">
    <el-form label-position="left" label-width="120px" @submit.prevent>
      <el-form-item label="敏感词检测">
        <el-switch
          v-model="sensitiveWordDetectEnabled"
          active-text="启用检测"
          :disabled="loading"
          @change="onDetectChange"
        />
        <p class="hint">命中后写入检测记录，请求继续转发上游。</p>
      </el-form-item>
      <el-form-item label="敏感词拦截">
        <el-switch
          v-model="sensitiveWordInterceptEnabled"
          active-text="启用拦截"
          :disabled="loading || !sensitiveWordDetectEnabled"
          @change="onInterceptChange"
        />
        <p class="hint">需先启用检测。开启后命中同时写入拦截记录并拦截请求。</p>
      </el-form-item>
    </el-form>
  </el-card>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { ElMessage } from "element-plus";
import { http } from "@/api/http";

const loading = ref(false);
const sensitiveWordDetectEnabled = ref(true);
const sensitiveWordInterceptEnabled = ref(false);

function applySettings(data: {
  sensitiveWordDetectEnabled?: boolean;
  sensitiveWordInterceptEnabled?: boolean;
}) {
  sensitiveWordDetectEnabled.value = Boolean(data.sensitiveWordDetectEnabled);
  sensitiveWordInterceptEnabled.value = Boolean(data.sensitiveWordInterceptEnabled);
}

async function load() {
  loading.value = true;
  try {
    const { data } = await http.get("/api/admin/settings");
    if (data.success) applySettings(data.data);
  } catch (e: any) {
    ElMessage.error(e.response?.data?.message || "加载系统设置失败");
  } finally {
    loading.value = false;
  }
}

async function patchSettings(
  payload: {
    sensitiveWordDetectEnabled?: boolean;
    sensitiveWordInterceptEnabled?: boolean;
  },
  revert: () => void,
  success: string,
) {
  try {
    const { data } = await http.patch("/api/admin/settings", payload);
    if (!data.success) throw new Error(data.message || "保存失败");
    applySettings(data.data);
    ElMessage.success(success);
  } catch (e: any) {
    revert();
    ElMessage.error(e.response?.data?.message || e.message || "保存失败");
  }
}

async function onDetectChange(value: string | number | boolean) {
  const next = Boolean(value);
  const previousIntercept = sensitiveWordInterceptEnabled.value;
  if (!next) sensitiveWordInterceptEnabled.value = false;
  await patchSettings(
    next
      ? { sensitiveWordDetectEnabled: true }
      : { sensitiveWordDetectEnabled: false, sensitiveWordInterceptEnabled: false },
    () => {
      sensitiveWordDetectEnabled.value = !next;
      if (!next) sensitiveWordInterceptEnabled.value = previousIntercept;
    },
    next ? "已启用检测" : "已关闭检测",
  );
}

async function onInterceptChange(value: string | number | boolean) {
  const next = Boolean(value);
  const previousDetect = sensitiveWordDetectEnabled.value;
  if (next) sensitiveWordDetectEnabled.value = true;
  await patchSettings(
    next
      ? { sensitiveWordDetectEnabled: true, sensitiveWordInterceptEnabled: true }
      : { sensitiveWordInterceptEnabled: false },
    () => {
      sensitiveWordInterceptEnabled.value = !next;
      if (next) sensitiveWordDetectEnabled.value = previousDetect;
    },
    next ? "已启用拦截" : "已关闭拦截",
  );
}

onMounted(() => {
  void load();
});
</script>

<style scoped>
.settings-page {
  max-width: 640px;
}

.hint {
  margin: 6px 0 0;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  line-height: 1.5;
}
</style>
