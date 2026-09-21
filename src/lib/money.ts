const eur = new Intl.NumberFormat("de-DE", {
  style: "currency",
  currency: "EUR",
});

export function formatEur(value: number): string {
  return eur.format(value);
}

const sheetNumber = new Intl.NumberFormat("de-DE", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatSheetNumber(value: number): string {
  if (value === 0) return "—";
  return sheetNumber.format(value);
}

export function parseGermanAmount(raw: string): number {
  const cleaned = raw.trim().replace(/\s/g, "").replace(/\./g, "").replace(",", ".");
  if (!cleaned) return 0;
  const n = Number(cleaned);
  if (Number.isNaN(n)) {
    throw new Error(`Could not parse amount: ${raw}`);
  }
  return Math.round(n * 100) / 100;
}

/** Soft parse for filters — empty or invalid returns null. */
export function tryParseAmount(raw: string): number | null {
  const cleaned = raw.trim().replace(/\s/g, "").replace(/\./g, "").replace(",", ".");
  if (!cleaned) return null;
  const n = Number(cleaned);
  if (Number.isNaN(n)) return null;
  return Math.round(n * 100) / 100;
}

export function amountMatchesFilter(
  amount: number,
  min: number | null,
  max: number | null,
  exact: number | null = null,
): boolean {
  const abs = Math.abs(amount);
  if (exact != null) return almostEqual(abs, Math.abs(exact));
  if (min != null && abs < min - 0.0001) return false;
  if (max != null && abs > max + 0.0001) return false;
  return true;
}

export function cents(value: number): number {
  return Math.round(value * 100);
}

export function almostEqual(a: number, b: number): boolean {
  return Math.abs(cents(a) - cents(b)) === 0;
}

export function clampPercent(used: number, budget: number): number {
  if (budget <= 0) return used > 0 ? 100 : 0;
  return Math.min(200, Math.round((used / budget) * 100));
}
