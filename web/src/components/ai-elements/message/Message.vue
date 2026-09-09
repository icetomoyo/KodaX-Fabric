<script setup lang="ts">
import type { HTMLAttributes } from "vue";
import { cn } from "@/lib/utils";

interface Props {
  from: "user" | "assistant" | "system";
  class?: HTMLAttributes["class"];
}

const props = defineProps<Props>();
</script>

<template>
  <div
    :class="
      cn(
        'group flex w-full max-w-[85%] gap-2',
        props.from === 'user' ? 'is-user ml-auto justify-end' : 'is-assistant',
        props.class,
      )
    "
  >
    <slot />
  </div>
</template>
