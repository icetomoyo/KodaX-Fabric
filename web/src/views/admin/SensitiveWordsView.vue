<template>
  <el-card shadow="never" class="sensitive-page">
    <div class="toolbar">
      <el-input
        v-model="draft"
        placeholder="输入敏感词，例如 英雄联盟"
        maxlength="64"
        show-word-limit
        clearable
        @keyup.enter="addWord"
      />
      <el-button type="primary" :disabled="!draft.trim() || saving" @click="addWord">
        添加
      </el-button>
      <el-upload
        :show-file-list="false"
        :disabled="saving"
        accept=".txt,.md,.markdown,.xlsx,.xls,.docx,.pdf"
        :http-request="onUpload"
      >
        <el-button :disabled="saving">导入文档</el-button>
      </el-upload>
    </div>
    <el-table
      v-loading="loading"
      :data="items"
      stripe
      empty-text="还没有敏感词"
      :default-sort="{ prop: 'hitCount', order: 'descending' }"
      @sort-change="onSortChange"
    >
      <el-table-column prop="word" label="敏感词" min-width="240" sortable="custom" show-overflow-tooltip />
      <el-table-column prop="hitCount" label="命中次数" width="120" sortable="custom" />
      <el-table-column label="操作" width="88" align="right">
        <template #default="{ row }">
          <el-button link type="danger" @click="removeWord(row.word)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>
    <div class="pager">
      <el-pagination
        background
        layout="total, prev, pager, next"
        :total="total"
        :page-size="limit"
        v-model:current-page="page"
        @current-change="load"
      />
    </div>
  </el-card>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import type { UploadRequestOptions } from "element-plus";
import { http } from "@/api/http";
import { TABLE_PAGE_SIZE } from "@/lib/table-page";

type SensitiveWordRow = {
  word: string;
  hitCount: number;
};

const loading = ref(false);
const saving = ref(false);
const items = ref<SensitiveWordRow[]>([]);
const total = ref(0);
const page = ref(1);
const limit = TABLE_PAGE_SIZE;
const draft = ref("");
const sort = ref<"hitCount" | "word">("hitCount");
const order = ref<"asc" | "desc">("desc");

async function load() {
  loading.value = true;
  try {
    const { data } = await http.get("/api/admin/sensitive-words", {
      params: {
        limit,
        offset: (page.value - 1) * limit,
        sort: sort.value,
        order: order.value,
      },
    });
    if (data.success) {
      items.value = data.data.items;
      total.value = data.data.total;
      const maxPage = Math.max(1, Math.ceil(total.value / limit));
      if (page.value > maxPage) {
        page.value = maxPage;
        if (total.value > 0) await load();
      }
    }
  } catch (e: any) {
    ElMessage.error(e.response?.data?.message || "加载敏感词失败");
  } finally {
    loading.value = false;
  }
}

function onSortChange(payload: { prop: string; order: string | null }) {
  if (payload.prop === "word" || payload.prop === "hitCount") {
    sort.value = payload.prop;
  }
  order.value = payload.order === "ascending" ? "asc" : "desc";
  page.value = 1;
  void load();
}

async function addWord() {
  const word = draft.value.trim();
  if (!word || saving.value) return;
  saving.value = true;
  try {
    const { data } = await http.post("/api/admin/sensitive-words", { word });
    if (!data.success) throw new Error(data.message || "添加失败");
    draft.value = "";
    ElMessage.success(`已添加「${word}」`);
    await load();
  } catch (e: any) {
    ElMessage.error(e.response?.data?.message || e.message || "添加失败");
  } finally {
    saving.value = false;
  }
}

async function removeWord(word: string) {
  try {
    await ElMessageBox.confirm(`删除敏感词「${word}」？`, "删除敏感词", {
      type: "warning",
      confirmButtonText: "删除",
      cancelButtonText: "取消",
    });
  } catch {
    return;
  }
  try {
    const { data } = await http.delete("/api/admin/sensitive-words", { data: { word } });
    if (!data.success) throw new Error(data.message || "删除失败");
    ElMessage.success("已删除");
    await load();
  } catch (e: any) {
    ElMessage.error(e.response?.data?.message || e.message || "删除失败");
  }
}

function readFileBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error("读取文档失败"));
    reader.readAsDataURL(file);
  });
}

async function onUpload(options: UploadRequestOptions) {
  const file = options.file;
  if (file.size > 5 * 1024 * 1024) {
    ElMessage.error("文档不能超过 5 MB");
    return;
  }
  saving.value = true;
  try {
    const contentBase64 = await readFileBase64(file);
    const { data } = await http.post("/api/admin/sensitive-words/import", {
      filename: file.name,
      contentBase64,
    });
    if (!data.success) throw new Error(data.message || "导入失败");
    ElMessage.success(`已导入 ${data.data.added} 个，跳过 ${data.data.skipped} 个`);
    page.value = 1;
    await load();
    options.onSuccess(data);
  } catch (e: any) {
    ElMessage.error(e.response?.data?.message || e.message || "导入失败");
    options.onError(e);
  } finally {
    saving.value = false;
  }
}

onMounted(() => {
  void load();
});
</script>

<style scoped>
.sensitive-page {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
}
.toolbar :deep(.el-input) {
  width: 320px;
}
.pager {
  display: flex;
  justify-content: flex-end;
}
</style>
