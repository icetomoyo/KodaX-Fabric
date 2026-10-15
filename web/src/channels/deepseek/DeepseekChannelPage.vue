<template>
  <ChannelWorkspaceView
    :channel="channel"
    :show-seats="false"
    show-keys
    :show-seat-count="false"
    name-placeholder="例如 DeepSeek 主账户"
    @changed="$emit('changed')"
  />
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
