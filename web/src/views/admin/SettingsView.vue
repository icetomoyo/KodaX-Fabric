<template>
  <el-card shadow="never" class="settings-page">
    <el-form label-position="left" label-width="120px" @submit.prevent>
      <el-form-item label="敏感词检测">
        <el-switch
          v-model="sensitiveWordDetectEnabled"
          active-text="启用检测"
          :disabled="!settingsLoaded || loading || patching"
          @change="onDetectChange"
        />
        <p class="hint">命中后写入检测记录，请求继续转发上游。</p>
      </el-form-item>
      <el-form-item label="敏感词拦截">
        <el-switch
          v-model="sensitiveWordInterceptEnabled"
          active-text="启用拦截"
          :disabled="!settingsLoaded || loading || patching || !sensitiveWordDetectEnabled"
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
// PATCH 进行中禁用两个开关：避免连点产生并发 PATCH、乱序响应把 UI 改回旧状态
const patching = ref(false);
// GET 成功前 / 失败后开关保持禁用，防止在未知基线上修改
const settingsLoaded = ref(false);
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
    if (data.success) {
      applySettings(data.data);
      settingsLoaded.value = true;
    }
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
  patching.value = true;
  try {
    const { data } = await http.patch("/api/admin/settings", payload);
    if (!data.success) throw new Error(data.message || "保存失败");
    applySettings(data.data);
    ElMessage.success(success);
  } catch (e: any) {
    revert();
    ElMessage.error(e.response?.data?.message || e.message || "保存失败");
  } finally {
    patching.value = false;
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
