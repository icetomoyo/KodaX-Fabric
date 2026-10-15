<template>
  <el-dialog
    :model-value="visible"
    :title="mode === 'create' ? '新增席位' : '编辑席位'"
    width="480px"
    destroy-on-close
    @update:model-value="$emit('update:visible', $event)"
  >
    <el-form label-width="90px">
      <el-form-item label="产品">
        <el-input :model-value="productName" disabled />
      </el-form-item>
      <el-form-item label="员工" required>
        <el-select
          :model-value="employeeId"
          filterable
          remote
          :remote-method="onSearch"
          :loading="employeeLoading"
          placeholder="姓名或手机号"
          style="width: 100%"
          @update:model-value="$emit('update:employeeId', $event)"
        >
          <el-option
            v-for="item in employees"
            :key="item.id"
            :label="`${item.name} · ${item.phone}`"
            :value="item.id"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="标签" :required="tagRequired">
        <el-input
          :model-value="tag"
          maxlength="32"
          show-word-limit
          placeholder="能区分即可，自己定"
          @update:model-value="$emit('update:tag', $event)"
        />
        <p class="form-hint">
          {{
            mode === "create"
              ? "同一人第一条可不填；再登记必须填，用来区分多把 KEY。KEY 由本人在个人中心提交。"
              : "同一人在此产品下已有其他席位时必填。"
          }}
        </p>
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="$emit('update:visible', false)">取消</el-button>
      <el-button type="primary" :loading="saving" @click="$emit('submit')">
        {{ mode === "create" ? "登记" : "保存" }}
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import type { EmployeeOption } from "./types";

defineProps<{
  visible: boolean;
  mode: "create" | "edit";
  productName: string;
  employeeId: number | undefined;
  tag: string;
  tagRequired: boolean;
  employees: EmployeeOption[];
  employeeLoading: boolean;
  saving: boolean;
}>();

const emit = defineEmits<{
  "update:visible": [value: boolean];
  "update:employeeId": [value: number];
  "update:tag": [value: string];
  search: [query: string];
  submit: [];
}>();

function onSearch(query: string) {
  emit("search", query);
}
</script>

<style scoped>
.form-hint {
  margin: 6px 0 0;
  color: #64748b;
  font-size: 12px;
  line-height: 1.5;
}
</style>
