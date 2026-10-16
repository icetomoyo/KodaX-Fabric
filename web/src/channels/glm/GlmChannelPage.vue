<template>
  <ChannelWorkspaceView
    :channel="channel"
    show-seats
    :show-keys="false"
    show-seat-count
    create-tag-default="国内"
    name-placeholder="例如 GLM-50"
    @changed="$emit('changed')"
  >
    <template #create-extra="{ form }">
      <el-form-item label="地区">
        <el-radio-group v-model="form.variant">
          <el-radio-button value="domestic">国内</el-radio-button>
          <el-radio-button value="international">国际</el-radio-button>
        </el-radio-group>
      </el-form-item>
    </template>
    <template #edit-extra="{ form }">
      <el-form-item label="组织 ID">
        <el-input v-model="form.zhipuOrganizationId" placeholder="org-xxxxxx" clearable />
      </el-form-item>
      <el-form-item label="项目 ID">
        <el-input v-model="form.zhipuProjectId" placeholder="proj_xxxxxx" clearable />
        <p class="form-hint">
          智谱团队套餐查询官方额度用，在团队管理后台用量页 URL 中可找到；个人套餐留空。
        </p>
      </el-form-item>
    </template>
  </ChannelWorkspaceView>
</template>

<script setup lang="ts">
import ChannelWorkspaceView from "@/components/channel/ChannelWorkspaceView.vue";
import type { ChannelType } from "@/composables/useChannelTypes";

defineProps<{
  channel: ChannelType;
}>();

defineEmits<{
  changed: [];
}>();
</script>

<style scoped>
.form-hint {
  margin: 6px 0 0;
  color: #64748b;
  font-size: 12px;
  line-height: 1.5;
}
</style>
