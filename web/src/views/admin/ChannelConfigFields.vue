<template>
  <div class="channel-config-fields">
    <el-form-item label="渠道名称" required>
      <el-input
        v-model="name"
        maxlength="100"
        show-word-limit
        placeholder="请输入渠道名称"
        :disabled="disabled"
      />
    </el-form-item>

    <el-form-item label="支持协议" required class="protocol-form-item">
      <el-checkbox-group
        v-model="supportedProtocols"
        class="protocol-checkbox-group"
        :disabled="disabled"
        @change="emit('protocols-change')"
      >
        <el-checkbox
          v-for="option in relayProtocolOptions"
          :key="option.value"
          :value="option.value"
          :disabled="!isProtocolAvailable(option.value)"
          border
          class="protocol-checkbox-option"
        >
          <span class="protocol-option-copy">
            <strong>{{ protocolOptionLabel(option) }}</strong>
            <small>{{ option.description }}</small>
          </span>
        </el-checkbox>
      </el-checkbox-group>
      <div class="form-help">
        协议决定上游地址和鉴权方式，地址不可在此单独修改；标记“当前渠道不支持”的协议不可选择。
      </div>
    </el-form-item>

    <el-form-item :label="protocolRouteLabel" required>
      <div v-if="selectedConfigRows.length" class="protocol-config-list">
        <div
          v-for="row in selectedConfigRows"
          :key="row.protocol"
          class="protocol-config-row"
        >
          <div class="protocol-config-head">
            <strong>{{ row.label }}</strong>
            <el-tag size="small" effect="plain">{{ authStyleLabel(row.authStyle) }}</el-tag>
          </div>
          <code>{{ row.baseUrl }}</code>
        </div>
      </div>
      <el-empty v-else description="请先选择协议" :image-size="48" />
      <el-alert
        v-if="missingProtocols.length"
        class="config-missing-alert"
        type="error"
        :closable="false"
        show-icon
        :title="`当前渠道变体缺少 ${missingProtocolLabels} 的 URL / 鉴权配置`"
      />
    </el-form-item>

    <div v-if="showChangeRisk && routingConfigDrift" class="routing-upgrade-panel">
      <el-alert
        type="warning"
        :closable="false"
        show-icon
        :title="routingUpgradeTitle"
      />
      <el-button
        v-if="!routingUpgradePending"
        type="warning"
        plain
        size="small"
        :disabled="disabled"
        @click="emit('request-routing-upgrade')"
      >
        应用按协议路由
      </el-button>
      <el-tag v-else type="warning" effect="plain">将在保存时应用</el-tag>
    </div>

    <el-alert
      v-if="showChangeRisk && protocolsTouched && !routingConfigDrift"
      class="change-risk-alert"
      type="warning"
      :closable="false"
      show-icon
      :title="changeRiskTitle"
    />

    <el-form-item label="渠道状态">
      <el-select v-model="status" style="width: 100%" :disabled="disabled">
        <el-option label="启用" value="active" />
        <el-option label="停用" value="disabled" />
      </el-select>
    </el-form-item>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import {
  relayProtocolLabel,
  relayProtocolOptions,
  type RelayProtocol,
  type RelayProtocolConfigs,
  type RelayProtocolOption,
} from "@/views/relay-protocol";

type ChannelStatus = "active" | "disabled";

const props = withDefaults(defineProps<{
  protocolConfigs: RelayProtocolConfigs;
  protocolsTouched?: boolean;
  routingConfigDrift?: boolean;
  routingUpgradeRequested?: boolean;
  disabled?: boolean;
  showChangeRisk?: boolean;
}>(), {
  protocolsTouched: false,
  routingConfigDrift: false,
  routingUpgradeRequested: false,
  disabled: false,
  showChangeRisk: false,
});

const emit = defineEmits<{
  "protocols-change": [];
  "request-routing-upgrade": [];
}>();

const name = defineModel<string>("name", { required: true });
const supportedProtocols = defineModel<RelayProtocol[]>("supportedProtocols", { required: true });
const status = defineModel<ChannelStatus>("status", { required: true });

