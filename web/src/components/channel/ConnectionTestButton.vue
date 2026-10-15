<template>
  <el-button
    link
    type="primary"
    :loading="testing"
    @click="test"
  >
    测试连接
  </el-button>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { ElMessage } from "element-plus";
import { http } from "@/api/http";
import { requestMessage } from "@/lib/request-error";

const props = defineProps<{
  credentialId: number;
}>();

const emit = defineEmits<{
  done: [];
}>();

const testing = ref(false);

async function test() {
  if (testing.value) return;
  testing.value = true;
  try {
    const { data } = await http.post<{
      success: boolean;
      message?: string;
      data?: { ok?: boolean; message?: string };
    }>(`/api/admin/credentials/${props.credentialId}/test`, {
      protocol: "openai_chat",
    });
    if (!data.success) throw new Error(data.message || "测试失败");
    const result = data.data;
    if (result?.ok) ElMessage.success(result.message || "测试通过");
    else ElMessage.warning(result?.message || "测试失败");
    emit("done");
  } catch (error) {
    ElMessage.error(requestMessage(error, "测试失败"));
  } finally {
    testing.value = false;
  }
}
</script>
