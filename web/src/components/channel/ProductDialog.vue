<template>
  <el-dialog
    :model-value="visible"
    :title="title"
    :width="mode === 'edit' ? '520px' : '560px'"
    destroy-on-close
    @update:model-value="$emit('update:visible', $event)"
  >
    <el-form label-width="100px">
      <el-form-item v-if="mode === 'create'" label="渠道">
        <el-input :model-value="channelName" disabled />
      </el-form-item>
      <el-form-item v-else label="产品">
        <el-input :model-value="kindLabel" disabled />
      </el-form-item>
      <el-form-item label="名称" required>
        <el-input
          :model-value="name"
          maxlength="100"
          show-word-limit
          :placeholder="namePlaceholder"
          @update:model-value="$emit('update:name', $event)"
        />
      </el-form-item>
      <el-form-item label="标签">
        <el-input
          :model-value="tag"
          maxlength="32"
          show-word-limit
          placeholder="国内、国际"
          @update:model-value="$emit('update:tag', $event)"
        />
      </el-form-item>
      <slot />
      <el-form-item v-if="showSeatCount" label="席位数量" required>
        <el-input-number
          :model-value="seatCount"
          :min="0"
          :max="100000"
          controls-position="right"
          @update:model-value="$emit('update:seatCount', Number($event) || 0)"
        />
      </el-form-item>
      <template v-if="mode === 'edit' && showCreditLimits">
        <el-form-item label="5 小时积分">
          <el-input
            :model-value="fiveHourCreditLimit"
            placeholder="每把 KEY 的 5 小时上限，例如 35000"
            clearable
            @update:model-value="$emit('update:fiveHourCreditLimit', $event)"
          />
        </el-form-item>
        <el-form-item label="每周积分">
          <el-input
            :model-value="weeklyCreditLimit"
            placeholder="每把 KEY 的每周上限，例如 155000"
            clearable
            @update:model-value="$emit('update:weeklyCreditLimit', $event)"
          />
        </el-form-item>
        <el-form-item label="每月积分">
          <el-input
            :model-value="monthlyCreditLimit"
            placeholder="每把 KEY 的每月上限，例如 1000000"
            clearable
            @update:model-value="$emit('update:monthlyCreditLimit', $event)"
          />
          <p class="form-hint">
            该产品下每把 KEY 的积分上限，留空表示不限。保存后对该产品下所有 KEY 立即生效，
            渠道 KEY 不单独设置。火山方舟 Agent Plan 支持的模型按 AFP 计入这三档；图片、视频、语音、Harness 不开放。
          </p>
        </el-form-item>
        <el-form-item label="周重置时间">
          <el-date-picker
            :model-value="weeklyWindowResetAt"
            type="datetime"
            format="YYYY-MM-DD HH:mm"
            placeholder="控制台显示的周限额重置时间"
            style="width: 100%"
            clearable
            @update:model-value="$emit('update:weeklyWindowResetAt', $event)"
          />
          <p class="form-hint">
            填控制台显示的任意一次周限额重置时间，之后按每 7 天滚动。同一产品下的 KEY 共用；
            保存后各 KEY 之前从上游学到的时间会清空，统一跟随这里。
          </p>
        </el-form-item>
        <el-form-item v-if="showMonthlyReset" label="月重置时间">
          <el-date-picker
            :model-value="monthlyWindowResetAt"
            type="datetime"
            format="YYYY-MM-DD HH:mm"
            placeholder="订阅月重置时间，留空为北京时间每月 1 日 0 点"
            style="width: 100%"
            clearable
            @update:model-value="$emit('update:monthlyWindowResetAt', $event)"
          />
        </el-form-item>
        <el-form-item label="可挂员工数">
          <el-input
            :model-value="keyMaxMembers"
            placeholder="每把 KEY 可挂员工数，留空为 3"
            clearable
            @update:model-value="$emit('update:keyMaxMembers', $event)"
          />
        </el-form-item>
        <el-form-item label="KEY 并发">
          <el-input
            :model-value="keyMaxConcurrency"
            placeholder="每把 KEY 并发，留空为 9"
            clearable
            @update:model-value="$emit('update:keyMaxConcurrency', $event)"
          />
          <p class="form-hint">
            该产品下每把 KEY 最多挂几名员工、最多几路在途请求。留空走全局默认（3 人 / 9 路）。
            保存后对该产品下所有 KEY 立即生效。
          </p>
        </el-form-item>
      </template>
      <el-form-item v-if="mode === 'edit'" label="批量查询额度">
        <el-switch
          :model-value="officialQuotaQueryEnabled"
          @update:model-value="$emit('update:officialQuotaQueryEnabled', Boolean($event))"
        />
        <p class="form-hint">开启后，该产品下的 KEY 参与 KEYS Table 的官方额度批量查询。</p>
      </el-form-item>
      <slot name="extra-edit" />
      <el-form-item v-if="mode === 'edit'" label="状态">
        <el-radio-group
          :model-value="status"
          @update:model-value="$emit('update:status', $event)"
        >
          <el-radio-button value="active">启用</el-radio-button>
          <el-radio-button value="disabled">停用</el-radio-button>
        </el-radio-group>
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="$emit('update:visible', false)">取消</el-button>
      <el-button type="primary" :loading="saving" @click="$emit('submit')">
        {{ mode === "create" ? "创建" : "保存" }}
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  visible: boolean;
  mode: "create" | "edit";
  title: string;
  channelName: string;
  kindLabel: string;
  name: string;
  tag: string;
  seatCount: number;
  showSeatCount: boolean;
  showCreditLimits: boolean;
  fiveHourCreditLimit: string;
  weeklyCreditLimit: string;
  monthlyCreditLimit: string;
  weeklyWindowResetAt: Date | null;
  monthlyWindowResetAt: Date | null;
  showMonthlyReset?: boolean;
  officialQuotaQueryEnabled?: boolean;
  keyMaxMembers?: string;
  keyMaxConcurrency?: string;
  status: "active" | "disabled";
  saving: boolean;
  namePlaceholder?: string;
}>(), {
  showMonthlyReset: true,
  officialQuotaQueryEnabled: false,
  keyMaxMembers: "",
  keyMaxConcurrency: "",
});

defineEmits<{
  "update:visible": [value: boolean];
  "update:name": [value: string];
  "update:tag": [value: string];
  "update:seatCount": [value: number];
  "update:fiveHourCreditLimit": [value: string];
  "update:weeklyCreditLimit": [value: string];
  "update:monthlyCreditLimit": [value: string];
  "update:weeklyWindowResetAt": [value: unknown];
  "update:monthlyWindowResetAt": [value: unknown];
  "update:officialQuotaQueryEnabled": [value: boolean];
  "update:keyMaxMembers": [value: string];
  "update:keyMaxConcurrency": [value: string];
  "update:status": [value: "active" | "disabled"];
  submit: [];
}>();
</script>

<style scoped>
.form-hint {
  margin: 6px 0 0;
  color: #64748b;
  font-size: 12px;
  line-height: 1.5;
}
</style>
