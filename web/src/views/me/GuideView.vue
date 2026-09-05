<template>
  <div class="guide-page">
    <section class="page-card hero-card">
      <div>
        <p class="eyebrow">员工接入</p>
        <h2 class="page-title">接入教程</h2>
        <p class="page-subtitle">
          <strong>KodaX Fabric</strong>（Token Hub 模块）使用公网受信任的 HTTPS。
          员工 Key 绑定上游渠道和协议，原生转发
          <strong>Anthropic Message</strong>、<strong>OpenAI Chat Completion</strong>、
          <strong>OpenAI Response</strong> 三种协议。
        </p>
      </div>
      <div class="hero-actions">
        <el-button type="primary" @click="router.push('/me/keys')">创建 API Key</el-button>
        <el-button @click="scrollToTroubleshooting">查看排障</el-button>
      </div>
    </section>

    <el-alert
      class="security-alert"
      title="HTTPS 已就绪"
      type="success"
      :closable="false"
      show-icon
    >
      <template #default>
        此地址使用公网受信任的证书，无需下载或安装本地根证书。请保持客户端的 TLS 证书校验开启，勿使用不安全模式绕过校验。
      </template>
    </el-alert>

    <el-alert
      class="security-alert"
      title="一种协议，一把 Key"
      type="warning"
      :closable="false"
      show-icon
    >
      <template #default>
        Key 创建时绑定<strong>上游渠道 + 协议</strong>，创建后不可改。
        请求路径必须与 Key 协议一致；换协议或换渠道请另建 Key。
      </template>
    </el-alert>

    <section class="summary-grid" aria-label="接入信息">
      <article class="summary-card">
        <span class="summary-label">Base URL</span>
        <code class="summary-value">{{ clientBaseUrl }}</code>
        <el-button link type="primary" @click="copyValue('Base URL', clientBaseUrl)">复制</el-button>
      </article>
      <article class="summary-card">
        <span class="summary-label">HTTPS</span>
        <span class="summary-value">公网受信任证书（无需本地安装）</span>
      </article>
    </section>

    <section class="page-card guide-section">
      <div class="section-heading">
        <span class="step-index">1</span>
        <div>
          <h3>验证 HTTPS 连接</h3>
          <p>无需安装本地证书；先确认设备能够正常打开 Fabric 健康检查地址。</p>
        </div>
      </div>

      <div class="verify-strip">
        <div>
          <strong>打开健康检查</strong>
          <p>浏览器应可直接打开且不出现证书警告。</p>
        </div>
        <code>{{ healthUrl }}</code>
        <el-button link type="primary" tag="a" :href="healthUrl" target="_blank" rel="noopener noreferrer">
          打开验证
        </el-button>
      </div>
    </section>

    <section class="page-card guide-section">
      <div class="section-heading">
        <span class="step-index">2</span>
        <div>
          <h3>创建并保存 API Key</h3>
          <p>一把 Key 固定绑定一个上游渠道和一种协议，创建后不能修改。</p>
        </div>
      </div>

      <div class="two-column">
        <ol class="instruction-list compact-list">
          <li>进入「API Key」，填写名称并选择上游渠道。</li>
          <li>
            选好渠道后选择协议：<strong>Anthropic Message 协议</strong>、
            <strong>OpenAI Chat Completion 协议</strong>或
            <strong>OpenAI Response 协议</strong>（仅显示当前渠道支持的）。
          </li>
          <li>创建后立即复制完整 Key（<code>th_...</code>）；关闭后无法再查看明文。</li>
          <li>换协议或换渠道时另建 Key，不要混用。</li>
        </ol>
        <div class="key-safety-card">
          <strong>Key 安全</strong>
          <p>不要把完整 Key 放进截图、聊天记录或代码仓库。怀疑泄漏时，请立即删除旧 Key 并重新创建。</p>
          <el-button type="primary" @click="router.push('/me/keys')">前往 API Key</el-button>
        </div>
      </div>
    </section>

    <section class="page-card guide-section">
      <div class="section-heading">
        <span class="step-index">3</span>
        <div>
          <h3>配置调用客户端</h3>
          <p>Base URL 统一为 <code>{{ clientBaseUrl }}</code>，不要按协议改写路径。示例中的 Key 是占位符。</p>
        </div>
      </div>

      <div class="protocol-matrix" aria-label="协议对照">
        <div class="protocol-matrix-row protocol-matrix-head">
          <span>协议</span>
          <span>请求路径</span>
          <span>鉴权 / 配置</span>
        </div>
        <div
          v-for="row in protocolGuideRows"
          :key="row.value"
          class="protocol-matrix-row"
        >
          <span>{{ row.label }}</span>
          <code>{{ row.endpoint }}</code>
          <span>{{ row.config }}</span>
        </div>
      </div>

      <el-tabs v-model="clientTab" class="guide-tabs client-tabs">
        <el-tab-pane label="Anthropic Message" name="anthropic">
          <el-alert
            title="使用「Anthropic Message 协议」的员工 Key"
            type="info"
            :closable="false"
            show-icon
          />
          <ol class="instruction-list compact-list tab-steps">
            <li>创建 Key 时协议选 <strong>Anthropic Message 协议</strong>。</li>
            <li>Base URL 填 <code>{{ clientBaseUrl }}</code>，客户端请求 <code>/v1/messages</code>。</li>
            <li>Claude Code 将下列字段<strong>合并</strong>进 <code>~/.claude/settings.json</code> 的 <code>env</code>，不要整文件覆盖；改完后完全退出再打开。</li>
            <li>模型名称请到「模型」页复制，不要手打。</li>
          </ol>
          <SnippetBlock
            :value="claudeSettingsSnippet"
            language="JSON"
            @copy="copyValue('Anthropic 配置', claudeSettingsSnippet)"
          />
          <p class="inline-note">
            鉴权使用 <code>x-api-key</code> 或 <code>Authorization: Bearer</code>，二选一，Key 值相同。
          </p>
        </el-tab-pane>

        <el-tab-pane label="OpenAI Chat Completion" name="openai-chat">
          <el-alert
            title="使用「OpenAI Chat Completion 协议」的员工 Key"
            type="info"
            :closable="false"
            show-icon
          />
          <ol class="instruction-list compact-list tab-steps">
            <li>创建 Key 时协议选 <strong>OpenAI Chat Completion 协议</strong>。</li>
            <li>
              OpenAI 兼容客户端的 Base URL 填 <code>{{ clientBaseUrl }}</code>
              （不要加端口号）；客户端会请求 <code>/chat/completions</code>。
            </li>
            <li>API Key 填员工 Key（<code>th_...</code>）。</li>
            <li>模型名称请到「模型」页复制，不要手打。</li>
          </ol>
          <div class="field-table">
            <div><span>OpenAI Base URL</span><code>{{ clientBaseUrl }}</code></div>
            <div><span>API Key</span><code>&lt;你的 KodaX Fabric API Key&gt;</code></div>
            <div><span>请求路径</span><code>POST /ai/chat/completions</code></div>
          </div>
          <p class="tab-intro">环境变量：</p>
          <SnippetBlock
            :value="openAiSettingsSnippet"
            language="Shell"
            @copy="copyValue('OpenAI Chat Completion 环境变量', openAiSettingsSnippet)"
          />
        </el-tab-pane>

        <el-tab-pane label="OpenAI Response" name="openai-response">
          <el-alert
            title="使用「OpenAI Response 协议」的员工 Key；Chat Completion Key 不能调用 /responses"
            type="info"
            :closable="false"
            show-icon
          />
          <ol class="instruction-list compact-list tab-steps">
            <li>创建 Key 时协议选 <strong>OpenAI Response 协议</strong>（渠道需支持该协议）。</li>
            <li>
              Base URL 同样填 <code>{{ clientBaseUrl }}</code>；
              客户端走 Responses API（<code>POST /responses</code>，亦接受 <code>/v1/responses</code>）。
            </li>
            <li>API Key 填员工 Key（<code>th_...</code>）。</li>
            <li>模型名称请到「模型」页复制，不要手打。</li>
          </ol>
          <div class="field-table">
            <div><span>OpenAI Base URL</span><code>{{ clientBaseUrl }}</code></div>
            <div><span>API Key</span><code>&lt;你的 KodaX Fabric API Key&gt;</code></div>
            <div><span>请求路径</span><code>POST /ai/responses</code></div>
          </div>
          <p class="tab-intro">环境变量与 Chat Completion 相同，区别只在客户端调用的是 Responses 而不是 Chat Completions：</p>
          <SnippetBlock
            :value="openAiSettingsSnippet"
            language="Shell"
            @copy="copyValue('OpenAI Response 环境变量', openAiSettingsSnippet)"
          />
          <SnippetBlock
            :value="responsesCurlSnippet"
            language="Shell"
            @copy="copyValue('Responses 调用示例', responsesCurlSnippet)"
          />
        </el-tab-pane>

        <el-tab-pane label="CC Switch" name="cc-switch">
          <div class="cc-switch-flow" aria-label="CC Switch 请求链路">
            <span>本地客户端</span><b>→</b><span>CC Switch 本地代理</span><b>→</b><span>KodaX Fabric</span>
          </div>
          <ol class="instruction-list">
            <li>员工 Key 协议必须与 CC Switch 配置的 API 格式一致。</li>
            <li>上游 Base URL 填写 <code>{{ clientBaseUrl }}</code>，API Key 填写自己的 <code>th_...</code> Key。</li>
            <li>
              若启用本地代理，客户端可指向 <code>http://127.0.0.1:15721</code>；
              CC Switch 的<strong>上游</strong>必须是 KodaX Fabric，禁止填本地地址（防循环代理）。
            </li>
          </ol>
          <div class="field-table">
            <div><span>CC Switch 上游 Base URL</span><code>{{ clientBaseUrl }}</code></div>
            <div><span>API Key</span><code>&lt;你的 KodaX Fabric API Key&gt;</code></div>
            <div><span>API 格式</span><code>与创建 Key 时选择的协议一致</code></div>
          </div>
        </el-tab-pane>
      </el-tabs>
    </section>

    <section class="page-card guide-section">
      <div class="section-heading">
        <span class="step-index">4</span>
        <div>
          <h3>验证模型访问</h3>
          <p>先到「模型」页复制模型名称填入客户端；也可用当前 Key 查询接口核对。</p>
        </div>
      </div>

      <div class="section-actions model-list-action">
        <el-button type="primary" @click="router.push('/me/models')">查看模型列表</el-button>
      </div>
      <SnippetBlock
        :value="modelListCommand"
        language="Shell"
        @copy="copyValue('模型查询命令', modelListCommand)"
      />
      <div class="success-checks">
        <div><span class="check-dot">✓</span><p><strong>HTTPS 正常</strong><br />健康检查返回 <code>"ok": true</code></p></div>
        <div><span class="check-dot">✓</span><p><strong>Key 正常</strong><br />模型接口返回 <code>data</code> 数组</p></div>
        <div><span class="check-dot">✓</span><p><strong>调用正常</strong><br />客户端能够收到完整或流式回复</p></div>
      </div>
    </section>

    <section id="troubleshooting" class="page-card guide-section troubleshooting-section">
      <div class="section-heading">
        <span class="step-index">5</span>
        <div>
          <h3>常见问题排查</h3>
          <p>先按错误类型检查；仍无法解决时，到“我的调用”复制 Request ID 排查。</p>
        </div>
      </div>

      <div class="troubleshooting-list">
        <article v-for="item in troubleshootingItems" :key="item.title">
          <div>
            <strong>{{ item.title }}</strong>
            <p>{{ item.cause }}</p>
          </div>
          <p class="resolution">{{ item.resolution }}</p>
        </article>
      </div>
      <div class="section-actions">
        <el-button type="primary" @click="router.push('/me/logs')">查看我的调用</el-button>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, defineComponent, h, onMounted, ref } from "vue";
