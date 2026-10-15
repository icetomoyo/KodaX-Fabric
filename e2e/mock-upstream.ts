import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

/**
 * E2E 专用 OpenAI 兼容 mock 上游（端口 3311）。
 * 被「员工测试渠道 KEY」的连通性探测和 relay 转发共同命中：
 * 任何 Bearer 都接受，回显请求模型，固定 usage，从不访问外网。
 *
 * 调度用例通过 /__control/* 编排它：按渠道 Key（Bearer 明文）指定返回
 * 成功 / 挂起 / 指定状态码与报文，并读回每把 Key 被谁打过、同时在途多少。
 * 没有编排过的 Key 一律按成功处理，其他用例不受影响。
 */
const PORT = 3311;
const USAGE = { prompt_tokens: 12, completion_tokens: 34, total_tokens: 46 };

interface ChatRequestBody {
  model?: unknown;
  stream?: unknown;
  messages?: unknown;
}

type Behavior =
  | { type: "ok" }
  | { type: "hold" }
  | { type: "status"; status: number; body: unknown };

type HitLog = { seq: number; secret: string; model: string; marker: string | null; at: string };

const behaviors = new Map<string, Behavior>();
const heldBySecret = new Map<string, Array<() => void>>();
const inFlight = new Map<string, number>();
const maxInFlight = new Map<string, number>();
const hits: HitLog[] = [];
const alerts: unknown[] = [];
let seq = 0;

function resetControl(): void {
  for (const waiters of heldBySecret.values()) {
    for (const release of waiters) release();
  }
  behaviors.clear();
  heldBySecret.clear();
  inFlight.clear();
  maxInFlight.clear();
  hits.length = 0;
  alerts.length = 0;
  seq = 0;
}

function headerValue(req: IncomingMessage, name: string): string {
  const header = req.headers[name];
  const value = Array.isArray(header) ? header[0] : header;
  return value?.trim() ?? "";
}

/** Authorization Bearer first, then x-api-key (Anthropic / some gateways). */
function requestSecret(req: IncomingMessage): string {
  const bearer = headerValue(req, "authorization").replace(/^Bearer\s+/i, "").trim();
  if (bearer) return bearer;
  return headerValue(req, "x-api-key");
}

/** 取最后一条 user 消息的文本，用例用它给每次调用打标记。 */
function requestMarker(body: ChatRequestBody): string | null {
  if (!Array.isArray(body.messages)) return null;
  const last = body.messages[body.messages.length - 1] as { content?: unknown } | undefined;
  return typeof last?.content === "string" ? last.content : null;
}

async function readRaw(req: IncomingMessage): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let data = "";
    req.on("data", (chunk: Buffer) => {
      data += chunk.toString("utf8");
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

async function readBody(req: IncomingMessage): Promise<ChatRequestBody> {
  try {
    return JSON.parse(await readRaw(req)) as ChatRequestBody;
  } catch {
    return {};
  }
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const raw = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(raw),
  });
  res.end(raw);
}

