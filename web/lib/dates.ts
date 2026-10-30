const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function localTodayISO(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function isRealISODate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = ISO_DATE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1900 || year > 2200) return false;
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

export function isoFromUTC(date: Date): string {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

export function parseISODate(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

export function addDaysISO(value: string, days: number): string {
  const parsed = parseISODate(value);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return isoFromUTC(parsed);
}

export function daysBetweenISO(start: string, end: string): number {
  const diff = parseISODate(end).getTime() - parseISODate(start).getTime();
  return Math.round(diff / 86_400_000);
}

export function formatFriendlyDate(value: string | null): string {
  if (!value) return "No date";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(parseISODate(value));
}

export function formatShortDate(value: string | null): string {
  if (!value) return "No date";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(parseISODate(value));
}

export function formatLongDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(parseISODate(value));
}

export function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function describeDate(value: string | null, today = localTodayISO()): string {
  if (!value) return "No date";
  const diff = daysBetweenISO(today, value);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  if (diff > 1 && diff <= 7) return `In ${diff} days`;
  if (diff < -1 && diff >= -7) return `${Math.abs(diff)} days ago`;
  return formatFriendlyDate(value);
}

export function isOverdue(taskDueDate: string | null, today = localTodayISO()): boolean {
  return Boolean(taskDueDate && taskDueDate < today);
}

export function weekdayIndex(name: string): number {
  return ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"].indexOf(
    name.toLowerCase(),
  );
}