import { ElButton, ElMessage } from "element-plus";
import { useRouter } from "vue-router";
import { http } from "@/api/http";
import { copyText } from "@/lib/clipboard";
import {
  RELAY_BASE_PATH,
  relayClientBaseUrl,
  relayProtocolOptions,
} from "@/views/relay-protocol";

const SnippetBlock = defineComponent({
  name: "SnippetBlock",
  props: {
    value: { type: String, required: true },
    language: { type: String, default: "Text" },
  },
  emits: ["copy"],
  setup(props, { emit }) {
    return () => h("div", { class: "snippet-block" }, [
      h("div", { class: "snippet-head" }, [
        h("span", props.language),
        h(ElButton, {
          link: true,
          type: "primary",
          onClick: () => emit("copy"),
        }, () => "复制"),
      ]),
      h("pre", [h("code", props.value)]),
    ]);
  },
});

const router = useRouter();
const clientTab = ref("anthropic");
const relayUrl = ref("");

const clientBaseUrl = computed(() => relayClientBaseUrl(
  relayUrl.value || `${window.location.origin}${RELAY_BASE_PATH}`,
));

const publicOrigin = computed(() => {
  try {
    return new URL(clientBaseUrl.value).origin;
  } catch {
    return window.location.origin;
  }
});

const healthUrl = computed(() => `${publicOrigin.value}/health`);

