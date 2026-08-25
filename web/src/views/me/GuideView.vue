<template>
  <div class="guide-page">
    <section class="page-card hero-card">
      <div>
        <p class="eyebrow">员工接入</p>
        <h2 class="page-title">接入教程</h2>
        <p class="page-subtitle">
          <strong>KodaX Fabric</strong>（Token Hub 模块）使用公网受信任的 HTTPS。员工用内部 API Key 接入；
          <strong>Claude Code</strong> 与 <strong>Cursor</strong> 请各建一把协议匹配的 Key，不要混用。
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
      title="一种客户端，一把 Key"
      type="warning"
      :closable="false"
      show-icon
    >
      <template #default>
        Key 创建时绑定<strong>上游渠道 + 协议</strong>，创建后不可改协议。
        Claude Code 使用 <code>Anthropic Messages</code>；Cursor 使用 <code>OpenAI Chat Completions</code>。
        两台工具请创建两把 Key，名称可写「本机 Claude Code」「本机 Cursor」便于区分。
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
          <p>一把 Key 固定绑定一个上游渠道和一种协议，创建后不能修改协议。</p>
        </div>
      </div>

      <div class="two-column">
        <ol class="instruction-list compact-list">
          <li>进入“API Key”，选择需要使用的上游渠道。</li>
          <li>
            按客户端选协议：Claude Code → <strong>Anthropic Messages</strong>；
            Cursor → <strong>OpenAI Chat Completions</strong>。
          </li>
          <li>创建后立即复制完整 Key（<code>th_...</code>），保存到密码管理器或客户端；关闭后无法再查看明文。</li>
          <li>若同时使用 Claude Code 与 Cursor，请创建<strong>两把</strong> Key，不要共用一把。</li>
        </ol>
        <div class="key-safety-card">
          <strong>Key 安全</strong>
          <p>不要把完整 Key 放进截图、工单、聊天记录或代码仓库。怀疑泄漏时，请立即删除旧 Key 并重新创建。</p>
          <el-button type="primary" @click="router.push('/me/keys')">前往 API Key</el-button>
        </div>
      </div>
    </section>

    <section class="page-card guide-section">
      <div class="section-heading">
        <span class="step-index">3</span>
        <div>
          <h3>配置调用客户端</h3>
          <p>客户端协议必须与创建 Key 时选择的协议一致；示例中的 Key 是占位符 <code>th_...</code>。</p>
        </div>
      </div>

      <div class="protocol-matrix" aria-label="客户端与协议对照">
        <div class="protocol-matrix-row protocol-matrix-head">
          <span>客户端</span>
          <span>创建 Key 时选协议</span>
          <span>主要配置项</span>
        </div>
        <div class="protocol-matrix-row">
          <span>Claude Code</span>
          <code>Anthropic Messages</code>
          <span><code>ANTHROPIC_BASE_URL</code> + <code>ANTHROPIC_AUTH_TOKEN</code></span>
        </div>
        <div class="protocol-matrix-row">
          <span>Cursor</span>
          <code>OpenAI Chat Completions</code>
          <span>OpenAI Base URL + API Key（或环境变量）</span>
        </div>
        <div class="protocol-matrix-row">
          <span>其他 OpenAI 兼容工具</span>
          <code>OpenAI Chat Completions</code>
          <span><code>OPENAI_BASE_URL</code> + <code>OPENAI_API_KEY</code></span>
        </div>
      </div>

      <el-tabs v-model="clientTab" class="guide-tabs client-tabs">
        <el-tab-pane label="Claude Code" name="claude">
          <el-alert
            title="必须使用「Anthropic Messages」协议的员工 Key"
            type="info"
            :closable="false"
            show-icon
          />
          <ol class="instruction-list compact-list tab-steps">
            <li>在 API Key 页创建 Key：协议选 <strong>Anthropic Messages（Claude）</strong>。</li>
            <li>将下列字段<strong>合并</strong>进 <code>~/.claude/settings.json</code> 的 <code>env</code>，不要整文件覆盖。</li>
            <li>完全退出并重新打开 Claude Code，使环境变量生效。</li>
            <li>模型名使用下一步 <code>/ai/models</code> 返回的 ID（以渠道实际为准）。</li>
          </ol>
          <SnippetBlock
            :value="claudeSettingsSnippet"
            language="JSON"
            @copy="copyValue('Claude Code 配置', claudeSettingsSnippet)"
          />
          <p class="inline-note">
            鉴权也可用客户端支持的 <code>x-api-key</code>；与 Bearer 二选一即可，Key 值相同。
          </p>
        </el-tab-pane>

        <el-tab-pane label="Cursor" name="cursor">
          <el-alert
            title="必须使用「OpenAI Chat Completions」协议的员工 Key"
            type="info"
            :closable="false"
            show-icon
          />
          <ol class="instruction-list compact-list tab-steps">
            <li>在 API Key 页创建 Key：协议选 <strong>OpenAI 对话（Chat Completions）</strong>。</li>
            <li>打开 Cursor Settings → Models（或 OpenAI 兼容相关设置）。</li>
            <li>
              Override OpenAI Base URL 填 <code>{{ clientBaseUrl }}</code>
              （不要加端口号，不要漏协议）。
            </li>
            <li>OpenAI API Key 填员工 Key（<code>th_...</code>）。</li>
            <li>模型选择与 <code>/ai/models</code> 返回一致；保存后新开对话验证。</li>
          </ol>
          <div class="field-table">
            <div><span>OpenAI Base URL</span><code>{{ clientBaseUrl }}</code></div>
            <div><span>API Key</span><code>&lt;你的 KodaX Fabric API Key&gt;</code></div>
            <div><span>Key 协议</span><code>openai_chat / OpenAI Chat Completions</code></div>
          </div>
          <p class="tab-intro">也可用环境变量（适用于支持 OpenAI 环境变量的启动方式）：</p>
          <SnippetBlock
            :value="openAiSettingsSnippet"
            language="Shell"
            @copy="copyValue('Cursor / OpenAI 环境变量', openAiSettingsSnippet)"
          />
        </el-tab-pane>

        <el-tab-pane label="其他 OpenAI 兼容" name="openai">
          <el-alert
            title="仅使用 OpenAI Chat Completions 协议的员工 Key"
            type="info"
            :closable="false"
            show-icon
          />
          <p class="tab-intro">
            任意支持自定义 OpenAI Base URL 的 SDK / CLI 均可；客户端会自动请求
            <code>/chat/completions</code>。请单独建一把 <code>openai_chat</code> Key。
          </p>
          <SnippetBlock
            :value="openAiSettingsSnippet"
            language="Shell"
            @copy="copyValue('OpenAI 客户端配置', openAiSettingsSnippet)"
          />
        </el-tab-pane>

        <el-tab-pane label="CC Switch" name="cc-switch">
          <div class="cc-switch-flow" aria-label="CC Switch 请求链路">
            <span>Claude Code</span><b>→</b><span>CC Switch 本地代理</span><b>→</b><span>KodaX Fabric</span>
          </div>
          <ol class="instruction-list">
            <li>员工 Key 协议与 CC Switch 里配置的 API 格式必须一致（Claude 场景用 Anthropic Messages）。</li>
            <li>上游 Base URL 填写 <code>{{ clientBaseUrl }}</code>，API Key 填写自己的 <code>th_...</code> Key。</li>
            <li>
              若启用本地代理，Claude Code 可指向 <code>http://127.0.0.1:15721</code>；
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
          <p>先查询当前 Key 真实可用的模型，再把返回的模型 ID 填入客户端。</p>
        </div>
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
          <p>先按错误类型检查；仍无法解决时，到“我的调用”复制 Request ID 后提交工单。</p>
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
        <el-button @click="router.push('/me/logs')">查看我的调用</el-button>
        <el-button type="primary" @click="router.push('/me/tickets')">提交工单</el-button>
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
import { RELAY_BASE_PATH, relayClientBaseUrl } from "@/views/relay-protocol";

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
const clientTab = ref("claude");
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

