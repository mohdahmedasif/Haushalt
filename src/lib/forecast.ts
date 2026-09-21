import { addDays, addMonths } from "./dates";
import type { DetectedContract } from "./contracts";
import type { Category, Transaction } from "../types";
import { summarizeMonth } from "./summary";

export interface UpcomingDebit {
  name: string;
  date: string;
  amount: number;
  kind: DetectedContract["kind"];
}

export interface SavingsHint {
  id: string;
  title: string;
  body: string;
  monthly: number;
}

export interface Forecast {
  asOf: string;
  bankBalance: number | null;
  cashOnHand: number;
  nextSalaryDate: string | null;
  nextSalaryAmount: number;
  daysUntilSalary: number | null;
  remainingOutflows: number;
  remainingInflows: number;
  availableUntilSalary: number | null;
  forecastAtSalary: number | null;
  forecastTomorrow: number | null;
  forecastIn7Days: number | null;
  monthlyFixedCosts: number;
  upcoming: UpcomingDebit[];
  savings: SavingsHint[];
}

export function buildForecast(input: {
  transactions: Transaction[];
  contracts: DetectedContract[];
  categories: Category[];
  bankBalance: number | null;
  cashOnHand: number;
  asOf?: string;
}): Forecast {
  const asOf = input.asOf ?? new Date().toISOString().slice(0, 10);
  const salary = nextSalary(input.transactions, asOf);
  const active = input.contracts.filter((c) => c.status === "active" && c.typicalAmount !== 0);
  const debitContracts = active.filter((c) => c.typicalAmount < 0);
  const monthlyFixedCosts = round2(
    debitContracts.reduce((sum, c) => sum + monthlyEquivalent(c), 0),
  );

  const withSalaryAmount = (u: UpcomingDebit): UpcomingDebit =>
    u.kind === "salary" && salary.amount ? { ...u, amount: salary.amount } : u;
  const upcoming = upcomingDebits(active, asOf, salary.date).map(withSalaryAmount);
  const remainingOutflows = round2(
    upcoming.filter((u) => u.amount < 0).reduce((sum, u) => sum + Math.abs(u.amount), 0),
  );
  const extraInflows = round2(
    upcoming.filter((u) => u.amount > 0 && u.kind !== "salary").reduce((sum, u) => sum + u.amount, 0),
  );
  const remainingInflows = extraInflows + (salary.date && salary.date > asOf ? salary.amount : 0);
  const availableUntilSalary =
    input.bankBalance == null ? null : round2(input.bankBalance - remainingOutflows + extraInflows);
  const forecastAtSalary =
    input.bankBalance == null ? null : round2((availableUntilSalary ?? 0) + (salary.date && salary.date > asOf ? salary.amount : 0));
  const weekHorizon = addDays(asOf, 7);
  const near = upcomingDebits(active, asOf, weekHorizon).map(withSalaryAmount);

  return {
    asOf,
    bankBalance: input.bankBalance,
    cashOnHand: input.cashOnHand,
    nextSalaryDate: salary.date,
    nextSalaryAmount: salary.amount,
    daysUntilSalary: salary.date ? daysBetween(asOf, salary.date) : null,
    remainingOutflows,
    remainingInflows,
    availableUntilSalary,
    forecastAtSalary,
    forecastTomorrow: projectBalance(input.bankBalance, near, asOf, addDays(asOf, 1)),
    forecastIn7Days: projectBalance(input.bankBalance, near, asOf, weekHorizon),
    monthlyFixedCosts: Math.abs(monthlyFixedCosts),
    upcoming,
    savings: savingsHints(input.contracts, input.transactions, input.categories, asOf),
  };
}

function nextSalary(transactions: Transaction[], asOf: string): { date: string | null; amount: number } {
  const paid = transactions
    .filter((tx) => tx.categoryId === "salary" && tx.amount > 0)
    .sort((a, b) => b.valueDate.localeCompare(a.valueDate));
  if (!paid.length) return { date: null, amount: 0 };
  const recent = paid.slice(0, 6);
  const typicalDay = Math.round(median(recent.map((tx) => Number(tx.valueDate.slice(8, 10)))));
  const typicalAmount = median(recent.map((tx) => tx.amount));
  const [y, m] = asOf.split("-").map(Number);
  let candidate = clampDay(y, m, typicalDay);
  if (candidate <= asOf) {
    const next = addMonths(asOf.slice(0, 7), 1);
    const [ny, nm] = next.split("-").map(Number);
    candidate = clampDay(ny, nm, typicalDay);
  }
  return { date: candidate, amount: round2(typicalAmount) };
}

