<template>
  <div>
    <div class="page-card" style="margin-bottom: 16px">
      <h2 class="page-title">管理概览</h2>
      <el-row :gutter="16">
        <el-col :span="4"><el-statistic title="员工总数" :value="data?.employees?.total ?? 0" /></el-col>
        <el-col :span="4"><el-statistic title="启用员工" :value="data?.employees?.active ?? 0" /></el-col>
        <el-col :span="4"><el-statistic title="活跃凭证" :value="data?.credentials?.active ?? 0" /></el-col>
        <el-col :span="4"><el-statistic title="自动禁用凭证" :value="data?.credentials?.autoDisabled ?? 0" /></el-col>
        <el-col :span="4"><el-statistic title="启用模型路由" :value="data?.modelRoutesEnabled ?? 0" /></el-col>
        <el-col :span="4"><el-statistic title="今日请求" :value="data?.today?.requests ?? 0" /></el-col>
      </el-row>
      <el-row :gutter="16" style="margin-top: 16px">
        <el-col :span="8"><el-statistic title="今日 Tokens" :value="data?.today?.tokens ?? 0" /></el-col>
        <el-col :span="8"><el-statistic title="今日失败" :value="data?.today?.errors ?? 0" /></el-col>
        <el-col :span="8"><el-statistic title="供应商数" :value="data?.providers ?? 0" /></el-col>
      </el-row>
    </div>

    <el-row :gutter="16">
      <el-col :span="12">
        <div class="page-card">
          <h3 class="page-title">今日消耗 Top 员工</h3>
          <el-table :data="data?.topUsersToday ?? []" size="small" empty-text="暂无数据">
            <el-table-column prop="name" label="姓名" width="100" />
            <el-table-column prop="phone" label="手机" width="120" />
            <el-table-column prop="totalTokens" label="Tokens" />
            <el-table-column prop="requestCount" label="请求数" />
          </el-table>
        </div>
      </el-col>
      <el-col :span="12">
        <div class="page-card">
          <h3 class="page-title">今日按供应商</h3>
          <el-table :data="data?.byProviderToday ?? []" size="small" empty-text="暂无数据">
            <el-table-column prop="providerCode" label="供应商" />
            <el-table-column prop="requests" label="请求" />
            <el-table-column prop="tokens" label="Tokens" />
          </el-table>
        </div>
      </el-col>
    </el-row>

    <div class="page-card" style="margin-top: 16px">
      <h3 class="page-title">最近失败请求</h3>
      <el-table :data="data?.recentErrors ?? []" size="small" empty-text="暂无失败">
        <el-table-column prop="createdAt" label="时间" width="170" />
        <el-table-column prop="employeeName" label="员工" width="100" />
        <el-table-column prop="clientModel" label="模型" width="120" />
        <el-table-column prop="providerCode" label="供应商" width="100" />
        <el-table-column prop="status" label="状态" width="110" />
        <el-table-column prop="errorCode" label="错误码" width="120" />
        <el-table-column prop="errorMessage" label="错误信息" show-overflow-tooltip />
      </el-table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { http } from "@/api/http";

const data = ref<{
  employees?: { total: number; active: number };
  credentials?: { total: number; active: number; autoDisabled: number };
  providers?: number;
  modelRoutesEnabled?: number;
  today?: { requests: number; tokens: number; errors: number };
  topUsersToday?: Array<Record<string, unknown>>;
  byProviderToday?: Array<Record<string, unknown>>;
  recentErrors?: Array<Record<string, unknown>>;
} | null>(null);

onMounted(async () => {
  const res = await http.get("/api/admin/overview");
  if (res.data.success) data.value = res.data.data;
});
</script>
