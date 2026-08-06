/** Format an API timestamp in the browser's local time zone for display. */
export function formatDateTime(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";

  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);

  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** Format an instant in an explicitly declared IANA timezone. */
export function formatDateTimeInTimeZone(value: unknown, timeZone: string): string {
  if (value === null || value === undefined || value === "") return "—";
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date);
    const valueOf = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((part) => part.type === type)?.value ?? "";
    return `${valueOf("year")}-${valueOf("month")}-${valueOf("day")}`
      + ` ${valueOf("hour")}:${valueOf("minute")}:${valueOf("second")}`;
  } catch {
    return formatDateTime(value);
  }
}
