#!/usr/bin/env node
/**
 * Anatomy of the v2 slim envelope: build real envelopes at a threshold over a
 * day directory (no blob store, fake 64-hex hashes — byte counts are what
 * matter), report size/ref distributions, byte decomposition, and dump one
 * representative envelope for display.
 *
 * Usage: node scripts/envelope-anatomy.mjs <dayDir> [--threshold 1024] [--sample-every 1]
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

const args = process.argv.slice(2);
const dayDir = args[0];
const flag = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? Number(args[i + 1]) : dflt;
};
const threshold = flag("--threshold", 1024);
const sampleEvery = flag("--sample-every", 1) || 1;
if (!dayDir) {
  console.error("usage: node scripts/envelope-anatomy.mjs <dayDir> [--threshold 1024] [--sample-every 1]");
  process.exit(1);
}

const fakeHash = () => "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2".repeat(1);
const refFor = (kind, bytes) => ({ blob: fakeHash(), kind, bytes, media_type: undefined });

function extractCandidates(record) {
  const candidates = [];
  const push = (path, value) => {
    const json = JSON.stringify(value);
    candidates.push({ path, value, json, bytes: Buffer.byteLength(json) });
  };
  for (const key of ["requestBody", "responseBody"]) {
    const value = record?.[key];
    if (value == null) continue;
    if (key === "requestBody" && value && typeof value === "object" && !Array.isArray(value)) {
      for (const [k, v] of Object.entries(value)) {
        if (k === "messages" || v == null) continue;
        push(`requestBody.${k}`, v);
      }
      const messages = Array.isArray(value.messages) ? value.messages : [];
      messages.forEach((msg, i) => {
        const content = msg?.content;
        if (Array.isArray(content)) content.forEach((block, j) => push(`requestBody.messages[${i}].content[${j}]`, block));
        else if (content != null) push(`requestBody.messages[${i}].content`, content);
      });
    } else {
      push(key, value);
    }
  }
  const assembled = record?.streamAudit?.assembled;
  if (assembled != null) push("streamAudit.assembled", assembled);
  return candidates;
}

function buildEnvelope(record, candidates) {
  const slim = new Map();
  for (const c of candidates) if (c.bytes >= threshold) slim.set(c.path, true);
  const refOr = (path, value) => (slim.has(path) ? "«REF»" : value);
  const body = record?.requestBody;
  const slimRequest = body && typeof body === "object" && !Array.isArray(body)
    ? Object.fromEntries(Object.entries(body).map(([k, v]) => {
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
      }))
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
const sizes = [];
const refCounts = [];
let metaBytes = 0, refsBytes = 0, inlineBytes = 0, skeletonBytes = 0, parsed = 0;
let example = null;      // envelope with most refs among sampled, kept for display
let exampleRefs = -1;

for (let fi = 0; fi < files.length; fi += sampleEvery) {
  let record;
  try {
    record = JSON.parse(gunzipSync(await readFile(join(dayDir, files[fi]))).toString("utf8"));
  } catch { continue; }
  parsed += 1;

  const candidates = extractCandidates(record);
  const refPaths = new Set(candidates.filter((c) => c.bytes >= threshold).map((c) => c.path));
  const envelope = buildEnvelope(record, candidates);
  const bytes = Buffer.byteLength(JSON.stringify(envelope));

  const { requestBody: _rb, responseBody: _rp, streamAudit: _sa, ...meta } = record;
  const msgCount = Array.isArray(record?.requestBody?.messages) ? record.requestBody.messages.length : 0;
  sizes.push({ bytes, refs: refPaths.size, msgCount, file: files[fi] });
  refCounts.push(refPaths.size);

  metaBytes += Buffer.byteLength(JSON.stringify(meta));
  refsBytes += refPaths.size * Buffer.byteLength(JSON.stringify(refFor("block", 123456)));
  inlineBytes += candidates.filter((c) => c.bytes < threshold).reduce((s, c) => s + c.bytes, 0);
  skeletonBytes += bytes - refPaths.size * 90; // rough: remainder after refs≈90B each

  if (refPaths.size > exampleRefs && refPaths.size < 400) {
    exampleRefs = refPaths.size;
    example = { file: files[fi], envelope, msgCount, refs: refPaths.size, bytes };
  }
}

const pct = (arr, p) => arr[Math.min(arr.length - 1, Math.floor(arr.length * p))];
const kb = (n) => (n / 1024).toFixed(1);
const sortedSizes = [...sizes].sort((a, b) => a.bytes - b.bytes);
const sortedRefs = [...refCounts].sort((a, b) => a - b);
const sortedMsgs = [...sizes].sort((a, b) => a.msgCount - b.msgCount);

console.log(`样本: ${parsed} 个请求  阈值: ${threshold}B`);
console.log("");
console.log("== 信封体积分布（KB 明文） ==");
for (const [label, p] of [["p10", 0.1], ["p50", 0.5], ["p90", 0.9], ["p99", 0.99], ["max", 1]]) {
  const s = pct(sortedSizes, p === 1 ? 0.999 : p);
  console.log(`${label.padEnd(5)} ${kb(s.bytes).padStart(9)} KB   (${s.msgCount} 条消息, ${s.refs} 引用)  ${s.file}`);
}
console.log("");
console.log("== 每请求引用数分布 ==");
for (const [label, p] of [["p10", 0.1], ["p50", 0.5], ["p90", 0.9], ["p99", 0.99], ["max", "max"]]) {
  const v = label === "max" ? sortedRefs[sortedRefs.length - 1] : pct(sortedRefs, p);
  console.log(`${label.padEnd(5)} ${String(v).padStart(6)} 个`);
}
console.log("");
console.log("== 每请求消息数分布 ==");
for (const [label, p] of [["p50", 0.5], ["p90", 0.9], ["p99", 0.99], ["max", "max"]]) {
  const v = label === "max" ? sortedMsgs[sortedMsgs.length - 1].msgCount : pct(sortedMsgs, p).msgCount;
  console.log(`${label.padEnd(5)} ${String(v).padStart(6)} 条`);
}
console.log("");
console.log("== 平均每个信封的字节构成 ==");
const avg = (n) => kb(n / parsed);
console.log(`元信息(人/模型/headers/usage等)  ${avg(metaBytes).padStart(8)} KB`);
console.log(`引用列表 (${(refCounts.reduce((a, b) => a + b, 0) / parsed).toFixed(0)} 个 × ~90B)   ${avg(refsBytes).padStart(8)} KB`);
console.log(`内联小块(阈值以下)            ${avg(inlineBytes).padStart(8)} KB`);
console.log(`骨架(JSON结构/role/键名)       ${avg(skeletonBytes - metaBytes).padStart(8)} KB`);

// Display example: truncate long inline strings, collapse repeated ref blocks.
const trunc = (v) => {
  if (typeof v === "string" && v.length > 120) return v.slice(0, 100) + `…(+${v.length - 100}字符)`;
  if (Array.isArray(v)) return v.map(trunc);
  if (v && typeof v === "object") {
    const o = {};
    for (const [k, val] of Object.entries(v)) o[k] = trunc(val);
    return o;
  }
  return v;
};
const env = example.envelope;
const msgs = env.requestBody?.messages;
if (Array.isArray(msgs) && msgs.length > 6) {
  env.requestBody = {
    ...env.requestBody,
    messages: [
      ...msgs.slice(0, 3).map(trunc),
      `…（中间省略 ${msgs.length - 5} 条，结构同上：role + content 引用）…`,
      ...msgs.slice(-2).map(trunc),
    ],
  };
} else if (env.requestBody) env.requestBody = trunc(env.requestBody);
env.responseBody = trunc(env.responseBody);
if (env.streamAudit?.assembled) env.streamAudit.assembled = trunc(env.streamAudit.assembled);

console.log("");
console.log(`== 示例信封: ${example.file}  ${kb(example.bytes)}KB / ${example.msgCount}条消息 / ${example.refs}个引用 ==`);
console.log(JSON.stringify(env, null, 2));
