<template>
  <div class="guide-page">
    <section class="page-card pin-card" aria-label="接入必看">
      <div class="pin-item">
        <span class="pin-label">Base URL</span>
        <p class="pin-copy">所有客户端都填这个地址。只要站点根，不要加端口，也不要再拼 <code>/ai</code>、<code>/v1/messages</code> 或 <code>/chat/completions</code>。</p>
        <div class="pin-row">
          <code class="pin-value">{{ clientBaseUrl }}</code>
          <el-button type="primary" @click="copyValue('Base URL', clientBaseUrl)">复制 Base URL</el-button>
        </div>
      </div>
      <div class="pin-item">
        <span class="pin-label">遇到问题？咨询 Token Bot</span>
        <p class="pin-copy">
          点页面<strong>右下角 Token Bot</strong>。它可以看你的 Key 前缀和调用记录，也能帮你加入部门。
        </p>
      </div>
      <div v-if="!loaded || !inTeam" class="pin-item">
        <span class="pin-label">尚未加入部门</span>
        <p class="pin-copy">
          先加入部门才有 API Key。打开右下角 Token Bot，说出所属部门（有同名时再补企业名）。
        </p>
      </div>
    </section>

    <section class="page-card step-card">
      <div class="step-heading">
        <span class="step-index">1</span>
        <div>
          <h3>加入部门</h3>
          <p>注册后只是普通用户。加入部门后才有员工权限，系统会按部门自动生成 API Key。</p>
        </div>
      </div>

      <el-alert
        v-if="loaded && inTeam"
        class="status-alert"
        title="第一步已完成：你已加入部门"
        type="success"
        show-icon
        :closable="false"
      >
        <p v-if="teamNames">当前部门：{{ teamNames }}</p>
        <p>下一步到「API Key」复制 Base URL 和 Key。</p>
      </el-alert>
      <el-alert
        v-else-if="loaded"
        class="status-alert"
        title="你尚未加入部门。请先完成本步，再复制 API Key 或配置客户端。"
        type="warning"
        show-icon
        :closable="false"
      />

      <ol class="steps">
        <li>用手机号注册并登录。</li>
        <li>
          打开右下角 Token Bot，说出部门名（有同名时再补企业名）。
          部门名在钉钉个人资料的「部门」一栏。
        </li>
        <li>加入成功后刷新页面。</li>
      </ol>

      <p class="lead">对照下面两张图加入部门。</p>
      <div class="guide-shots" aria-label="Token Bot 加入部门截图">
        <figure>
          <img :src="dingtalkDepartmentSrc" alt="钉钉个人资料中的部门一栏" />
          <figcaption>钉钉个人资料里，「部门」这一栏就是部门名。有同名时再补「企业/组织」。</figcaption>
        </figure>
        <figure>
          <img :src="tokenBotJoinDepartmentSrc" alt="Token Bot 对话中说出部门名并加入成功" />
          <figcaption>打开右下角 Token Bot，直接说出部门名。加入成功后刷新页面，再到「API Key」复制。</figcaption>
        </figure>
      </div>

      <ul class="notes">
        <li>工作台仍提示「普通注册用户」，表示还没加入部门。</li>
        <li>部门管理员也可以用你的注册手机号邀请进部门。</li>
      </ul>
    </section>

    <section class="page-card step-card">
      <div class="step-heading">
        <span class="step-index">2</span>
        <div>
          <h3>复制 Base URL 和 API Key</h3>
          <p>打开「API Key」页。每个部门会自动生成一把通用 Key，三种协议都能用。需要多把时，点「新增 Key」，填写名称；多个部门时再选部门，只有一个部门则固定。</p>
        </div>
      </div>

      <el-alert
        v-if="loaded && !inTeam"
        class="status-alert"
        title="尚未加入部门时没有 API Key。请先完成第一步。"
        type="warning"
        show-icon
        :closable="false"
      />

      <div class="phone-card">
        <span class="phone-label">Base URL（复制后填入客户端）</span>
        <code class="phone-value">{{ clientBaseUrl }}</code>
        <el-button type="primary" @click="copyValue('Base URL', clientBaseUrl)">复制 Base URL</el-button>
      </div>

      <ol class="steps">
        <li>打开「API Key」页，复制上方 Base URL。</li>
        <li>默认隐藏明文。打开「显示 Key」后复制 <code>th_</code> 开头的完整 Key；复制按钮在隐藏时也可以用。</li>
        <li>以前按协议生成的多把 Key 仍然有效，任意一把都能用。</li>
      </ol>

      <div class="script-card">
        <strong>注意</strong>
        <p>
          API Key 记在部门上，用来记账。同一把 Key 可以同时填进 Claude Code、Cursor、Codex。
          不要把完整 Key 发到聊天或截图里。怀疑泄漏时，在「API Key」页更新或删除后新增。
        </p>
      </div>

      <div class="step-actions">
        <el-button type="primary" :disabled="loaded && !inTeam" @click="router.push(keysPath)">
          前往 API Key
        </el-button>
      </div>
    </section>

    <section class="page-card step-card">
      <div class="step-heading">
        <span class="step-index">3</span>
        <div>
          <h3>确认客户端走哪条 API 协议</h3>
          <p>Key 不绑定协议。客户端拿 Base URL 自己去拼路径。对照下表即可，不要把路径写进 Base URL。</p>
        </div>
      </div>

      <div class="protocol-table" aria-label="产品与协议对照">
        <div class="protocol-row protocol-head">
          <span>所用产品</span>
          <span>API协议</span>
        </div>
        <div class="protocol-row">
          <span>Claude Code</span>
          <strong>Messages API（<code>/v1/messages</code>）</strong>
        </div>
        <div class="protocol-row">
          <span>Cursor、ZCode、WorkBuddy、KodaX / KodaX Space</span>
          <strong>Chat Completions API（<code>/v1/chat/completions</code>）</strong>
        </div>
        <div class="protocol-row">
          <span>Codex（自定义模型）</span>
          <strong>Responses API（<code>/v1/responses</code>）</strong>
        </div>
        <div class="protocol-row">
          <span>CC Switch</span>
          <span>按其 API 格式：Anthropic 走 Messages API，OpenAI Chat 走 Chat Completions API</span>
        </div>
      </div>

      <ul class="notes">
        <li>不确定时看客户端要填 Anthropic 还是 OpenAI。Claude Code 走 Messages；Cursor / WorkBuddy / ZCode / KodaX 走 Chat Completions；Codex 走 Responses。</li>
        <li>旧地址 <code>/ai</code> 仍然可用。新配置请用站点根。</li>
      </ul>
    </section>

    <section class="page-card step-card">
      <div class="step-heading">
        <span class="step-index">4</span>
        <div>
          <h3>配置客户端</h3>
          <p>Base URL 填 <code>{{ clientBaseUrl }}</code>。API Key 填第二步复制的 <code>th_</code> 字符串。模型到下一步再复制。</p>
        </div>
      </div>

      <div class="protocol-table" aria-label="客户端填写对照">
        <div class="protocol-row protocol-head">
          <span>产品</span>
          <span>填写说明</span>
        </div>
        <div class="protocol-row">
          <span>Claude Code</span>
          <span>
            把下方 JSON <strong>合并</strong>到 <code>~/.claude/settings.json</code> 的 <code>env</code>，保留其余配置。改完后完全退出再打开。
          </span>
        </div>
        <div class="protocol-row">
          <span>Cursor</span>
          <span>自定义模型 / OpenAI 兼容：Base URL 填上方地址，API Key 填部门 Key。</span>
        </div>
        <div class="protocol-row">
          <span>ZCode</span>
          <span>
            添加自定义供应商，Base URL 填上方地址，API 格式选 Chat Completions。
            添加 <code>glm/glm-5.3-flash</code>（或别称 <code>glm-5.3-flash</code>）时必须勾选输入类型「图片」。
          </span>
        </div>
        <div class="protocol-row">
          <span>WorkBuddy</span>
          <span>
            设置 → 模型 → 添加模型。供应商选「自定义」，接口地址填上方地址，不要再拼
            <code>/chat/completions</code>。模型建议 <code>glm/glm-5.3-flash</code>，必须勾选「图片输入」，测试连接成功后再保存。
          </span>
        </div>
        <div class="protocol-row">
          <span>KodaX、KodaX Space</span>
          <span>按 OpenAI Chat Completions 配置：Base URL 填上方地址，API Key 填部门 Key。</span>
        </div>
        <div class="protocol-row">
          <span>Codex（自定义模型）</span>
          <span>
            在 <code>~/.codex/config.toml</code> 里把自定义 provider 的 <code>base_url</code> 设为上方地址，并设置
            <code>wire_api = "responses"</code>。Codex 会自行请求 <code>/responses</code>。
          </span>
        </div>
        <div class="protocol-row">
          <span>CC Switch</span>
          <span>
            <strong>上游</strong> Base URL 填上方地址，API Key 填部门 Key。
            不要把本地代理 <code>127.0.0.1:15721</code> 当成上游，否则会循环。
          </span>
        </div>
      </div>

      <p class="lead">ZCode 添加供应商和模型时对照下面两张图。识图必须勾「图片」。</p>
      <div class="guide-shots" aria-label="ZCode 配置截图">
        <figure>
          <img :src="zcodeAddProviderSrc" alt="ZCode 添加 TokenHub 自定义供应商" />
          <figcaption>供应商名称可填 TokenHub，Base URL 填站点根，API 格式选 Chat Completions。</figcaption>
        </figure>
        <figure>
          <img :src="zcodeAddModelSrc" alt="ZCode 添加 glm-5.3-flash 并勾选图片" />
          <figcaption>
            模型填 <code>glm/glm-5.3-flash</code>（或别称 <code>glm-5.3-flash</code>），输入类型必须勾选「图片」。
          </figcaption>
        </figure>
      </div>

      <p class="lead">WorkBuddy 添加自定义模型时对照下图，必须勾选「图片输入」。</p>
      <div class="guide-shots" aria-label="WorkBuddy 配置截图">
        <figure>
          <img :src="workbuddyAddModelSrc" alt="WorkBuddy 添加自定义模型并勾选图片输入" />
          <figcaption>
            供应商选「自定义」，接口地址填 Base URL，模型建议
            <code>glm/glm-5.3-flash</code>，勾选「图片输入」，测试连接成功后再保存。
          </figcaption>
        </figure>
      </div>

      <p class="lead">Claude Code 可直接复制以下配置，把 Key 换成你的 <code>th_</code> Key：</p>
      <pre class="snippet"><code>{{ claudeSettingsSnippet }}</code></pre>
      <div class="step-actions">
        <el-button @click="copyValue('Claude Code 配置', claudeSettingsSnippet)">复制 Claude Code 配置</el-button>
      </div>

      <p class="lead">Codex 自定义 provider 可参考：</p>
      <pre class="snippet"><code>{{ codexSnippet }}</code></pre>
      <div class="step-actions">
        <el-button @click="copyValue('Codex 配置', codexSnippet)">复制 Codex 配置</el-button>
      </div>

      <ul class="notes">
        <li>地址里如果出现 <code>:3000</code> / <code>:3100</code>，那是内部端口，员工电脑访问不到，删掉。</li>
        <li>改完配置后完全退出客户端再打开。</li>
      </ul>
    </section>

    <section class="page-card step-card">
      <div class="step-heading">
        <span class="step-index">5</span>
        <div>
          <h3>复制模型并完成首次调用</h3>
          <p>到「模型列表」复制模型名称（推荐正式名），在客户端发一条短消息，再到「我的调用」确认是否有记录。</p>
        </div>
      </div>

      <ol class="steps">
        <li>
          打开「模型列表」，复制「模型名称」。智谱常用：
          <code>glm/glm-5.3</code>（文本，别称 <code>glm-5.3</code>）、
          <code>glm/glm-5.3-flash</code>（文本 / 图片 / 视频 / 文件，别称 <code>glm-5.3-flash</code>）。识图用 Flash。
        </li>
        <li>在客户端发送「ping」或「你好」。</li>
        <li>打开「我的调用」。成功时有 Request ID、模型和 Tokens；失败时复制 Request ID 发给 Token Bot。</li>
      </ol>

      <div class="script-card">
        <strong>成功标准</strong>
        <p>客户端出现回复，且「我的调用」能看到对应记录。若客户端一直等待且调用页没有记录，回到第二至第四步核对 Base URL、API Key 和模型名。</p>
      </div>

      <ul class="notes">
        <li>不要手打旧模型名，例如 glm-4.x，智谱渠道会拒绝。</li>
        <li>不要用 <code>glm-5.3-flashx</code>，Coding Plan 尚未开放。</li>
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

