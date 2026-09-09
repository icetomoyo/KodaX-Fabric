<template>
  <div class="guide-page">
    <section class="page-card pin-card" aria-label="接入必看">
      <div class="pin-item">
        <span class="pin-label">Base URL</span>
        <p class="pin-copy">所有客户端都填这一条，不要加端口，也不要再拼路径。</p>
        <div class="pin-row">
          <code class="pin-value">{{ clientBaseUrl }}</code>
          <el-button type="primary" @click="copyValue('Base URL', clientBaseUrl)">复制 Base URL</el-button>
        </div>
      </div>
      <div class="pin-item">
        <span class="pin-label">不懂就问 Token Hub</span>
        <p class="pin-copy">
          协议、Key、客户端配不好，点页面<strong>右下角 Token Bot</strong> 问。
          它能看你自己的 Key 和调用，比自己猜快。
        </p>
      </div>
      <div v-if="!loaded || !inTeam" class="pin-item">
        <span class="pin-label">还没进团队，也可以问该找谁</span>
        <p class="pin-copy">
          点右下角 Token Bot，先告诉它你是哪个企业、哪个团队（或部门），再问「我该找谁把我加进团队」。
          没说清团队，它没法帮你对上该找的人。
        </p>
      </div>
    </section>

    <section class="page-card step-card">
      <div class="step-heading">
        <span class="step-index">1</span>
        <div>
          <h3>找领导，把你请进团队</h3>
          <p>刚注册完还不能调用。你现在是普通注册用户，不是员工；没进团队就没有 API Key。</p>
        </div>
      </div>

      <el-alert
        v-if="loaded && inTeam"
        class="status-alert"
        title="第一步已完成：你已经在团队里"
        type="success"
        show-icon
        :closable="false"
      >
        <p v-if="teamNames">当前团队：{{ teamNames }}</p>
        <p>下一步先看你会用哪个产品，建 Key 时选对应协议。</p>
      </el-alert>
      <el-alert
        v-else-if="loaded"
        class="status-alert"
        title="你还没进团队。先做下面这件事，不要去建 Key、也不要先配客户端。"
        type="warning"
        show-icon
        :closable="false"
      />

      <ol class="steps">
        <li>用手机号注册并登录，就是现在这个账号。</li>
        <li>
          把注册手机号发给能管编制的人，请他把你加进团队。
          通常是你的组长、部门负责人，或企业里管账号的人
          （产品里叫团队管理员、部门管理员、企业管理员）。
        </li>
        <li>对方只能邀请<strong>已经注册好的手机号</strong>，不能替你开号。</li>
      </ol>

      <div class="phone-card">
        <span class="phone-label">发给领导的手机号</span>
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
        <strong>可以直接这样说</strong>
        <p>「我已经在 Token Hub 注册了，手机号是 {{ phone || "（你的注册手机号）" }}，请把我加进团队。」</p>
      </div>

      <ul class="notes">
        <li>工作台还在提示「普通注册用户」，说明第一步没完成。</li>
        <li>「API Key」页的「创建 Key」是灰的，也是因为还没进团队。</li>
        <li>领导侧找不到你：先确认对方用的是上面这个手机号，而且你已经注册成功。</li>
      </ul>
    </section>

    <section class="page-card step-card">
      <div class="step-heading">
        <span class="step-index">2</span>
        <div>
          <h3>先搞清三种协议，再用什么产品选什么协议</h3>
          <p>
            创建 Key 时要选协议，选错了这把 Key 就废了：创建后不能改，路径对不上会 404，或能列模型但调不了。
            一种产品用一把对应协议的 Key，不要混用。
          </p>
        </div>
      </div>

      <p class="lead">看你电脑上实际在用的软件，对照下面这张表。建 Key 时「协议」三个选项的名字就是表里这一列。</p>

      <div class="protocol-table" aria-label="产品与协议对照">
        <div class="protocol-row protocol-head">
          <span>你用的产品</span>
          <span>建 Key 时选</span>
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
          <span>看你在 CC Switch 里配的 API 格式：Anthropic 就选 <strong>Anthropic Message 协议</strong>，OpenAI Chat 就选 <strong>OpenAI Chat Completion 协议</strong></span>
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
        <li>不确定就先看客户端要填的是 Anthropic 还是 OpenAI。公司产品 KodaX / KodaX Space 选 Chat Completion；常见外部工具是 Claude Code、Cursor 或 Codex。</li>
        <li>Chat Completion 的 Key 不能打 Responses，Responses 的 Key 也不能打 Chat Completions。</li>
        <li>Codex 自定义模型默认走 Responses，不要选 Chat Completion。</li>
        <li>Claude Code、Cursor、Codex 要一起用：各建一把对应协议的 Key，不要共用。</li>
        <li>渠道不支持你选的协议时，创建页不会出现该选项；换一个渠道，或换符合该渠道的协议。</li>
      </ul>
    </section>

    <section class="page-card step-card">
      <div class="step-heading">
        <span class="step-index">3</span>
        <div>
          <h3>创建 API Key</h3>
          <p>进团队之后，到「API Key」页按你要用的产品建 Key。协议按上一步对照表选，选完不能改。</p>
        </div>
      </div>

      <el-alert
        v-if="loaded && !inTeam"
        class="status-alert"
        title="还没进团队，「创建 Key」是灰的。先完成第一步。"
        type="warning"
        show-icon
        :closable="false"
      />

      <ol class="steps">
        <li>打开「API Key」，点「创建 Key」。</li>
        <li>名称随便起，建议写成产品名，例如 <code>Cursor</code>、<code>Claude Code</code>、<code>KodaX</code>。</li>
        <li>选上游渠道（没有可选的，找管理员先配渠道）。</li>
        <li>选协议：必须和上一步表格一致。Claude Code 选 Anthropic Message，Cursor / KodaX / KodaX Space 选 OpenAI Chat Completion，Codex 选 OpenAI Response。</li>
        <li>创建成功后立刻复制完整 Key（<code>th_</code> 开头）。关掉窗口就再也看不到明文。</li>
      </ol>

      <div class="script-card">
        <strong>这一步最容易栽的坑</strong>
        <p>Key 只显示一次。没复制就关掉，只能删除再建。怀疑泄漏了也是删掉再建，不要把完整 Key 发到聊天或截图里。</p>
      </div>

      <ul class="notes">
        <li>一把 Key 绑死渠道 + 协议，创建后不能改。换协议或换产品就另建一把。</li>
        <li>Claude Code、Cursor、Codex 不要共用一把 Key。</li>
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
          <h3>配客户端，Base URL 只填这一个</h3>
          <p>所有产品的 Base URL 都是当前站点的 <code>/ai</code>。不要加 <code>:3000</code> 或 <code>:3100</code>，也不要在地址后面再拼 <code>/v1/messages</code>、<code>/chat/completions</code>。</p>
        </div>
      </div>

      <div class="phone-card">
        <span class="phone-label">Base URL（复制后填进客户端）</span>
        <code class="phone-value">{{ clientBaseUrl }}</code>
        <el-button type="primary" @click="copyValue('Base URL', clientBaseUrl)">复制 Base URL</el-button>
      </div>

      <p class="lead">API Key 填第三步复制的 <code>th_</code> 开头那串。各产品字段名字不一样，对照下面填。</p>

      <div class="protocol-table" aria-label="客户端填写对照">
        <div class="protocol-row protocol-head">
          <span>产品</span>
          <span>怎么填</span>
        </div>
        <div class="protocol-row">
          <span>Claude Code</span>
          <span>
            把下面 JSON <strong>合并</strong>进 <code>~/.claude/settings.json</code> 的 <code>env</code>，不要整文件覆盖。改完后完全退出再打开。
          </span>
        </div>
        <div class="protocol-row">
          <span>Cursor</span>
          <span>自定义模型 / OpenAI 兼容：Base URL 填上面地址，API Key 填员工 Key。</span>
        </div>
        <div class="protocol-row">
          <span>KodaX、KodaX Space</span>
          <span>按 OpenAI Chat Completion 配：Base URL 填上面地址，API Key 填员工 Key。</span>
        </div>
        <div class="protocol-row">
          <span>Codex（自定义模型）</span>
          <span>
            <code>~/.codex/config.toml</code> 里自定义 provider 的 <code>base_url</code> 填上面地址，
            <code>wire_api = "responses"</code>。Codex 会自己请求 <code>/responses</code>。
          </span>
        </div>
        <div class="protocol-row">
          <span>CC Switch</span>
          <span>
            <strong>上游</strong> Base URL 填上面地址，API Key 填员工 Key。
            禁止把 <code>127.0.0.1:15721</code> 填成上游（那是 CC Switch 本地代理，填上去会循环）。
          </span>
        </div>
      </div>

      <p class="lead">Claude Code 可直接复制这段，只改 Key：</p>
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
        <li>地址里出现 <code>:3000</code> / <code>:3100</code> 一定是错的，那是 API 内部端口，员工电脑访问不到。</li>
        <li>模型名称到「模型列表」页复制，不要手打。</li>
        <li>配完仍连不上：先用浏览器打开当前站点，确认不是证书或网络问题，再完全退出客户端重开。</li>
      </ul>
    </section>

    <section class="page-card step-card">
      <div class="step-heading">
        <span class="step-index">5</span>
        <div>
          <h3>从模型列表复制模型名，做第一次调用</h3>
          <p>模型 ID 不要手打。先到「模型列表」复制，填进客户端，发一句短消息；再到「我的调用」看有没有记录。</p>
        </div>
      </div>

      <ol class="steps">
        <li>打开「模型列表」，左侧选和 Key 相同的上游渠道。</li>
        <li>点模型名旁边的「复制」，粘贴到客户端。智谱渠道当前常用：<code>glm-5.3</code>（文本）、<code>glm-5.3-flash</code>（多模态）。</li>
        <li>在客户端发一句很短的话，例如「ping」或「你好」。</li>
        <li>打开「我的调用」：成功会出现 Request ID、模型和 Tokens；失败也能看到错误，把 Request ID 复制下来再排障。</li>
      </ol>

      <div class="script-card">
        <strong>怎样算第一次调用成功</strong>
        <p>客户端有完整或流式回复，并且「我的调用」里能看到刚那条记录。只有客户端转圈、调用页没有记录，多半是 Base URL、Key 或协议没配对，回到第二到第四步核对。</p>
      </div>

      <ul class="notes">
        <li>能列出模型但生成失败：模型 ID 和渠道不匹配，或上游暂时不可用。重新从「模型列表」复制。</li>
        <li>智谱渠道不允许随便填旧模型名，手打 glm-4.x 会被拒。</li>
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
