import { Buffer } from "node:buffer";
import type { RelayUsage } from "./types.js";

export const DEFAULT_SSE_AUDIT_MAX_BYTES = 20 * 1024 * 1024;
export const DEFAULT_SSE_EVENT_MAX_BYTES = 1024 * 1024;

type JsonObject = Record<string, unknown>;

export type SseAssembledFunctionCall = {
  name?: string;
  arguments: string;
};

export type SseAssembledToolCall = {
  index: number;
  id?: string;
  type?: string;
  function?: SseAssembledFunctionCall;
};

export type SseAssembledMessage = {
  role: string;
  content: string | null;
  name?: string;
  reasoning_content?: string;
  refusal?: string;
  function_call?: SseAssembledFunctionCall;
  tool_calls?: SseAssembledToolCall[];
};

export type SseAssembledChoice = {
  index: number;
  message: SseAssembledMessage;
  finish_reason: string | null;
  logprobs?: unknown;
};

/**
 * A canonical response reconstructed from chat.completion.chunk events.
 * It is intended for audit storage, not as a replacement client response.
 */
export type SseAssembledResponse = {
  id?: string;
  object: string;
  created?: number;
  model?: string;
  system_fingerprint?: string | null;
  service_tier?: string | null;
  choices: SseAssembledChoice[];
  usage?: Record<string, unknown>;
};

export type SseAuditSnapshot = {
  bytesSeen: number;
  auditBytesCaptured: number;
  truncated: boolean;
  doneSeen: boolean;
  eventCount: number;
  jsonEventCount: number;
  malformedEventCount: number;
  oversizedEventCount: number;
  usage: RelayUsage;
  assembled: SseAssembledResponse;
  upstreamError: unknown | null;
  /** Epoch ms of the first chunk containing output content (text/reasoning/refusal/tool-call). Null if no content was seen. */
  firstTokenAt: number | null;
};

type MutableFunctionCall = {
  name?: string;
  argumentParts: string[];
};

type MutableToolCall = {
  index: number;
  id?: string;
  type?: string;
  functionCall?: MutableFunctionCall;
};

type MutableChoice = {
  index: number;
  role?: string;
  name?: string;
  contentParts: string[];
  contentSeen: boolean;
  reasoningParts: string[];
  reasoningSeen: boolean;
  refusalParts: string[];
  refusalSeen: boolean;
  functionCall?: MutableFunctionCall;
  toolCalls: Map<number, MutableToolCall>;
  finishReason: string | null;
  logprobs?: unknown;
};

function asObject(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function asNonNegativeInteger(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return Math.trunc(value);
}

function emptyUsage(): RelayUsage {
  return {
    promptTokens: null,
    completionTokens: null,
    totalTokens: null,
    raw: null,
  };
}

function parseUsage(value: unknown): RelayUsage | null {
  const raw = asObject(value);
  if (!raw) return null;

  const promptTokens = asNonNegativeInteger(raw.prompt_tokens);
  const completionTokens = asNonNegativeInteger(raw.completion_tokens);
  const suppliedTotal = asNonNegativeInteger(raw.total_tokens);
  const totalTokens = suppliedTotal ??
    (promptTokens !== null && completionTokens !== null
      ? promptTokens + completionTokens
      : null);

  return {
    promptTokens,
    completionTokens,
    totalTokens,
    raw,
  };
}

function normalizedLimit(value: number | undefined, fallback: number, allowZero = false): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  const integer = Math.trunc(value);
  if (allowZero ? integer < 0 : integer <= 0) return fallback;
  return integer;
}

function setString(target: JsonObject, key: string, assign: (value: string) => void): void {
  const value = target[key];
  if (typeof value === "string") assign(value);
}

function appendString(
  target: JsonObject,
  key: string,
  parts: string[],
  markSeen: () => void,
): void {
  const value = target[key];
  if (typeof value === "string") {
    markSeen();
    parts.push(value);
  } else if (value === null) {
    markSeen();
  }
}

/**
 * Incrementally observes SSE bytes without modifying them. It accepts arbitrary
 * UTF-8 and SSE line splits, including CRLF split across network chunks.
 */
