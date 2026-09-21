import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import postgres from "postgres";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import "../config.js";
import { env } from "../config.js";

type Journal = { entries: Array<{ tag: string; when: number }> };

/**
 * Apply each SQL file in its own transaction.
 * Drizzle's migrator wraps every pending file in one transaction, so a later
 * file cannot use an enum label added earlier in the same empty-database run.
 */
async function applyMigrations(client: postgres.Sql, migrationsFolder: string): Promise<void> {
  const journal = JSON.parse(
    readFileSync(resolve(migrationsFolder, "meta/_journal.json"), "utf8"),
  ) as Journal;
  await client`CREATE SCHEMA IF NOT EXISTS drizzle`;
  await client`
    CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )
  `;
  const applied = await client<{ created_at: string | number | bigint | null }[]>`
    SELECT created_at FROM drizzle.__drizzle_migrations
  `;
  const appliedWhen = new Set(applied.map((row) => Number(row.created_at)));

  for (const entry of journal.entries) {
    if (appliedWhen.has(entry.when)) continue;
    const sqlText = readFileSync(resolve(migrationsFolder, `${entry.tag}.sql`), "utf8");
    const hash = createHash("sha256").update(sqlText).digest("hex");
    const statements = sqlText
      .split("--> statement-breakpoint")
      .map((statement) => statement.trim())
      .filter(Boolean);
    await client.begin(async (tx) => {
      for (const statement of statements) {
        await tx.unsafe(statement);
      }
      await tx`
        INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
        VALUES (${hash}, ${entry.when})
      `;
    });
    console.log("Applied", entry.tag);
  }
}

async function main() {
  const client = postgres(env.DATABASE_URL, { max: 1 });
  const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), "../../drizzle");
  console.log("Running migrations from", migrationsFolder);
  await applyMigrations(client, migrationsFolder);
  // Enum ADD VALUE cannot be used in the same transaction. Backfill after commit.
  await client`
    UPDATE product_lines AS pl
    SET
      protocol_configs = jsonb_set(
        coalesce(pl.protocol_configs, '{}'::jsonb),
        '{openai_responses}',
        '{"baseUrl":"https://open.bigmodel.cn/api/v1","authStyle":"bearer"}'::jsonb,
        true
      ),
      updated_at = now()
    FROM providers AS p
    WHERE pl.provider_id = p.id
      AND p.code = 'glm'
      AND pl.code = 'api'
      AND pl.protocol_configs -> 'openai_responses' IS NULL
  `;
  await client`
    UPDATE product_lines AS pl
    SET
      protocol_configs = jsonb_set(
        coalesce(pl.protocol_configs, '{}'::jsonb),
        '{openai_responses}',
        '{"baseUrl":"https://api.z.ai/api/v1","authStyle":"bearer"}'::jsonb,
        true
      ),
      updated_at = now()
    FROM providers AS p
    WHERE pl.provider_id = p.id
      AND p.code = 'glm'
      AND pl.code = 'api_intl'
      AND pl.protocol_configs -> 'openai_responses' IS NULL
  `;
  await client`
    UPDATE upstream_credentials AS uc
    SET
      supported_protocols = CASE
        WHEN NOT ('openai_responses' = ANY (uc.supported_protocols))
        THEN array_append(uc.supported_protocols, 'openai_responses'::relay_protocol)
        ELSE uc.supported_protocols
      END,
      updated_at = now()
    FROM product_lines AS pl
    JOIN providers AS p ON p.id = pl.provider_id
    WHERE uc.product_line_id = pl.id
      AND p.code = 'glm'
  `;
  await client.end();
  const { mergeBundledSensitiveWords } = await import("../lib/relay/sensitive-words.js");
  const { sql } = await import("./client.js");
  await mergeBundledSensitiveWords();
  await sql.end({ timeout: 5 });
  console.log("Migrations complete");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
