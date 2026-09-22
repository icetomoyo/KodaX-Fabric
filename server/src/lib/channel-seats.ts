import type { SubmitableChannel, SubmitableChannelRow } from "./channel-credential-submit.js";

export const SEAT_CONFLICT_MESSAGE = "该员工在此渠道已有该席位";
export const SEAT_REQUIRED_MESSAGE = "没有该渠道的席位，不能提交渠道 KEY";
export const SEAT_ALREADY_SUBMITTED_MESSAGE = "该席位已提交渠道 KEY";
export const SEAT_EMPLOYEE_MISSING_MESSAGE = "员工不存在";
export const SEAT_CHANNEL_MISSING_MESSAGE = "渠道不存在";
export const SEAT_MISSING_MESSAGE = "席位不存在";
export const SEAT_TAG_INVALID_MESSAGE = "席位标签最多 32 个字符";
export const SEAT_CHANNEL_FULL_MESSAGE = "该渠道席位已满";
export const SEAT_COUNT_BELOW_REGISTERED_MESSAGE = "渠道席位不能少于已登记数";
export const SEAT_COUNT_REQUIRED_MESSAGE = "请填写席位数量";
export const SEAT_TAG_MAX_LENGTH = 32;
export const SEAT_COUNT_MAX = 100_000;

export function normalizeSeatCount(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > SEAT_COUNT_MAX) {
    return null;
  }
  return value;
}

export function planSeatCapacity(input: {
  seatCount: number;
  registered: number;
  adding: number;
}): { kind: "accepted"; remaining: number } | { kind: "full"; remaining: number } {
  if (input.seatCount <= 0) {
    return { kind: "accepted", remaining: Number.POSITIVE_INFINITY };
  }
  const remaining = Math.max(0, input.seatCount - input.registered);
  if (input.adding > remaining) return { kind: "full", remaining };
  return { kind: "accepted", remaining };
}

export function normalizeSeatTag(value: unknown): string | null {
  if (value == null) return "";
  if (typeof value !== "string") return null;
  const tag = value.trim();
  if (tag.length > SEAT_TAG_MAX_LENGTH) return null;
  return tag;
}

export function collectSubmitableChannelIds(
  seatProductLineIds: readonly number[],
): Set<number> {
  return new Set(
    seatProductLineIds.filter((id) => Number.isSafeInteger(id) && id > 0),
  );
}

export type SubmitableSeat = SubmitableChannel & {
  seatId: number;
  tag: string;
  productLineId: number;
};

export type SubmitableSeatRow = {
  id: number;
  productLineId: number;
  tag: string;
  credentialId: number | null;
};

export function collectSubmitableSeats(
  channels: readonly SubmitableChannelRow[],
  seats: readonly SubmitableSeatRow[],
): SubmitableSeat[] {
  const channelById = new Map(
    channels
      .filter((row) => row.status === "active" && row.providerStatus === "active")
      .map((row) => [row.id, row]),
  );
  return [...seats]
    .filter((seat) => seat.credentialId == null && channelById.has(seat.productLineId))
    .sort((left, right) => {
      if (left.productLineId !== right.productLineId) {
        return left.productLineId - right.productLineId;
      }
      if (left.tag !== right.tag) return left.tag.localeCompare(right.tag, "zh");
      return left.id - right.id;
    })
    .flatMap((seat) => {
      const channel = channelById.get(seat.productLineId);
      if (!channel) return [];
      return [{
        seatId: seat.id,
        tag: seat.tag,
        productLineId: channel.id,
        id: channel.id,
        name: channel.name,
        code: channel.code,
        productType: channel.productType,
        providerCode: channel.providerCode,
        providerName: channel.providerName,
      }];
    });
}

export type SeatCreatePlan =
  | { kind: "accepted" }
  | { kind: "employee_missing" }
  | { kind: "channel_missing" }
  | { kind: "conflict" }
  | { kind: "tag_invalid" };

export function planChannelSeatCreate(input: {
  employeeRole: string | null;
  employeeExists: boolean;
  channelExists: boolean;
  alreadySeated: boolean;
  tagValid?: boolean;
}): SeatCreatePlan {
  if (input.tagValid === false) return { kind: "tag_invalid" };
  if (!input.employeeExists) return { kind: "employee_missing" };
  if (!input.channelExists) return { kind: "channel_missing" };
  if (input.alreadySeated) return { kind: "conflict" };
  return { kind: "accepted" };
}

export function seatCreateError(kind: Exclude<SeatCreatePlan["kind"], "accepted">): {
  status: number;
  message: string;
} {
  switch (kind) {
    case "employee_missing":
      return { status: 404, message: SEAT_EMPLOYEE_MISSING_MESSAGE };
    case "channel_missing":
      return { status: 404, message: SEAT_CHANNEL_MISSING_MESSAGE };
    case "conflict":
      return { status: 409, message: SEAT_CONFLICT_MESSAGE };
    case "tag_invalid":
      return { status: 400, message: SEAT_TAG_INVALID_MESSAGE };
  }
}

export type SeatUpdatePlan =
  | { kind: "accepted"; employeeId: number; tag: string }
  | { kind: "unchanged" }
  | { kind: "not_found" }
  | { kind: "employee_missing" }
  | { kind: "conflict" }
  | { kind: "tag_invalid" };

export function planChannelSeatUpdate(input: {
  seatExists: boolean;
  employeeExists: boolean;
  alreadySeated: boolean;
  nextEmployeeId: number;
  currentEmployeeId: number;
  nextTag: string;
  currentTag: string;
  tagValid: boolean;
}): SeatUpdatePlan {
  if (!input.seatExists) return { kind: "not_found" };
  if (!input.tagValid) return { kind: "tag_invalid" };
  if (!input.employeeExists) return { kind: "employee_missing" };
  if (
    input.nextEmployeeId === input.currentEmployeeId
    && input.nextTag === input.currentTag
  ) {
    return { kind: "unchanged" };
  }
  if (input.alreadySeated) return { kind: "conflict" };
  return {
    kind: "accepted",
    employeeId: input.nextEmployeeId,
    tag: input.nextTag,
  };
}

export function seatUpdateError(
  kind: Exclude<SeatUpdatePlan["kind"], "accepted" | "unchanged">,
): {
  status: number;
  message: string;
} {
  if (kind === "not_found") {
    return { status: 404, message: SEAT_MISSING_MESSAGE };
  }
  return seatCreateError(kind);
}

