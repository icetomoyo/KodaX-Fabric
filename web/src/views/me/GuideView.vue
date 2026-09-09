<template>
  <div class="guide-page">
    <section class="page-card pin-card" aria-label="接入必看">
      <div class="pin-item">
        <span class="pin-label">Base URL</span>
        <p class="pin-copy">所有客户端均填写此地址。Base URL 不需要包含端口号或接口路径。</p>
        <div class="pin-row">
          <code class="pin-value">{{ clientBaseUrl }}</code>
          <el-button type="primary" @click="copyValue('Base URL', clientBaseUrl)">复制 Base URL</el-button>
        </div>
      </div>
      <div class="pin-item">
        <span class="pin-label">遇到问题？咨询 Token Bot</span>
        <p class="pin-copy">
          协议、API Key 或客户端配置遇到问题，可点击页面<strong>右下角 Token Bot</strong> 咨询。
          它能查看你的 API Key 和调用记录。
        </p>
      </div>
      <div v-if="!loaded || !inTeam" class="pin-item">
        <span class="pin-label">尚未加入团队</span>
        <p class="pin-copy">
          点击右下角 Token Bot，说明你所属的企业和团队（或部门），再询问应将你加入团队的联系人。
          需提供团队信息，才能匹配到对应负责人。
        </p>
      </div>
    </section>

    <section class="page-card step-card">
      <div class="step-heading">
        <span class="step-index">1</span>
        <div>
          <h3>加入团队</h3>
          <p>注册完成后需加入团队，才能创建 API Key。当前账号为普通注册用户，加入团队后即为员工身份。</p>
        </div>
      </div>

      <el-alert
        v-if="loaded && inTeam"
        class="status-alert"
        title="第一步已完成：你已加入团队"
        type="success"
        show-icon
        :closable="false"
      >
        <p v-if="teamNames">当前团队：{{ teamNames }}</p>
        <p>下一步请确认所用产品，创建 API Key 时选择对应协议。</p>
      </el-alert>
      <el-alert
        v-else-if="loaded"
        class="status-alert"
        title="你尚未加入团队。请先完成本步，再创建 API Key 或配置客户端。"
        type="warning"
        show-icon
        :closable="false"
      />

      <ol class="steps">
        <li>使用手机号注册并登录，即当前账号。</li>
        <li>
          将注册手机号发给负责团队成员管理的人员，请其将你加入团队。
          通常为组长、部门负责人，或企业内账号管理员
          （产品中称为团队管理员、部门管理员、企业管理员）。
        </li>
        <li>对方仅能邀请<strong>已经注册好的手机号</strong>，无法代为注册。</li>
      </ol>

      <div class="phone-card">
        <span class="phone-label">用于加入团队的手机号</span>
        <code class="phone-value">{{ phone || "登录后显示" }}</code>
        <el-button
          type="primary"
          :disabled="!phone"
          @click="copyPhone"
        >
          复制手机号
        </el-button>
      </div>

      <div class="script-card">
        <strong>参考话术</strong>
        <p>「我已经在 Token Hub 注册了，手机号是 {{ phone || "（你的注册手机号）" }}，请把我加进团队。」</p>
      </div>

      <ul class="notes">
        <li>工作台仍提示「普通注册用户」，表示尚未加入团队。</li>
        <li>「API Key」页的「创建 Key」为灰色，表示尚未加入团队。</li>
        <li>管理员无法找到你时，请确认对方使用的是上方手机号，且该号码已完成注册。</li>
      </ul>
    </section>

    <section class="page-card step-card">
      <div class="step-heading">
        <span class="step-index">2</span>
        <div>
          <h3>选择协议</h3>
          <p>
            创建 API Key 时需选择协议。协议在创建后不可修改；选错会导致路径不匹配并返回 404，或能列出模型但无法调用。
            每种产品使用对应协议的 API Key。
          </p>
        </div>
      </div>

      <p class="lead">对照下表，按实际使用的客户端选择协议。创建 API Key 时，「协议」选项名称与下表右列一致。</p>

      <div class="protocol-table" aria-label="产品与协议对照">
        <div class="protocol-row protocol-head">
          <span>所用产品</span>
          <span>对应协议</span>
        </div>
        <div class="protocol-row">
          <span>Claude Code</span>
          <strong>Anthropic Message 协议</strong>
        </div>
        <div class="protocol-row">
          <span>Cursor</span>
          <strong>OpenAI Chat Completion 协议</strong>
        </div>
        <div class="protocol-row">
          <span>KodaX、KodaX Space</span>
          <span>支持两种协议，推荐选 <strong>OpenAI Chat Completion 协议</strong></span>
        </div>
        <div class="protocol-row">
          <span>Codex（自定义模型）</span>
          <strong>OpenAI Response 协议</strong>
        </div>
        <div class="protocol-row">
          <span>CC Switch</span>
          <span>按 CC Switch 中配置的 API 格式选择：Anthropic 对应 <strong>Anthropic Message 协议</strong>，OpenAI Chat 对应 <strong>OpenAI Chat Completion 协议</strong></span>
        </div>
        <div class="protocol-row">
          <span>其他 OpenAI 兼容客户端（走 Chat Completions）</span>
          <strong>OpenAI Chat Completion 协议</strong>
        </div>
        <div class="protocol-row">
          <span>走 Responses API 的客户端</span>
          <strong>OpenAI Response 协议</strong>
        </div>
      </div>

      <ul class="notes">
        <li>如不确定协议，先确认客户端要求填写 Anthropic 还是 OpenAI。公司产品 KodaX / KodaX Space 选择 Chat Completion；常见外部工具为 Claude Code、Cursor 或 Codex。</li>
        <li>Chat Completion 协议的 API Key 无法调用 Responses 接口，Responses 协议的 API Key 也无法调用 Chat Completions 接口。</li>
        <li>Codex 自定义模型默认使用 Responses 接口，应选择 OpenAI Response 协议。</li>
        <li>同时使用 Claude Code、Cursor、Codex 时，分别为每种产品创建对应协议的 API Key。</li>
        <li>上游渠道不支持所选协议时，创建页不会显示该选项。可更换上游渠道，或选择该渠道支持的协议。</li>
      </ul>
    </section>

    <section class="page-card step-card">
      <div class="step-heading">
        <span class="step-index">3</span>
        <div>
          <h3>创建 API Key</h3>
          <p>加入团队后，在「API Key」页按所用产品创建 API Key。协议按上一步对照表选择，创建后不可修改。</p>
        </div>
      </div>

      <el-alert
        v-if="loaded && !inTeam"
        class="status-alert"
        title="尚未加入团队时，「创建 Key」不可用。请先完成第一步。"
        type="warning"
        show-icon
        :closable="false"
      />

      <ol class="steps">
        <li>打开「API Key」页，点击「创建 Key」。</li>
        <li>填写名称，建议使用产品名，例如 <code>Cursor</code>、<code>Claude Code</code>、<code>KodaX</code>。</li>
        <li>选择上游渠道。若无可选项，请联系团队管理员先配置渠道。</li>
        <li>选择协议，须与上一步对照表一致：Claude Code 选择 Anthropic Message，Cursor / KodaX / KodaX Space 选择 OpenAI Chat Completion，Codex 选择 OpenAI Response。</li>
        <li>创建成功后立即复制完整 API Key（<code>th_</code> 开头）。关闭窗口后将无法再次查看明文。</li>
      </ol>

      <div class="script-card">
        <strong>注意</strong>
        <p>API Key 只显示一次。未复制即关闭窗口后，只能删除后重新创建。如怀疑泄漏，同样删除后重新创建。请勿将完整 API Key 发送到聊天工具或截图中。</p>
      </div>

      <ul class="notes">
        <li>每把 API Key 绑定固定的上游渠道和协议，创建后不可修改。更换协议或产品时，需另行创建。</li>
        <li>Claude Code、Cursor、Codex 需分别使用各自协议的 API Key。</li>
      </ul>

      <div class="step-actions">
        <el-button type="primary" :disabled="loaded && !inTeam" @click="router.push(keysPath)">
          前往 API Key
        </el-button>
      </div>
    </section>

    <section class="page-card step-card">
      <div class="step-heading">
        <span class="step-index">4</span>
        <div>
          <h3>配置客户端</h3>
          <p>所有产品的 Base URL 均为当前站点的 <code>/ai</code>。Base URL 不需要包含端口号或接口路径，例如 <code>:3000</code>、<code>:3100</code>、<code>/v1/messages</code>、<code>/chat/completions</code>。</p>
        </div>
      </div>

      <div class="phone-card">
        <span class="phone-label">Base URL（复制后填入客户端）</span>
        <code class="phone-value">{{ clientBaseUrl }}</code>
        <el-button type="primary" @click="copyValue('Base URL', clientBaseUrl)">复制 Base URL</el-button>
      </div>

      <p class="lead">API Key 填写第三步复制的 <code>th_</code> 开头字符串。各产品字段名称不同，请对照下表填写。</p>

      <div class="protocol-table" aria-label="客户端填写对照">
        <div class="protocol-row protocol-head">
          <span>产品</span>
          <span>填写说明</span>
        </div>
        <div class="protocol-row">
          <span>Claude Code</span>
          <span>
            将下方 JSON <strong>合并</strong>到 <code>~/.claude/settings.json</code> 的 <code>env</code> 中，保留文件中的其余配置。修改后完全退出客户端再重新打开。
          </span>
        </div>
        <div class="protocol-row">
          <span>Cursor</span>
          <span>自定义模型 / OpenAI 兼容：Base URL 填写上方地址，API Key 填写第三步创建的 API Key。</span>
        </div>
        <div class="protocol-row">
          <span>KodaX、KodaX Space</span>
          <span>按 OpenAI Chat Completion 配置：Base URL 填写上方地址，API Key 填写第三步创建的 API Key。</span>
        </div>
        <div class="protocol-row">
          <span>Codex（自定义模型）</span>
          <span>
            在 <code>~/.codex/config.toml</code> 中，将自定义 provider 的 <code>base_url</code> 设为上方地址，
            并设置 <code>wire_api = "responses"</code>。Codex 会自行请求 <code>/responses</code>。
          </span>
        </div>
        <div class="protocol-row">
          <span>CC Switch</span>
          <span>
            <strong>上游</strong> Base URL 填写上方地址，API Key 填写第三步创建的 API Key。
            CC Switch 的本地代理地址 <code>127.0.0.1:15721</code> 不能作为上游地址，否则会形成请求循环。
          </span>
        </div>
      </div>

      <p class="lead">Claude Code 可直接复制以下配置，将其中的 Key 替换为你的 API Key：</p>
      <pre class="snippet"><code>{{ claudeSettingsSnippet }}</code></pre>
      <div class="step-actions">
        <el-button @click="copyValue('Claude Code 配置', claudeSettingsSnippet)">复制 Claude Code 配置</el-button>
      </div>

      <p class="lead">Codex 自定义 provider 可参考以下配置：</p>
      <pre class="snippet"><code>{{ codexSnippet }}</code></pre>
      <div class="step-actions">
        <el-button @click="copyValue('Codex 配置', codexSnippet)">复制 Codex 配置</el-button>
      </div>

      <ul class="notes">
        <li>Base URL 中如出现 <code>:3000</code> / <code>:3100</code>，属于 API 内部端口，员工电脑无法访问。</li>
        <li>模型名称请到「模型列表」页复制。</li>
        <li>配置后仍无法连接时，先用浏览器打开当前站点，确认证书与网络正常，再完全退出客户端后重新打开。</li>
      </ul>
    </section>

    <section class="page-card step-card">
      <div class="step-heading">
        <span class="step-index">5</span>
        <div>
          <h3>完成首次调用</h3>
          <p>模型 ID 请从「模型列表」复制后填入客户端，发送一条短消息，再到「我的调用」确认是否产生记录。</p>
        </div>
      </div>

      <ol class="steps">
        <li>打开「模型列表」，在左侧选择与 API Key 相同的上游渠道。</li>
        <li>点击模型名旁的「复制」，粘贴到客户端。智谱渠道当前常用：<code>glm-5.3</code>（文本）、<code>glm-5.3-flash</code>（多模态）。</li>
        <li>在客户端发送一句短消息，例如「ping」或「你好」。</li>
        <li>打开「我的调用」。成功时会显示 Request ID、模型和 Tokens；失败时也可查看错误信息，复制 Request ID 后用于排查。</li>
      </ol>

      <div class="script-card">
        <strong>成功标准</strong>
        <p>客户端出现完整或流式回复，且「我的调用」中可见对应记录，即表示首次调用成功。若客户端持续等待且调用页无记录，通常是 Base URL、API Key 或协议未匹配，请回到第二至第四步核对。</p>
      </div>

      <ul class="notes">
        <li>能列出模型但生成失败时，通常是模型 ID 与上游渠道不匹配，或上游暂时不可用。请重新从「模型列表」复制。</li>
        <li>智谱渠道不接受自行填写的旧模型名，手打 glm-4.x 会被拒绝。</li>
      </ul>

      <div class="step-actions">
        <el-button type="primary" @click="router.push(modelsPath)">前往模型列表</el-button>
        <el-button @click="router.push(logsPath)">查看我的调用</el-button>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { ElMessage } from "element-plus";
