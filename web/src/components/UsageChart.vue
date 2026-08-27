<template>
  <VChart class="usage-chart" :option="option" autoresize :style="{ height }" />
</template>

<script setup lang="ts">
import { BarChart, LineChart, PieChart } from "echarts/charts";
import {
  GridComponent,
  LegendComponent,
  TitleComponent,
  TooltipComponent,
} from "echarts/components";
import { use, type EChartsCoreOption } from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import VChart from "vue-echarts";

use([
  CanvasRenderer,
  BarChart,
  LineChart,
  PieChart,
  GridComponent,
  LegendComponent,
  TitleComponent,
  TooltipComponent,
]);

withDefaults(
  defineProps<{ option: EChartsCoreOption; height?: string }>(),
  { height: "320px" },
);
</script>

<style scoped>
.usage-chart {
  width: 100%;
}
</style>
