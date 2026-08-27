import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import type { RelayUpstreamAttemptResult } from "../src/lib/relay/upstream.js";

process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:5432/test";
process.env.REDIS_URL ??= "redis://127.0.0.1:6379/15";
process.env.JWT_SECRET ??= "unit-test-jwt-secret";
process.env.CREDENTIAL_ENCRYPT_KEY ??= "unit-test-credential-secret";

const {
  RelayResponseTooLargeError,
  readBoundedBody,
  readFirstNonEmptyChunk,
  chatCompletionRoutes,
  settleFailedAttempt,
  toFastifyReadable,
} = await import("../src/routes/relay/chat-completions.js");
const { anthropicMessageRoutes } = await import(
  "../src/routes/relay/anthropic-messages.js"
);

test("employee relay exposes Chat Completions, Responses, and Anthropic Messages under /ai", async () => {
  const app = Fastify();
  await app.register(chatCompletionRoutes);
  await app.register(anthropicMessageRoutes);

  const currentRoutes = [
    { method: "GET", url: "/ai/models" },
    { method: "GET", url: "/ai/v1/models" },
    { method: "POST", url: "/ai/chat/completions" },
    { method: "POST", url: "/ai/responses" },
    { method: "POST", url: "/ai/v1/responses" },
    { method: "POST", url: "/ai/v1/messages" },
    { method: "POST", url: "/ai/v1/messages/count_tokens" },
  ] as const;
  for (const route of currentRoutes) {
    const response = await app.inject(route);
    assert.equal(response.statusCode, 401, `${route.method} ${route.url} is not registered`);
  }

  const unregisteredRoutes = [
    { method: "GET", url: "/v1/models" },
    { method: "POST", url: "/v1/chat/completions" },
    { method: "POST", url: "/v1/responses" },
    { method: "POST", url: "/v1/responses/compact" },
    { method: "POST", url: "/v1/messages" },
    { method: "POST", url: "/v1/messages/count_tokens" },
    { method: "POST", url: "/ai/responses/compact" },
  ] as const;
  for (const route of unregisteredRoutes) {
    const response = await app.inject(route);
    assert.equal(response.statusCode, 404, `${route.method} ${route.url} is still exposed`);
  }

  await app.close();
});

test("first-byte validation skips legal empty chunks", async () => {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array());
      controller.enqueue(new TextEncoder().encode("data: ok\n\n"));
      controller.close();
    },
  });

  const first = await readFirstNonEmptyChunk(stream.getReader());
  assert.equal(first.done, false);
  assert.equal(new TextDecoder().decode(first.value), "data: ok\n\n");
});

test("WHATWG streams are converted to byte-preserving Node streams", async () => {
  const chunks = [new Uint8Array([0, 1, 2]), new Uint8Array([253, 254, 255])];
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });

  const received: Buffer[] = [];
  for await (const chunk of toFastifyReadable(stream)) {
    received.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  assert.deepEqual(Buffer.concat(received), Buffer.from([0, 1, 2, 253, 254, 255]));
});

test("Fastify sends converted web streams as streams instead of JSON objects", async () => {
  const app = Fastify();
  app.get("/stream", async (_req, reply) => {
    const webStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("data: one\n\n"));
        controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
        controller.close();
      },
    });
    reply.type("text/event-stream");
    return reply.send(toFastifyReadable(webStream));
  });

  const response = await app.inject({ method: "GET", url: "/stream" });
  assert.equal(response.statusCode, 200);
  assert.match(response.headers["content-type"] ?? "", /text\/event-stream/);
  assert.equal(response.body, "data: one\n\ndata: [DONE]\n\n");
  await app.close();
});

test("terminal HTTP failures retain their body while retried failures release it", async () => {
  let terminalCancelled = false;
  const terminalResponse = new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"error":{"message":"bad"}}'));
        controller.close();
      },
      cancel() {
        terminalCancelled = true;
      },
    }),
  );
  let terminalCleanups = 0;
  const terminalResult: RelayUpstreamAttemptResult = {
    response: terminalResponse,
    kind: "client_error",
    retryable: false,
    status: 400,
    latencyMs: 1,
    errorCode: "upstream_bad_request",
    errorMessage: "bad request",
    cleanup: () => {
      terminalCleanups += 1;
    },
    abort: () => {},
  };
  assert.equal(await settleFailedAttempt(terminalResult, false), "retained");
  assert.equal(terminalCancelled, false);
  assert.equal(terminalCleanups, 0);
  assert.equal(await terminalResponse.text(), '{"error":{"message":"bad"}}');
  terminalResult.cleanup();
  assert.equal(terminalCleanups, 1);

  let retryCancelled = false;
  const retryResponse = new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1]));
      },
      cancel() {
        retryCancelled = true;
      },
    }),
  );
  let retryCleanups = 0;
  const retryResult: RelayUpstreamAttemptResult = {
    ...terminalResult,
    response: retryResponse,
    retryable: true,
    cleanup: () => {
      retryCleanups += 1;
    },
  };
  assert.equal(await settleFailedAttempt(retryResult, true), "released");
  assert.equal(retryCancelled, true);
  assert.equal(retryCleanups, 1);
});

test("bounded response reads accept the limit and cancel oversized bodies", async () => {
  const exact = new Response(new Uint8Array([1, 2, 3, 4]));
  assert.deepEqual(await readBoundedBody(exact, 4), Buffer.from([1, 2, 3, 4]));

  let cancelled = false;
  const oversized = new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
        controller.enqueue(new Uint8Array([4, 5]));
      },
      cancel() {
        cancelled = true;
      },
    }),
  );

  await assert.rejects(
    () => readBoundedBody(oversized, 4),
    (error: unknown) => error instanceof RelayResponseTooLargeError,
  );
  assert.equal(cancelled, true);
});