import { useRoute, useRouter } from "vue-router";
import { http } from "@/api/http";
import { copyText } from "@/lib/clipboard";
import { useAuthStore } from "@/stores/auth";
import { RELAY_BASE_PATH, relayClientBaseUrl } from "@/views/relay-protocol";

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();
const isAdminGuide = computed(() => route.path.startsWith("/admin"));
const keysPath = computed(() => (isAdminGuide.value ? "/admin/keys" : "/me/keys"));
const modelsPath = computed(() => (isAdminGuide.value ? "/admin/models" : "/me/models"));
const logsPath = computed(() => (isAdminGuide.value ? "/admin/my-logs" : "/me/logs"));
const loaded = ref(false);
const inTeam = ref(false);
const teams = ref<Array<{ id: number; name: string }>>([]);
const relayUrl = ref("");

const phone = computed(() => auth.user?.phone?.trim() || "");
const teamNames = computed(() => teams.value.map((team) => team.name).filter(Boolean).join("、"));
const clientBaseUrl = computed(() =>
  relayClientBaseUrl(relayUrl.value || `${window.location.origin}${RELAY_BASE_PATH}`),
);
const claudeSettingsSnippet = computed(() =>
  JSON.stringify(
    {
      env: {
        ANTHROPIC_BASE_URL: clientBaseUrl.value,
        ANTHROPIC_AUTH_TOKEN: "<你的 API Key>",
      },
    },
    null,
    2,
  ),
);
const codexSnippet = computed(
  () => `model_provider = "tokenhub"
model = "<模型列表里复制的模型 ID>"

[model_providers.tokenhub]
name = "Token Hub"
base_url = "${clientBaseUrl.value}"
env_key = "OPENAI_API_KEY"
wire_api = "responses"`,
);