function projectBalance(
  bank: number | null,
  bookings: UpcomingDebit[],
  asOf: string,
  until: string,
): number | null {
  if (bank == null) return null;
  const delta = bookings
    .filter((b) => b.date > asOf && b.date <= until)
    .reduce((sum, b) => sum + b.amount, 0);
  return round2(bank + delta);
}

function upcomingDebits(
  active: DetectedContract[],
  asOf: string,
  until: string | null,
): UpcomingDebit[] {
  const end = until ?? addMonths(asOf.slice(0, 7), 1) + "-28";
  const out: UpcomingDebit[] = [];
  for (const c of active) {
    const next = c.nextExpected ?? nextFromLast(c.lastDate, c.cadence);
    if (!next) continue;
    if (next > asOf && next <= end && c.lastDate < next) {
      out.push({
        name: c.name,
        date: next,
        amount: c.typicalAmount,
        kind: c.kind,
      });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

function nextFromLast(lastDate: string, cadence: DetectedContract["cadence"]): string | null {
  const add = cadence === "yearly" ? 12 : cadence === "quarterly" ? 3 : cadence === "monthly" ? 1 : 0;
  if (!add) return null;
  return addMonths(lastDate.slice(0, 7), add) + lastDate.slice(7);
}

function monthlyEquivalent(c: DetectedContract): number {
  if (c.cadence === "quarterly") return c.typicalAmount / 3;
  if (c.cadence === "yearly") return c.typicalAmount / 12;
  return c.typicalAmount;
}

function savingsHints(
  contracts: DetectedContract[],
  transactions: Transaction[],
  categories: Category[],
  asOf: string,
): SavingsHint[] {
  const hints: SavingsHint[] = [];
  const active = contracts.filter((c) => c.status === "active");
  const gyms = active.filter((c) => /urban sports|fit star|fitness|gym/i.test(c.name + c.vendor));
  if (gyms.length >= 2) {
    const extra = gyms.reduce((sum, c) => sum + Math.abs(monthlyEquivalent(c)), 0) - Math.max(...gyms.map((c) => Math.abs(monthlyEquivalent(c))));
    hints.push({
      id: "two-gyms",
      title: "Two gym contracts",
      body: `Urban Sports and Fit Star are both still debiting. One of them is about ${extra.toFixed(0)} €/month if you only need one.`,
      monthly: round2(extra),
    });
  }

  const mobiles = active.filter((c) => /mobile|freenet|klarmobil|drillisch/i.test(c.name + c.vendor));
  if (mobiles.length >= 2) {
    const total = mobiles.reduce((sum, c) => sum + Math.abs(monthlyEquivalent(c)), 0);
    hints.push({
      id: "mobiles",
      title: "Several mobile contracts",
      body: `freenet + klarmobil together are about ${total.toFixed(0)} €/month. Worth checking if one SIM can go.`,
      monthly: round2(total),
    });
  }

  const month = asOf.slice(0, 7);
  const summary = summarizeMonth(month, transactions, categories);
  const leisure = Math.abs(Math.min(0, summary.byCategory.leisure ?? 0));
  const shopping = Math.abs(Math.min(0, summary.byCategory.shopping ?? 0));
  if (shopping > 250) {
    hints.push({
      id: "shopping",
      title: "Shopping is heavy this month",
      body: `Shopping is ${shopping.toFixed(0)} € vs a 200 € budget.`,
      monthly: round2(shopping - 200),
    });
  }
  if (leisure > 120) {
    hints.push({
      id: "leisure",
      title: "Leisure over budget",
      body: `Leisure is ${leisure.toFixed(0)} € this month.`,
      monthly: round2(leisure - 100),
    });
  }

  const endedStillNamed = contracts.filter((c) => c.status === "ended" && /urban|telekom|freenet/.test(c.name.toLowerCase()) && daysBetween(c.lastDate, asOf) < 60);
  void endedStillNamed;
  return hints;
}

function clampDay(year: number, month: number, day: number): string {
  const last = new Date(year, month, 0).getDate();
  const d = Math.min(day, last);
  return `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