async function sendSse(res: ServerResponse, model: string): Promise<void> {
  const id = "chatcmpl-e2e-mock";
  const chunks = [
    `data: ${JSON.stringify({
      id,
      object: "chat.completion.chunk",
      created: 0,
      model,
      choices: [{ index: 0, delta: { role: "assistant", content: "E2E mock " }, finish_reason: null }],
    })}\n\n`,
    `data: ${JSON.stringify({
      id,
      object: "chat.completion.chunk",
      created: 0,
      model,
      choices: [{ index: 0, delta: { content: "reply" }, finish_reason: "stop" }],
    })}\n\n`,
    `data: ${JSON.stringify({ id, object: "chat.completion.chunk", created: 0, model, choices: [], usage: USAGE })}\n\n`,
    "data: [DONE]\n\n",
  ];
  res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache" });
  for (const chunk of chunks) {
    res.write(chunk);
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  res.end();
}

async function handleControl(req: IncomingMessage, res: ServerResponse, url: string): Promise<void> {
  if (req.method === "POST" && url === "/__control/reset") {
    resetControl();
    sendJson(res, 200, { ok: true });
    return;
  }
  if (req.method === "POST" && url === "/__control/behavior") {
    const body = JSON.parse((await readRaw(req)) || "{}") as { secret?: string; behavior?: Behavior };
    if (!body.secret || !body.behavior) {
      sendJson(res, 400, { ok: false, message: "secret 和 behavior 必填" });
      return;
    }
    behaviors.set(body.secret, body.behavior);
    sendJson(res, 200, { ok: true });
    return;
  }
  if (req.method === "POST" && url === "/__control/release") {
    const body = JSON.parse((await readRaw(req)) || "{}") as { secret?: string };
    const secrets = body.secret ? [body.secret] : [...heldBySecret.keys()];
    let released = 0;
    for (const secret of secrets) {
      const waiters = heldBySecret.get(secret) ?? [];
      heldBySecret.delete(secret);
      for (const release of waiters) {
        release();
        released += 1;
      }
    }
    sendJson(res, 200, { ok: true, released });
    return;
  }
  if (req.method === "POST" && url === "/__control/alerts") {
    const raw = await readRaw(req);
    try {
      alerts.push(JSON.parse(raw));
    } catch {
      alerts.push(raw);
    }
    sendJson(res, 200, { ok: true });
    return;
  }
  if (req.method === "GET" && url === "/__control/state") {
    sendJson(res, 200, {
      hits,
      inFlight: Object.fromEntries(inFlight),
      maxInFlight: Object.fromEntries(maxInFlight),
      alerts,
    });
    return;
  }
  sendJson(res, 404, { error: { message: `unexpected control ${req.method} ${url}` } });
}

async function handleChat(req: IncomingMessage, res: ServerResponse, url: string): Promise<void> {
  const body = await readBody(req);
  const model = typeof body.model === "string" ? body.model : "e2e-upstream-model";
  const secret = requestSecret(req);
  console.log(`[mock-upstream] POST ${url} model=${model} stream=${Boolean(body.stream)}`);

  seq += 1;
  hits.push({ seq, secret, model, marker: requestMarker(body), at: new Date().toISOString() });
  const current = (inFlight.get(secret) ?? 0) + 1;
  inFlight.set(secret, current);
  maxInFlight.set(secret, Math.max(maxInFlight.get(secret) ?? 0, current));

  try {
    const behavior = behaviors.get(secret) ?? { type: "ok" };
    if (behavior.type === "status") {
      sendJson(res, behavior.status, behavior.body);
      return;
    }
    if (behavior.type === "hold") {
      await new Promise<void>((resolve) => {
        const waiters = heldBySecret.get(secret) ?? [];
        waiters.push(resolve);
        heldBySecret.set(secret, waiters);
      });
    }
    if (body.stream === true) {
      await sendSse(res, model);
      return;
    }
    sendJson(res, 200, {
      id: "chatcmpl-e2e-mock",
      object: "chat.completion",
      created: 0,
      model,
      choices: [
        {
          index: 0,
          // 回显渠道 Key 明文，调度用例据此断言请求落在哪把 Key 上。
          message: { role: "assistant", content: `E2E mock reply [key=${secret}]` },
          finish_reason: "stop",
        },
      ],
      usage: USAGE,
    });
  } finally {
    const remaining = (inFlight.get(secret) ?? 1) - 1;
    if (remaining <= 0) inFlight.delete(secret);
    else inFlight.set(secret, remaining);
  }
}

const server = createServer((req, res) => {
  void (async () => {
    const url = req.url ?? "";
    if (url.startsWith("/__control/")) {
      await handleControl(req, res, url);
      return;
    }
    if (req.method === "GET" && (url === "/" || url === "/health")) {
      sendJson(res, 200, { ok: true, service: "e2e-mock-upstream" });
      return;
    }
    if (req.method === "GET" && url.endsWith("/models")) {
      sendJson(res, 200, { object: "list", data: [{ id: "e2e-upstream-model" }] });
      return;
    }
    if (req.method === "POST" && url.endsWith("/chat/completions")) {
      await handleChat(req, res, url);
      return;
    }
    sendJson(res, 404, { error: { message: `unexpected ${req.method} ${url}` } });
  })().catch(() => {
    if (!res.headersSent) sendJson(res, 500, { error: { message: "mock upstream failure" } });
    else res.end();
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[mock-upstream] listening on http://127.0.0.1:${PORT}`);
});
