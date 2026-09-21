import { addCalendarDays, enumerateDays } from "./quota-time.js";

export type ContributionCell = {
  date: string;
  totalTokens: number;
  requestCount: number;
  level: 0 | 1 | 2 | 3 | 4;
};

export type ContributionWeek = {
  days: Array<ContributionCell | null>;
};

export type ContributionMonthLabel = {
  label: string;
  weekIndex: number;
};

export function utcWeekday(day: string): number {
  return new Date(`${day}T00:00:00.000Z`).getUTCDay();
}

export function contributionStartSunday(to: string, weekCount = 53): string {
  const sundayOfTo = addCalendarDays(to, -utcWeekday(to));
  return addCalendarDays(sundayOfTo, -(weekCount - 1) * 7);
}

export function contributionLevel(tokens: number, maxTokens: number): 0 | 1 | 2 | 3 | 4 {
  if (!(tokens > 0) || !(maxTokens > 0)) return 0;
  const ratio = tokens / maxTokens;
  if (ratio <= 0.25) return 1;
  if (ratio <= 0.5) return 2;
  if (ratio <= 0.75) return 3;
  return 4;
}

export function monthLabelsForWeeks(weeks: ContributionWeek[]): ContributionMonthLabel[] {
  const labels: ContributionMonthLabel[] = [];
  let last: string | null = null;
  weeks.forEach((week, weekIndex) => {
    const first = week.days.find((cell) => cell != null);
    if (!first) return;
    const month = first.date.slice(5, 7);
    if (month === last) return;
    last = month;
    labels.push({ label: `${Number(month)}月`, weekIndex });
  });
  return labels;
}

export function buildContributionGrid(
  to: string,
  rows: Array<{ day: string; totalTokens: number; requestCount: number }>,
  weekCount = 53,
): {
  from: string;
  to: string;
  weeks: ContributionWeek[];
  months: ContributionMonthLabel[];
  maxTokens: number;
} {
  const from = contributionStartSunday(to, weekCount);
  const gridEnd = addCalendarDays(from, weekCount * 7 - 1);
  const byDay = new Map(rows.map((row) => [row.day, row]));
  const maxTokens = rows.reduce((max, row) => Math.max(max, Number(row.totalTokens) || 0), 0);
  const cells = enumerateDays(from, gridEnd).map((date) => {
    if (date > to) return null;
    const row = byDay.get(date);
    const totalTokens = Number(row?.totalTokens) || 0;
    const requestCount = Number(row?.requestCount) || 0;
    return {
      date,
      totalTokens,
      requestCount,
      level: contributionLevel(totalTokens, maxTokens),
    };
  });
  const weeks: ContributionWeek[] = [];
  for (let index = 0; index < weekCount; index += 1) {
    weeks.push({ days: cells.slice(index * 7, index * 7 + 7) });
  }
  return { from, to, weeks, months: monthLabelsForWeeks(weeks), maxTokens };
}

export function usageStreaks(
  days: Array<{ day: string; totalTokens: number }>,
  today: string,
): { current: number; longest: number; activeDays: number } {
  const active = [...new Set(
    days.filter((row) => (Number(row.totalTokens) || 0) > 0).map((row) => row.day),
  )].sort();
  const activeSet = new Set(active);
  let cursor = activeSet.has(today) ? today : addCalendarDays(today, -1);
  let current = 0;
  while (activeSet.has(cursor)) {
    current += 1;
    cursor = addCalendarDays(cursor, -1);
  }
  let longest = 0;
  let run = 0;
  let previous: string | null = null;
  for (const day of active) {
    run = previous && addCalendarDays(previous, 1) === day ? run + 1 : 1;
    longest = Math.max(longest, run);
    previous = day;
  }
  return { current, longest, activeDays: active.length };
}

export function weekdayWeekendSplit(
  days: Array<{ day: string; totalTokens: number }>,
): { weekdayTokens: number; weekendTokens: number } {
  let weekdayTokens = 0;
  let weekendTokens = 0;
  for (const row of days) {
    const tokens = Number(row.totalTokens) || 0;
    const weekday = utcWeekday(row.day);
    if (weekday === 0 || weekday === 6) weekendTokens += tokens;
    else weekdayTokens += tokens;
  }
  return { weekdayTokens, weekendTokens };
}

export function fillHourCounts(
  rows: Array<{ hour: number; totalTokens: number; requestCount: number }>,
): Array<{ hour: string; totalTokens: number; requestCount: number }> {
  const byHour = new Map(rows.map((row) => [row.hour, row]));
  return Array.from({ length: 24 }, (_, hour) => {
    const row = byHour.get(hour);
    return {
      hour: `${String(hour).padStart(2, "0")}:00`,
      totalTokens: Number(row?.totalTokens) || 0,
      requestCount: Number(row?.requestCount) || 0,
    };
  });
}
