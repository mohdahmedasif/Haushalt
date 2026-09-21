import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import { accountFeeMonth, feeSpreadStart, learnRuleFrom, suggestCategory } from "../src/lib/categorize.ts";
import { currentMonth, monthKey } from "../src/lib/dates.ts";
import { parseSparkasseCsv } from "../src/lib/parseSparkasse.ts";
import { buildInsights } from "../src/lib/insights.ts";
import { detectContracts } from "../src/lib/contracts.ts";
import { enrichContractsWithAI } from "../src/lib/ai.ts";
import { buildForecast } from "../src/lib/forecast.ts";
import { answerFinanceQuestion } from "../src/lib/ask.ts";
import { summarizeMonth } from "../src/lib/summary.ts";
import { buildYearSheet } from "../src/lib/report.ts";
import { buildLending } from "../src/lib/lending.ts";
import type { CashMovement, ImportPreviewRow, Transaction } from "../src/types.ts";
import {
  cashBalance,
  db,
  findBySoftKey,
  fingerprintExists,
  getSettings,
  getTransaction,
  insertCashMovement,
  insertCategory,
  insertImport,
  findOrCreateBorrower,
  insertRule,
  deleteRule,
  insertTransaction,
  listCashMovements,
  listCategories,
  listImports,
  listPeople,
  listRules,
  listTransactions,
  saveSettings,
  accountState,
  currentBankBalance,
  currentBankBalanceAsOf,
  resetLedger,
  seedIfEmpty,
  ensureSeedCategories,
  repairAccountFeeMonths,
  repairSpreads,
  updateCategoryBudget,
  updateTransaction,
} from "./db.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
loadEnv(join(root, ".env"));

const API_KEY = process.env.HAUSHALT_API_KEY || "haushalt-local";
const PORT = Number(process.env.PORT || 8787);

seedIfEmpty();
ensureSeedCategories();
repairAccountFeeMonths();
repairSpreads();

const app = express();
app.use(cors());
app.use(express.json({ limit: "12mb" }));