const CLIENT_BASE_URL = "https://tokenhub.haizhi.com";

const route = useRoute();
const router = useRouter();
const isAdminGuide = computed(() => route.path.startsWith("/admin"));
const keysPath = computed(() => (isAdminGuide.value ? "/admin/keys" : "/me/keys"));
const modelsPath = computed(() => (isAdminGuide.value ? "/admin/models" : "/me/models"));
const logsPath = computed(() => (isAdminGuide.value ? "/admin/my-logs" : "/me/logs"));
const loaded = ref(false);
const inTeam = ref(false);
const teams = ref<Array<{ id: number; name: string }>>([]);

const teamNames = computed(() => teams.value.map((team) => team.name).filter(Boolean).join("、"));
const clientBaseUrl = CLIENT_BASE_URL;
const dingtalkDepartmentSrc = "/guides/dingtalk-department.png";
const tokenBotJoinDepartmentSrc = "/guides/token-bot-join-department.png";
const zcodeAddProviderSrc = "/guides/zcode-add-provider.png";
const zcodeAddModelSrc = "/guides/zcode-add-model.png";
const workbuddyAddModelSrc = "/guides/workbuddy-add-model.png";
const claudeSettingsSnippet = JSON.stringify(
  {
    env: {
      ANTHROPIC_BASE_URL: CLIENT_BASE_URL,
      ANTHROPIC_AUTH_TOKEN: "<你的 API Key>",
    },
  },
  null,
  2,
);
const codexSnippet = `model_provider = "tokenhub"
model = "<模型列表里复制的模型 ID>"

[model_providers.tokenhub]
name = "Token Hub"
base_url = "${CLIENT_BASE_URL}"
env_key = "OPENAI_API_KEY"
wire_api = "responses"`;

async function loadGuideContext() {
  try {
    const org = await http.get("/api/me/org");
    if (org.data.success) {
      teams.value = org.data.data.teams ?? [];
      inTeam.value = teams.value.length > 0;
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

.guide-shots {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin: 0 0 16px;
  align-items: start;
}

.guide-shots figure {
  display: flex;
  flex-direction: column;
  min-width: 0;
  margin: 0;
  padding: 10px;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  background: #f8fafc;
}

.guide-shots img {
  display: block;
  width: 100%;
  max-height: 416px;
  height: auto;
  object-fit: contain;
  object-position: top center;
  border-radius: 8px;
  background: #fff;
}

.guide-shots figcaption {
  margin-top: 8px;
  color: #64748b;
  font-size: 13px;
  line-height: 1.6;
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
  .protocol-row,
  .guide-shots {
    grid-template-columns: 1fr;
  }
}
</style>