const protocolGuideRows = computed(() =>
  relayProtocolOptions.map((option) => ({
    value: option.value,
    label: option.shortLabel,
    endpoint: option.endpoint.replace(/^POST\s+/, ""),
    config: option.value === "anthropic_messages"
      ? "x-api-key 或 Bearer · ANTHROPIC_BASE_URL"
      : "Authorization: Bearer · OPENAI_BASE_URL",
  })),
);

const claudeSettingsSnippet = computed(() => JSON.stringify({
  env: {
    ANTHROPIC_BASE_URL: clientBaseUrl.value,
    ANTHROPIC_AUTH_TOKEN: "<你的 KodaX Fabric API Key>",
  },
}, null, 2));

const openAiSettingsSnippet = computed(() => [
  `export OPENAI_BASE_URL="${clientBaseUrl.value}"`,
  'export OPENAI_API_KEY="<你的 KodaX Fabric API Key>"',
].join("\n"));

const responsesCurlSnippet = computed(() => `curl -sS "${clientBaseUrl.value}/responses" \\
  -H "Authorization: Bearer <你的 KodaX Fabric API Key>" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"<模型 ID>","input":"ping"}'`);

const modelListCommand = computed(() => `# OpenAI Chat Completion / OpenAI Response
curl -sS "${clientBaseUrl.value}/models" \\
  -H "Authorization: Bearer <你的 KodaX Fabric API Key>"

# Anthropic Message
curl -sS "${clientBaseUrl.value}/v1/models" \\
  -H "x-api-key: <你的 KodaX Fabric API Key>" \\
  -H "anthropic-version: 2023-06-01"`);

