import { Buffer } from "node:buffer";
import type { RelayUsage } from "./types.js";

export const DEFAULT_NATIVE_SSE_AUDIT_MAX_BYTES = 20 * 1024 * 1024;
export const DEFAULT_NATIVE_SSE_EVENT_MAX_BYTES = 20 * 1024 * 1024;

export type NativeSseProtocol = "anthropic_messages";
export type NativeSseTerminalKind = "completed" | "error";

type JsonObject = Record<string, unknown>;

export type AnthropicAuditTextBlock = {
  index: number;
  type: "text";
  text: string;
};

export type AnthropicAuditToolUseBlock = {
  index: number;
  type: "tool_use";
  id?: string;
  name?: string;
  input: unknown;
  /** Concatenated input_json_delta payload, retained even when it is incomplete. */
  inputJson?: string;
  inputParseError?: true;
};

export type AnthropicAuditUnknownBlock = JsonObject & {
  index: number;
  type: string;
};

export type AnthropicAuditContentBlock =
  | AnthropicAuditTextBlock
  | AnthropicAuditToolUseBlock
  | AnthropicAuditUnknownBlock;

export type AnthropicAuditMessage = {
  id?: string;
  type: "message";
  role: string;
  model?: string;
  content: AnthropicAuditContentBlock[];
  stopReason: string | null;
  stopSequence: string | null;
  usage?: JsonObject;
};

export type AnthropicMessagesSseAssembly = {
  protocol: "anthropic_messages";
  message: AnthropicAuditMessage;
};

export type NativeSseAssembly = AnthropicMessagesSseAssembly;

export type NativeSseAuditSnapshot = {
  protocol: NativeSseProtocol;
  bytesSeen: number;
  auditBytesCaptured: number;
  truncated: boolean;
  terminalSeen: boolean;
  terminalEvent: string | null;
  terminalKind: NativeSseTerminalKind | null;
  eventCount: number;
  jsonEventCount: number;
  malformedEventCount: number;
  oversizedEventCount: number;
  usage: RelayUsage;
  assembled: NativeSseAssembly;
  upstreamError: unknown | null;
};

export type NativeSseAuditOptions = {
  protocol: NativeSseProtocol;
  maxAuditBytes?: number;
  maxEventBytes?: number;
};

type MutableAnthropicBlock = {
  index: number;
  type: string;
  raw: JsonObject;
  id?: string;
  name?: string;
  initialInput?: unknown;
  textParts: string[];
  inputJsonParts: string[];
  inputJsonSeen: boolean;
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

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function emptyUsage(): RelayUsage {
  return {
    promptTokens: null,
    completionTokens: null,
    totalTokens: null,
    raw: null,
  };
}

function mergeNativeUsage(current: RelayUsage, value: unknown): RelayUsage {
  const update = asObject(value);
  if (!update) return current;

  const raw = { ...(current.raw ?? {}), ...update };
  const inputTokens = asNonNegativeInteger(raw.input_tokens);
  const cacheCreationTokens = asNonNegativeInteger(raw.cache_creation_input_tokens);
  const cacheReadTokens = asNonNegativeInteger(raw.cache_read_input_tokens);
  const hasAnthropicInputBreakdown =
    cacheCreationTokens !== null || cacheReadTokens !== null;
  const promptTokens = hasAnthropicInputBreakdown
    ? (inputTokens ?? 0) + (cacheCreationTokens ?? 0) + (cacheReadTokens ?? 0)
    : (inputTokens ?? current.promptTokens);
  const completionTokens =
    asNonNegativeInteger(update.output_tokens) ?? current.completionTokens;
  const suppliedTotal = asNonNegativeInteger(update.total_tokens);
  const totalTokens = suppliedTotal ??
    (promptTokens !== null && completionTokens !== null
      ? promptTokens + completionTokens
      : current.totalTokens);

  return { promptTokens, completionTokens, totalTokens, raw };
}

function normalizedLimit(value: number | undefined, fallback: number, allowZero = false): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  const integer = Math.trunc(value);
  if (allowZero ? integer < 0 : integer <= 0) return fallback;
  return integer;
}

/**
 * Incrementally observes Anthropic Messages SSE without changing the bytes.
 * UTF-8 code points, CRLF pairs, lines, and events may all be split at
 * arbitrary network chunk boundaries.
 */
export class NativeSseAuditInspector {
  readonly protocol: NativeSseProtocol;

