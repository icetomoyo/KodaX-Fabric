import type { SubmitableChannel, SubmitableChannelRow } from "./channel-credential-submit.js";

export const SEAT_CONFLICT_MESSAGE = "该员工在此渠道已有该席位";
export const SEAT_REQUIRED_MESSAGE = "没有该渠道的席位，不能提交渠道 KEY";
export const SEAT_ALREADY_SUBMITTED_MESSAGE = "该席位已提交渠道 KEY";
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
    reason: "duplicate";
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

export type BulkSeatKeyEntry = {
  name: string;
  secret: string;
};

export type BulkSeatKeySeat = {
  id: number;
  employeeId: number;
  employeeName: string;
  tag: string;
  credentialId: number | null;
};

export type BulkSeatKeyPlanItem =
  | {
    kind: "assign";
    seatId: number;
    employeeId: number;
    name: string;
    secret: string;
  }
  | {
    kind: "skip";
    name: string;
    reason: "already_submitted";
    message: string;
  }
  | {
    kind: "fail";
    name: string;
    reason: "not_seated" | "ambiguous_name";
    message: string;
  };

export const SEAT_KEY_NOT_SEATED_MESSAGE = "该员工在此渠道没有席位";
export const SEAT_KEY_AMBIGUOUS_NAME_MESSAGE = "该姓名对应多个席位，无法自动匹配";
export const SEAT_KEY_ALREADY_SUBMITTED_MESSAGE = "该席位已提交渠道 KEY";
export const SEAT_KEY_DUPLICATE_SECRET_MESSAGE = "渠道中已存在相同 KEY";

export function planBulkSeatKeys(input: {
  entries: readonly BulkSeatKeyEntry[];
  seats: readonly BulkSeatKeySeat[];
}): BulkSeatKeyPlanItem[] {
  const seatsByName = new Map<string, BulkSeatKeySeat[]>();
  for (const seat of input.seats) {
    const name = seat.employeeName.trim();
    const list = seatsByName.get(name) ?? [];
    list.push(seat);
    seatsByName.set(name, list);
  }

  const items: BulkSeatKeyPlanItem[] = [];
  const reservedSeatIds = new Set<number>();
  for (const entry of input.entries) {
    const name = entry.name.trim();
    const seats = seatsByName.get(name) ?? [];
    if (!seats.length) {
      items.push({
        kind: "fail",
        name,
        reason: "not_seated",
        message: SEAT_KEY_NOT_SEATED_MESSAGE,
      });
      continue;
    }
    const employeeIds = new Set(seats.map((seat) => seat.employeeId));
    if (employeeIds.size > 1) {
      items.push({
        kind: "fail",
        name,
        reason: "ambiguous_name",
        message: SEAT_KEY_AMBIGUOUS_NAME_MESSAGE,
      });
      continue;
    }
    const open = seats.filter((seat) => seat.credentialId == null && !reservedSeatIds.has(seat.id));
    if (!open.length) {
      items.push({
        kind: "skip",
        name,
        reason: "already_submitted",
        message: SEAT_KEY_ALREADY_SUBMITTED_MESSAGE,
      });
      continue;
    }
    const untaggedOpen = open.filter((seat) => seat.tag === "");
    const chosen = untaggedOpen.length === 1
      ? untaggedOpen[0]
      : open.length === 1
        ? open[0]
        : null;
    if (!chosen) {
      items.push({
        kind: "fail",
        name,
        reason: "ambiguous_name",
        message: SEAT_KEY_AMBIGUOUS_NAME_MESSAGE,
      });
      continue;
    }
    reservedSeatIds.add(chosen.id);
    items.push({
      kind: "assign",
      seatId: chosen.id,
      employeeId: seats[0].employeeId,
      name,
      secret: entry.secret,
    });
  }
  return items;
}
