#!/usr/bin/env node
/**
 * Real-data smoke: push N existing 144 envelopes through the new write path,
 * hydrate them back, and verify semantic equality with the original record.
 *
 * Usage: npx tsx scripts/smoke-v2-roundtrip.mjs <dayDir> [count]
 */
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:5432/test";
process.env.REDIS_URL ??= "redis://127.0.0.1:6379/15";
process.env.JWT_SECRET ??= "unit-test-jwt-secret";
process.env.CREDENTIAL_ENCRYPT_KEY ??= "unit-test-credential-secret";

const mod = await import("../server/src/lib/relay/request-context.ts");

const dayDir = process.argv[2];
const count = Number(process.argv[3] ?? 50);
if (!dayDir) {
  console.error("usage: npx tsx scripts/smoke-v2-roundtrip.mjs <dayDir> [count]");
  process.exit(1);
}
const files = (await readdir(dayDir)).filter((f) => f.startsWith("threq_") && f.endsWith(".json.gz"));
const step = Math.max(1, Math.floor(files.length / count));
const picked = files.filter((_, i) => i % step === 0).slice(0, count);

const canonical = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
};

const root = await mkdtemp(join(tmpdir(), "th-smoke-"));
let ok = 0;
let mismatch = 0;
let srcBytes = 0;
let envBytes = 0;

for (const name of picked) {
  const original = JSON.parse(gunzipSync(await readFile(join(dayDir, name))).toString("utf8"));
  srcBytes += (await readFile(join(dayDir, name))).length;
  try {
    const path = await mod.writeRequestContextFile({
      rootDir: root,
      timeZone: "Asia/Shanghai",
      maxBytes: 50 * 1024 * 1024,
      blobMinBytes: 1024,
      record: original,
    });
    const stat = await import("node:fs/promises").then((fs) => fs.stat(path));
    envBytes += stat.size;
    const hydrated = await mod.readRequestContextRecord(path);
    const { contextFormat, ...rest } = hydrated;
    // document/image 块重建时键序规范化为 type/source，语义相等即可
    if (contextFormat === 2 && canonical(rest) === canonical(original)) {
      ok += 1;
    } else {
      mismatch += 1;
      console.error(`MISMATCH ${name}`);
    }
  } catch (error) {
    mismatch += 1;
    console.error(`ERROR ${name}:`, error instanceof Error ? error.message : error);
  }
}

let blobCount = 0;
let blobBytes = 0;
for (const store of ["blocks", "files"]) {
  try {
    const entries = await readdir(join(root, store), { recursive: true, withFileTypes: true });
    for (const e of entries.filter((x) => x.isFile())) {
      blobCount += 1;
      blobBytes += (await import("node:fs/promises").then((fs) => fs.stat(join(e.parentPath, e.name)))).size;
    }
  } catch {}
}

console.log(`样本 ${picked.length} 个：roundtrip OK ${ok}，失败 ${mismatch}`);
console.log(`原文件合计 ${(srcBytes / 1024 / 1024).toFixed(1)}MB → 信封 ${(envBytes / 1024 / 1024).toFixed(2)}MB + 内容库 ${(blobBytes / 1024 / 1024).toFixed(2)}MB（${blobCount} 个对象）`);
await rm(root, { recursive: true, force: true });
