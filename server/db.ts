import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { SEED_CATEGORIES } from "../src/data/categories.ts";
import { SEED_PEOPLE } from "../src/data/people.ts";
import { SEED_RULES } from "../src/data/rules.ts";
import { accountFeeMonth, feeSpreadStart, matchPerson, spreadMonthsForCategory } from "../src/lib/categorize.ts";
import type {
  AccountState,
  AppSettings,
  CashMovement,
  Category,
  CategoryRule,
  ImportBatch,
  Person,
  Transaction,
} from "../src/types.ts";

function defaultSettings(): AppSettings {
  return {
    monthBasis: "valueDate",
    skipZeroAmount: true,
    openingBalance: null,
    openingBalanceDate: null,
    onboarded: false,
    bankBalance: null,
    bankBalanceAsOf: null,
  };
}

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
/** Runtime store only — created and seeded by the API on first start. Do not check in. */
const dataDir = join(root, "data");
mkdirSync(dataDir, { recursive: true });

export const db = new DatabaseSync(join(dataDir, "haushalt.sqlite"));
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  budget REAL NOT NULL,
  color TEXT NOT NULL,
  sort INTEGER NOT NULL,
  exclude_from_budget INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  fingerprint TEXT NOT NULL UNIQUE,
  account_iban TEXT,
  booking_date TEXT,
  value_date TEXT,
  month TEXT,
  booking_text TEXT,
  purpose TEXT,
  counterparty TEXT,
  iban TEXT,
  bic TEXT,
  amount REAL NOT NULL,
  currency TEXT,
  end_to_end_ref TEXT,
  mandate_ref TEXT,
  creditor_id TEXT,
  info TEXT,
  category_id TEXT,
  splits TEXT NOT NULL DEFAULT '[]',
  spread_months INTEGER NOT NULL DEFAULT 1,
  spread_start TEXT,
  excluded INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  loan_person_id TEXT,
  loan_direction TEXT,
  loan_origin_id TEXT,
  import_id TEXT,
  source TEXT NOT NULL DEFAULT 'bank',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS rules (
  id TEXT PRIMARY KEY,
  priority INTEGER NOT NULL,
  category_id TEXT NOT NULL,
  field TEXT NOT NULL,
  match TEXT NOT NULL,
  value TEXT NOT NULL,
  note TEXT,
  learned INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS people (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  aliases TEXT NOT NULL,
  ibans TEXT NOT NULL,
  notes TEXT
);
CREATE TABLE IF NOT EXISTS imports (
  id TEXT PRIMARY KEY,
  file_name TEXT NOT NULL,
  imported_at TEXT NOT NULL,
  added INTEGER NOT NULL,
  duplicates INTEGER NOT NULL,
  skipped INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS cash_movements (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  amount REAL NOT NULL,
  date TEXT NOT NULL,
  month TEXT NOT NULL,
  category_id TEXT,
  note TEXT,
  transaction_id TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`);

ensureColumn("transactions", "loan_origin_id", "TEXT");

function ensureColumn(table: string, name: string, spec: string): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (cols.some((col) => col.name === name)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${spec}`);
}

export function persistSeedRules(): void {
  const insert = db.prepare(
    `INSERT OR IGNORE INTO rules (id, priority, category_id, field, match, value, note, learned)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const r of SEED_RULES) {
    insert.run(r.id, r.priority, r.categoryId, r.field, r.match, r.value, r.note ?? "", r.learned ? 1 : 0);
  }
}

export function seedIfEmpty(): void {
  const count = db.prepare("SELECT COUNT(*) AS n FROM categories").get() as { n: number };
  if (count.n > 0) {
    ensureSeedCategories();
    return;
  }

  const insertCat = db.prepare(
    `INSERT INTO categories (id, name, kind, budget, color, sort, exclude_from_budget)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const c of SEED_CATEGORIES) {
    insertCat.run(c.id, c.name, c.kind, c.budget, c.color, c.sort, c.excludeFromBudget ? 1 : 0);
  }

  const insertRule = db.prepare(
    `INSERT INTO rules (id, priority, category_id, field, match, value, note, learned)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const r of SEED_RULES) {
    insertRule.run(r.id, r.priority, r.categoryId, r.field, r.match, r.value, r.note ?? "", r.learned ? 1 : 0);
  }

  const insertPerson = db.prepare(
    `INSERT INTO people (id, name, role, aliases, ibans, notes) VALUES (?, ?, ?, ?, ?, ?)`,
  );
  for (const p of SEED_PEOPLE) {
    insertPerson.run(p.id, p.name, p.role, JSON.stringify(p.aliases), JSON.stringify(p.ibans), p.notes);
  }

  db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run(
    "settings",
    JSON.stringify(defaultSettings()),
  );
}

/** Add any seed categories missing from an existing DB (e.g. Cash to classify). */
export function ensureSeedCategories(): void {
  const insertCat = db.prepare(
    `INSERT OR IGNORE INTO categories (id, name, kind, budget, color, sort, exclude_from_budget)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const c of SEED_CATEGORIES) {
    insertCat.run(c.id, c.name, c.kind, c.budget, c.color, c.sort, c.excludeFromBudget ? 1 : 0);
  }
  db.prepare("UPDATE categories SET name=? WHERE id=?").run("Cash (to classify)", "cash_unclassified");
}

export function getSettings(): AppSettings {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'settings'").get() as { value: string } | undefined;
  if (!row) return defaultSettings();
  return { ...defaultSettings(), ...(JSON.parse(row.value) as Partial<AppSettings>) };
}

export function saveSettings(patch: Partial<AppSettings>): AppSettings {
  const next = { ...getSettings(), ...patch };
  db.prepare("INSERT INTO settings (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(
    JSON.stringify(next),
  );
  return next;
}

export function currentBankBalance(): number {
  const opening = getSettings().openingBalance ?? 0;
  const row = db.prepare(
    `SELECT COALESCE(SUM(amount), 0) AS bal FROM transactions WHERE source = 'bank'`,
  ).get() as { bal: number };
  return Math.round((opening + Number(row.bal)) * 100) / 100;
}

export function currentBankBalanceAsOf(): string | null {
  const row = db.prepare(
    `SELECT value_date, booking_date FROM transactions
     WHERE source = 'bank'
     ORDER BY value_date DESC, booking_date DESC, id DESC
     LIMIT 1`,
  ).get() as { value_date: string; booking_date: string } | undefined;
  if (row) return row.value_date || row.booking_date || null;
  return getSettings().openingBalanceDate;
}

export function accountState(): AccountState {
  const settings = getSettings();
  return {
    bankBalance: currentBankBalance(),
    bankBalanceAsOf: currentBankBalanceAsOf(),
    cashOnHand: cashBalance(),
    openingBalance: settings.openingBalance ?? 0,
    openingBalanceDate: settings.openingBalanceDate,
    onboarded: Boolean(settings.onboarded),
  };
}

export function resetLedger(): AccountState {
  db.exec("DELETE FROM cash_movements");
  db.exec("DELETE FROM transactions");
  db.exec("DELETE FROM imports");
  db.exec("DELETE FROM rules WHERE learned = 1");
  persistSeedRules();
  saveSettings(defaultSettings());
  return accountState();
}

export function listCategories(): Category[] {
  const rows = db.prepare("SELECT * FROM categories ORDER BY kind, sort").all() as Record<string, unknown>[];
  return rows.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    kind: r.kind as Category["kind"],
    budget: Number(r.budget),
    color: String(r.color),
    sort: Number(r.sort),
    excludeFromBudget: Boolean(r.exclude_from_budget),
  }));
}

