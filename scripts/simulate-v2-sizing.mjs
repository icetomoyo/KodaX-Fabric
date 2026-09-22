#!/usr/bin/env node
/**
 * Dry-run simulator for UPDATE.md v2: measure what the content-addressed layout
 * would have written for a directory of existing threq_*.json.gz files.
 *
 * Read-only. Reads `<dayDir>/threq_*.json.gz`, splits candidates the way v2
 * would (system / tools / message content blocks / responseBody / assembled),
 * then for each threshold reports envelope bytes (plain JSON) plus unique blob
 * bytes (binary blocks decoded, JSON blocks gzipped), so the threshold can be
 * picked from measured numbers instead of guesses.
 *
 * Usage: node scripts/simulate-v2-sizing.mjs <dayDir> [--thresholds 512,1024,2048,8192]
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";

const args = process.argv.slice(2);
const dayDir = args[0];
if (!dayDir) {
  console.error("usage: node scripts/simulate-v2-sizing.mjs <dayDir> [--thresholds 512,1024,2048,8192]");
  process.exit(1);
}
const thresholds = (() => {
  const i = args.indexOf("--thresholds");
  const raw = i >= 0 ? args[i + 1] : "512,1024,2048,8192";
  return raw.split(",").map((n) => Number(n.trim())).filter((n) => n > 0).sort((a, b) => a - b);
})();
const MIN_T = thresholds[0];

const sha = (s) => createHash("sha256").update(s).digest("hex");
const jsonBytes = (v) => Buffer.byteLength(JSON.stringify(v));

// A binary block: Anthropic document/image with inline base64 source.
function binaryBytes(candidate) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
  const src = candidate.source ?? candidate.data;
  if (src && typeof src === "object" && src.type === "base64" && typeof src.data === "string") {
    return Math.floor((src.data.length * 3) / 4);
  }
  return null;
}

/**
 * Split one record into: meta (always inline), and a flat list of named
 * candidates at their JSON paths. Same candidates for every threshold; only
 * the inline-vs-ref decision differs.
 */
function extractCandidates(record) {
  const candidates = [];
  const push = (path, value) => {
    const json = JSON.stringify(value);
    candidates.push({ path, value, json, bytes: Buffer.byteLength(json) });
  };

  const bodies = ["requestBody", "responseBody"];
  for (const key of bodies) {
    const value = record?.[key];
    if (value == null) continue;
    if (key === "requestBody" && value && typeof value === "object" && !Array.isArray(value)) {
      for (const [k, v] of Object.entries(value)) {
        if (k === "messages") continue;
        if (v == null) continue;
        push(`requestBody.${k}`, v);
      }
      const messages = Array.isArray(value.messages) ? value.messages : [];
      messages.forEach((msg, i) => {
        const content = msg?.content;
        if (Array.isArray(content)) {
          content.forEach((block, j) => push(`requestBody.messages[${i}].content[${j}]`, block));
        } else if (content != null) {
          push(`requestBody.messages[${i}].content`, content);
        }
      });
    } else {
      push(key, value);
    }
  }
  const assembled = record?.streamAudit?.assembled;
  if (assembled != null) push("streamAudit.assembled", assembled);
  return candidates;
}

/** Build the slim envelope actually serialized at a threshold. */
function buildEnvelope(record, candidates, threshold, refOf) {
  const slim = new Map(); // path -> ref placeholder
  for (const c of candidates) {
    if (c.bytes >= threshold) slim.set(c.path, refOf(c));
  }
  const refOr = (path, value) => slim.get(path) ?? value;

  const body = record?.requestBody;
  const slimRequest = body && typeof body === "object" && !Array.isArray(body)
    ? Object.fromEntries(
        Object.entries(body).map(([k, v]) => {
          if (k === "messages" && Array.isArray(v)) {
            return ["messages", v.map((msg, i) => {
              if (msg && typeof msg === "object" && !Array.isArray(msg)) {
                const content = Array.isArray(msg.content)
                  ? msg.content.map((b, j) => refOr(`requestBody.messages[${i}].content[${j}]`, b))
                  : refOr(`requestBody.messages[${i}].content`, msg.content);
                return { ...msg, content };
              }
              return msg;
            })];
          }
          return [k, refOr(`requestBody.${k}`, v)];
        }),
      )
    : refOr("requestBody", body);

  return {
    ...record,
    requestBody: slimRequest,
    responseBody: refOr("responseBody", record?.responseBody),
    streamAudit: record?.streamAudit
      ? { ...record.streamAudit, assembled: refOr("streamAudit.assembled", record.streamAudit.assembled) }
      : record?.streamAudit ?? null,
  };
}

