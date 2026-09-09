<script setup lang="ts">
import type { HTMLAttributes } from "vue";
import { cn } from "@/lib/utils";
import type { PromptInputMessage } from "./types";

interface Props {
  class?: HTMLAttributes["class"];
}

const props = defineProps<Props>();
const emit = defineEmits<{
  submit: [payload: PromptInputMessage];
}>();

function onSubmit(event: Event) {
  event.preventDefault();
  const form = event.target as HTMLFormElement;
  const text = String(new FormData(form).get("message") ?? "").trim();
  if (!text) return;
  emit("submit", { text });
}
</script>

<template>
  <form
    :class="cn('relative w-full overflow-hidden rounded-xl border border-input bg-background shadow-xs', props.class)"
    @submit="onSubmit"
  >
    <slot />
  </form>
</template>
