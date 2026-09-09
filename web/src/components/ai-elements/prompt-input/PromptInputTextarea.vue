<script setup lang="ts">
import type { HTMLAttributes } from "vue";
import { cn } from "@/lib/utils";
import { ref } from "vue";

interface Props {
  class?: HTMLAttributes["class"];
  placeholder?: string;
  disabled?: boolean;
  maxlength?: number;
  modelValue?: string;
}

const props = withDefaults(defineProps<Props>(), {
  placeholder: "What would you like to know?",
});

const emit = defineEmits<{
  "update:modelValue": [value: string];
}>();

const composing = ref(false);

function handleKeyDown(event: KeyboardEvent) {
  if (event.key !== "Enter" || event.shiftKey || composing.value) return;
  event.preventDefault();
  (event.target as HTMLTextAreaElement).form?.requestSubmit();
}
</script>

<template>
  <textarea
    name="message"
    rows="1"
    :value="props.modelValue"
    :placeholder="props.placeholder"
    :disabled="props.disabled"
    :maxlength="props.maxlength"
    :class="
      cn(
        'field-sizing-content max-h-32 min-h-16 w-full resize-none border-0 bg-transparent px-3 py-2.5 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50',
        props.class,
      )
    "
    @input="emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)"
    @keydown="handleKeyDown"
    @compositionstart="composing = true"
    @compositionend="composing = false"
  />
</template>
