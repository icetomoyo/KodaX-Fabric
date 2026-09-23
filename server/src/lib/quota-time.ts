const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATETIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/;

type DateParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function formatter(timeZone: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
}

function zonedParts(date: Date, timeZone: string): DateParts {
  const values: Record<string, number> = {};
  for (const part of formatter(timeZone).formatToParts(date)) {
    if (part.type !== "literal") values[part.type] = Number(part.value);
  }
  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour === 24 ? 0 : values.hour,
    minute: values.minute,
    second: values.second,
  };
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function parseDateOnly(value: string): Date | null {
  const match = DATE_ONLY_PATTERN.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day
  ) {
    return null;
  }
  return parsed;
}

export function formatUtcDate(date: Date): string {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

export function addCalendarDays(value: string, days: number): string {
  const parsed = parseDateOnly(value);
  if (!parsed) throw new Error(`Invalid date: ${value}`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return formatUtcDate(parsed);
}

export function inclusiveDayCount(from: string, to: string): number | null {
  const start = parseDateOnly(from);
  const end = parseDateOnly(to);
  if (!start || !end) return null;
  return Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1;
}

export function enumerateDays(from: string, to: string): string[] {
  const count = inclusiveDayCount(from, to);
  if (count === null || count < 1) return [];
  return Array.from({ length: count }, (_, index) => addCalendarDays(from, index));
}

export function quotaDayAt(date: Date, timeZone: string): string {
  const parts = zonedParts(date, timeZone);
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

export function quotaMonthStartDay(date: Date, timeZone: string): string {
  const parts = zonedParts(date, timeZone);
  return `${parts.year}-${pad(parts.month)}-01`;
}

export function addCalendarMonths(value: string, months: number): string {
  const parsed = parseDateOnly(value);
  if (!parsed) throw new Error(`Invalid date: ${value}`);
  const total = parsed.getUTCFullYear() * 12 + parsed.getUTCMonth() + months;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  return `${year}-${pad(month)}-01`;
}

export function zonedMonthRange(
  date: Date,
  timeZone: string,
): { start: Date; endExclusive: Date; from: string; to: string } {
  const from = quotaMonthStartDay(date, timeZone);
  const next = addCalendarMonths(from, 1);
  return {
    start: zonedDayStart(from, timeZone),
    endExclusive: zonedDayStart(next, timeZone),
    from,
    to: addCalendarDays(next, -1),
  };
}

function timeZoneOffsetMs(date: Date, timeZone: string): number {
  const parts = zonedParts(date, timeZone);
  const representedAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return representedAsUtc - Math.floor(date.getTime() / 1_000) * 1_000;
}

/** Convert local midnight in an IANA timezone to its UTC instant. */
export function zonedDayStart(value: string, timeZone: string): Date {
  const parsed = parseDateOnly(value);
  if (!parsed) throw new Error(`Invalid date: ${value}`);
  const localAsUtc = parsed.getTime();
  let instant = localAsUtc - timeZoneOffsetMs(new Date(localAsUtc), timeZone);
  // A second pass handles DST transitions where the first offset probe lands
  // on the opposite side of the transition.
  instant = localAsUtc - timeZoneOffsetMs(new Date(instant), timeZone);
  return new Date(instant);
}

/**
 * Interpret a "YYYY-MM-DD"（按本地零点）或 "YYYY-MM-DD[ T]HH:mm:ss" wall-clock
 * string in the given timezone and return the corresponding UTC instant.
 * Returns null when the value matches neither format or has invalid parts.
 */
export function zonedInstant(value: string, timeZone: string): Date | null {
  const match = DATETIME_PATTERN.exec(value);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const hour = Number(match[4]);
    const minute = Number(match[5]);
    const second = Number(match[6]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    if (hour > 23 || minute > 59 || second > 59) return null;
    const localAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);
    const calendar = new Date(localAsUtc);
    if (
      calendar.getUTCFullYear() !== year
      || calendar.getUTCMonth() !== month - 1
      || calendar.getUTCDate() !== day
    ) {
      return null;
    }
    let instant = localAsUtc - timeZoneOffsetMs(calendar, timeZone);
    // Second pass handles DST transitions where the first probe lands across
    // the transition, mirroring zonedDayStart.
    instant = localAsUtc - timeZoneOffsetMs(new Date(instant), timeZone);
    return new Date(instant);
  }
  return parseDateOnly(value) ? zonedDayStart(value, timeZone) : null;
}

/** True when the boundary string carries a time-of-day part. */
export function hasTimePart(value: string): boolean {
  return DATETIME_PATTERN.test(value);
}

export function zonedDateRange(
  from: string,
  to: string,
  timeZone: string,
): { start: Date; endExclusive: Date } {
  return {
    start: zonedDayStart(from, timeZone),
    endExclusive: zonedDayStart(addCalendarDays(to, 1), timeZone),
  };
}

export function formatZonedInstant(date: Date, timeZone: string): string {
  const parts = zonedParts(date, timeZone);
  const offsetMinutes = Math.round(timeZoneOffsetMs(date, timeZone) / 60_000);
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absolute = Math.abs(offsetMinutes);
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`
    + `T${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)}`
    + `${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`;
}

export function nextQuotaResetAt(date: Date, timeZone: string): string {
  const tomorrow = addCalendarDays(quotaDayAt(date, timeZone), 1);
  return formatZonedInstant(zonedDayStart(tomorrow, timeZone), timeZone);
}