async function loadGuideContext() {
  try {
    const [org, usage] = await Promise.all([
      http.get("/api/me/org"),
      http.get("/api/me/usage").catch(() => ({ data: { success: false } })),
    ]);
    if (org.data.success) {
      teams.value = org.data.data.teams ?? [];
      inTeam.value = teams.value.length > 0;
    }
    if (usage.data.success && typeof usage.data.data?.relay?.baseUrl === "string") {
      relayUrl.value = usage.data.data.relay.baseUrl;
    }
  } catch {
    inTeam.value = false;
    teams.value = [];
  } finally {
    loaded.value = true;
  }
}

async function copyValue(label: string, value: string) {
  if (!value) return;
  const copied = await copyText(value);
  if (copied) ElMessage.success(`${label}已复制`);
  else ElMessage.error(`${label}复制失败，请手动选择文本复制`);
}

async function copyPhone() {
  await copyValue("手机号", phone.value);
}

onMounted(loadGuideContext);
</script>

<style scoped>
.guide-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
}

.pin-card {
  display: grid;
  gap: 18px;
  border: 1px solid #93c5fd;
  background: linear-gradient(180deg, #eff6ff 0%, #ffffff 100%);
}

.pin-label {
  display: block;
  margin-bottom: 6px;
  color: #1d4ed8;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.06em;
}

.pin-copy {
  margin: 0 0 10px;
  color: #1e3a8a;
  line-height: 1.65;
}

.pin-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}

