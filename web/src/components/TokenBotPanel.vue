<template>
  <div v-if="enabled" class="token-bot" :class="{ 'is-canvas': isCanvasPage }">
    <section v-if="open" class="panel" role="dialog" aria-labelledby="token-bot-title">
      <header class="panel-head">
        <div>
          <strong id="token-bot-title">Token Bot</strong>
          <p>接入与排障，可查看你自己的 Key 和调用</p>
        </div>
        <div class="head-actions">
          <el-button text size="small" @click="onNewConversation">新对话</el-button>
          <el-button text size="small" @click="open = false">关闭</el-button>
        </div>
      </header>

      <div class="panel-body">
        <p v-if="loadError" class="hint error">{{ loadError }}</p>
        <Conversation v-else class="h-full min-h-0">
          <ConversationContent>
            <template v-if="messages.length === 0 && !sending">
              <ConversationEmptyState
                title="直接问接入问题"
                description="我会结合你当前的 Key、最近调用和可用模型来回答。"
              />
              <Suggestions>
                <Suggestion
                  v-for="item in suggestions"
                  :key="item"
                  :suggestion="item"
                  @click="sendMessage"
                />
              </Suggestions>
            </template>
            <Message
              v-for="(item, index) in messages"
              :key="item.id ?? `local-${index}`"
              :from="item.role"
            >
              <MessageContent>
                <MessageResponse v-if="item.role === 'assistant'">
                  {{ item.content }}
                </MessageResponse>
                <span v-else>{{ item.content }}</span>
              </MessageContent>
            </Message>
            <Loader v-if="sending" />
          </ConversationContent>
          <template #overlay>
            <ConversationScrollButton />
          </template>
        </Conversation>
      </div>

      <footer class="panel-foot">
        <router-link class="guide-link" :to="guidePath">接入教程</router-link>
        <PromptInput @submit="onPromptSubmit">
          <PromptInputTextarea
            v-model="draft"
            placeholder="例如：Base URL 填什么？"
            :disabled="sending"
            :maxlength="2000"
            class="pr-12"
          />
          <PromptInputSubmit
            :status="sending ? 'submitted' : 'ready'"
            :disabled="sending || !draft.trim()"
          />
        </PromptInput>
      </footer>
    </section>

    <button type="button" class="fab" :class="{ open }" @click="toggle">
      {{ open ? "收起" : "Token Bot" }}
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Loader } from "@/components/ai-elements/loader";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputSubmit,
  PromptInputTextarea,
  type PromptInputMessage,
} from "@/components/ai-elements/prompt-input";
import { Suggestion, Suggestions } from "@/components/ai-elements/suggestion";
import {
  fetchSupportHistory,
  fetchSupportStatus,
  sendSupportChat,
  supportApiError,
  type SupportHistoryMessage,
} from "@/api/support";

type ChatLine = {
  id?: number;
  role: "user" | "assistant";
  content: string;
};

const suggestions = [
  "Base URL 应该填什么？",
  "三种协议怎么选？",
  "我的 Key 为什么会 401？",
  "现在可用哪些模型？",
] as const;

const route = useRoute();
const enabled = ref(false);
const open = ref(false);
const sending = ref(false);
const loadedHistory = ref(false);
const startFresh = ref(false);
const draft = ref("");
const loadError = ref("");
const conversationId = ref<number | null>(null);
const messages = ref<ChatLine[]>([]);

const isCanvasPage = computed(() => route.path === "/admin/key-bindings");
const guidePath = computed(() => (route.path.startsWith("/admin") ? "/admin/guide" : "/me/guide"));

onMounted(async () => {
  try {
    enabled.value = await fetchSupportStatus();
  } catch {
    enabled.value = false;
  }
});

watch(open, async (visible) => {
  if (!visible || loadedHistory.value) return;
  try {
    const history = await fetchSupportHistory();
    conversationId.value = history.conversationId;
    messages.value = history.messages.map(toLine);
    loadedHistory.value = true;
  } catch (error) {
    loadError.value = supportApiError(error, "历史记录加载失败");
    loadedHistory.value = true;
  }
});

function toLine(item: SupportHistoryMessage): ChatLine {
  return { id: item.id, role: item.role, content: item.content };
}

function toggle() {
  open.value = !open.value;
}

function onNewConversation() {
  conversationId.value = null;
  messages.value = [];
  startFresh.value = true;
  loadError.value = "";
}

function onPromptSubmit(message: PromptInputMessage) {
  draft.value = "";
  void sendMessage(message.text);
}

async function sendMessage(message: string) {
  const text = message.trim();
  if (!text || sending.value) return;

  loadError.value = "";
  messages.value.push({ role: "user", content: text });
  sending.value = true;

  try {
    const result = await sendSupportChat({
      message: text,
      conversationId: startFresh.value ? undefined : (conversationId.value ?? undefined),
      newConversation: startFresh.value || conversationId.value == null,
    });
    startFresh.value = false;
    conversationId.value = result.conversationId;
    messages.value.push({ role: "assistant", content: result.reply });
  } catch (error) {
    messages.value.push({
      role: "assistant",
      content: supportApiError(error),
    });
    if (conversationId.value == null) {
      try {
        const history = await fetchSupportHistory();
        conversationId.value = history.conversationId;
        startFresh.value = false;
      } catch {
        // Keep composing a new conversation if history cannot be recovered.
      }
    }
  } finally {
    sending.value = false;
  }
}
</script>

<style scoped>
.token-bot {
  position: fixed;
  right: 24px;
  bottom: 24px;
  z-index: 1800;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 12px;
}

.token-bot.is-canvas {
  right: auto;
  left: 244px;
}

.fab {
  min-height: 40px;
  padding: 8px 16px;
  border: none;
  border-radius: 999px;
  background: #0f172a;
  color: #fff;
  font: inherit;
  cursor: pointer;
  box-shadow: 0 10px 24px rgba(15, 23, 42, 0.28);
}

.fab.open {
  background: #1e293b;
}

.panel {
  display: flex;
  flex-direction: column;
  width: min(420px, calc(100vw - 32px));
  height: min(560px, calc(100vh - 120px));
  overflow: hidden;
  border: 1px solid #e2e8f0;
  border-radius: 16px;
  background: #fff;
  box-shadow: 0 18px 48px rgba(15, 23, 42, 0.18);
}

.panel-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px 12px;
  background: #0f172a;
  color: #fff;
}

.panel-head p {
  margin: 4px 0 0;
  color: #cbd5e1;
  font-size: 12px;
  line-height: 1.4;
}

.head-actions {
  display: flex;
  flex-shrink: 0;
}

.head-actions :deep(.el-button) {
  color: #e2e8f0;
}

.panel-body {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  background: #f8fafc;
}

.hint {
  margin: 12px 16px 0;
  color: #64748b;
  font-size: 13px;
  line-height: 1.5;
}

.hint.error {
  color: #b45309;
}

.panel-foot {
  padding: 10px 16px 14px;
  border-top: 1px solid #e5e7eb;
  background: #fff;
}

.guide-link {
  display: inline-block;
  margin-bottom: 8px;
  color: #2563eb;
  font-size: 12px;
}
</style>
