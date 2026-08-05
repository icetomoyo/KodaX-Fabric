<template>
  <div class="protocol-route-summary">
    <div v-for="row in configuredRows" :key="row.protocol" class="route-row">
      <span>{{ row.label }}</span>
      <code>{{ row.baseUrl }}</code>
      <small>{{ authStyleLabel(row.authStyle) }}</small>
    </div>
    <div v-if="showLegacyFallback && fallbackBaseUrl" class="route-row legacy">
      <span>旧配置 URL</span>
      <code>{{ fallbackBaseUrl }}</code>
    </div>
    <span v-if="!configuredRows.length && !fallbackBaseUrl" class="route-empty">暂无协议路由配置</span>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import {
  relayProtocolLabel,
  relayProtocolOptions,
  type RelayAuthStyle,
  type RelayProtocol,
  type RelayProtocolConfigs,
} from "@/views/relay-protocol";

const props = defineProps<{
  protocols: RelayProtocol[];
  protocolConfigs: RelayProtocolConfigs;
  fallbackBaseUrl?: string;
}>();

const selectableProtocols = new Set(relayProtocolOptions.map((option) => option.value));

const configuredRows = computed(() => props.protocols.flatMap((protocol) => {
  const config = props.protocolConfigs?.[protocol];
  return config
    ? [{
      protocol,
      label: relayProtocolLabel(protocol, true),
      baseUrl: config.baseUrl,
      authStyle: config.authStyle,
    }]
    : [];
}));

const showLegacyFallback = computed(() => (
  configuredRows.value.length === 0
  || props.protocols.some(
    (protocol) => !selectableProtocols.has(protocol) && !props.protocolConfigs?.[protocol],
  )
));

function authStyleLabel(authStyle: RelayAuthStyle): string {
  return authStyle === "x-api-key" ? "x-api-key" : "Bearer";
}
</script>

<style scoped>
.protocol-route-summary {
  display: flex;
  flex-direction: column;
  min-width: 0;
  gap: 4px;
}

.route-row {
  display: grid;
  grid-template-columns: minmax(96px, auto) minmax(0, 1fr) auto;
  align-items: center;
  gap: 7px;
  color: #64748b;
  font-size: 11px;
}

.route-row > span {
  color: #64748b;
  white-space: nowrap;
}

.route-row code {
  min-width: 0;
  overflow-wrap: anywhere;
  color: #475569;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 11px;
}

.route-row small {
  padding: 1px 5px;
  border: 1px solid #e2e8f0;
  border-radius: 999px;
  color: #64748b;
  font-size: 10px;
  line-height: 1.4;
}

.route-row.legacy {
  grid-template-columns: minmax(96px, auto) minmax(0, 1fr);
}

.route-empty {
  color: #94a3b8;
  font-size: 12px;
}

@media (max-width: 720px) {
  .route-row {
    grid-template-columns: 1fr auto;
  }

  .route-row code {
    grid-column: 1 / -1;
    grid-row: 2;
  }

  .route-row.legacy {
    grid-template-columns: 1fr;
  }
}
</style>
