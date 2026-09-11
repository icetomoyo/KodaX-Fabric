<script setup lang="ts">
import type { HTMLAttributes } from "vue";
import { Loader2Icon } from "@lucide/vue";
import { cn } from "@/lib/utils";

interface Props {
  class?: HTMLAttributes["class"];
}

const props = defineProps<Props>();
</script>

<template>
  <div :class="cn('flex items-center gap-2 text-sm text-muted-foreground', props.class)">
    <Loader2Icon class="size-4 animate-spin" />
    <span>思考中…</span>
  </div>
</template>