  private readonly decoder = new TextDecoder();
  private readonly maxAuditBytes: number;
  private readonly maxEventBytes: number;

  private lineBuffer = "";
  private lineHasCharacters = false;
  private dataLines: string[] = [];
  private eventName: string | null = null;
  private eventBytes = 0;
  private eventHasData = false;
  private pendingCarriageReturn = false;
  private discardCurrentEvent = false;
  private firstLine = true;
  private ended = false;

  private totalBytes = 0;
  private retainedAuditBytes = 0;
  private auditTruncated = false;
  private dataEventCount = 0;
  private parsedJsonEventCount = 0;
  private malformedJsonEventCount = 0;
  private droppedOversizedEventCount = 0;

  private terminalEvent: string | null = null;
  private terminalKind: NativeSseTerminalKind | null = null;
  private lastUsage: RelayUsage = emptyUsage();
  private lastUpstreamError: unknown | null = null;

  private anthropicId?: string;
  private anthropicRole = "assistant";
  private anthropicModel?: string;
  private anthropicStopReason: string | null = null;
  private anthropicStopSequence: string | null = null;
  private readonly anthropicBlocks = new Map<number, MutableAnthropicBlock>();

  constructor(options: NativeSseAuditOptions) {
    this.protocol = options.protocol;
    this.maxAuditBytes = normalizedLimit(
      options.maxAuditBytes,
      DEFAULT_NATIVE_SSE_AUDIT_MAX_BYTES,
      true,
    );
    this.maxEventBytes = normalizedLimit(
      options.maxEventBytes,
      DEFAULT_NATIVE_SSE_EVENT_MAX_BYTES,
    );
  }

  feed(chunk: Uint8Array): void {
    if (this.ended) throw new Error("Native SSE inspector has already finished");
    this.totalBytes += chunk.byteLength;
    this.consumeText(this.decoder.decode(chunk, { stream: true }));
  }

  finish(): NativeSseAuditSnapshot {
    if (!this.ended) {
      this.consumeText(this.decoder.decode());

      if (this.pendingCarriageReturn) {
        this.pendingCarriageReturn = false;
        this.finishLine();
      }
      if (this.lineBuffer.length > 0 || this.discardCurrentEvent) {
        this.finishLine();
      }
      if (this.eventHasData || this.eventName !== null || this.discardCurrentEvent) {
        this.dispatchEvent();
      }
      this.ended = true;
    }
    return this.snapshot();
  }

  snapshot(): NativeSseAuditSnapshot {
    return {
      protocol: this.protocol,
      bytesSeen: this.totalBytes,
      auditBytesCaptured: this.retainedAuditBytes,
      truncated: this.auditTruncated,
      terminalSeen: this.terminalKind !== null,
      terminalEvent: this.terminalEvent,
      terminalKind: this.terminalKind,
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
      assembled: this.snapshotAnthropic(),
      upstreamError: this.lastUpstreamError,
    };
  }

  private snapshotAnthropic(): AnthropicMessagesSseAssembly {
    const content = [...this.anthropicBlocks.values()]
      .sort((left, right) => left.index - right.index)
      .map((block): AnthropicAuditContentBlock => {
        if (block.type === "text") {
          return {
            index: block.index,
            type: "text",
            text: block.textParts.join(""),
          };
        }

        if (block.type === "tool_use") {
          const inputJson = block.inputJsonParts.join("");
          let input = block.initialInput ?? {};
          let inputParseError = false;
          if (block.inputJsonSeen && inputJson.trim() !== "") {
            try {
              input = JSON.parse(inputJson);
            } catch {
              inputParseError = true;
            }
          }

          return {
            index: block.index,
            type: "tool_use",
            ...(block.id !== undefined ? { id: block.id } : {}),
            ...(block.name !== undefined ? { name: block.name } : {}),
            input,
            ...(block.inputJsonSeen ? { inputJson } : {}),
            ...(inputParseError ? { inputParseError: true } : {}),
          };
        }

        return {
          ...block.raw,
          index: block.index,
          type: block.type,
        };
      });

    return {
      protocol: "anthropic_messages",
      message: {
        ...(this.anthropicId !== undefined ? { id: this.anthropicId } : {}),
        type: "message",
        role: this.anthropicRole,
        ...(this.anthropicModel !== undefined ? { model: this.anthropicModel } : {}),
        content,
        stopReason: this.anthropicStopReason,
        stopSequence: this.anthropicStopSequence,
        ...(this.lastUsage.raw ? { usage: this.lastUsage.raw } : {}),
      },
    };
  }