export function listRules(): CategoryRule[] {
  const rows = db.prepare("SELECT * FROM rules ORDER BY priority, id").all() as Record<string, unknown>[];
  return rows.map((r) => ({
    id: String(r.id),
    priority: Number(r.priority),
    categoryId: String(r.category_id),
    field: r.field as CategoryRule["field"],
    match: r.match as CategoryRule["match"],
    value: String(r.value),
    note: String(r.note ?? ""),
    learned: Boolean(r.learned),
  }));
}

export function listPeople(): Person[] {
  const rows = db.prepare("SELECT * FROM people ORDER BY name").all() as Record<string, unknown>[];
  return rows.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    role: r.role as Person["role"],
    aliases: JSON.parse(String(r.aliases)),
    ibans: JSON.parse(String(r.ibans)),
    notes: String(r.notes ?? ""),
  }));
}

export function insertPerson(person: Person): void {
  db.prepare(
    `INSERT INTO people (id, name, role, aliases, ibans, notes) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(person.id, person.name, person.role, JSON.stringify(person.aliases), JSON.stringify(person.ibans), person.notes);
}

export function findOrCreateBorrower(name: string, iban = ""): Person {
  const people = listPeople();
  const matched = matchPerson({ counterparty: name, iban }, people);
  if (matched) return matched;
  const trimmed = name.trim() || "Borrower";
  const base = `borrower-${trimmed.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "person"}`;
  let id = base;
  let n = 2;
  while (people.some((person) => person.id === id)) {
    id = `${base}-${n}`;
    n += 1;
  }
  const person: Person = {
    id,
    name: trimmed,
    role: "borrower",
    aliases: [trimmed],
    ibans: iban.replace(/\s/g, "") ? [iban.replace(/\s/g, "").toUpperCase()] : [],
    notes: "Created when money was marked as lent",
  };
  insertPerson(person);
  return person;
}

export function listTransactions(): Transaction[] {
  const rows = db.prepare("SELECT * FROM transactions ORDER BY value_date DESC, booking_date DESC").all() as Record<string, unknown>[];
  return rows.map(rowToTransaction);
}

export function getTransaction(id: string): Transaction | undefined {
  const row = db.prepare("SELECT * FROM transactions WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  return row ? rowToTransaction(row) : undefined;
}

export function listImports(): ImportBatch[] {
  const rows = db.prepare("SELECT * FROM imports ORDER BY imported_at DESC").all() as Record<string, unknown>[];
  return rows.map((r) => ({
    id: String(r.id),
    fileName: String(r.file_name),
    importedAt: String(r.imported_at),
    added: Number(r.added),
    duplicates: Number(r.duplicates),
    skipped: Number(r.skipped),
  }));
}

export function listCashMovements(): CashMovement[] {
  const rows = db.prepare("SELECT * FROM cash_movements ORDER BY date DESC, created_at DESC").all() as Record<string, unknown>[];
  return rows.map((r) => ({
    id: String(r.id),
    type: r.type as CashMovement["type"],
    amount: Number(r.amount),
    date: String(r.date),
    month: String(r.month),
    categoryId: r.category_id ? String(r.category_id) : null,
    note: String(r.note ?? ""),
    transactionId: r.transaction_id ? String(r.transaction_id) : null,
    createdAt: String(r.created_at),
  }));
}

export function cashBalance(): number {
  const row = db.prepare(`
    SELECT COALESCE(SUM(CASE WHEN type = 'cash_out' THEN -amount ELSE amount END), 0) AS bal
    FROM cash_movements
  `).get() as { bal: number };
  return Math.round(Number(row.bal) * 100) / 100;
}

export function insertTransaction(tx: Transaction): void {
  db.prepare(
    `INSERT INTO transactions (
      id, fingerprint, account_iban, booking_date, value_date, month, booking_text, purpose,
      counterparty, iban, bic, amount, currency, end_to_end_ref, mandate_ref, creditor_id, info,
      category_id, splits, spread_months, spread_start, excluded, notes, loan_person_id,
      loan_direction, loan_origin_id, import_id, source, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    tx.id,
    tx.fingerprint,
    tx.accountIban,
    tx.bookingDate,
    tx.valueDate,
    tx.month,
    tx.bookingText,
    tx.purpose,
    tx.counterparty,
    tx.iban,
    tx.bic,
    tx.amount,
    tx.currency,
    tx.endToEndRef,
    tx.mandateRef,
    tx.creditorId,
    tx.info,
    tx.categoryId,
    JSON.stringify(tx.splits),
    tx.spreadMonths,
    tx.spreadStart,
    tx.excluded ? 1 : 0,
    tx.notes,
    tx.loanPersonId,
    tx.loanDirection,
    tx.loanOriginId,
    tx.importId,
    tx.source,
    tx.createdAt,
  );
}

export function updateTransaction(id: string, patch: Partial<Transaction>): Transaction | undefined {
  const current = getTransaction(id);
  if (!current) return undefined;
  const next = { ...current, ...patch, id: current.id, fingerprint: current.fingerprint };
  db.prepare(
    `UPDATE transactions SET
      category_id=?, splits=?, spread_months=?, spread_start=?, excluded=?, notes=?,
      loan_person_id=?, loan_direction=?, loan_origin_id=?, month=?
     WHERE id=?`,
  ).run(
    next.categoryId,
    JSON.stringify(next.splits),
    next.spreadMonths,
    next.spreadStart,
    next.excluded ? 1 : 0,
    next.notes,
    next.loanPersonId,
    next.loanDirection,
    next.loanOriginId,
    next.month,
    id,
  );
  return getTransaction(id);
}

export function insertCashMovement(m: CashMovement): void {
  db.prepare(
    `INSERT INTO cash_movements (id, type, amount, date, month, category_id, note, transaction_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(m.id, m.type, m.amount, m.date, m.month, m.categoryId, m.note, m.transactionId, m.createdAt);
}

export function insertImport(batch: ImportBatch): void {
  db.prepare(
    `INSERT INTO imports (id, file_name, imported_at, added, duplicates, skipped) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(batch.id, batch.fileName, batch.importedAt, batch.added, batch.duplicates, batch.skipped);
}

export function insertRule(rule: CategoryRule): void {
  db.prepare(
    `INSERT INTO rules (id, priority, category_id, field, match, value, note, learned) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(rule.id, rule.priority, rule.categoryId, rule.field, rule.match, rule.value, rule.note ?? "", rule.learned ? 1 : 0);
}

export function deleteRule(id: string): boolean {
  return db.prepare(`DELETE FROM rules WHERE id = ?`).run(id).changes > 0;
}

export function insertCategory(category: Category): void {
  db.prepare(
    `INSERT INTO categories (id, name, kind, budget, color, sort, exclude_from_budget)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    category.id,
    category.name,
    category.kind,
    category.budget,
    category.color,
    category.sort,
    category.excludeFromBudget ? 1 : 0,
  );
}

export function updateCategoryBudget(id: string, budget: number, name?: string): void {
  if (name) {
    db.prepare("UPDATE categories SET budget=?, name=? WHERE id=?").run(budget, name, id);
  } else {
    db.prepare("UPDATE categories SET budget=? WHERE id=?").run(budget, id);
  }
}

export function fingerprintExists(fingerprint: string): boolean {
  const row = db.prepare("SELECT id FROM transactions WHERE fingerprint = ?").get(fingerprint) as { id: string } | undefined;
  return Boolean(row);
}

export function findBySoftKey(bookingDate: string, counterparty: string, iban: string, amount: number): Transaction | undefined {
  const row = db.prepare(
    `SELECT * FROM transactions
     WHERE booking_date = ? AND counterparty = ? AND iban = ? AND ROUND(amount * 100) = ROUND(? * 100)
     LIMIT 1`,
  ).get(bookingDate, counterparty, iban, amount) as Record<string, unknown> | undefined;
  return row ? rowToTransaction(row) : undefined;
}

function rowToTransaction(r: Record<string, unknown>): Transaction {
  return {
    id: String(r.id),
    fingerprint: String(r.fingerprint),
    accountIban: String(r.account_iban ?? ""),
    bookingDate: String(r.booking_date ?? ""),
    valueDate: String(r.value_date ?? ""),
    month: String(r.month ?? ""),
    bookingText: String(r.booking_text ?? ""),
    purpose: String(r.purpose ?? ""),
    counterparty: String(r.counterparty ?? ""),
    iban: String(r.iban ?? ""),
    bic: String(r.bic ?? ""),
    amount: Number(r.amount),
    currency: String(r.currency ?? "EUR"),
    endToEndRef: String(r.end_to_end_ref ?? ""),
    mandateRef: String(r.mandate_ref ?? ""),
    creditorId: String(r.creditor_id ?? ""),
    info: String(r.info ?? ""),
    categoryId: r.category_id ? String(r.category_id) : null,
    splits: JSON.parse(String(r.splits || "[]")),
    spreadMonths: Number(r.spread_months ?? 1),
    spreadStart: r.spread_start ? String(r.spread_start) : null,
    excluded: Boolean(r.excluded),
    notes: String(r.notes ?? ""),
    loanPersonId: r.loan_person_id ? String(r.loan_person_id) : null,
    loanDirection: (r.loan_direction as Transaction["loanDirection"]) ?? null,
    loanOriginId: r.loan_origin_id ? String(r.loan_origin_id) : null,
    importId: r.import_id ? String(r.import_id) : null,
    source: (r.source as Transaction["source"]) || "bank",
    createdAt: String(r.created_at),
  };
}

export function repairSpreads(): void {
  const bank = listTransactions()
    .filter((tx) => tx.source === "bank" && tx.categoryId)
    .sort((a, b) => (a.valueDate || a.bookingDate).localeCompare(b.valueDate || b.bookingDate));

  const byCat = new Map<string, Transaction[]>();
  for (const tx of bank) {
    const list = byCat.get(tx.categoryId!) ?? [];
    list.push(tx);
    byCat.set(tx.categoryId!, list);
  }

  for (const tx of bank) {
    let months = spreadMonthsForCategory(tx.categoryId!, tx.amount, tx.counterparty, tx.purpose);
    const peers = byCat.get(tx.categoryId!) ?? [];
    const nextAnnual = peers.find((other) => {
      if (other.month <= tx.month) return false;
      return spreadMonthsForCategory(other.categoryId!, other.amount, other.counterparty, other.purpose) > 1;
    });
    if (nextAnnual && months > 1) {
      const gap = monthGap(tx.month, nextAnnual.month);
      months = Math.max(1, Math.min(months, gap));
    }
    const start = months > 1 ? feeSpreadStart(tx.purpose, tx.spreadStart || tx.month) : null;
    if (tx.spreadMonths === months && tx.spreadStart === start) continue;
    updateTransaction(tx.id, {
      spreadMonths: months,
      spreadStart: start,
    });
  }
}

export function repairAccountFeeMonths(): void {
  for (const tx of listTransactions()) {
    const month = accountFeeMonth(tx.valueDate || tx.bookingDate, tx.bookingText);
    if (!month || month === tx.month) continue;
    updateTransaction(tx.id, { month });
  }
}

function monthGap(from: string, to: string): number {
  const [y1, m1] = from.split("-").map(Number);
  const [y2, m2] = to.split("-").map(Number);
  return (y2 - y1) * 12 + (m2 - m1);
}