.pin-value {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
  color: #0f172a;
  font-size: 18px;
  font-weight: 700;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}

.step-heading {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  margin-bottom: 16px;
}

.step-heading h3 {
  margin: 0;
  color: #0f172a;
  font-size: 18px;
}

.step-heading p {
  margin: 6px 0 0;
  color: #64748b;
  line-height: 1.6;
}

.step-index {
  display: inline-flex;
  flex: 0 0 32px;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  color: #fff;
  background: #2563eb;
  border-radius: 50%;
  font-weight: 700;
}

.status-alert {
  margin-bottom: 16px;
}

.status-alert p {
  margin: 8px 0 0;
}

.steps {
  margin: 0 0 16px;
  padding-left: 22px;
  color: #334155;
  line-height: 1.75;
}

.phone-card {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 6px 12px;
  margin-bottom: 12px;
  padding: 14px 16px;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  background: #f8fafc;
}

.phone-label {
  grid-column: 1 / -1;
  color: #64748b;
  font-size: 12px;
  font-weight: 600;
}

.phone-value {
  min-width: 0;
  overflow-wrap: anywhere;
  color: #0f172a;
  font-size: 18px;
  font-weight: 700;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}

.script-card {
  margin-bottom: 16px;
  padding: 14px 16px;
  border: 1px solid #dbeafe;
  border-radius: 12px;
  background: #eff6ff;
}

