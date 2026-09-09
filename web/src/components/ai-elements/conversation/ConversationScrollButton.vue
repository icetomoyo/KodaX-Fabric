<script setup lang="ts">
import type { HTMLAttributes } from "vue";
import { ArrowDownIcon } from "@lucide/vue";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { computed } from "vue";
import { useStickToBottomContext } from "vue-stick-to-bottom";

interface Props {
  class?: HTMLAttributes["class"];
}

const props = defineProps<Props>();
const { isAtBottom, scrollToBottom } = useStickToBottomContext();
const showScrollButton = computed(() => !isAtBottom.value);
</script>

<template>
  <Button
    v-if="showScrollButton"
    type="button"
    size="icon"
    variant="outline"
    aria-label="Scroll to bottom"
    :class="cn('absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full', props.class)"
    @click="scrollToBottom()"
  >
    <ArrowDownIcon class="size-4" />
  </Button>
</template>