const troubleshootingItems = computed(() => [
  {
    title: "Connection failed / TLS / 证书错误",
    cause: "请求没有到达 KodaX Fabric，通常是 Base URL、DNS、网络、代理设置或设备系统时间异常。",
    resolution: `先在浏览器打开 ${healthUrl.value}；确认客户端 Base URL 使用 ${clientBaseUrl.value}，随后完全退出并重启客户端。`,
  },
  {
    title: "地址中出现 :3000 或 :3100",
    cause: "那是 API 内部监听端口（现为 3000；旧文档可能写 3100），员工电脑无法直接访问。",
    resolution: `Base URL 必须使用 ${clientBaseUrl.value}，不要添加端口号。`,
  },
  {
    title: "401 / invalid_api_key",
    cause: "Key 粘贴不完整、已经被删除，或客户端使用了错误的鉴权字段。",
    resolution: "核对 Key；Anthropic Message 可用 x-api-key 或 Bearer，OpenAI Chat Completion / Response 使用 Bearer。必要时创建新 Key。",
  },
  {
    title: "404 / 协议不匹配 / 能列出模型但调用失败",
    cause: "请求路径与 Key 绑定的协议不一致。Chat Completion Key 不能打 /responses，Response Key 不能打 /chat/completions，Anthropic Key 不能打 OpenAI 路径。",
    resolution: "按实际请求路径另建对应协议的 Key；三种协议不要混用同一把 Key。",
  },
  {
    title: "能查询模型，但生成失败",
    cause: "客户端模型 ID 或所选渠道不匹配，也可能是当前上游暂时不可用。",
    resolution: "使用对应协议的 models 接口返回的模型 ID，并在「我的调用」中查看具体错误。",
  },
  {
    title: "CC Switch 持续 API error / Retrying",
    cause: "CC Switch 的上游配置没有重新加载，或把本地代理地址误填成了上游地址。",
    resolution: `重启 CC Switch；确认其上游地址是 ${clientBaseUrl.value}，而不是 127.0.0.1:15721。`,
  },
  {
    title: "403 team_required",
    cause: "API Key 未绑定团队。",
    resolution: "确认 Key 已绑定团队后再调用。",
  },
]);

