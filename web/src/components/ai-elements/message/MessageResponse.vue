<script setup lang="ts">
import type { HTMLAttributes } from "vue";
import { cn } from "@/lib/utils";
import { computed, useSlots } from "vue";
import { Markdown } from "vue-stream-markdown";
import "vue-stream-markdown/index.css";
import "vue-stream-markdown/theme.css";

interface Props {
  content?: string;
  class?: HTMLAttributes["class"];
}

const props = defineProps<Props>();
const slots = useSlots();

const md = computed(() => {
  const nodes = slots.default?.();
  if (Array.isArray(nodes)) {
    let text = "";
    for (const node of nodes) {
      if (typeof node.children === "string") text += node.children;
    }
    if (text) return text;
  }
  return props.content ?? "";
});
</script>

<template>
  <Markdown
    :content="md"
    :class="cn('size-full [&>*:first-child]:mt-0! [&>*:last-child]:mb-0!', props.class)"
  />
</template>