const modelListCommand = computed(() => `curl -sS "${clientBaseUrl.value}/models" \\
  -H "Authorization: Bearer <你的 KodaX Fabric API Key>"`);

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
    resolution: "核对 Key，Anthropic 可用 x-api-key 或 Bearer，OpenAI 使用 Bearer；必要时创建新 Key。",
  },
  {
    title: "能查询模型，但生成失败",
    cause: "客户端模型 ID、Key 协议或所选渠道不匹配，也可能是当前上游暂时不可用。",
    resolution: "使用 /ai/models 返回的模型 ID，确认协议一致，并在“我的调用”中查看具体错误。",
  },
  {
    title: "Claude Code 正常但 Cursor 401 / 模型列表空（或相反）",
    cause: "两套客户端共用了一把错误协议的 Key，或 Base URL / 鉴权字段不一致。",
    resolution: "Claude Code 与 Cursor 各建一把 Key（Messages vs Chat Completions）；Cursor 使用 Bearer + OpenAI Base URL。",
  },
  {
    title: "CC Switch 持续 API error / Retrying",
    cause: "CC Switch 的上游配置没有重新加载，或把本地代理地址误填成了上游地址。",
    resolution: `重启 CC Switch；确认其上游地址是 ${clientBaseUrl.value}，而不是 127.0.0.1:15721。`,
  },
  {
    title: "403 team_required / team_quota_not_assigned",
    cause: "API Key 未绑定团队，或该团队尚未分配每日额度。",
    resolution: "确认 Key 已绑定团队；若团队额度为 0，请联系企业管理员分配额度。",
  },
  {
    title: "429 team_quota_exceeded / member_limit_exceeded",
    cause: "团队当日额度或你的个人每日上限已用尽。",
    resolution: "等待次日重置，或联系团队 / 企业管理员调整额度。",
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
  grid-template-columns: minmax(120px, 0.7fr) minmax(160px, 1fr) minmax(0, 1.4fr);
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
