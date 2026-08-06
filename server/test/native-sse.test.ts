import assert from "node:assert/strict";
import test from "node:test";
import {
  createNativeSsePassthrough,
  NativeSseAuditInspector,
  type NativeSseProtocol,
} from "../src/lib/relay/native-sse.js";

const encoder = new TextEncoder();

function sseEvent(name: string, payload: unknown, lineEnding = "\n"): string {
  return `event: ${name}${lineEnding}data: ${JSON.stringify(payload)}${lineEnding}${lineEnding}`;
}

function inspectBytewise(protocol: NativeSseProtocol, source: string) {
  const bytes = encoder.encode(source);
  const inspector = new NativeSseAuditInspector({ protocol });
  for (let index = 0; index < bytes.length; index += 1) {
    inspector.feed(bytes.subarray(index, index + 1));
  }
  return inspector.finish();
}

test("Anthropic SSE assembles text, tool input, usage, and terminal across byte splits", () => {
  const source = [
    "\uFEFF",
    sseEvent(
      "message_start",
      {
        type: "message_start",
        message: {
          id: "msg_1",
          type: "message",
          role: "assistant",
          model: "claude-test",
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 11, output_tokens: 1, cache_read_input_tokens: 2 },
        },
      },
      "\r\n",
    ),
    sseEvent(
      "content_block_start",
      {
        type: "content_block_start",
        index: 0,
        content_block: { type: "text", text: "" },
      },
      "\r\n",
    ),
    sseEvent("content_block_delta", {
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: "你" },
    }),
    sseEvent("content_block_delta", {
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: "好" },
    }),
    sseEvent("content_block_stop", { type: "content_block_stop", index: 0 }),
    sseEvent("content_block_start", {
      type: "content_block_start",
      index: 1,
      content_block: {
        type: "tool_use",
        id: "toolu_1",
        name: "read_file",
        input: {},
      },
    }),
    sseEvent("content_block_delta", {
      type: "content_block_delta",
      index: 1,
      delta: { type: "input_json_delta", partial_json: "{\"path\":\"文" },
    }),
    sseEvent("content_block_delta", {
      type: "content_block_delta",
      index: 1,
      delta: { type: "input_json_delta", partial_json: "件.ts\"}" },
    }),
    sseEvent("content_block_stop", { type: "content_block_stop", index: 1 }),
    sseEvent("message_delta", {
      type: "message_delta",
      delta: { stop_reason: "tool_use", stop_sequence: null },
      usage: { output_tokens: 7 },
    }),
    sseEvent("message_stop", { type: "message_stop" }),
  ].join("");

  const snapshot = inspectBytewise("anthropic_messages", source);

  assert.equal(snapshot.bytesSeen, encoder.encode(source).byteLength);
  assert.equal(snapshot.terminalSeen, true);
  assert.equal(snapshot.terminalEvent, "message_stop");
  assert.equal(snapshot.terminalKind, "completed");
  assert.equal(snapshot.malformedEventCount, 0);
  assert.deepEqual(
    {
      prompt: snapshot.usage.promptTokens,
      completion: snapshot.usage.completionTokens,
      total: snapshot.usage.totalTokens,
    },
    { prompt: 13, completion: 7, total: 20 },
  );
  assert.equal(snapshot.usage.raw?.cache_read_input_tokens, 2);

  assert.equal(snapshot.assembled.protocol, "anthropic_messages");
  if (snapshot.assembled.protocol !== "anthropic_messages") return;
  assert.equal(snapshot.assembled.message.id, "msg_1");
  assert.equal(snapshot.assembled.message.stopReason, "tool_use");
  assert.deepEqual(snapshot.assembled.message.content[0], {
    index: 0,
    type: "text",
    text: "你好",
  });
  assert.deepEqual(snapshot.assembled.message.content[1], {
    index: 1,
    type: "tool_use",
    id: "toolu_1",
    name: "read_file",
    input: { path: "文件.ts" },
    inputJson: '{"path":"文件.ts"}',
  });
});

test("Anthropic SSE error is terminal and retains the native error", () => {
  const error = { type: "overloaded_error", message: "Overloaded" };
  const snapshot = inspectBytewise(
    "anthropic_messages",
    sseEvent("error", { type: "error", error }),
  );

  assert.equal(snapshot.terminalSeen, true);
  assert.equal(snapshot.terminalKind, "error");
  assert.equal(snapshot.terminalEvent, "error");
  assert.deepEqual(snapshot.upstreamError, error);
});

test("native SSE passthrough preserves exact chunk objects and reports audit", async () => {
  const chunks = [
    encoder.encode('event: message_start\ndata: {"type":"message_start","message":'),
    encoder.encode(
      '{"id":"msg_2","role":"assistant","content":[],"usage":{"input_tokens":1,"output_tokens":0}}}\n\n',
    ),
    encoder.encode('event: message_stop\ndata: {"type":"message_stop"}\n\n'),
  ];
  const upstream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
  const passthrough = createNativeSsePassthrough(upstream, {
    protocol: "anthropic_messages",
  });
  const reader = passthrough.stream.getReader();
  const received: Uint8Array[] = [];
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    received.push(next.value);
  }
  const completion = await passthrough.completion;

  assert.equal(completion.state, "completed");
  assert.equal(completion.audit.terminalSeen, true);
  assert.equal(received.length, chunks.length);
  for (let index = 0; index < chunks.length; index += 1) {
    assert.strictEqual(received[index], chunks[index]);
  }
});

test("audit truncation does not hide terminal state or usage", () => {
  const source = [
    sseEvent("message_start", {
      type: "message_start",
      message: {
        id: "msg_large",
        type: "message",
        role: "assistant",
        content: [],
        usage: { input_tokens: 2, output_tokens: 0 },
      },
    }),
    sseEvent("message_delta", {
      type: "message_delta",
      delta: { stop_reason: "end_turn", stop_sequence: null },
      usage: { output_tokens: 4 },
    }),
    sseEvent("message_stop", { type: "message_stop" }),
  ].join("");
  const inspector = new NativeSseAuditInspector({
    protocol: "anthropic_messages",
    maxAuditBytes: 1,
  });
  inspector.feed(encoder.encode(source));
  const snapshot = inspector.finish();

  assert.equal(snapshot.truncated, true);
  assert.equal(snapshot.auditBytesCaptured, 0);
  assert.equal(snapshot.terminalSeen, true);
  assert.equal(snapshot.usage.totalTokens, 6);
  assert.equal(snapshot.assembled.protocol, "anthropic_messages");
  assert.deepEqual(snapshot.assembled.message.content, []);
});

test("an oversized named terminal event remains terminal until its blank delimiter", () => {
  const source = [
    "event: message_stop\n",
    `data: ${"x".repeat(100)}\n`,
    `data: ${"y".repeat(100)}\n`,
    "\n",
  ].join("");
  const inspector = new NativeSseAuditInspector({
    protocol: "anthropic_messages",
    maxEventBytes: 40,
  });
  const bytes = encoder.encode(source);
  for (let index = 0; index < bytes.length; index += 3) {
    inspector.feed(bytes.subarray(index, index + 3));
  }
  const snapshot = inspector.finish();

  assert.equal(snapshot.oversizedEventCount, 1);
  assert.equal(snapshot.terminalSeen, true);
  assert.equal(snapshot.terminalEvent, "message_stop");
  assert.equal(snapshot.terminalKind, "completed");
});
