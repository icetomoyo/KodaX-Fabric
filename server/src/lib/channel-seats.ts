import type { SubmitableChannel, SubmitableChannelRow } from "./channel-credential-submit.js";

export const SEAT_CONFLICT_MESSAGE = "该员工在此渠道已有该席位";
export const SEAT_REQUIRED_MESSAGE = "没有该渠道的席位，不能提交渠道 KEY";
export const SEAT_ALREADY_SUBMITTED_MESSAGE = "该席位已提交渠道 KEY";
export const SEAT_SUPER_ADMIN_MESSAGE = "超级管理员不登记席位";
export const SEAT_EMPLOYEE_MISSING_MESSAGE = "员工不存在";
export const SEAT_CHANNEL_MISSING_MESSAGE = "渠道不存在";
export const SEAT_TAG_INVALID_MESSAGE = "席位标签最多 32 个字符";
export const SEAT_CHANNEL_FULL_MESSAGE = "该渠道席位已满";
export const SEAT_COUNT_BELOW_REGISTERED_MESSAGE = "渠道席位不能少于已登记数";
export const SEAT_COUNT_REQUIRED_MESSAGE = "请填写席位数量";
export const SEAT_TAG_MAX_LENGTH = 32;
export const SEAT_BULK_MAX = 200;
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
  | { kind: "super_admin" }
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
  if (input.employeeRole === "admin") return { kind: "super_admin" };
  if (!input.channelExists) return { kind: "channel_missing" };
  if (input.alreadySeated) return { kind: "conflict" };
  return { kind: "accepted" };
}

export function seatCreateError(kind: Exclude<SeatCreatePlan["kind"], "accepted">): {
  status: number;
  message: string;
} {
  switch (kind) {
    case "super_admin":
      return { status: 400, message: SEAT_SUPER_ADMIN_MESSAGE };
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

export type BulkSeatPerson = {
  name: string;
  phone: string;
};

export type BulkSeatEmployee = {
  id: number;
  name: string;
  role: string;
  status: string;
};

export type BulkSeatPlanItem =
  | { kind: "create"; employeeId: number; name: string; phone: string }
  | {
    kind: "skip";
    name: string;
    phone: string;
    reason: "duplicate" | "super_admin";
    message: string;
  }
  | {
    kind: "fail";
    name: string;
    phone: string;
    reason: "not_found" | "inactive" | "full";
    message: string;
  };

export function planBulkChannelSeats(input: {
  people: readonly BulkSeatPerson[];
  employeesByPhone: ReadonlyMap<string, BulkSeatEmployee>;
  seatedEmployeeIds: ReadonlySet<number>;
}): BulkSeatPlanItem[] {
  const seenPhones = new Set<string>();
  const items: BulkSeatPlanItem[] = [];
  for (const person of input.people) {
    const phone = person.phone.trim();
    const name = person.name.trim();
    if (seenPhones.has(phone)) {
      items.push({
        kind: "skip",
        name,
        phone,
        reason: "duplicate",
        message: SEAT_CONFLICT_MESSAGE,
      });
      continue;
    }
    seenPhones.add(phone);
    const employee = input.employeesByPhone.get(phone);
    if (!employee) {
      items.push({
        kind: "fail",
        name,
        phone,
        reason: "not_found",
        message: "未注册",
      });
      continue;
    }
    if (employee.role === "admin") {
      items.push({
        kind: "skip",
        name: employee.name,
        phone,
        reason: "super_admin",
        message: SEAT_SUPER_ADMIN_MESSAGE,
      });
      continue;
    }
    if (employee.status !== "active") {
      items.push({
        kind: "fail",
        name: employee.name,
        phone,
        reason: "inactive",
        message: "账号未启用",
      });
      continue;
    }
    if (input.seatedEmployeeIds.has(employee.id)) {
      items.push({
        kind: "skip",
        name: employee.name,
        phone,
        reason: "duplicate",
        message: SEAT_CONFLICT_MESSAGE,
      });
      continue;
    }
    items.push({
      kind: "create",
      employeeId: employee.id,
      name: employee.name,
      phone,
    });
  }
  return items;
}
