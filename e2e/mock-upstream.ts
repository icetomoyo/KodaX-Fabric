import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

/**
 * E2E 专用 OpenAI 兼容 mock 上游（端口 3311）。
 * 被「员工测试渠道 KEY」的连通性探测和 relay 转发共同命中：
 * 任何 Bearer 都接受，回显请求模型，固定 usage，从不访问外网。
 */
const PORT = 3311;
const USAGE = { prompt_tokens: 12, completion_tokens: 34, total_tokens: 46 };

interface ChatRequestBody {
  model?: unknown;
  stream?: unknown;
  messages?: unknown;
}

async function readBody(req: IncomingMessage): Promise<ChatRequestBody> {
  const raw = await new Promise<string>((resolve, reject) => {
    let data = "";
    req.on("data", (chunk: Buffer) => {
      data += chunk.toString("utf8");
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
  try {
    return JSON.parse(raw) as ChatRequestBody;
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

const server = createServer((req, res) => {
  void (async () => {
    const url = req.url ?? "";
    if (req.method === "GET" && (url === "/" || url === "/health")) {
      sendJson(res, 200, { ok: true, service: "e2e-mock-upstream" });
      return;
    }
    if (req.method === "GET" && url.endsWith("/models")) {
      sendJson(res, 200, { object: "list", data: [{ id: "e2e-upstream-model" }] });
      return;
    }
    if (req.method === "POST" && url.endsWith("/chat/completions")) {
      const body = await readBody(req);
      const model = typeof body.model === "string" ? body.model : "e2e-upstream-model";
      console.log(`[mock-upstream] POST ${url} model=${model} stream=${Boolean(body.stream)}`);
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
            message: { role: "assistant", content: "E2E mock reply" },
            finish_reason: "stop",
          },
        ],
        usage: USAGE,
      });
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
