<template>
  <div
    v-if="enabled"
    ref="rootRef"
    class="token-bot"
    :class="{
      'is-canvas': isCanvasPage,
      'is-moved': position != null,
      'is-dragging': dragging,
    }"
    :style="positionStyle"
  >
    <section v-if="open" class="panel" role="dialog" aria-labelledby="token-bot-title">
      <header
        class="panel-head"
        @pointerdown="onHandlePointerDown"
        @pointermove="onHandlePointerMove"
        @pointerup="onHandlePointerUp"
        @pointercancel="onHandlePointerUp"
        @lostpointercapture="onHandlePointerUp"
      >
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

    <button
      type="button"
      class="fab"
      :class="{ open }"
      aria-label="Token Bot"
      title="Token Bot"
      @pointerdown="onHandlePointerDown"
      @pointermove="onHandlePointerMove"
      @pointerup="onHandlePointerUp"
      @pointercancel="onHandlePointerUp"
      @lostpointercapture="onHandlePointerUp"
      @click="onFabClick"
    >
      <XIcon v-if="open" :size="22" aria-hidden="true" />
      <BotIcon v-else :size="22" aria-hidden="true" />
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { BotIcon, XIcon } from "@lucide/vue";
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
import {
  TOKEN_BOT_POSITION_KEY,
  boxToRightBottom,
  clampTokenBotPosition,
  moveTokenBotPosition,
  parseTokenBotPosition,
  tokenBotDragMoved,
  type TokenBotPosition,
} from "@/lib/token-bot-position";

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
  "ZCode 贴图为什么看不了？",
] as const;

type DragSession = {
  pointerId: number;
  startX: number;
  startY: number;
  origin: TokenBotPosition;
  moved: boolean;
};

const route = useRoute();
const rootRef = ref<HTMLElement | null>(null);
const enabled = ref(false);
const open = ref(false);
const position = ref<TokenBotPosition | null>(null);
const dragSession = ref<DragSession | null>(null);
const suppressClick = ref(false);
const sending = ref(false);
const loadedHistory = ref(false);
const startFresh = ref(false);
const draft = ref("");
const loadError = ref("");
const conversationId = ref<number | null>(null);
const messages = ref<ChatLine[]>([]);

const isCanvasPage = computed(() => route.path === "/admin/key-bindings");
const guidePath = computed(() => (route.path.startsWith("/admin") ? "/admin/guide" : "/me/guide"));
const dragging = computed(() => Boolean(dragSession.value?.moved));
const positionStyle = computed(() => {
  if (!position.value) return undefined;
  return {
    right: `${position.value.right}px`,
    bottom: `${position.value.bottom}px`,
    left: "auto",
  };
});

onMounted(async () => {
  position.value = readStoredPosition();
  try {
    enabled.value = await fetchSupportStatus();
  } catch {
    enabled.value = false;
  }
  window.addEventListener("resize", onViewportChange);
});

onBeforeUnmount(() => {
  window.removeEventListener("resize", onViewportChange);
});

watch([enabled, open], () => {
  void nextTick(clampToViewport);
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

function readStoredPosition(): TokenBotPosition | null {
  try {
    return parseTokenBotPosition(localStorage.getItem(TOKEN_BOT_POSITION_KEY));
  } catch {
    return null;
  }
}

function writeStoredPosition(value: TokenBotPosition) {
  try {
    localStorage.setItem(TOKEN_BOT_POSITION_KEY, JSON.stringify(value));
  } catch {
    // Ignore quota / private-mode failures.
  }
}

function widgetSize() {
  const rect = rootRef.value?.getBoundingClientRect();
  return {
    width: rect?.width || 120,
    height: rect?.height || 40,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
  };
}

function clampToViewport() {
  if (!position.value || !rootRef.value) return;
  position.value = clampTokenBotPosition({
    ...position.value,
    ...widgetSize(),
  });
}

function onViewportChange() {
  clampToViewport();
}

function onHandlePointerDown(event: PointerEvent) {
  if (event.button !== 0) return;
  const target = event.target;
  if (target instanceof Element && target.closest(".head-actions")) return;
  const root = rootRef.value;
  if (!root) return;
  const rect = root.getBoundingClientRect();
  const origin = boxToRightBottom({
    right: rect.right,
    bottom: rect.bottom,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
  });
  dragSession.value = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    origin,
    moved: false,
  };
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
}

function onHandlePointerMove(event: PointerEvent) {
  const session = dragSession.value;
  if (!session || event.pointerId !== session.pointerId) return;
  const dx = event.clientX - session.startX;
  const dy = event.clientY - session.startY;
  if (!session.moved && !tokenBotDragMoved(dx, dy)) return;
  dragSession.value = { ...session, moved: true };
  event.preventDefault();
  position.value = moveTokenBotPosition(session.origin, dx, dy, widgetSize());
}

function onHandlePointerUp(event: PointerEvent) {
  const session = dragSession.value;
  if (!session || event.pointerId !== session.pointerId) return;
  if (session.moved && position.value) {
    suppressClick.value = true;
    writeStoredPosition(position.value);
  }
  dragSession.value = null;
}

function toggle() {
  open.value = !open.value;
}

function onFabClick() {
  if (suppressClick.value) {
    suppressClick.value = false;
    return;
  }
  toggle();
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

.token-bot.is-canvas:not(.is-moved) {
  right: auto;
  left: 244px;
}

.token-bot.is-dragging {
  user-select: none;
}

.fab {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  min-height: 48px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: #0f172a;
  color: #fff;
  cursor: grab;
  touch-action: none;
  box-shadow: 0 10px 24px rgba(15, 23, 42, 0.28);
}

.fab.open {
  background: #1e293b;
}

.token-bot.is-dragging .fab,
.token-bot.is-dragging .panel-head {
  cursor: grabbing;
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
  cursor: grab;
  touch-action: none;
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
  cursor: auto;
  touch-action: auto;
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

.panel-body :deep(img) {
  display: block;
  max-width: 100%;
  height: auto;
  margin: 8px 0;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
}
</style>
