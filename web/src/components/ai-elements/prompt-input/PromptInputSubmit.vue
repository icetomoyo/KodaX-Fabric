<script setup lang="ts">
import type { HTMLAttributes } from "vue";
import { CornerDownLeftIcon, Loader2Icon, SquareIcon, XIcon } from "@lucide/vue";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { computed } from "vue";

type ChatStatus = "submitted" | "streaming" | "ready" | "error";

interface Props {
  class?: HTMLAttributes["class"];
  status?: ChatStatus;
  disabled?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  status: "ready",
});

const icon = computed(() => {
  if (props.status === "submitted") return Loader2Icon;
  if (props.status === "streaming") return SquareIcon;
  if (props.status === "error") return XIcon;
  return CornerDownLeftIcon;
});

const iconClass = computed(() =>
  props.status === "submitted" ? "size-4 animate-spin" : "size-4",
);
</script>

<template>
  <Button
    type="submit"
    size="icon-sm"
    variant="default"
    :disabled="props.disabled"
    :class="cn('absolute right-2 bottom-2', props.class)"
    aria-label="Submit"
  >
    <component :is="icon" :class="iconClass" />
  </Button>
</template>
