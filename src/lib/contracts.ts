import { addMonths } from "./dates";
import type { Transaction } from "../types";

export type ContractStatus = "active" | "paused" | "ended";
export type ContractCadence = "monthly" | "quarterly" | "yearly" | "irregular";

export interface DetectedContract {
  id: string;
  name: string;
  vendor: string;
  status: ContractStatus;
  cadence: ContractCadence;
  typicalAmount: number;
  firstDate: string;
  lastDate: string;
  nextExpected: string | null;
  categoryId: string | null;
  mandateRef: string;
  creditorId: string;
  iban: string;
  count: number;
  kind: "sepa" | "salary" | "allowance" | "subscription";
  confidence: number;
  evidence: string;
  ai?: {
    used: boolean;
    provider?: string;
    note?: string;
  };
}

const TODAY = () => new Date().toISOString().slice(0, 10);

const HINTS: {
  match: RegExp;
  name: string;
  kind?: DetectedContract["kind"];
  cadence?: ContractCadence;
}[] = [
  { match: /eprimo/i, name: "Electricity" },
  { match: /freenet|klarmobil|drillisch|vodafone/i, name: "Mobile" },
  { match: /telekom/i, name: "Internet" },
  { match: /urban sports/i, name: "Urban Sports Club" },
  { match: /rundfunk|ard zdf/i, name: "Rundfunkbeitrag" },
  { match: /techniker/i, name: "Health insurance" },
  { match: /entgeltabschluss/i, name: "Bank account fee" },
  { match: /lohn|gehalt/i, name: "Salary", kind: "salary" },
  { match: /db vertrieb/i, name: "Rail / Deutschlandticket" },
  { match: /taxfix/i, name: "Taxfix", cadence: "yearly" },
  { match: /amazon/i, name: "Amazon recurring" },
];

export function detectContracts(transactions: Transaction[], asOf = TODAY()): DetectedContract[] {
  const groups = new Map<string, Transaction[]>();
  for (const tx of transactions) {
    if (tx.source !== "bank" || tx.amount === 0) continue;
    const key = groupKey(tx);
    if (!key) continue;
    const list = groups.get(key) ?? [];
    list.push(tx);
    groups.set(key, list);
  }

  const out: DetectedContract[] = [];
  for (const [key, list] of groups) {
    const contract = toContract(key, list, asOf);
    if (contract) out.push(contract);
  }

  return out.sort((a, b) => statusRank(a.status) - statusRank(b.status) || b.lastDate.localeCompare(a.lastDate));
}

function groupKey(tx: Transaction): string | null {
  const text = `${tx.bookingText} ${tx.counterparty} ${tx.purpose}`.toUpperCase();
  if (tx.mandateRef.trim()) return `m:${tx.mandateRef.trim()}`;
  if (tx.bookingText.includes("LOHN") || /LOHN\s*\/\s*GEHALT/i.test(tx.purpose)) {
    return `salary:${tx.counterparty}`;
  }
  if (tx.bookingText === "ENTGELTABSCHLUSS") return "bankfee";
  if (tx.creditorId && isLastschrift(tx)) return `c:${tx.creditorId}|${normalizeVendor(tx.counterparty)}`;
  if (isLastschrift(tx) && tx.counterparty) return `v:${normalizeVendor(tx.counterparty)}`;
  if (/CODECADEMY|VIRTUAL UNIVERSITY/i.test(text) && tx.amount < 0) {
    return `sub:${normalizeVendor(tx.counterparty)}`;
  }
  return null;
}

function isLastschrift(tx: Transaction): boolean {
  return /LASTSCHRIFT|ENTGELTABSCHLUSS/.test(tx.bookingText);
}

