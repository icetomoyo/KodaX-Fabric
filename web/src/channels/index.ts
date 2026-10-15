import DeepseekChannelPage from "./deepseek/DeepseekChannelPage.vue";
import GlmChannelPage from "./glm/GlmChannelPage.vue";
import HuoshanChannelPage from "./huoshan/HuoshanChannelPage.vue";
import type { ChannelPagePlugin } from "./types";

export const channelPages: readonly ChannelPagePlugin[] = [
  { code: "glm", page: GlmChannelPage },
  { code: "deepseek", page: DeepseekChannelPage },
  { code: "huoshan", page: HuoshanChannelPage },
];

export function getChannelPage(code: string): ChannelPagePlugin | undefined {
  return channelPages.find((plugin) => plugin.code === code);
}

export type { ChannelPagePlugin } from "./types";
