import { db } from "../db/client.js";
import { providers } from "../db/schema/index.js";
import { listChannelPlugins, variantBaseUrl } from "../channels/index.js";

/**
 * Insert a providers row for every registered channel plugin.
 * Existing rows are left untouched (conflict on code is a no-op).
 */
export async function ensureRegisteredProviders(): Promise<void> {
  const plugins = listChannelPlugins();
  if (plugins.length === 0) return;
  await db
    .insert(providers)
    .values(
      plugins.map((plugin) => ({
        code: plugin.code,
        name: plugin.meta.company,
        defaultBaseUrl: (plugin.variants[0] && variantBaseUrl(plugin.variants[0])) || "https://example.invalid",
        authStyle: "bearer",
        openaiCompatLevel: "full",
        status: "active",
      })),
    )
    .onConflictDoNothing({ target: providers.code });
}
