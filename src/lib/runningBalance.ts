import type { Transaction } from "../types";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function bankChronological(transactions: Transaction[]): Transaction[] {
  return transactions
    .filter((tx) => tx.source === "bank")
    .sort((a, b) => {
      const va = a.valueDate || a.bookingDate;
      const vb = b.valueDate || b.bookingDate;
      if (va !== vb) return va.localeCompare(vb);
      const book = (a.bookingDate || "").localeCompare(b.bookingDate || "");
      if (book !== 0) return book;
      return a.id.localeCompare(b.id);
    });
}

/** Running Girokonto after each bank booking, starting from the opening balance. */
export function runningBalanceById(transactions: Transaction[], openingBalance = 0): Map<string, number> {
  const map = new Map<string, number>();
  let balance = round2(openingBalance);
  for (const tx of bankChronological(transactions)) {
    balance = round2(balance + tx.amount);
    map.set(tx.id, balance);
  }
  return map;
}

export function latestBankBalance(
  transactions: Transaction[],
  openingBalance = 0,
  openingDate: string | null = null,
): { balance: number; asOf: string | null } {
  const rows = bankChronological(transactions);
  let balance = round2(openingBalance);
  if (rows.length === 0) return { balance, asOf: openingDate };
  for (const tx of rows) balance = round2(balance + tx.amount);
  const last = rows[rows.length - 1];
  return { balance, asOf: last.valueDate || last.bookingDate || openingDate };
}
