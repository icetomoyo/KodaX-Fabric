import type { ChannelPlugin } from "./types.js";

export type ChannelRegistry = {
  get(code: string): ChannelPlugin;
  find(code: string): ChannelPlugin | undefined;
  list(): readonly ChannelPlugin[];
  isCode(code: string): boolean;
};

export function createChannelRegistry(plugins: readonly ChannelPlugin[]): ChannelRegistry {
  const byCode = new Map(plugins.map((plugin) => [plugin.code, plugin]));
  return {
    get(code: string): ChannelPlugin {
      const plugin = byCode.get(code);
      if (!plugin) throw new Error(`unknown channel: ${code}`);
      return plugin;
    },
    find(code: string): ChannelPlugin | undefined {
      return byCode.get(code);
    },
    list(): readonly ChannelPlugin[] {
      return plugins;
    },
    isCode(code: string): boolean {
      return byCode.has(code);
    },
  };
}
