<template>
  <div class="channel-config-fields">
    <div class="channel-field-grid">
      <el-form-item label="渠道名称" required>
        <el-input
          v-model="name"
          maxlength="100"
          show-word-limit
          placeholder="请输入渠道名称"
          :disabled="disabled"
        />
      </el-form-item>

      <el-form-item label="标签">
        <el-input
          v-model="tag"
          maxlength="32"
          show-word-limit
          clearable
          placeholder="国内、备用"
          :disabled="disabled"
        />
      </el-form-item>

      <el-form-item label="席位数量" required>
        <el-input-number
          v-model="seatCount"
          class="seat-count-input"
          :min="0"
          :max="100000"
          :step="1"
          :precision="0"
          :disabled="disabled"
          controls-position="right"
        />
        <div class="form-help">登记席位不能超过这个数</div>
      </el-form-item>

      <el-form-item label="渠道状态">
        <el-radio-group v-model="status" :disabled="disabled">
          <el-radio-button value="active">启用</el-radio-button>
          <el-radio-button value="disabled">停用</el-radio-button>
        </el-radio-group>
      </el-form-item>
    </div>

    <el-form-item label="API 协议" required>
      <el-checkbox-group
        v-model="supportedProtocols"
        class="protocol-group"
        :disabled="disabled"
        @change="onProtocolsChange"
      >
        <el-checkbox
          v-for="option in relayProtocolOptions"
          :key="option.value"
          :value="option.value"
          :disabled="!isProtocolAvailable(option.value)"
          :title="option.description"
          border
        >
          {{ protocolOptionLabel(option) }}
        </el-checkbox>
      </el-checkbox-group>
      <div v-if="hasUnavailableProtocols" class="form-help">灰色项为当前渠道不支持的协议</div>
    </el-form-item>

    <el-form-item v-if="editable" label="上游地址" required>
      <el-input
        v-model="sharedBaseUrl"
        placeholder="http://host:port/v1"
        :disabled="disabled"
      />
    </el-form-item>

    <el-alert
      v-if="showChangeRisk && protocolsTouched"
      class="change-risk-alert"
      type="warning"
      :closable="false"
      show-icon
      title="协议变更会影响该渠道下所有 Key 的转发，保存后建议重新测试连接。"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import {
  relayProtocolOptions,
  type RelayAuthStyle,
  type RelayProtocol,
  type RelayProtocolConfigs,
  type RelayProtocolOption,
} from "@/views/relay-protocol";

type ChannelStatus = "active" | "disabled";

const props = withDefaults(defineProps<{
  protocolsTouched?: boolean;
  routingConfigDrift?: boolean;
  routingUpgradeRequested?: boolean;
  disabled?: boolean;
  showChangeRisk?: boolean;
  editable?: boolean;
  allowAllProtocols?: boolean;
}>(), {
  protocolsTouched: false,
  routingConfigDrift: false,
  routingUpgradeRequested: false,
  disabled: false,
  showChangeRisk: false,
  editable: false,
  allowAllProtocols: false,
});

const emit = defineEmits<{
  "protocols-change": [];
  "request-routing-upgrade": [];
}>();

const name = defineModel<string>("name", { required: true });
const tag = defineModel<string>("tag", { default: "" });
const seatCount = defineModel<number | null>("seatCount", { required: true });
const supportedProtocols = defineModel<RelayProtocol[]>("supportedProtocols", { required: true });
const status = defineModel<ChannelStatus>("status", { required: true });
const protocolConfigs = defineModel<RelayProtocolConfigs>("protocolConfigs", { required: true });

const sharedBaseUrl = computed({
  get() {
    for (const protocol of supportedProtocols.value) {
      const url = protocolConfigs.value[protocol]?.baseUrl?.trim();
      if (url) return url;
    }
    return "";
  },
  set(value: string) {
    const next = { ...protocolConfigs.value };
    for (const protocol of supportedProtocols.value) {
      next[protocol] = {
        baseUrl: value,
        authStyle: next[protocol]?.authStyle ?? defaultAuthStyle(protocol),
      };
    }
    protocolConfigs.value = next;
  },
});

const hasUnavailableProtocols = computed(() =>
  relayProtocolOptions.some((option) => !isProtocolAvailable(option.value)),
);

function defaultAuthStyle(protocol: RelayProtocol): RelayAuthStyle {
  return protocol === "anthropic_messages" ? "x-api-key" : "bearer";
}

function hasUsableProtocolConfig(protocol: RelayProtocol): boolean {
  const config = protocolConfigs.value[protocol];
  return Boolean(config?.baseUrl?.trim() && config.authStyle);
}

function isProtocolAvailable(protocol: RelayProtocol): boolean {
  return props.editable || props.allowAllProtocols || hasUsableProtocolConfig(protocol);
}

function seedMissingEditableConfigs() {
  if (!props.editable) return;
  const next = { ...protocolConfigs.value };
  const donor = Object.values(next).find((config) => config?.baseUrl?.trim());
  let changed = false;
  for (const protocol of supportedProtocols.value) {
    if (next[protocol]?.baseUrl?.trim()) continue;
    next[protocol] = {
      baseUrl: donor?.baseUrl ?? next[protocol]?.baseUrl ?? "",
      authStyle: next[protocol]?.authStyle ?? defaultAuthStyle(protocol),
    };
    changed = true;
  }
  if (changed) protocolConfigs.value = next;
}

function onProtocolsChange() {
  emit("protocols-change");
  seedMissingEditableConfigs();
}

function protocolOptionLabel(option: RelayProtocolOption): string {
  const label = option.shortLabel.replace(/ 协议$/, "");
  return isProtocolAvailable(option.value) ? label : `${label}（不支持）`;
}
</script>

<style scoped>
.channel-field-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0 16px;
}

.seat-count-input {
  width: 160px;
}

.protocol-group {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.protocol-group :deep(.el-checkbox) {
  margin-right: 0;
}

.form-help {
  margin-top: 6px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  line-height: 1.4;
}

.change-risk-alert {
  margin: 0 0 4px;
}

@media (max-width: 560px) {
  .channel-field-grid {
    grid-template-columns: 1fr;
  }
}
</style>