app.use("/api", (req: Request, res: Response, next: NextFunction) => {
  if (req.path === "/v1" && req.method === "GET") return next();
  if (req.path === "/v1/health") return next();
  const header = req.header("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : req.header("x-api-key") || "";
  if (token !== API_KEY) {
    res.status(401).json({ error: "Unauthorized. Send Authorization: Bearer <HAUSHALT_API_KEY>." });
    return;
  }
  next();
});

app.get("/api/v1/health", (_req, res) => {
  res.json({ ok: true, name: "haushalt", version: "v1" });
});

app.get("/api/v1", (_req, res) => {
  res.json({
    name: "Budget API",
    version: "v1",
    auth: "Authorization: Bearer <HAUSHALT_API_KEY>",
    endpoints: [
      "GET /api/v1/health",
      "GET /api/v1/summary?month=YYYY-MM",
      "GET /api/v1/account",
      "POST /api/v1/setup  { openingBalance, openingBalanceDate, onboarded? }",
      "POST /api/v1/reset",
      "PATCH /api/v1/settings  { openingBalance, openingBalanceDate }",
      "GET /api/v1/categories",
      "POST /api/v1/categories  { name, kind, budget? }",
      "PATCH /api/v1/categories/:id  { budget, name? }",
      "GET /api/v1/transactions?month=&uncategorized=&category=",
      "PATCH /api/v1/transactions/:id",
      "POST /api/v1/imports/preview  { fileName, csvText }",
      "POST /api/v1/imports  { fileName, csvText, includeSoft }",
      "GET /api/v1/imports",
      "GET /api/v1/cash",
      "POST /api/v1/cash/movements  { type: in|out|opening, amount, categoryId?, date, note? }",
      "GET /api/v1/lending",
      "GET /api/v1/contracts",
      "POST /api/v1/contracts/analyze",
      "GET /api/v1/forecast",
      "POST /api/v1/ask  { question, month? }",
      "GET /api/v1/report?year=YYYY",
      "GET /api/v1/people",
      "POST /api/v1/people",
      "GET /api/v1/rules",
      "POST /api/v1/rules",
      "DELETE /api/v1/rules/:id",
      "POST /api/v1/rules/apply",
      "GET /api/v1/export",
    ],
  });
});

app.get("/api/v1/categories", (_req, res) => {
  res.json(listCategories());
});

app.post("/api/v1/categories", (req, res) => {
  const name = String(req.body?.name ?? "").trim();
  const kind = req.body?.kind === "income" ? "income" : "expense";
  const budget = Number(req.body?.budget ?? 0);
  if (!name) {
    res.status(400).json({ error: "name is required" });
    return;
  }
  if (Number.isNaN(budget) || budget < 0) {
    res.status(400).json({ error: "budget must be 0 or more" });
    return;
  }
  const existing = listCategories();
  const id = uniqueCategoryId(name, existing);
  const sort =
    Math.max(0, ...existing.filter((c) => c.kind === kind).map((c) => c.sort)) + 10;
  const colors = ["#2f5d50", "#c4a35a", "#b4533c", "#2b6cb0", "#805ad5", "#c05621", "#2c7a7b", "#b7791f"];
  const category = {
    id,
    name,
    kind,
    budget,
    color: colors[existing.length % colors.length],
    sort,
    excludeFromBudget: false,
  };
  insertCategory(category);
  res.status(201).json(category);
});

app.patch("/api/v1/categories/:id", (req, res) => {
  const budget = Number(req.body?.budget);
  if (Number.isNaN(budget)) {
    res.status(400).json({ error: "budget is required" });
    return;
  }
  updateCategoryBudget(req.params.id, budget, req.body?.name);
  res.json(listCategories().find((c) => c.id === req.params.id) ?? null);
});

app.get("/api/v1/people", (_req, res) => {
  res.json(listPeople());
});

app.post("/api/v1/people", (req, res) => {
  const name = String(req.body?.name ?? "").trim();
  const iban = String(req.body?.iban ?? "").replace(/\s/g, "").toUpperCase();
  if (!name) {
    res.status(400).json({ error: "name is required" });
    return;
  }
  const person = findOrCreateBorrower(name, iban);
  res.status(201).json(person);
});

app.get("/api/v1/rules", (_req, res) => {
  res.json(listRules());
});

app.post("/api/v1/rules", (req, res) => {
  const body = req.body ?? {};
  if (!body.categoryId || !body.value || !body.field) {
    res.status(400).json({ error: "categoryId, field, value required" });
    return;
  }
  const rule = {
    id: crypto.randomUUID(),
    priority: Number(body.priority ?? 25),
    categoryId: String(body.categoryId),
    field: body.field,
    match: body.match === "equals" ? "equals" as const : "contains" as const,
    value: String(body.value),
    note: String(body.note ?? "Added via API"),
    learned: true,
  };
  insertRule(rule);
  res.status(201).json(rule);
});

app.delete("/api/v1/rules/:id", (req, res) => {
  if (!deleteRule(req.params.id)) {
    res.status(404).json({ error: "Rule not found" });
    return;
  }
  res.json({ ok: true });
});

app.post("/api/v1/rules/apply", (_req, res) => {
  const rules = listRules();
  const people = listPeople();
  const all = listTransactions();
  const rows = all.filter((tx) => !tx.categoryId && tx.splits.length === 0);
  let applied = 0;
  for (const tx of rows) {
    const suggestion = suggestCategory(tx, rules, people, all);
    if (!suggestion) continue;
    if (suggestion.reason.startsWith("Known person")) continue;
    updateTransaction(tx.id, {
      categoryId: suggestion.categoryId,
      loanPersonId: suggestion.personId,
      loanDirection: suggestion.loanDirection,
      loanOriginId: suggestion.loanOriginId ?? null,
      spreadMonths: suggestion.spreadMonths,
      spreadStart: suggestion.spreadMonths > 1 ? feeSpreadStart(tx.purpose, tx.spreadStart || tx.month) : null,
      excluded: suggestion.categoryId === "ignore" || suggestion.categoryId === "to_cash" || suggestion.categoryId === "internal",
    });
    const updated = all.find((row) => row.id === tx.id);
    if (updated) {
      updated.categoryId = suggestion.categoryId;
      updated.loanPersonId = suggestion.personId;
      updated.loanDirection = suggestion.loanDirection;
      updated.loanOriginId = suggestion.loanOriginId ?? null;
    }
    applied += 1;
  }
  repairSpreads();
  res.json({ scanned: rows.length, applied });
});

app.get("/api/v1/transactions", (req, res) => {
  let rows = listTransactions();
  const month = str(req.query.month);
  const category = str(req.query.category);
  if (month) rows = rows.filter((tx) => tx.month === month || (tx.spreadStart && tx.spreadMonths > 1));
  if (req.query.uncategorized === "1") rows = rows.filter((tx) => !tx.categoryId && tx.splits.length === 0);
  if (category) rows = rows.filter((tx) => tx.categoryId === category);
  res.json(rows);
});

app.patch("/api/v1/transactions/:id", (req, res) => {
  const allowed = [
    "categoryId",
    "splits",
    "spreadMonths",
    "spreadStart",
    "excluded",
    "notes",
    "loanPersonId",
    "loanDirection",
    "loanOriginId",
    "month",
  ] as const;
  const patch: Partial<Transaction> = {};
  for (const key of allowed) {
    if (key in (req.body ?? {})) (patch as Record<string, unknown>)[key] = req.body[key];
  }
  const current = getTransaction(req.params.id);
  if (!current) {
    res.status(404).json({ error: "Transaction not found" });
    return;
  }
  applyLoanSemantics(current, patch);
  const updated = updateTransaction(req.params.id, patch);
  if (!updated) {
    res.status(404).json({ error: "Transaction not found" });
    return;
  }
  if (
    updated.categoryId &&
    req.body?.learn !== false &&
    updated.counterparty &&
    updated.splits.length === 0
  ) {
    const learned = learnRuleFrom(updated, listRules());
    if (learned) insertRule(learned);
  }
  res.json(updated);
});

app.get("/api/v1/imports", (_req, res) => {
  res.json(listImports());
});

app.post("/api/v1/imports/preview", (req, res) => {
  try {
    const csvText = String(req.body?.csvText ?? "");
    if (!csvText.trim()) {
      res.status(400).json({ error: "csvText is required" });
      return;
    }
    res.json(previewImport(csvText));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Could not parse CSV" });
  }
});

app.post("/api/v1/imports", (req, res) => {
  try {
    const csvText = String(req.body?.csvText ?? "");
    const fileName = String(req.body?.fileName ?? "upload.csv");
    const includeSoft = Boolean(req.body?.includeSoft);
    if (!csvText.trim()) {
      res.status(400).json({ error: "csvText is required" });
      return;
    }
    const preview = previewImport(csvText);
    const batch = commitImport(fileName, preview, includeSoft);
    res.status(201).json({ ...batch, previewCounts: counts(preview) });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Import failed" });
  }
});

app.get("/api/v1/summary", (req, res) => {
  const month = str(req.query.month) || new Date().toISOString().slice(0, 7);
  const summary = summarizeMonth(month, listTransactions(), listCategories());
  res.json({
    ...summary,
    cashOnHand: cashBalance(),
    bankBalance: currentBankBalance(),
    bankBalanceAsOf: currentBankBalanceAsOf(),
  });
});

app.get("/api/v1/account", (_req, res) => {
  res.json(accountState());
});

app.post("/api/v1/setup", (req, res) => {
  const amount = Number(req.body?.openingBalance);
  const date = String(req.body?.openingBalanceDate ?? "").slice(0, 10);
  if (!Number.isFinite(amount)) {
    res.status(400).json({ error: "openingBalance must be a number" });
    return;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    res.status(400).json({ error: "openingBalanceDate must be YYYY-MM-DD" });
    return;
  }
  saveSettings({
    openingBalance: Math.round(amount * 100) / 100,
    openingBalanceDate: date,
    onboarded: req.body?.onboarded === false ? false : Boolean(req.body?.onboarded) || getSettings().onboarded,
  });
  res.json(accountState());
});

app.post("/api/v1/reset", (_req, res) => {
  res.json(resetLedger());
});

app.patch("/api/v1/settings", (req, res) => {
  const patch: Record<string, unknown> = {};
  if (req.body?.openingBalance != null || req.body?.bankBalance != null) {
    const n = Number(req.body?.openingBalance ?? req.body.bankBalance);
    if (Number.isNaN(n)) {
      res.status(400).json({ error: "openingBalance must be a number" });
      return;
    }
    patch.openingBalance = Math.round(n * 100) / 100;
    patch.openingBalanceDate = String(req.body?.openingBalanceDate || req.body?.bankBalanceAsOf || "").slice(0, 10) || getSettings().openingBalanceDate;
  }
  if (req.body?.monthBasis === "bookingDate" || req.body?.monthBasis === "valueDate") {
    patch.monthBasis = req.body.monthBasis;
  }
  saveSettings(patch);
  res.json(accountState());
});

app.get("/api/v1/cash", (_req, res) => {
  res.json({
    balance: cashBalance(),
    movements: listCashMovements(),
  });
});

app.post("/api/v1/cash/movements", (req, res) => {
  const typeRaw = String(req.body?.type ?? "");
  const type = typeRaw === "in" ? "cash_in" : typeRaw === "out" ? "cash_out" : typeRaw === "opening" ? "opening" : "";
  const amount = Number(req.body?.amount);
  const date = String(req.body?.date ?? new Date().toISOString().slice(0, 10));
  const note = String(req.body?.note ?? "");
  const categoryId = req.body?.categoryId ? String(req.body.categoryId) : null;
  const bookRemainder = Boolean(req.body?.bookRemainder);
  if (!type || !(amount > 0)) {
    res.status(400).json({ error: "type must be in|out|opening and amount must be > 0" });
    return;
  }

  const now = new Date().toISOString();
  const month = monthKey(date);
  let transactionId: string | null = null;
  let movementAmount = Math.abs(amount);
  let txCategoryId: string | null = categoryId ?? (type === "cash_out" ? "miscellaneous" : "other_income");
  let splits: Transaction["splits"] = [];

  if (type === "cash_out" && bookRemainder) {
    const wallet = cashBalance();
    const classified = Math.round(Math.abs(amount) * 100) / 100;
    if (classified > wallet + 0.005) {
      res.status(400).json({ error: `Only ${wallet.toFixed(2)} € left in the wallet` });
      return;
    }
    const rest = Math.round((wallet - classified) * 100) / 100;
    if (rest > 0.005) {
      if (!categoryId) {
        res.status(400).json({ error: "Pick a category for the classified part" });
        return;
      }
      movementAmount = wallet;
      txCategoryId = null;
      splits = [
        { id: crypto.randomUUID(), categoryId, amount: classified },
        { id: crypto.randomUUID(), categoryId: "cash_unclassified", amount: rest },
      ];
    }
  }

  if (type === "cash_out" || type === "cash_in") {
    const txId = crypto.randomUUID();
    transactionId = txId;
    const signed = type === "cash_out" ? -Math.abs(movementAmount) : Math.abs(movementAmount);
    const catName =
      splits.length > 0
        ? "Cash spend"
        : listCategories().find((c) => c.id === categoryId)?.name ||
          (type === "cash_out" ? "Cash spend" : "Cash in");
    insertTransaction({
      id: txId,
      fingerprint: `cash:${txId}`,
      accountIban: "",
      bookingDate: date,
      valueDate: date,
      month,
      bookingText: note || (type === "cash_out" ? "Cash spend" : "Cash in"),
      purpose: note,
      counterparty: catName,
      iban: "",
      bic: "",
      amount: signed,
      currency: "EUR",
      endToEndRef: "",
      mandateRef: "",
      creditorId: "",
      info: "",
      categoryId: txCategoryId,
      splits,
      spreadMonths: 1,
      spreadStart: null,
      excluded: false,
      notes: note,
      loanPersonId: req.body?.loanPersonId ?? null,
      loanDirection: req.body?.loanDirection ?? null,
      loanOriginId: req.body?.loanOriginId ?? null,
      importId: null,
      source: "cash",
      createdAt: now,
    });
  }

  const movement: CashMovement = {
    id: crypto.randomUUID(),
    type,
    amount: movementAmount,
    date,
    month,
    categoryId: splits.length ? "cash_unclassified" : categoryId,
    note:
      splits.length > 0
        ? note || `Cash · split (${formatCashSplitNote(splits)})`
        : note,
    transactionId,
    createdAt: now,
  };
  insertCashMovement(movement);
  res.status(201).json({ movement, balance: cashBalance() });
});

function formatCashSplitNote(splits: Transaction["splits"]): string {
  return splits.map((line) => `${line.categoryId} ${line.amount}`).join(" + ");
}

app.get("/api/v1/lending", (_req, res) => {
  res.json(buildLending(listPeople(), listTransactions()));
});

app.get("/api/v1/report", (req, res) => {
  const year = Number(str(req.query.year)) || new Date().getFullYear();
  res.json(buildYearSheet(year, listTransactions(), listCategories()));
});

app.get("/api/v1/insights", (req, res) => {
  const year = Number(str(req.query.year)) || new Date().getFullYear();
  res.json(buildInsights(year, listTransactions(), listCategories()));
});

app.get("/api/v1/contracts", async (_req, res) => {
  const detected = detectContracts(listTransactions());
  const { contracts, provider } = await enrichContractsWithAI(detected);
  res.json({ provider, contracts });
});

app.post("/api/v1/contracts/analyze", async (_req, res) => {
  const detected = detectContracts(listTransactions());
  const { contracts, provider } = await enrichContractsWithAI(detected);
  res.json({ provider, contracts });
});

app.get("/api/v1/forecast", (_req, res) => {
  res.json(makeForecast());
});

app.post("/api/v1/ask", (req, res) => {
  const question = String(req.body?.question ?? "").trim();
  if (!question) {
    res.status(400).json({ error: "question is required" });
    return;
  }
  const month = String(req.body?.month ?? currentMonth());
  const transactions = listTransactions();
  const categories = listCategories();
  const contracts = detectContracts(transactions);
  const forecast = makeForecast(transactions, categories, contracts);
  res.json(answerFinanceQuestion(question, { month, transactions, categories, contracts, forecast }));
});

app.get("/api/v1/export", (_req, res) => {
  res.json({
    exportedAt: new Date().toISOString(),
    settings: getSettings(),
    categories: listCategories(),
    people: listPeople(),
    rules: listRules(),
    transactions: listTransactions(),
    cashMovements: listCashMovements(),
    imports: listImports(),
  });
});

const dist = join(root, "dist");
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/.*/, (_req, res) => {
    res.sendFile(join(dist, "index.html"));
  });
}