const files = (await readdir(dayDir)).filter((f) => f.startsWith("threq_") && f.endsWith(".json.gz")).sort();
if (files.length === 0) {
  console.error(`no threq_*.json.gz under ${dayDir}`);
  process.exit(1);
}

// Per threshold: unique blob store. Map<hash, {bytes, kind}>; repeat hits counted.
const stores = thresholds.map(() => new Map());
const tally = thresholds.map(() => ({
  envelopeBytes: 0, envelopeGzipBytes: 0, blobBytes: 0, fileBytes: 0, blockBytes: 0,
  fileCount: 0, blockCount: 0, repeatRefBytes: 0, inlineBytes: 0, refCount: 0,
  maxEnvelope: 0,
}));
let currentOnDisk = 0;
let parsed = 0;
let failed = 0;
const started = Date.now();

for (const name of files) {
  const full = join(dayDir, name);
  currentOnDisk += (await stat(full)).size;
  let record;
  try {
    record = JSON.parse(gunzipSync(await readFile(full)).toString("utf8"));
    parsed += 1;
  } catch {
    failed += 1;
    continue;
  }

  const candidates = extractCandidates(record).filter((c) => c.bytes > 0);
  // Cached per-candidate facts shared across thresholds.
  const facts = new Map(); // bytes>=MIN_T -> {hash, stored (binary decoded or gzip size), kind}
  for (let t = 0; t < thresholds.length; t++) {
    const threshold = thresholds[t];
    const store = stores[t];
    const acc = tally[t];
    for (const c of candidates) {
      if (c.bytes < threshold) {
        acc.inlineBytes += c.bytes;
        continue;
      }
      let f = facts.get(c);
      if (!f) {
        const decoded = binaryBytes(c.value);
        f = decoded != null
          ? { hash: sha(c.json), stored: decoded, kind: "file" }
          : { hash: sha(c.json), stored: gzipSync(Buffer.from(c.json)).length, kind: "block" };
        facts.set(c, f);
      }
      acc.refCount += 1;
      const existing = store.get(f.hash);
      if (existing) {
        acc.repeatRefBytes += f.stored;
      } else {
        store.set(f.hash, f);
        acc.blobBytes += f.stored;
        if (f.kind === "file") { acc.fileCount += 1; acc.fileBytes += f.stored; }
        else { acc.blockCount += 1; acc.blockBytes += f.stored; }
      }
    }
    const envelopeJson = JSON.stringify(buildEnvelope(record, candidates, threshold, (c) => {
      const f = facts.get(c);
      return { blob: f.hash, kind: f.kind, bytes: f.stored, media_type: undefined };
    }));
    const envBytes = Buffer.byteLength(envelopeJson);
    acc.envelopeBytes += envBytes;
    acc.envelopeGzipBytes += gzipSync(Buffer.from(envelopeJson)).length;
    if (envBytes > acc.maxEnvelope) acc.maxEnvelope = envBytes;
  }
}

const mb = (n) => (n / 1024 / 1024).toFixed(1);
console.log(`目录: ${dayDir}`);
console.log(`文件: ${files.length}（解析成功 ${parsed}，失败 ${failed}）  当前占用: ${mb(currentOnDisk)} MB(gzip)  耗时 ${((Date.now() - started) / 1000).toFixed(0)}s`);
console.log("");
console.log("阈值B   信封MB(明文)   信封MB(gzip)   blobs MB   files/块数   blocks/块数   v2合计MB(信封gzip)   vs现在   平均信封KB   引用/请求   内联MB   省下重复MB");
for (let t = 0; t < thresholds.length; t++) {
  const a = tally[t];
  const total = a.envelopeGzipBytes + a.blobBytes;
  const avgEnv = (a.envelopeBytes / parsed / 1024).toFixed(1);
  const refsPerReq = (a.refCount / parsed).toFixed(0);
  console.log(
    String(thresholds[t]).padEnd(7),
    mb(a.envelopeBytes).padStart(10),
    mb(a.envelopeGzipBytes).padStart(13),
    mb(a.blobBytes).padStart(12),
    `${mb(a.fileBytes)}/${a.fileCount}`.padStart(14),
    `${mb(a.blockBytes)}/${a.blockCount}`.padStart(14),
    mb(total).padStart(15),
    `${(total / currentOnDisk * 100).toFixed(0)}%`.padStart(9),
    avgEnv.padStart(11),
    refsPerReq.padStart(10),
    mb(a.inlineBytes).padStart(10),
    mb(a.repeatRefBytes).padStart(13),
  );
}
