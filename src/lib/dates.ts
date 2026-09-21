export function parseGermanDate(raw: string): string {
  const m = raw.trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})$/);
  if (!m) return raw.trim();
  let year = Number(m[3]);
  if (year < 100) year += 2000;
  const month = m[2].padStart(2, "0");
  const day = m[1].padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function monthKey(isoDate: string): string {
  return isoDate.slice(0, 7);
}

export function addMonths(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const date = new Date(y, m - 1 + delta, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const date = new Date(y, m - 1, d + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function formatMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
  });
}

export function formatDay(isoDate: string): string {
  if (!isoDate) return "";
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function formatDayShort(isoDate: string): string {
  if (!isoDate) return "";
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
  });
}

export function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

/** Latest YYYY-MM that has at least one booking (by value/booking date). */
export function latestBookedMonth(
  transactions: { month?: string; valueDate?: string; bookingDate?: string }[],
): string | null {
  let latest = "";
  for (const tx of transactions) {
    const month = (tx.month || tx.valueDate || tx.bookingDate || "").slice(0, 7);
    if (/^\d{4}-\d{2}$/.test(month) && month > latest) latest = month;
  }
  return latest || null;
}

export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let cursor = from;
  while (cursor <= to) {
    out.push(cursor);
    cursor = addMonths(cursor, 1);
    if (out.length > 120) break;
  }
  return out;
}

export function spreadMonthsFor(start: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => addMonths(start, i));
}
