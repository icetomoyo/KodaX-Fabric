<template>
  <div class="guide-page">
    <section class="page-card hero-card">
      <div>
        <p class="eyebrow">员工接入</p>
        <h2 class="page-title">接入教程</h2>
        <p class="page-subtitle">
          首次使用需要完成一次证书信任，之后客户端只需配置 Base URL 和自己的 TokenHub API Key。
        </p>
      </div>
      <div class="hero-actions">
        <el-button type="primary" @click="router.push('/me/keys')">创建 API Key</el-button>
        <el-button @click="scrollToTroubleshooting">查看排障</el-button>
      </div>
    </section>

    <el-alert
      class="security-alert"
      title="内网 HTTPS 提示"
      type="warning"
      :closable="false"
      show-icon
    >
      <template #default>
        当前使用公司内网 IP 和私有 CA。每台电脑只需安装一次
        <code>caddy-root-ca.crt</code>；不要关闭 TLS 校验，也不要使用
        <code>NODE_TLS_REJECT_UNAUTHORIZED=0</code> 或 <code>curl -k</code> 绕过证书检查。
      </template>
    </el-alert>

    <section class="summary-grid" aria-label="接入信息">
      <article class="summary-card">
        <span class="summary-label">Base URL</span>
        <code class="summary-value">{{ clientBaseUrl }}</code>
        <el-button link type="primary" @click="copyValue('Base URL', clientBaseUrl)">复制</el-button>
      </article>
      <article class="summary-card">
        <span class="summary-label">根证书文件</span>
        <code class="summary-value">caddy-root-ca.crt</code>
        <el-button
          link
          type="primary"
          tag="a"
          href="/caddy-root-ca.crt"
          download="caddy-root-ca.crt"
        >
          下载证书
        </el-button>
      </article>
      <article class="summary-card fingerprint-card">
        <span class="summary-label">证书 SHA-256 指纹</span>
        <code class="summary-value fingerprint">{{ caFingerprint }}</code>
        <el-button link type="primary" @click="copyValue('证书指纹', caFingerprint)">复制</el-button>
      </article>
    </section>

    <section class="page-card guide-section">
      <div class="section-heading">
        <span class="step-index">1</span>
        <div>
          <h3>安装并信任内网根证书</h3>
          <p>这是每台电脑的一次性操作。只安装公开的 <code>.crt</code> 文件，不要接收或安装任何 CA 私钥。</p>
        </div>
      </div>

      <el-tabs v-model="osTab" class="guide-tabs">
        <el-tab-pane label="macOS" name="macos">
          <ol class="instruction-list">
            <li>点击页面上方“下载证书”，保存 <code>caddy-root-ca.crt</code>，并核对 SHA-256 指纹。</li>
            <li>
              双击证书导入“钥匙串访问”，选择“登录”钥匙串；打开证书详情，在“信任”中将 SSL 设置为“始终信任”。
            </li>
            <li>也可以在终端执行下面的命令，路径按实际下载位置修改。</li>
          </ol>
          <SnippetBlock
            :value="macInstallCommand"
            language="Shell"
            @copy="copyValue('macOS 安装命令', macInstallCommand)"
          />
          <p class="inline-note">
            安装后必须完全退出并重新打开 CC Switch、Claude Code 和其他调用客户端，让它们重新加载系统信任库。
          </p>
        </el-tab-pane>

        <el-tab-pane label="Windows" name="windows">
          <ol class="instruction-list">
            <li>点击页面上方“下载证书”，保存 <code>caddy-root-ca.crt</code>，并核对 SHA-256 指纹。</li>
            <li>
              双击证书，选择“安装证书” → “当前用户” → “将所有证书放入下列存储” →
              “受信任的根证书颁发机构”。
            </li>
            <li>也可以在 PowerShell 中执行下面的命令。</li>
          </ol>
          <SnippetBlock
            :value="windowsInstallCommand"
            language="PowerShell"
            @copy="copyValue('Windows 安装命令', windowsInstallCommand)"
          />
          <p class="inline-note">
            安装后必须完全退出并重新打开 CC Switch、Claude Code 和其他调用客户端。
          </p>
        </el-tab-pane>
      </el-tabs>

      <div class="verify-strip">
        <div>
          <strong>先验证 HTTPS</strong>
          <p>浏览器打开健康检查地址，不应再出现红色“不安全”提示。</p>
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
          <li>根据客户端选择“Anthropic Messages”或“OpenAI Chat Completions”。</li>
          <li>创建后立即复制完整 Key，并保存到密码管理器或客户端配置。</li>
          <li>关闭创建窗口后，员工和管理员都无法再次查看 Key 明文。</li>
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
          <p>客户端协议必须与创建 Key 时选择的协议一致；示例中的 Key 是占位符。</p>
        </div>
      </div>

      <el-tabs v-model="clientTab" class="guide-tabs client-tabs">
        <el-tab-pane label="Claude Code" name="claude">
          <el-alert
            title="Claude Code 需要使用 Anthropic Messages 协议的员工 Key"
            type="info"
            :closable="false"
            show-icon
          />
          <p class="tab-intro">
            将下面字段合并到 <code>~/.claude/settings.json</code> 的 <code>env</code> 中；不要覆盖文件里已有的其他配置。
          </p>
          <SnippetBlock
            :value="claudeSettingsSnippet"
            language="JSON"
            @copy="copyValue('Claude Code 配置', claudeSettingsSnippet)"
          />
          <p class="inline-note">
            如果使用 Node.js 运行版 Claude Code，且系统证书已经安装但仍提示 TLS 错误，再加入
            <code>NODE_EXTRA_CA_CERTS=/证书的绝对路径/caddy-root-ca.crt</code>。配置后重新启动 Claude Code。
          </p>
        </el-tab-pane>

        <el-tab-pane label="CC Switch" name="cc-switch">
          <div class="cc-switch-flow" aria-label="CC Switch 请求链路">
            <span>Claude Code</span><b>→</b><span>CC Switch 本地代理</span><b>→</b><span>TokenHub</span>
          </div>
          <ol class="instruction-list">
            <li>先完成根证书安装，再完全退出并重新打开 CC Switch。</li>
            <li>在 CC Switch 中新增或编辑供应商，API 格式选择与员工 Key 完全一致的协议。</li>
            <li>上游 Base URL 填写 <code>{{ clientBaseUrl }}</code>，API Key 填写员工自己的 <code>th_...</code> Key。</li>
            <li>
              如果启用本地代理，Claude Code 的地址可以是 <code>http://127.0.0.1:15721</code>；但 CC Switch
              的上游地址必须保持为 TokenHub，不能也填成本地地址，否则会形成循环代理。
            </li>
          </ol>
          <div class="field-table">
            <div><span>CC Switch 上游 Base URL</span><code>{{ clientBaseUrl }}</code></div>
            <div><span>API Key</span><code>&lt;你的 TokenHub API Key&gt;</code></div>
            <div><span>API 格式</span><code>与创建 Key 时选择的协议一致</code></div>
          </div>
        </el-tab-pane>

        <el-tab-pane label="OpenAI 兼容客户端" name="openai">
          <el-alert
            title="仅使用 OpenAI Chat Completions 协议的员工 Key"
            type="info"
            :closable="false"
            show-icon
          />
          <p class="tab-intro">支持自定义 OpenAI Base URL 的客户端可使用以下环境变量；客户端会自动追加调用路径。</p>
          <SnippetBlock
            :value="openAiSettingsSnippet"
            language="Shell"
            @copy="copyValue('OpenAI 客户端配置', openAiSettingsSnippet)"
          />
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
const osTab = ref("macos");
const clientTab = ref("claude");
const relayUrl = ref("");

