<script setup lang="ts">
import type { HTMLAttributes } from "vue";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Props {
  suggestion: string;
  class?: HTMLAttributes["class"];
  disabled?: boolean;
}

const props = defineProps<Props>();
const emit = defineEmits<{
  click: [suggestion: string];
}>();
</script>

<template>
  <Button
    type="button"
    size="sm"
    variant="outline"
    :disabled="props.disabled"
    :class="cn('rounded-full', props.class)"
    @click="emit('click', props.suggestion)"
  >
    <slot>{{ props.suggestion }}</slot>
  </Button>
</template>