function toContract(key: string, list: Transaction[], asOf: string): DetectedContract | null {
  const txs = [...list].sort((a, b) => a.valueDate.localeCompare(b.valueDate));
  if (txs.length < 2 && !key.startsWith("m:") && key !== "bankfee") return null;

  const vendor = mostCommon(txs.map((t) => t.counterparty).filter(Boolean)) || txs[0].bookingText;
  const amounts = txs.map((t) => t.amount);
  const typicalAmount = median(amounts);
  const firstDate = txs[0].valueDate;
  const lastDate = txs[txs.length - 1].valueDate;
  const hint = HINTS.find((h) => h.match.test(`${vendor} ${txs[0].purpose} ${txs[0].bookingText} ${key}`));
  if (!hint && /paypal|h\+m|\bkik\b|deutsche post|zalando|ikea|payone|red tape|stadt nuernberg|rsg group/i.test(vendor)) {
    return null;
  }

  const kind = hint?.kind || (key.startsWith("salary") ? "salary" : key.startsWith("allowance") ? "allowance" : key.startsWith("sub") ? "subscription" : "sepa");
  const cadence = hint?.cadence || inferCadence(txs);
  const status = inferStatus(lastDate, cadence, asOf);

  if (/amazon/i.test(vendor)) return null;
  if (kind === "sepa" && Math.abs(typicalAmount) < 1 && !/LOGPAY|ENTGELT/i.test(vendor + txs[0].bookingText)) {
    return null;
  }
  if (/PAYPAL|TEMU|KARTENZAHLUNG|AMAZON PAYMENTS/i.test(txs[0].bookingText + vendor) && !txs[0].mandateRef) {
    return null;
  }

  const categoryId = mostCommon(txs.map((t) => t.categoryId).filter(Boolean) as string[]);
  const name = hint?.name || humanName(vendor, kind);
  const nextExpected = status === "ended" ? null : expectedNext(lastDate, cadence);

  return {
    id: key,
    name,
    vendor: vendor || "Bank",
    status,
    cadence,
    typicalAmount: Math.round(typicalAmount * 100) / 100,
    firstDate,
    lastDate,
    nextExpected,
    categoryId,
    mandateRef: txs[0].mandateRef,
    creditorId: txs[0].creditorId,
    iban: txs[0].iban,
    count: txs.length,
    kind,
    confidence: hint ? 0.92 : txs[0].mandateRef ? 0.8 : 0.65,
    evidence: `${txs.length} bookings ${firstDate} → ${lastDate}, typical ${typicalAmount.toFixed(2)} €, ${cadence}`,
  };
}

function inferCadence(txs: Transaction[]): ContractCadence {
  if (txs.length < 3) {
    const span = daysBetween(txs[0].valueDate, txs[txs.length - 1].valueDate);
    if (span > 300) return "yearly";
    if (span > 70) return "quarterly";
    return "monthly";
  }
  const gaps: number[] = [];
  for (let i = 1; i < txs.length; i++) {
    gaps.push(daysBetween(txs[i - 1].valueDate, txs[i].valueDate));
  }
  const g = median(gaps);
  if (g >= 300) return "yearly";
  if (g >= 70) return "quarterly";
  if (g >= 20) return "monthly";
  return "irregular";
}

function inferStatus(lastDate: string, cadence: ContractCadence, asOf: string): ContractStatus {
  const lag = daysBetween(lastDate, asOf);
  const grace =
    cadence === "yearly" ? 400 : cadence === "quarterly" ? 120 : cadence === "monthly" ? 45 : 60;
  if (lag <= grace) return "active";
  if (lag <= grace * 1.6) return "paused";
  return "ended";
}

function expectedNext(lastDate: string, cadence: ContractCadence): string | null {
  const add = cadence === "yearly" ? 12 : cadence === "quarterly" ? 3 : cadence === "monthly" ? 1 : 0;
  if (!add) return null;
  return addMonths(lastDate.slice(0, 7), add) + lastDate.slice(7);
}

function humanName(vendor: string, kind: DetectedContract["kind"]): string {
  if (kind === "salary") return `Salary — ${vendor}`;
  if (kind === "allowance") return `Allowance — ${vendor}`;
  return vendor || "Unknown contract";
}

function normalizeVendor(name: string): string {
  return name.toLowerCase().replace(/gmbh|ag|se|kg|co\.?/g, "").replace(/\s+/g, " ").trim();
}

function mostCommon(values: string[]): string {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
}

function statusRank(status: ContractStatus): number {
  return status === "active" ? 0 : status === "paused" ? 1 : 2;
}