export class SseAuditInspector {
  private readonly decoder = new TextDecoder();
  private readonly maxAuditBytes: number;
  private readonly maxEventBytes: number;
  private readonly choices = new Map<number, MutableChoice>();

  private lineBuffer = "";
  private dataLines: string[] = [];
  private eventCodeUnits = 0;
  private pendingCarriageReturn = false;
  private discardCurrentEvent = false;
  private firstLine = true;
  private ended = false;

  private responseId?: string;
  private responseObject?: string;
  private responseCreated?: number;
  private responseModel?: string;
  private systemFingerprint?: string | null;
  private serviceTier?: string | null;
  private lastUsage: RelayUsage = emptyUsage();
  private lastUpstreamError: unknown | null = null;
  private firstTokenAt: number | null = null;

  private totalBytes = 0;
  private retainedAuditBytes = 0;
  private auditTruncated = false;
  private sawDone = false;
  private dataEventCount = 0;
  private parsedJsonEventCount = 0;
  private malformedJsonEventCount = 0;
  private droppedOversizedEventCount = 0;

  constructor(options: { maxAuditBytes?: number; maxEventBytes?: number } = {}) {
    this.maxAuditBytes = normalizedLimit(
      options.maxAuditBytes,
      DEFAULT_SSE_AUDIT_MAX_BYTES,
      true,
    );
    this.maxEventBytes = normalizedLimit(
      options.maxEventBytes,
      DEFAULT_SSE_EVENT_MAX_BYTES,
    );
  }

  feed(chunk: Uint8Array): void {
    if (this.ended) throw new Error("SSE inspector has already finished");
    this.totalBytes += chunk.byteLength;
    this.consumeText(this.decoder.decode(chunk, { stream: true }));
  }

  finish(): SseAuditSnapshot {
    if (!this.ended) {
      this.consumeText(this.decoder.decode());

      if (this.pendingCarriageReturn) {
        this.pendingCarriageReturn = false;
        this.finishLine();
      }

      if (this.lineBuffer.length > 0 || this.discardCurrentEvent) {
        this.processLine(this.lineBuffer);
        this.lineBuffer = "";
      }
      if (this.dataLines.length > 0 || this.discardCurrentEvent) {
        this.dispatchEvent();
      }
      this.ended = true;
    }
    return this.snapshot();
  }

  snapshot(): SseAuditSnapshot {
    const choices = [...this.choices.values()]
      .sort((left, right) => left.index - right.index)
      .map((choice): SseAssembledChoice => {
        const message: SseAssembledMessage = {
          role: choice.role ?? "assistant",
          content: choice.contentSeen ? choice.contentParts.join("") : null,
        };

        if (choice.name !== undefined) message.name = choice.name;
        if (choice.reasoningSeen) {
          message.reasoning_content = choice.reasoningParts.join("");
        }
        if (choice.refusalSeen) message.refusal = choice.refusalParts.join("");
        if (choice.functionCall) {
          message.function_call = {
            ...(choice.functionCall.name !== undefined
              ? { name: choice.functionCall.name }
              : {}),
            arguments: choice.functionCall.argumentParts.join(""),
          };
        }

        const toolCalls = [...choice.toolCalls.values()]
          .sort((left, right) => left.index - right.index)
          .map((tool): SseAssembledToolCall => ({
            index: tool.index,
            ...(tool.id !== undefined ? { id: tool.id } : {}),
            ...(tool.type !== undefined ? { type: tool.type } : {}),
            ...(tool.functionCall
              ? {
                  function: {
                    ...(tool.functionCall.name !== undefined
                      ? { name: tool.functionCall.name }
                      : {}),
                    arguments: tool.functionCall.argumentParts.join(""),
                  },
                }
              : {}),
          }));
        if (toolCalls.length > 0) message.tool_calls = toolCalls;

        return {
          index: choice.index,
          message,
          finish_reason: choice.finishReason,
          ...(choice.logprobs !== undefined ? { logprobs: choice.logprobs } : {}),
        };
      });

    const assembled: SseAssembledResponse = {
      ...(this.responseId !== undefined ? { id: this.responseId } : {}),
      object:
        this.responseObject === "chat.completion.chunk"
          ? "chat.completion"
          : (this.responseObject ?? "chat.completion"),
      ...(this.responseCreated !== undefined ? { created: this.responseCreated } : {}),
      ...(this.responseModel !== undefined ? { model: this.responseModel } : {}),
      ...(this.systemFingerprint !== undefined
        ? { system_fingerprint: this.systemFingerprint }
        : {}),
      ...(this.serviceTier !== undefined ? { service_tier: this.serviceTier } : {}),
      choices,
      ...(this.lastUsage.raw ? { usage: this.lastUsage.raw } : {}),
    };

    return {
      bytesSeen: this.totalBytes,
      auditBytesCaptured: this.retainedAuditBytes,
      truncated: this.auditTruncated,
      doneSeen: this.sawDone,
      eventCount: this.dataEventCount,
      jsonEventCount: this.parsedJsonEventCount,
      malformedEventCount: this.malformedJsonEventCount,
      oversizedEventCount: this.droppedOversizedEventCount,
      usage: {
        promptTokens: this.lastUsage.promptTokens,
        completionTokens: this.lastUsage.completionTokens,
        totalTokens: this.lastUsage.totalTokens,
        raw: this.lastUsage.raw,
      },
      assembled,
      upstreamError: this.lastUpstreamError,
      firstTokenAt: this.firstTokenAt,
    };
  }