const caFingerprint = "FE:DC:BF:30:A0:4A:25:7E:83:12:C1:42:8D:50:75:8C:83:D2:6B:E3:4A:87:05:6A:A4:6E:5F:F2:24:3D:BE:0D";

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

const macInstallCommand = `security add-trusted-cert \\
  -r trustRoot \\
  -p ssl \\
  -k "$HOME/Library/Keychains/login.keychain-db" \\
  "$HOME/Downloads/caddy-root-ca.crt"`;

const windowsInstallCommand = "certutil -user -addstore -f Root \"$env:USERPROFILE\\Downloads\\caddy-root-ca.crt\"";

const claudeSettingsSnippet = computed(() => JSON.stringify({
  env: {
    ANTHROPIC_BASE_URL: clientBaseUrl.value,
    ANTHROPIC_AUTH_TOKEN: "<你的 TokenHub API Key>",
  },
}, null, 2));

const openAiSettingsSnippet = computed(() => [
  `export OPENAI_BASE_URL="${clientBaseUrl.value}"`,
  'export OPENAI_API_KEY="<你的 TokenHub API Key>"',
].join("\n"));

const modelListCommand = computed(() => `curl -sS "${clientBaseUrl.value}/models" \\
  -H "Authorization: Bearer <你的 TokenHub API Key>"`);

const troubleshootingItems = computed(() => [
  {
    title: "Connection failed / TLS / 证书错误",
    cause: "请求没有到达 TokenHub，通常是根证书未安装，或客户端仍在使用安装证书前加载的信任库。",
    resolution: "重新安装并核对根证书，随后完全退出并重启 CC Switch、Claude Code 或对应客户端。",
  },
  {
    title: "地址中出现 :3100",
    cause: "3100 是 TokenHub 容器内部端口，员工电脑无法直接访问。",
    resolution: `Base URL 必须使用 ${clientBaseUrl.value}，不要添加 :3100。`,
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
    title: "CC Switch 持续 API error / Retrying",
    cause: "CC Switch 没有重新加载证书，或把本地代理地址误填成了上游地址。",
    resolution: `重启 CC Switch；确认其上游地址是 ${clientBaseUrl.value}，而不是 127.0.0.1:15721。`,
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
  grid-template-columns: minmax(0, 1.1fr) minmax(220px, 0.7fr) minmax(0, 1.5fr);
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

.fingerprint {
  font-size: 11px;
  line-height: 1.55;
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
  .troubleshooting-list article {
    grid-template-columns: 1fr;
    gap: 6px;
  }
}
</style>