const selectedConfigRows = computed(() => relayProtocolOptions
  .filter((option) => supportedProtocols.value.includes(option.value))
  .flatMap((option) => {
    const config = props.protocolConfigs[option.value];
    return config
      ? [{
        protocol: option.value,
        label: option.shortLabel,
        baseUrl: config.baseUrl,
        authStyle: config.authStyle,
      }]
      : [];
  }));

const missingProtocols = computed(() => supportedProtocols.value.filter(
  (protocol) => !props.protocolConfigs[protocol],
));

const missingProtocolLabels = computed(() => missingProtocols.value
  .map((protocol) => relayProtocolLabel(protocol, true))
  .join("、"));

const routingUpgradePending = computed(() => (
  props.protocolsTouched || props.routingUpgradeRequested
));

const changeRiskTitle = computed(() => props.routingConfigDrift
  ? "检测到旧的 URL / 鉴权配置，保存后协议路由将更新；请重新测试连接。"
  : "协议变更会影响该渠道下所有 Key 的转发，保存后建议重新测试连接。");

const protocolRouteLabel = computed(() => (
  props.routingConfigDrift && !routingUpgradePending.value
    ? "模板协议路由（应用后生效）"
    : "协议路由"
));

const routingUpgradeTitle = computed(() => routingUpgradePending.value
  ? "保存后协议路由将更新为上方模板 URL / 鉴权，请重新测试连接。"
  : "检测到当前渠道仍使用旧固定 URL；上方为模板路由，尚未生效。普通字段保存不会自动升级。" );

function authStyleLabel(authStyle: "bearer" | "x-api-key"): string {
  return authStyle === "x-api-key" ? "x-api-key" : "Bearer";
}

function isProtocolAvailable(protocol: RelayProtocol): boolean {
  const config = props.protocolConfigs[protocol];
  return Boolean(config?.baseUrl && config.authStyle);
}

function protocolOptionLabel(option: RelayProtocolOption): string {
  return isProtocolAvailable(option.value)
    ? option.label
    : `${option.label}（当前渠道不支持）`;
}
</script>

<style scoped>
.protocol-form-item :deep(.el-form-item__content) {
  display: block;
}

.protocol-checkbox-group {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  width: 100%;
  gap: 10px;
}

.protocol-checkbox-option.el-checkbox.is-bordered {
  width: 100%;
  height: auto;
  min-height: 58px;
  margin: 0;
  padding: 10px 12px;
  border-radius: 8px;
}

.protocol-checkbox-option :deep(.el-checkbox__label) {
  min-width: 0;
  padding-left: 9px;
  white-space: normal;
}

.protocol-option-copy {
  display: flex;
  flex-direction: column;
  gap: 3px;
  line-height: 1.35;
}

.protocol-option-copy strong {
  color: #334155;
  font-size: 13px;
  font-weight: 600;
}

.protocol-option-copy small {
  color: #64748b;
  font-size: 11px;
}

.protocol-checkbox-option.is-checked .protocol-option-copy strong {
  color: var(--el-color-primary);
}

.form-help {
  margin-top: 6px;
  color: #64748b;
  font-size: 12px;
  line-height: 1.5;
}

.change-risk-alert {
  margin: -4px 0 18px;
}

.routing-upgrade-panel {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: -4px 0 18px;
}

.routing-upgrade-panel :deep(.el-alert) {
  flex: 1;
  min-width: 0;
}

.protocol-config-list {
  display: flex;
  flex-direction: column;
  width: 100%;
  gap: 8px;
}

.protocol-config-row {
  min-width: 0;
  padding: 10px 12px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #f8fafc;
}

.protocol-config-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 6px;
}

.protocol-config-head strong {
  color: #334155;
  font-size: 12px;
}

.protocol-config-row code {
  display: block;
  overflow-wrap: anywhere;
  color: #475569;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
  line-height: 1.5;
}

.config-missing-alert {
  width: 100%;
  margin-top: 8px;
}

@media (max-width: 720px) {
  .protocol-checkbox-group {
    grid-template-columns: 1fr;
  }

  .routing-upgrade-panel {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