  private markFirstToken(): void {
    if (this.firstTokenAt === null) this.firstTokenAt = Date.now();
  }

  private consumeText(text: string): void {
    for (let index = 0; index < text.length; index += 1) {
      const character = text[index];

      if (this.pendingCarriageReturn) {
        this.pendingCarriageReturn = false;
        this.finishLine();
        if (character === "\n") continue;
      }

      if (character === "\r") {
        this.pendingCarriageReturn = true;
        continue;
      }
      if (character === "\n") {
        this.finishLine();
        continue;
      }

      if (!this.discardCurrentEvent) {
        this.eventCodeUnits += 1;
        if (this.eventCodeUnits > this.maxEventBytes) {
          this.discardCurrentEvent = true;
          this.auditTruncated = true;
          this.lineBuffer = "";
          this.dataLines = [];
        } else {
          this.lineBuffer += character;
        }
      }
    }
  }

  private finishLine(): void {
    const line = this.lineBuffer;
    this.lineBuffer = "";
    this.processLine(line);
  }

  private processLine(input: string): void {
    let line = input;
    if (this.firstLine) {
      this.firstLine = false;
      if (line.startsWith("\uFEFF")) line = line.slice(1);
    }

    if (line === "") {
      this.dispatchEvent();
      return;
    }
    if (this.discardCurrentEvent || line.startsWith(":")) return;

    const separator = line.indexOf(":");
    const field = separator === -1 ? line : line.slice(0, separator);
    if (field !== "data") return;

    let value = separator === -1 ? "" : line.slice(separator + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    this.dataLines.push(value);
  }

  private dispatchEvent(): void {
    if (this.discardCurrentEvent) {
      this.droppedOversizedEventCount += 1;
      this.resetEvent();
      return;
    }
    if (this.dataLines.length === 0) {
      this.resetEvent();
      return;
    }

    const data = this.dataLines.join("\n");
    this.dataEventCount += 1;
    this.resetEvent();

    if (data.trim() === "[DONE]") {
      this.sawDone = true;
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      this.malformedJsonEventCount += 1;
      return;
    }

    const chunk = asObject(parsed);
    if (!chunk) {
      this.malformedJsonEventCount += 1;
      return;
    }
    this.parsedJsonEventCount += 1;

    const usage = parseUsage(chunk.usage);
    if (usage) this.lastUsage = usage;
    if (Object.hasOwn(chunk, "error") && chunk.error !== null) {
      this.lastUpstreamError = chunk.error;
    }

    const eventBytes = Buffer.byteLength(data, "utf8");
    if (this.retainedAuditBytes + eventBytes > this.maxAuditBytes) {
      this.auditTruncated = true;
      return;
    }
    this.retainedAuditBytes += eventBytes;
    this.applyChunk(chunk);
  }

  private resetEvent(): void {
    this.dataLines = [];
    this.eventCodeUnits = 0;
    this.discardCurrentEvent = false;
  }

  private applyChunk(chunk: JsonObject): void {
    setString(chunk, "id", (value) => {
      this.responseId = value;
    });
    setString(chunk, "object", (value) => {
      this.responseObject = value;
    });
    setString(chunk, "model", (value) => {
      this.responseModel = value;
    });

    if (typeof chunk.created === "number" && Number.isFinite(chunk.created)) {
      this.responseCreated = chunk.created;
    }
    if (typeof chunk.system_fingerprint === "string" || chunk.system_fingerprint === null) {
      this.systemFingerprint = chunk.system_fingerprint;
    }
    if (typeof chunk.service_tier === "string" || chunk.service_tier === null) {
      this.serviceTier = chunk.service_tier;
    }

    if (!Array.isArray(chunk.choices)) return;
    for (let position = 0; position < chunk.choices.length; position += 1) {
      const sourceChoice = asObject(chunk.choices[position]);
      if (!sourceChoice) continue;
      const suppliedIndex = asNonNegativeInteger(sourceChoice.index);
      const choiceIndex = suppliedIndex ?? position;
      const choice = this.getChoice(choiceIndex);

      const delta = asObject(sourceChoice.delta) ?? asObject(sourceChoice.message);
      if (delta) this.applyDelta(choice, delta);

      if (typeof sourceChoice.finish_reason === "string") {
        choice.finishReason = sourceChoice.finish_reason;
      } else if (sourceChoice.finish_reason === null && choice.finishReason === null) {
        choice.finishReason = null;
      }
      if (sourceChoice.logprobs !== undefined && sourceChoice.logprobs !== null) {
        choice.logprobs = sourceChoice.logprobs;
      }
    }
  }

  private getChoice(index: number): MutableChoice {
    const existing = this.choices.get(index);
    if (existing) return existing;

    const created: MutableChoice = {
      index,
      contentParts: [],
      contentSeen: false,
      reasoningParts: [],
      reasoningSeen: false,
      refusalParts: [],
      refusalSeen: false,
      toolCalls: new Map(),
      finishReason: null,
    };
    this.choices.set(index, created);
    return created;
  }

  private applyDelta(choice: MutableChoice, delta: JsonObject): void {
    setString(delta, "role", (value) => {
      choice.role = value;
    });
    setString(delta, "name", (value) => {
      choice.name = value;
    });
    let contentProduced = false;
    appendString(delta, "content", choice.contentParts, () => {
      choice.contentSeen = true;
      contentProduced = true;
    });
    appendString(delta, "reasoning_content", choice.reasoningParts, () => {
      choice.reasoningSeen = true;
      contentProduced = true;
    });
    appendString(delta, "refusal", choice.refusalParts, () => {
      choice.refusalSeen = true;
      contentProduced = true;
    });
    if (contentProduced) this.markFirstToken();

    const legacyFunction = asObject(delta.function_call);
    if (legacyFunction) {
      choice.functionCall ??= { argumentParts: [] };
      setString(legacyFunction, "name", (value) => {
        choice.functionCall!.name = value;
      });
      appendString(legacyFunction, "arguments", choice.functionCall.argumentParts, () => {});
    }

    if (!Array.isArray(delta.tool_calls)) {
      if (contentProduced) this.markFirstToken();
      return;
    }
    let toolCallSeen = false;
    for (let position = 0; position < delta.tool_calls.length; position += 1) {
      const sourceTool = asObject(delta.tool_calls[position]);
      if (!sourceTool) continue;
      const suppliedIndex = asNonNegativeInteger(sourceTool.index);
      const toolIndex = suppliedIndex ?? position;
      let tool = choice.toolCalls.get(toolIndex);
      if (!tool) {
        tool = { index: toolIndex };
        choice.toolCalls.set(toolIndex, tool);
      }

      setString(sourceTool, "id", (value) => {
        tool!.id = value;
      });
      setString(sourceTool, "type", (value) => {
        tool!.type = value;
      });

      const sourceFunction = asObject(sourceTool.function);
      if (!sourceFunction) continue;
      tool.functionCall ??= { argumentParts: [] };
      setString(sourceFunction, "name", (value) => {
        tool!.functionCall!.name = value;
      });
      appendString(sourceFunction, "arguments", tool.functionCall.argumentParts, () => {
        toolCallSeen = true;
      });
    }
    if (toolCallSeen || contentProduced) this.markFirstToken();
  }
}

export type SsePassthroughState = "completed" | "cancelled" | "errored";

export type SsePassthroughResult = {
  state: SsePassthroughState;
  audit: SseAuditSnapshot;
  reason?: unknown;
};

export type SsePassthroughOptions = {
  maxAuditBytes?: number;
  maxEventBytes?: number;
  /** Chunks already read for header/first-byte validation; they are emitted first, unchanged. */
  initialChunks?: readonly Uint8Array[];
  /** Useful for resetting an idle timeout without coupling this module to timers. */
  onChunk?: (chunk: Uint8Array) => void;
};

export type SsePassthrough = {
  stream: ReadableStream<Uint8Array>;
  inspector: SseAuditInspector;
  completion: Promise<SsePassthroughResult>;
  /** Cancels the upstream reader even after Fastify has locked `stream`. */
  cancel: (reason?: unknown) => Promise<void>;
};

export type SseReadableSource =
  | ReadableStream<Uint8Array>
  | ReadableStreamDefaultReader<Uint8Array>;

function acquireReader(source: SseReadableSource): ReadableStreamDefaultReader<Uint8Array> {
  return "getReader" in source ? source.getReader() : source;
}

/**
 * Wraps an upstream SSE body for `reply.send(result.stream)`. Every emitted
 * Uint8Array is the exact object read upstream; parsing happens out-of-band.
 * `completion` always resolves, including source errors and client cancellation.
 */
export function createSsePassthrough(
  source: SseReadableSource,
  options: SsePassthroughOptions = {},
): SsePassthrough {
  const reader = acquireReader(source);
  const inspector = new SseAuditInspector({
    maxAuditBytes: options.maxAuditBytes,
    maxEventBytes: options.maxEventBytes,
  });
  const initialChunks = [...(options.initialChunks ?? [])];

  let controllerReference: ReadableStreamDefaultController<Uint8Array> | null = null;
  let settled = false;
  let resolveCompletion!: (result: SsePassthroughResult) => void;
  const completion = new Promise<SsePassthroughResult>((resolve) => {
    resolveCompletion = resolve;
  });

  const settle = (state: SsePassthroughState, reason?: unknown): boolean => {
    if (settled) return false;
    settled = true;
    resolveCompletion({
      state,
      audit: inspector.finish(),
      ...(reason !== undefined ? { reason } : {}),
    });
    return true;
  };

  const cancelSource = async (reason?: unknown): Promise<void> => {
    try {
      await reader.cancel(reason);
    } catch {
      // The completion state is authoritative; cancellation is best effort.
    }
  };

  const cancel = async (reason?: unknown): Promise<void> => {
    if (!settle("cancelled", reason)) return;
    try {
      controllerReference?.close();
    } catch {
      // The downstream may already be closed or cancelled.
    }
    await cancelSource(reason);
  };

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controllerReference = controller;
    },

    async pull(controller) {
      if (settled) return;

      try {
        const next = initialChunks.length > 0
          ? { done: false as const, value: initialChunks.shift()! }
          : await reader.read();

        if (next.done) {
          controller.close();
          settle("completed");
          return;
        }

        inspector.feed(next.value);
        options.onChunk?.(next.value);
        controller.enqueue(next.value);
      } catch (error) {
        if (!settle("errored", error)) return;
        void cancelSource(error);
        try {
          controller.error(error);
        } catch {
          // The downstream may have cancelled while the read was pending.
        }
      }
    },

    async cancel(reason) {
      settle("cancelled", reason);
      await cancelSource(reason);
    },
  });

  return { stream, inspector, completion, cancel };
}
