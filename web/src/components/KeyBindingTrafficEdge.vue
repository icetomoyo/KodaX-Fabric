<template>
  <g
    class="traffic-edge"
    :class="{ working: showParticles, afterglow: afterglow && showParticles, dimmed }"
  >
    <path v-if="showParticles" class="traffic-glow" :d="pathD" fill="none" />
    <BaseEdge :id="id" :path="pathD" :marker-end="markerEnd" :style="edgeStyle" />
    <path
      v-if="showParticles"
      :id="motionPathId"
      :d="pathD"
      fill="none"
      stroke="none"
      pointer-events="none"
    />
    <g v-if="showParticles" class="traffic-particles" pointer-events="none">
      <circle
        v-for="item in outbound"
        :key="`out-${item.i}`"
        class="traffic-particle outbound"
        :r="item.r"
        :style="{ opacity: particleOpacity }"
      >
        <animateMotion
          :dur="outDur"
          repeatCount="indefinite"
          rotate="auto"
          calcMode="linear"
          :begin="item.begin"
        >
          <mpath :href="`#${motionPathId}`" :xlink:href="`#${motionPathId}`" />
        </animateMotion>
      </circle>
      <circle
        v-for="item in inbound"
        :key="`in-${item.i}`"
        class="traffic-particle inbound"
        :r="item.r"
        :style="{ opacity: particleOpacity }"
      >
        <animateMotion
          :dur="inDur"
          repeatCount="indefinite"
          rotate="auto"
          calcMode="linear"
          keyPoints="1;0"
          keyTimes="0;1"
          :begin="item.begin"
        >
          <mpath :href="`#${motionPathId}`" :xlink:href="`#${motionPathId}`" />
        </animateMotion>
      </circle>
    </g>
  </g>
</template>

<script setup lang="ts">
import { computed, type CSSProperties } from "vue";
import { BaseEdge, getSmoothStepPath, Position } from "@vue-flow/core";

type TrafficData = {
  kind?: string;
  working?: boolean;
  afterglow?: boolean;
  inFlight?: number;
  dimmed?: boolean;
};

const props = defineProps<{
  id: string;
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  sourcePosition?: Position;
  targetPosition?: Position;
  markerEnd?: string;
  style?: CSSProperties;
  data?: TrafficData;
}>();

const dimmed = computed(() => Boolean(props.data?.dimmed));
const working = computed(() => Boolean(props.data?.working));
const afterglow = computed(() => Boolean(props.data?.afterglow));
const inFlight = computed(() => Math.max(0, Number(props.data?.inFlight) || 0));
const showParticles = computed(() => working.value && !dimmed.value);

const pathD = computed(() => {
  const [d] = getSmoothStepPath({
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    targetX: props.targetX,
    targetY: props.targetY,
    sourcePosition: props.sourcePosition ?? Position.Right,
    targetPosition: props.targetPosition ?? Position.Left,
    borderRadius: 8,
    offset: 28,
  });
  return d;
});

const motionPathId = computed(() => `traffic-path-${props.id.replace(/[^a-zA-Z0-9_-]/g, "-")}`);

const particleCount = computed(() => {
  if (!showParticles.value) return 0;
  if (afterglow.value && inFlight.value <= 0) return 1;
  if (inFlight.value >= 5) return 4;
  if (inFlight.value >= 2) return 3;
  return 2;
});

const outDurSec = computed(() =>
  Math.max(0.9, 1.6 - Math.min(4, inFlight.value) * 0.08),
);
const inDurSec = computed(() =>
  Math.max(1.3, 2.4 - Math.min(4, inFlight.value) * 0.1),
);
const outDur = computed(() => `${outDurSec.value}s`);
const inDur = computed(() => `${inDurSec.value}s`);
const particleOpacity = computed(() =>
  afterglow.value && inFlight.value <= 0 ? 0.42 : 0.95,
);

function spaced(count: number, duration: number, radius: number) {
  return Array.from({ length: count }, (_, i) => ({
    i,
    r: radius,
    begin: `-${((i / Math.max(count, 1)) * duration).toFixed(2)}s`,
  }));
}

const outbound = computed(() => spaced(particleCount.value, outDurSec.value, 2.6));
const inbound = computed(() => spaced(particleCount.value, inDurSec.value, 3.3));

const edgeStyle = computed((): CSSProperties => {
  const base: CSSProperties = { ...(props.style ?? {}) };
  if (showParticles.value) {
    const width = Number(base.strokeWidth) || 2;
    base.strokeWidth = width + 0.6;
  }
  return base;
});
</script>

<style scoped>
.traffic-glow {
  stroke: #38bdf8;
  stroke-width: 7;
  stroke-opacity: 0.2;
}

.traffic-edge.afterglow .traffic-glow {
  stroke-opacity: 0.1;
}

.traffic-particle.outbound {
  fill: #22d3ee;
}

.traffic-particle.inbound {
  fill: #f59e0b;
}

@media (prefers-reduced-motion: reduce) {
  .traffic-particles,
  .traffic-glow {
    display: none;
  }
}
</style>
