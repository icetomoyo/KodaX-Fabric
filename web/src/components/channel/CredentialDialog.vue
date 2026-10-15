<template>
  <el-dialog
    :model-value="visible"
    :title="mode === 'create' ? '添加 KEY' : '编辑 KEY'"
    width="480px"
    destroy-on-close
    @update:model-value="$emit('update:visible', $event)"
  >
    <el-form label-width="90px">
      <el-form-item :label="productLabel">
        <el-input :model-value="productName" disabled />
      </el-form-item>
      <el-form-item :label="mode === 'create' ? '名称' : '名称'" :required="mode === 'edit'">
        <el-input
          :model-value="label"
          maxlength="200"
          :show-word-limit="mode === 'edit'"
          :placeholder="mode === 'create' ? '可选，默认用产品名' : undefined"
          @update:model-value="$emit('update:label', $event)"
        />
      </el-form-item>
      <el-form-item :label="'KEY'" :required="mode === 'create'">
        <el-input
          :model-value="secret"
          type="textarea"
          :rows="4"
          :placeholder="
            mode === 'create'
              ? '粘贴管理员手里的 API KEY'
              : `当前 •••• ${secretSuffix}，留空则不更换`
          "
          @update:model-value="$emit('update:secret', $event)"
        />
      </el-form-item>
      <el-form-item v-if="mode === 'edit'" label="状态">
        <el-radio-group
          :model-value="status"
          @update:model-value="$emit('update:status', $event)"
        >
          <el-radio-button value="active">可用</el-radio-button>
          <el-radio-button value="disabled">停用</el-radio-button>
        </el-radio-group>
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="$emit('update:visible', false)">取消</el-button>
      <el-button type="primary" :loading="saving" @click="$emit('submit')">
        {{ mode === "create" ? "添加" : "保存" }}
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
defineProps<{
  visible: boolean;
  mode: "create" | "edit";
  productName: string;
  productLabel: string;
  label: string;
  secret: string;
  secretSuffix?: string;
  status: "active" | "disabled";
  saving: boolean;
}>();

defineEmits<{
  "update:visible": [value: boolean];
  "update:label": [value: string];
  "update:secret": [value: string];
  "update:status": [value: "active" | "disabled"];
  submit: [];
}>();
</script>