.script-card p {
  margin: 8px 0 0;
  color: #1e3a8a;
  line-height: 1.7;
}

.notes {
  margin: 0;
  padding-left: 18px;
  color: #64748b;
  font-size: 13px;
  line-height: 1.7;
}

.lead {
  margin: 0 0 14px;
  color: #334155;
  line-height: 1.7;
}

.protocol-table {
  margin: 0 0 16px;
  overflow: hidden;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
}

.protocol-row {
  display: grid;
  grid-template-columns: minmax(160px, 0.9fr) minmax(0, 1.3fr);
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid #e2e8f0;
  color: #334155;
  font-size: 14px;
  line-height: 1.6;
}

.protocol-row:last-child {
  border-bottom: none;
}

.protocol-head {
  background: #f8fafc;
  color: #64748b;
  font-size: 12px;
  font-weight: 650;
}

.protocol-row strong {
  color: #0f172a;
  font-weight: 650;
}

.step-actions {
  display: flex;
  justify-content: flex-start;
  margin: 8px 0 16px;
}

.snippet {
  margin: 0;
  padding: 14px 16px;
  overflow-x: auto;
  border: 1px solid #1e293b;
  border-radius: 10px;
  background: #0f172a;
  color: #e2e8f0;
  font-size: 12px;
  line-height: 1.65;
  white-space: pre;
}

.snippet code {
  color: inherit;
}

code {
  overflow-wrap: anywhere;
  color: #334155;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}

@media (max-width: 720px) {
  .phone-card,
  .protocol-row {
    grid-template-columns: 1fr;
  }
}
</style>