  private consumeText(text: string): void {
    for (const character of text) {
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

      this.lineHasCharacters = true;
      if (!this.discardCurrentEvent) {
        this.eventBytes += Buffer.byteLength(character, "utf8");
        if (this.eventBytes > this.maxEventBytes) {
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
    const lineHasCharacters = this.lineHasCharacters;
    this.lineBuffer = "";
    this.lineHasCharacters = false;
    if (this.discardCurrentEvent) {
      // Once an event is over the bound, retain only enough state to find its
      // actual blank-line delimiter without buffering the remaining long line.
      if (!lineHasCharacters) this.dispatchEvent();
      return;
    }
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
    let value = separator === -1 ? "" : line.slice(separator + 1);
    if (value.startsWith(" ")) value = value.slice(1);

    if (field === "event") {
      this.eventName = value;
      return;
    }
    if (field === "data") {
      this.eventHasData = true;
      this.dataLines.push(value);
    }
  }

  private dispatchEvent(): void {
    if (this.discardCurrentEvent) {
      this.droppedOversizedEventCount += 1;
      if (this.eventName) this.observeOversizedEvent(this.eventName);
      this.resetEvent();
      return;
    }
    if (!this.eventHasData) {
      this.resetEvent();
      return;
    }

    const data = this.dataLines.join("\n");
    const namedEvent = this.eventName;
    this.dataEventCount += 1;
    this.resetEvent();

    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      this.malformedJsonEventCount += 1;
      return;
    }

    const payload = asObject(parsed);
    if (!payload) {
      this.malformedJsonEventCount += 1;
      return;
    }
    this.parsedJsonEventCount += 1;

    const payloadType = stringValue(payload.type);
    const eventType = payloadType ?? namedEvent ?? "message";
    this.observeEssential(eventType, payload);

    const dataBytes = Buffer.byteLength(data, "utf8");
    if (this.retainedAuditBytes + dataBytes > this.maxAuditBytes) {
      this.auditTruncated = true;
      return;
    }
    this.retainedAuditBytes += dataBytes;

    this.applyAnthropicEvent(eventType, payload);
  }

  private resetEvent(): void {
    this.dataLines = [];
    this.eventName = null;
    this.eventBytes = 0;
    this.eventHasData = false;
    this.discardCurrentEvent = false;
  }

  private observeOversizedEvent(eventType: string): void {
    if (eventType === "message_stop") this.markTerminal(eventType, "completed");
    if (eventType === "error") {
      this.markTerminal(eventType, "error");
      this.lastUpstreamError = { type: "error", message: "Oversized SSE error event" };
    }
  }

  private observeEssential(eventType: string, payload: JsonObject): void {
    const message = asObject(payload.message);
    this.lastUsage = mergeNativeUsage(
      this.lastUsage,
      message?.usage ?? payload.usage,
    );
    if (eventType === "message_stop") {
      this.markTerminal(eventType, "completed");
    } else if (eventType === "error") {
      this.markTerminal(eventType, "error");
      this.lastUpstreamError = payload.error ?? {
        type: "error",
        ...(typeof payload.message === "string" ? { message: payload.message } : {}),
      };
    }
  }

  private markTerminal(eventType: string, kind: NativeSseTerminalKind): void {
    if (this.terminalKind === "error" && kind !== "error") return;
    this.terminalEvent = eventType;
    this.terminalKind = kind;
  }

  private applyAnthropicEvent(eventType: string, payload: JsonObject): void {
    if (eventType === "message_start") {
      const message = asObject(payload.message);
      if (!message) return;
      this.anthropicId = stringValue(message.id) ?? this.anthropicId;
      this.anthropicRole = stringValue(message.role) ?? this.anthropicRole;
      this.anthropicModel = stringValue(message.model) ?? this.anthropicModel;
      if (typeof message.stop_reason === "string" || message.stop_reason === null) {
        this.anthropicStopReason = message.stop_reason;
      }
      if (typeof message.stop_sequence === "string" || message.stop_sequence === null) {
        this.anthropicStopSequence = message.stop_sequence;
      }
      if (Array.isArray(message.content)) {
        for (let index = 0; index < message.content.length; index += 1) {
          const block = asObject(message.content[index]);
          if (block) this.applyAnthropicBlockStart(index, block);
        }
      }
      return;
    }

    if (eventType === "content_block_start") {
      const index = asNonNegativeInteger(payload.index);
      const block = asObject(payload.content_block);
      if (index !== null && block) this.applyAnthropicBlockStart(index, block);
      return;
    }

    if (eventType === "content_block_delta") {
      const index = asNonNegativeInteger(payload.index);
      const delta = asObject(payload.delta);
      if (index !== null && delta) this.applyAnthropicBlockDelta(index, delta);
      return;
    }

    if (eventType === "message_delta") {
      const delta = asObject(payload.delta);
      if (!delta) return;
      if (typeof delta.stop_reason === "string" || delta.stop_reason === null) {
        this.anthropicStopReason = delta.stop_reason;
      }
      if (typeof delta.stop_sequence === "string" || delta.stop_sequence === null) {
        this.anthropicStopSequence = delta.stop_sequence;
      }
    }
  }

  private applyAnthropicBlockStart(index: number, source: JsonObject): void {
    const type = stringValue(source.type) ?? "unknown";
    let block = this.anthropicBlocks.get(index);
    if (!block) {
      block = {
        index,
        type,
        raw: source,
        textParts: [],
        inputJsonParts: [],
        inputJsonSeen: false,
      };
      this.anthropicBlocks.set(index, block);
    } else {
      block.type = type;
      block.raw = source;
    }

    block.id = stringValue(source.id) ?? block.id;
    block.name = stringValue(source.name) ?? block.name;
    if (Object.hasOwn(source, "input")) block.initialInput = source.input;
    if (type === "text" && typeof source.text === "string") {
      block.textParts.push(source.text);
    }
  }

  private applyAnthropicBlockDelta(index: number, delta: JsonObject): void {
    const deltaType = stringValue(delta.type) ?? "unknown";
    let block = this.anthropicBlocks.get(index);
    if (!block) {
      block = {
        index,
        type: deltaType === "input_json_delta" ? "tool_use" : "text",
        raw: { type: deltaType === "input_json_delta" ? "tool_use" : "text" },
        textParts: [],
        inputJsonParts: [],
        inputJsonSeen: false,
      };
      this.anthropicBlocks.set(index, block);
    }

    if (deltaType === "text_delta" && typeof delta.text === "string") {
      block.textParts.push(delta.text);
    }
    if (deltaType === "input_json_delta" && typeof delta.partial_json === "string") {
      block.inputJsonSeen = true;
      block.inputJsonParts.push(delta.partial_json);
    }
  }
}

export type NativeSsePassthroughState = "completed" | "cancelled" | "errored";

export type NativeSsePassthroughResult = {
  state: NativeSsePassthroughState;
  audit: NativeSseAuditSnapshot;
  reason?: unknown;
};

export type NativeSseReadableSource =
  | ReadableStream<Uint8Array>
  | ReadableStreamDefaultReader<Uint8Array>;

export type NativeSsePassthroughOptions = NativeSseAuditOptions & {
  initialChunks?: readonly Uint8Array[];
  onChunk?: (chunk: Uint8Array) => void;
};

export type NativeSsePassthrough = {
  stream: ReadableStream<Uint8Array>;
  inspector: NativeSseAuditInspector;
  completion: Promise<NativeSsePassthroughResult>;
  cancel: (reason?: unknown) => Promise<void>;
};

function acquireReader(
  source: NativeSseReadableSource,
): ReadableStreamDefaultReader<Uint8Array> {
  return "getReader" in source ? source.getReader() : source;
}

/**
 * Wraps an SSE source while enqueueing the exact Uint8Array objects read from
 * upstream. Parsing is side-band and completion always resolves.
 */
export function createNativeSsePassthrough(
  source: NativeSseReadableSource,
  options: NativeSsePassthroughOptions,
): NativeSsePassthrough {
  const reader = acquireReader(source);
  const inspector = new NativeSseAuditInspector(options);
  const initialChunks = [...(options.initialChunks ?? [])];

  let controllerReference: ReadableStreamDefaultController<Uint8Array> | null = null;
  let settled = false;
  let resolveCompletion!: (result: NativeSsePassthroughResult) => void;
  const completion = new Promise<NativeSsePassthroughResult>((resolve) => {
    resolveCompletion = resolve;
  });

  const settle = (state: NativeSsePassthroughState, reason?: unknown): boolean => {
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
      // Cancellation is best effort; the completion state remains authoritative.
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