async function loadRelayUrl() {
  try {
    const { data } = await http.get("/api/me/usage");
    if (data.success && typeof data.data?.relay?.baseUrl === "string") {
      relayUrl.value = data.data.relay.baseUrl;
    }
  } catch {
    // Same-origin fallback remains correct when the usage endpoint is temporarily unavailable.
  }
}

async function copyValue(label: string, value: string) {
  const copied = await copyText(value);
  if (copied) ElMessage.success(`${label}已复制`);
  else ElMessage.error(`${label}复制失败，请手动选择文本复制`);
}

function scrollToTroubleshooting() {
  document.getElementById("troubleshooting")?.scrollIntoView({ behavior: "smooth" });
}

onMounted(loadRelayUrl);
</script>

<style scoped>
.guide-page {
  display: grid;
  gap: 16px;
  min-width: 0;
  padding-bottom: 8px;
}

.hero-card {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24px;
  background: linear-gradient(135deg, #ffffff 0%, #f1f7ff 100%);
  border: 1px solid #dbeafe;
}

.eyebrow {
  margin: 0 0 6px;
  color: #2563eb;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.12em;
}

.page-title {
  margin: 0;
  color: #0f172a;
  font-size: 24px;
  font-weight: 700;
}

.page-subtitle {
  max-width: 720px;
  margin: 8px 0 0;
  color: #64748b;
  line-height: 1.7;
}

.hero-actions,
.section-actions {
  display: flex;
  flex-shrink: 0;
  gap: 10px;
}

.security-alert :deep(.el-alert__content) {
  min-width: 0;
}

.security-alert code,
.guide-section code {
  color: #334155;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.summary-card {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 6px 12px;
  min-width: 0;
  padding: 16px 18px;
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
}

.summary-label {
  grid-column: 1 / -1;
  color: #64748b;
  font-size: 12px;
  font-weight: 600;
}

.summary-value {
  min-width: 0;
  overflow-wrap: anywhere;
  color: #0f172a;
  font-size: 13px;
  font-weight: 650;
}

.summary-note {
  color: #64748b;
  font-size: 12px;
}

.guide-section {
  border: 1px solid #eef2f7;
}

.section-heading {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  margin-bottom: 18px;
}

.section-heading h3 {
  margin: 0;
  color: #0f172a;
  font-size: 18px;
}

.section-heading p {
  margin: 5px 0 0;
  color: #64748b;
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

.guide-tabs :deep(.el-tabs__header) {
  margin-bottom: 16px;
}

.instruction-list {
  display: grid;
  gap: 10px;
  margin: 0 0 16px;
  padding-left: 22px;
  color: #334155;
  line-height: 1.7;
}

.compact-list {
  margin-bottom: 0;
}

.inline-note,
.tab-intro {
  margin: 12px 0 0;
  color: #64748b;
  font-size: 13px;
  line-height: 1.7;
}

.tab-intro {
  margin: 14px 0 10px;
}

.tab-steps {
  margin: 12px 0 14px;
}

.protocol-matrix {
  margin: 0 0 18px;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  overflow: hidden;
}

.protocol-matrix-row {
  display: grid;
  grid-template-columns: minmax(180px, 0.95fr) minmax(160px, 0.85fr) minmax(0, 1.2fr);
  gap: 12px;
  padding: 11px 14px;
  border-bottom: 1px solid #e2e8f0;
  color: #334155;
  font-size: 13px;
  line-height: 1.55;
}

.protocol-matrix-row:last-child {
  border-bottom: none;
}

.protocol-matrix-head {
  background: #f8fafc;
  color: #64748b;
  font-weight: 650;
}

.protocol-matrix-row code {
  overflow-wrap: anywhere;
}

:deep(.snippet-block) {
  overflow: hidden;
  background: #0f172a;
  border: 1px solid #1e293b;
  border-radius: 10px;
}

:deep(.snippet-head) {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 38px;
  padding: 0 12px 0 16px;
  color: #94a3b8;
  background: #111c30;
  border-bottom: 1px solid #243146;
  font-size: 12px;
}

:deep(.snippet-head .el-button) {
  color: #93c5fd;
}

:deep(.snippet-block pre) {
  margin: 0;
  padding: 16px;
  overflow-x: auto;
  color: #e2e8f0;
  font-size: 12px;
  line-height: 1.65;
  white-space: pre;
}

:deep(.snippet-block pre code) {
  color: inherit;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}

.verify-strip {
  display: grid;
  grid-template-columns: minmax(200px, 1fr) minmax(220px, auto) auto;
  align-items: center;
  gap: 16px;
  margin-top: 18px;
  padding: 14px 16px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
}

.verify-strip p {
  margin: 3px 0 0;
  color: #64748b;
  font-size: 13px;
}

.verify-strip code {
  overflow-wrap: anywhere;
}

.two-column {
  display: grid;
  grid-template-columns: minmax(0, 1.3fr) minmax(280px, 0.7fr);
  gap: 24px;
}

.key-safety-card {
  padding: 16px;
  background: #fff7ed;
  border: 1px solid #fed7aa;
  border-radius: 10px;
}

.key-safety-card p {
  margin: 8px 0 14px;
  color: #9a3412;
  font-size: 13px;
  line-height: 1.7;
}

.client-tabs :deep(.el-alert) {
  margin-bottom: 12px;
}

.client-tabs :deep(.snippet-block + .snippet-block) {
  margin-top: 12px;
}

.cc-switch-flow {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 16px;
  color: #2563eb;
  font-size: 13px;
  font-weight: 650;
}

.cc-switch-flow span {
  padding: 8px 12px;
  color: #1e3a8a;
  background: #eff6ff;
  border: 1px solid #bfdbfe;
  border-radius: 8px;
}

.field-table {
  display: grid;
  margin-top: 16px;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  overflow: hidden;
}

.field-table > div {
  display: grid;
  grid-template-columns: minmax(170px, 0.35fr) minmax(0, 1fr);
  gap: 16px;
  padding: 11px 14px;
  border-bottom: 1px solid #e2e8f0;
}

.field-table > div:last-child {
  border-bottom: none;
}

.field-table span {
  color: #64748b;
}

.field-table code {
  overflow-wrap: anywhere;
}

.success-checks {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  margin-top: 16px;
}

.success-checks > div {
  display: flex;
  gap: 10px;
  padding: 14px;
  background: #f0fdf4;
  border: 1px solid #bbf7d0;
  border-radius: 10px;
}

.success-checks p {
  margin: 0;
  color: #166534;
  font-size: 13px;
}

.check-dot {
  color: #16a34a;
  font-weight: 800;
}

.troubleshooting-section {
  scroll-margin-top: 16px;
}

.troubleshooting-list {
  display: grid;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  overflow: hidden;
}

.troubleshooting-list article {
  display: grid;
  grid-template-columns: minmax(240px, 0.8fr) minmax(0, 1.2fr);
  gap: 24px;
  padding: 14px 16px;
  border-bottom: 1px solid #e2e8f0;
}

.troubleshooting-list article:last-child {
  border-bottom: none;
}

.troubleshooting-list strong {
  color: #0f172a;
}

.troubleshooting-list p {
  margin: 4px 0 0;
  color: #64748b;
  font-size: 13px;
  line-height: 1.65;
}

.troubleshooting-list .resolution {
  margin: 0;
  color: #334155;
}

.section-actions {
  justify-content: flex-end;
  margin-top: 16px;
}

.model-list-action {
  justify-content: flex-start;
  margin: 0 0 14px;
}

@media (max-width: 980px) {
  .summary-grid,
  .success-checks {
    grid-template-columns: 1fr;
  }

  .two-column {
    grid-template-columns: 1fr;
  }

  .verify-strip {
    grid-template-columns: 1fr;
    gap: 8px;
  }
}

@media (max-width: 720px) {
  .hero-card {
    flex-direction: column;
  }

  .hero-actions {
    width: 100%;
  }

  .hero-actions .el-button {
    flex: 1;
  }

  .cc-switch-flow {
    align-items: stretch;
    flex-direction: column;
  }

  .cc-switch-flow b {
    align-self: center;
    transform: rotate(90deg);
  }

  .field-table > div,
  .troubleshooting-list article,
  .protocol-matrix-row {
    grid-template-columns: 1fr;
    gap: 6px;
  }
}
</style>
