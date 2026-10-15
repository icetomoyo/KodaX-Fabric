<template>
  <ChannelWorkspaceView
    :channel="channel"
    show-seats
    show-keys
    show-seat-count
    name-placeholder="例如 Agent Plan"
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