app.listen(PORT, "127.0.0.1", () => {
  console.log(`Budget API http://127.0.0.1:${PORT}/api/v1`);
});

function previewImport(csvText: string): ImportPreviewRow[] {
  const settings = getSettings();
  const rows = parseSparkasseCsv(csvText);
  return rows.map((row) => {
    if (settings.skipZeroAmount && row.amount === 0) {
      return { row, status: "skip" as const, reason: "Zero-amount statement row" };
    }
    if (fingerprintExists(row.fingerprint)) {
      return {
        row,
        status: "duplicate" as const,
        reason: "Exact match of date, amount, payee, purpose and references",
      };
    }
    const soft = findBySoftKey(row.bookingDate, row.counterparty, row.iban, row.amount);
    if (soft) {
      return {
        row,
        status: "soft" as const,
        existingId: soft.id,
        reason: `Same date, amount and payee as “${(soft.purpose || soft.counterparty).slice(0, 60)}”`,
      };
    }
    return { row, status: "new" as const };
  });
}

function commitImport(fileName: string, preview: ImportPreviewRow[], includeSoft: boolean) {
  const settings = getSettings();
  const rules = listRules();
  const people = listPeople();
  const importId = crypto.randomUUID();
  const now = new Date().toISOString();
  const toAdd = preview.filter((item) => item.status === "new" || (item.status === "soft" && includeSoft));
  const ledger = listTransactions();

  db.exec("BEGIN");
  try {
    for (const item of toAdd) {
      const suggestion = suggestCategory(item.row, rules, people, ledger);
      const basis = settings.monthBasis === "bookingDate" ? item.row.bookingDate : item.row.valueDate;
      const rawMonth = monthKey(basis || item.row.bookingDate);
      const month = accountFeeMonth(item.row.valueDate || basis, item.row.bookingText) ?? rawMonth;
      const excluded = suggestion?.categoryId === "ignore" || suggestion?.categoryId === "to_cash";
      const tx: Transaction = {
        id: crypto.randomUUID(),
        fingerprint: item.row.fingerprint,
        accountIban: item.row.accountIban,
        bookingDate: item.row.bookingDate,
        valueDate: item.row.valueDate,
        month,
        bookingText: item.row.bookingText,
        purpose: item.row.purpose,
        counterparty: item.row.counterparty,
        iban: item.row.iban,
        bic: item.row.bic,
        amount: item.row.amount,
        currency: item.row.currency,
        endToEndRef: item.row.endToEndRef,
        mandateRef: item.row.mandateRef,
        creditorId: item.row.creditorId,
        info: item.row.info,
        categoryId: suggestion?.categoryId ?? null,
        splits: [],
        spreadMonths: suggestion?.spreadMonths ?? 1,
        spreadStart:
          suggestion && suggestion.spreadMonths > 1 ? feeSpreadStart(item.row.purpose, month) : null,
        excluded,
        notes: suggestion?.reason ?? "",
        loanPersonId: suggestion?.personId ?? null,
        loanDirection: suggestion?.loanDirection ?? null,
        loanOriginId: suggestion?.loanOriginId ?? null,
        importId,
        source: "bank",
        createdAt: now,
      };
      insertTransaction(tx);
      ledger.push(tx);
      if (suggestion?.categoryId === "to_cash" && tx.amount < 0) {
        insertCashMovement({
          id: crypto.randomUUID(),
          type: "atm_in",
          amount: Math.abs(tx.amount),
          date: tx.valueDate || tx.bookingDate,
          month,
          categoryId: "to_cash",
          note: tx.purpose || "ATM withdrawal",
          transactionId: tx.id,
          createdAt: now,
        });
      }
    }
    const batch = {
      id: importId,
      fileName,
      importedAt: now,
      added: toAdd.length,
      duplicates: preview.filter((p) => p.status === "duplicate").length,
      skipped: preview.filter((p) => p.status === "skip" || (p.status === "soft" && !includeSoft)).length,
    };
    insertImport(batch);
    db.exec("COMMIT");
    return batch;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function counts(preview: ImportPreviewRow[]) {
  return {
    new: preview.filter((p) => p.status === "new").length,
    duplicate: preview.filter((p) => p.status === "duplicate").length,
    soft: preview.filter((p) => p.status === "soft").length,
    skip: preview.filter((p) => p.status === "skip").length,
  };
}

function makeForecast(
  transactions = listTransactions(),
  categories = listCategories(),
  contracts = detectContracts(transactions),
) {
  return buildForecast({
    transactions,
    contracts,
    categories,
    bankBalance: currentBankBalance(),
    cashOnHand: cashBalance(),
  });
}

function matchesName(tx: Transaction, person: { aliases: string[] }): boolean {
  const name = tx.counterparty.toLowerCase();
  return person.aliases.some((alias) => name.includes(alias.toLowerCase()));
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function applyLoanSemantics(current: Transaction, patch: Partial<Transaction>): void {
  const nextSplits = patch.splits ?? current.splits;
  const nextCategory = "categoryId" in patch ? patch.categoryId : current.categoryId;
  const lent =
    nextCategory === "loan_out" ||
    nextSplits.some((line) => line.categoryId === "loan_out") ||
    patch.loanDirection === "lent";
  const repaid =
    nextCategory === "loan_in" ||
    nextSplits.some((line) => line.categoryId === "loan_in") ||
    Boolean(patch.loanOriginId) ||
    patch.loanDirection === "repaid";

  if (lent) {
    if (!("loanDirection" in patch)) patch.loanDirection = "lent";
    if (!("loanOriginId" in patch)) patch.loanOriginId = null;
    const personId = patch.loanPersonId ?? current.loanPersonId;
    const splitLent = nextSplits.some((line) => line.categoryId === "loan_out");
    if (!personId && !splitLent) {
      patch.loanPersonId = findOrCreateBorrower(current.counterparty, current.iban).id;
    }
  } else if (repaid) {
    if (!("loanDirection" in patch)) patch.loanDirection = "repaid";
    if (patch.loanOriginId) {
      const origin = getTransaction(patch.loanOriginId);
      if (origin) {
        if (!("loanPersonId" in patch)) patch.loanPersonId = origin.loanPersonId;
        if (!("categoryId" in patch) && nextSplits.length === 0) patch.categoryId = "loan_in";
      }
    }
  }
}

function uniqueCategoryId(name: string, existing: { id: string }[]): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 40) || "category";
  const used = new Set(existing.map((c) => c.id));
  if (!used.has(base)) return base;
  let i = 2;
  while (used.has(`${base}_${i}`)) i += 1;
  return `${base}_${i}`;
}

function loadEnv(path: string): void {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim();
  }
}
