import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Button, Drawer, Flex, Input, InputNumber, Segmented, Select, Switch, Table } from "antd";
import { PageHeader } from "../ui/PageHeader";
import { Money } from "../ui/Money";
import { FilterBar } from "../ui/FilterBar";
import { CategoryTag } from "../ui/CategoryTag";
import { CategorySelect, categoriesForAmount } from "../ui/CategorySelect";
import { SectionCard } from "../ui/SectionCard";
import { EmptyState } from "../ui/EmptyState";
import { LoanPanel } from "../ui/LoanPanel";
import { formatDay, formatDayShort, formatMonth, latestBookedMonth } from "../lib/dates";
import { accountFeeMonth } from "../lib/categorize";
import { runningBalanceById } from "../lib/runningBalance";
import { categoryPatch, isOpenLoan, isWaitingToAttach, loanOriginStatus, splitLoanPatch } from "../lib/lending";
import { amountMatchesFilter, formatEur, tryParseAmount } from "../lib/money";
import type { Category, Person, Transaction } from "../types";

type FilterMode = "all" | "uncat" | "in" | "out" | "open";

function bookedInMonth(tx: Transaction, month: string): boolean {
  const feeMonth = accountFeeMonth(tx.valueDate || tx.bookingDate, tx.bookingText);
  if (feeMonth) return feeMonth === month;
  const value = (tx.valueDate || tx.bookingDate || "").slice(0, 7);
  return value === month;
}

function displayDate(tx: Transaction): string {
  const feeMonth = accountFeeMonth(tx.valueDate || tx.bookingDate, tx.bookingText);
  if (feeMonth && feeMonth !== (tx.valueDate || "").slice(0, 7)) {
    return tx.bookingDate || tx.valueDate;
  }
  return tx.valueDate || tx.bookingDate;
}

export function TransactionsPage({
  month,
  transactions,
  categories,
  people = [],
  openingBalance = 0,
  onPatch,
  onMonthChange,
}: {
  month: string;
  transactions: Transaction[];
  categories: Category[];
  people?: Person[];
  openingBalance?: number;
  onPatch: (id: string, patch: Partial<Transaction>) => Promise<void>;
  onMonthChange?: (month: string) => void;
}) {
  const [params, setParams] = useSearchParams();
  const kind = params.get("kind");
  const mode: FilterMode =
    params.get("uncat") === "1"
      ? "uncat"
      : kind === "in" || kind === "out" || kind === "open"
        ? kind
        : "all";
  const categoryFilter = params.get("category") ?? "";
  const [search, setSearch] = useState(params.get("q") ?? "");
  const [amountMinText, setAmountMinText] = useState(params.get("amin") ?? "");
  const [amountMaxText, setAmountMaxText] = useState(params.get("amax") ?? "");
  const [hideExcluded, setHideExcluded] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const amountMin = tryParseAmount(amountMinText);
  const amountMax = tryParseAmount(amountMaxText);

  function setFilter(next: { mode?: FilterMode; category?: string }) {
    const nextParams = new URLSearchParams(params);
    const nextMode = next.mode ?? mode;
    if (nextMode === "uncat") {
      nextParams.set("uncat", "1");
      nextParams.delete("kind");
    } else if (nextMode === "in" || nextMode === "out" || nextMode === "open") {
      nextParams.set("kind", nextMode);
      nextParams.delete("uncat");
    } else {
      nextParams.delete("uncat");
      nextParams.delete("kind");
    }
    const nextCategory = next.category ?? categoryFilter;
    if (nextCategory) nextParams.set("category", nextCategory);
    else nextParams.delete("category");
    setParams(nextParams, { replace: true });
  }

  const balances = useMemo(
    () => runningBalanceById(transactions, openingBalance),
    [transactions, openingBalance],
  );

  const monthRows = useMemo(
    () => transactions.filter((tx) => bookedInMonth(tx, month)),
    [transactions, month],
  );

  const rows = useMemo(() => {
    const base =
      mode === "open"
        ? transactions.filter(
            (tx) => isOpenLoan(tx, transactions) || isWaitingToAttach(tx, transactions, people),
          )
        : monthRows;
    return base
      .filter((tx) => {
        if (hideExcluded && tx.excluded) return false;
        if (mode === "uncat" && (tx.categoryId || tx.splits.length)) return false;
        if (mode === "in" && tx.amount <= 0) return false;
        if (mode === "out" && tx.amount >= 0) return false;
        if (categoryFilter && tx.categoryId !== categoryFilter && !tx.splits.some((s) => s.categoryId === categoryFilter)) {
          return false;
        }
        if (search) {
          const q = search.toLowerCase();
          const hay = `${tx.counterparty} ${tx.purpose} ${tx.bookingText} ${tx.iban} ${tx.notes}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        if (!amountMatchesFilter(tx.amount, amountMin, amountMax)) return false;
        return true;
      })
      .sort((a, b) => {
        const da = (b.valueDate || b.bookingDate).localeCompare(a.valueDate || a.bookingDate);
        if (da !== 0) return da;
        return b.id.localeCompare(a.id);
      });
  }, [monthRows, hideExcluded, mode, categoryFilter, search, amountMin, amountMax, transactions, people]);

  const open = rows.find((tx) => tx.id === openId) ?? transactions.find((tx) => tx.id === openId) ?? null;
  const uncatCount = monthRows.filter((tx) => !tx.categoryId && tx.splits.length === 0 && !tx.excluded).length;
  const openLoanCount = transactions.filter(
    (tx) => isOpenLoan(tx, transactions) || isWaitingToAttach(tx, transactions, people),
  ).length;
  const shownIn = rows.filter((tx) => !tx.excluded && tx.amount > 0).reduce((sum, tx) => sum + tx.amount, 0);
  const shownOut = rows.filter((tx) => !tx.excluded && tx.amount < 0).reduce((sum, tx) => sum + tx.amount, 0);
  const jumpMonth = monthRows.length === 0 ? latestBookedMonth(transactions) : null;

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (target?.isContentEditable) return;
      if (!openId) return;
      const index = rows.findIndex((tx) => tx.id === openId);
      if (event.key === "ArrowDown" || event.key === "j") {
        event.preventDefault();
        if (index >= 0 && index < rows.length - 1) setOpenId(rows[index + 1].id);
      }
      if (event.key === "ArrowUp" || event.key === "k") {
        event.preventDefault();
        if (index > 0) setOpenId(rows[index - 1].id);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openId, rows]);

  return (
    <>
      <PageHeader title="Transactions">
        {mode === "open"
          ? `Still open · ${rows.length} across all months`
          : `${formatMonth(month)} · ${monthRows.length} bookings${
              uncatCount ? ` · ${uncatCount} still need a category` : " · all tagged"
            }`}
      </PageHeader>

      <div className="tx-summary">
        <div>
          <span className="stat-label">Shown</span>
          <strong>{rows.length}</strong>
        </div>
        <div>
          <span className="stat-label">In</span>
          <strong>
            <Money value={shownIn} />
          </strong>
        </div>
        <div>
          <span className="stat-label">Out</span>
          <strong>
            <Money value={shownOut} />
          </strong>
        </div>
        <div>
          <span className="stat-label">Net</span>
          <strong>
            <Money value={shownIn + shownOut} />
          </strong>
        </div>
      </div>

      <FilterBar>
        <Segmented<FilterMode>
          value={mode}
          onChange={(value) => setFilter({ mode: value })}
          options={[
            { label: "All", value: "all" },
            { label: uncatCount ? `Needs category (${uncatCount})` : "Needs category", value: "uncat" },
            { label: openLoanCount ? `Still open (${openLoanCount})` : "Still open", value: "open" },
            { label: "In", value: "in" },
            { label: "Out", value: "out" },
          ]}
        />
        <Input.Search
          allowClear
          placeholder="Search payee, purpose, IBAN"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ maxWidth: 280, minWidth: 200, flex: 1 }}
        />
        <Input
          allowClear
          value={amountMinText}
          onChange={(e) => setAmountMinText(e.target.value)}
          placeholder="Min €"
          style={{ width: 100 }}
        />
        <Input
          allowClear
          value={amountMaxText}
          onChange={(e) => setAmountMaxText(e.target.value)}
          placeholder="Max €"
          style={{ width: 100 }}
        />
        <Select
          allowClear
          placeholder="Any category"
          value={categoryFilter || undefined}
          onChange={(value) => setFilter({ category: value ?? "" })}
          style={{ minWidth: 180 }}
          options={categories.map((c) => ({ value: c.id, label: c.name }))}
        />
        <label className="tx-hide-excluded">
          <Switch size="small" checked={hideExcluded} onChange={setHideExcluded} />
          Hide excluded
        </label>
      </FilterBar>

      <SectionCard padded={false}>
        <Table
          className="tx-table"
          size="middle"
          rowKey="id"
          dataSource={rows}
          scroll={{ x: 920 }}
          tableLayout="fixed"
          pagination={
            rows.length > 40
              ? { pageSize: 40, showSizeChanger: false, showTotal: (n) => `${n} bookings` }
              : false
          }
          locale={{
            emptyText: (
              <EmptyState
                title={
                  mode === "uncat"
                    ? "Nothing left to tag"
                    : mode === "open"
                      ? "Nothing still open"
                      : jumpMonth
                        ? `No bookings in ${formatMonth(month)}`
                        : "Nothing in this view"
                }
                body={
                  mode === "open"
                    ? "Mark a booking as Money Lent and it stays here until return bookings are attached — across every month."
                    : mode === "uncat"
                      ? "Every booking this month already has a category. Switch to All to see them."
                      : jumpMonth
                        ? `Your ledger has bookings in ${formatMonth(jumpMonth)}. Still-open money lent (${openLoanCount}) is counted across all months, not just this one.`
                        : search || amountMin != null || amountMax != null
                          ? "Try a shorter search, clear the amount filter, or clear the other filters."
                          : "Import a CSV or pick another month."
                }
              />
            ),
          }}
          footer={
            mode === "open"
              ? undefined
              : jumpMonth && onMonthChange
                ? () => (
                    <div className="tx-table-footer">
                      <Button type="link" onClick={() => onMonthChange(jumpMonth)}>
                        Go to {formatMonth(jumpMonth)}
                      </Button>
                    </div>
                  )
                : mode !== "all" && rows.length === 0 && monthRows.length > 0
                  ? () => (
                      <div className="tx-table-footer">
                        <Button type="link" onClick={() => setFilter({ mode: "all" })}>
                          Show all {monthRows.length} bookings this month
                        </Button>
                      </div>
                    )
                  : undefined
          }
          onRow={(tx) => ({
            onClick: () => setOpenId(tx.id),
          })}
          rowClassName={(tx) =>
            [
              "tx-row",
              !tx.categoryId && tx.splits.length === 0 ? "uncat-row" : "",
              tx.excluded ? "tx-excluded" : "",
              tx.id === openId ? "tx-open" : "",
            ]
              .filter(Boolean)
              .join(" ")
          }
          columns={[
            {
              title: "Date",
              width: 88,
              className: "tx-col-date",
              render: (_, tx) => (
                <span className="tx-date">{formatDayShort(displayDate(tx))}</span>
              ),
            },
            {
              title: "Payee",
              className: "tx-col-payee",
              render: (_, tx) => {
                const payee = tx.counterparty || tx.bookingText || "Unknown payee";
                const purpose =
                  tx.purpose && tx.purpose !== payee
                    ? tx.purpose
                    : tx.counterparty && tx.bookingText && tx.bookingText !== payee
                      ? tx.bookingText
                      : "";
                return (
                  <div className="tx-payee-cell">
                    <div className="tx-payee" title={payee}>
                      {payee}
                    </div>
                    {purpose ? (
                      <div className="tx-purpose" title={purpose}>
                        {purpose}
                      </div>
                    ) : null}
                    <TxFlags tx={tx} ledger={transactions} people={people} />
                  </div>
                );
              },
            },
            {
              title: "Category",
              width: 188,
              className: "tx-col-cat",
              render: (_, tx) => (
                <div className="tx-cat-cell" onClick={(e) => e.stopPropagation()}>
                  {tx.splits.length > 0 ? (
                    <SplitSummary tx={tx} categories={categories} />
                  ) : (
                    <CategorySelect
                      size="small"
                      value={tx.categoryId ?? ""}
                      categories={categories}
                      amount={tx.amount}
                      onChange={(value) => void onPatch(tx.id, categoryPatch(value))}
                    />
                  )}
                </div>
              ),
            },
            {
              title: "Amount",
              align: "right",
              width: 120,
              className: "tx-col-money",
              render: (_, tx) => <Money value={tx.amount} />,
            },
            {
              title: "Balance",
              align: "right",
              width: 120,
              className: "tx-col-money",
              render: (_, tx) =>
                balances.has(tx.id) ? <Money value={balances.get(tx.id) ?? 0} /> : <span className="tx-muted">—</span>,
            },
          ]}
        />
      </SectionCard>

      <Drawer
        open={Boolean(open)}
        onClose={() => setOpenId(null)}
        title={
          <span className="booking-drawer-title" title={open?.counterparty || open?.bookingText || "Booking"}>
            {shortLabel(open?.counterparty || open?.bookingText || "Booking")}
          </span>
        }
        width={440}
        classNames={{ body: "booking-drawer-body", header: "booking-drawer-header" }}
        destroyOnHidden
      >
        {open && (
          <BookingDetail
            key={open.id}
            tx={open}
            categories={categories}
            people={people}
            ledger={transactions}
            balance={balances.get(open.id)}
            onPatch={onPatch}
            onPrev={() => {
              const index = rows.findIndex((tx) => tx.id === open.id);
              if (index > 0) setOpenId(rows[index - 1].id);
            }}
            onNext={() => {
              const index = rows.findIndex((tx) => tx.id === open.id);
              if (index >= 0 && index < rows.length - 1) setOpenId(rows[index + 1].id);
            }}
          />
        )}
      </Drawer>
    </>
  );
}

function TxFlags({
  tx,
  ledger,
  people,
}: {
  tx: Transaction;
  ledger: Transaction[];
  people: Person[];
}) {
  const flags: { label: string; tone?: string }[] = [];
  if (isOpenLoan(tx, ledger)) {
    const status = loanOriginStatus(tx, ledger);
    flags.push({
      label: status.repaid > 0 ? `Still open · ${formatEur(status.outstanding)} left` : "Still open · waiting for return",
      tone: "loan-open",
    });
  } else if (tx.loanOriginId) {
    const origin = ledger.find((row) => row.id === tx.loanOriginId);
    const n = origin ? ledger.filter((row) => row.loanOriginId === origin.id).length : 1;
    flags.push({
      label: n > 1 ? `Return · installment of ${n}` : "Return attached",
      tone: "loan-ok",
    });
  } else if (isWaitingToAttach(tx, ledger, people)) {
    flags.push({ label: "Attach to money lent", tone: "loan-wait" });
  }
  if (tx.splits.length) flags.push({ label: `Split · ${tx.splits.length}` });
  if (tx.spreadMonths > 1) flags.push({ label: `Spread ${tx.spreadMonths} mo` });
  if (tx.notes) flags.push({ label: "Note" });
  if (tx.excluded) flags.push({ label: "Excluded" });
  if (tx.source === "cash") flags.push({ label: "Cash" });
  if (!flags.length) return null;
  return (
    <div className="tx-flags">
      {flags.map((flag) => (
        <span className={`tx-flag ${flag.tone ?? ""}`.trim()} key={flag.label}>
          {flag.label}
        </span>
      ))}
    </div>
  );
}

function SplitSummary({ tx, categories }: { tx: Transaction; categories: Category[] }) {
  return (
    <div className="split-summary">
      {tx.splits.map((line) => {
        const cat = categories.find((c) => c.id === line.categoryId);
        return (
          <div key={line.id} className="split-summary-line">
            {cat ? <CategoryTag name={cat.name} color={cat.color} /> : line.categoryId}
          </div>
        );
      })}
    </div>
  );
}

function shortLabel(value: string, max = 36): string {
  const cleaned = value.trim();
  if (cleaned.length <= max) return cleaned;
  const cut = cleaned.slice(0, max);
  const at = Math.max(cut.lastIndexOf(" "), cut.lastIndexOf(","));
  return `${(at > 16 ? cut.slice(0, at) : cut).trim()}…`;
}

function BookingDetail({
  tx,
  categories,
  people,
  ledger,
  balance,
  onPatch,
  onPrev,
  onNext,
}: {
  tx: Transaction;
  categories: Category[];
  people: Person[];
  ledger: Transaction[];
  balance?: number;
  onPatch: (id: string, patch: Partial<Transaction>) => Promise<void>;
  onPrev: () => void;
  onNext: () => void;
}) {
  const [notes, setNotes] = useState(tx.notes);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const purpose = tx.purpose && tx.purpose !== tx.counterparty ? tx.purpose : "";

  return (
    <div className="booking-drawer">
      <header className="booking-hero">
        <div className="booking-hero-meta">
          <span>{formatDay(tx.valueDate || tx.bookingDate)}</span>
          <span className="booking-dot">·</span>
          <span>{tx.source === "cash" ? "Cash" : "Bank"}</span>
        </div>
        <div className="booking-amount">
          <Money value={tx.amount} />
        </div>
        {balance != null && (
          <div className="booking-balance">
            After booking <Money value={balance} />
          </div>
        )}
        {purpose ? <p className="booking-purpose">{purpose}</p> : null}
      </header>

      <button
        type="button"
        className={`booking-details-toggle ${detailsOpen ? "open" : ""}`}
        onClick={() => setDetailsOpen((v) => !v)}
      >
        Booking details
        <span aria-hidden>{detailsOpen ? "−" : "+"}</span>
      </button>
      {detailsOpen && (
        <div className="booking-details">
          <Meta label="Payee" value={tx.counterparty || "—"} />
          <Meta label="Purpose" value={tx.purpose || "—"} />
          <Meta label="Booking text" value={tx.bookingText || "—"} />
          <Meta label="IBAN" value={tx.iban || "—"} />
        </div>
      )}

      <section className="booking-panel booking-classify">
        <div className="booking-classify-head">
          <label className="booking-label">Category</label>
          {tx.splits.length > 0 ? (
            <span className="booking-classify-note">Split · {tx.splits.length} parts</span>
          ) : null}
        </div>

        <SplitEditor tx={tx} categories={categories} onPatch={onPatch} />
      </section>

      <LoanPanel tx={tx} ledger={ledger} people={people} onPatch={onPatch} />

      <section className="booking-panel">
        <div className="booking-row">
          <span>Exclude from budget</span>
          <Switch checked={tx.excluded} onChange={(checked) => void onPatch(tx.id, { excluded: checked })} />
        </div>

        <div className="booking-row booking-spread">
          <span>Spread over</span>
          <div className="booking-spread-control">
            <InputNumber
              min={1}
              max={12}
              value={tx.spreadMonths}
              onChange={(value) =>
                void onPatch(tx.id, {
                  spreadMonths: Number(value || 1),
                  spreadStart: Number(value || 1) > 1 ? tx.month : null,
                })
              }
            />
            <span className="booking-spread-unit">months</span>
          </div>
        </div>

        <label className="booking-label">Notes</label>
        <Input.TextArea
          value={notes}
          rows={2}
          placeholder="Optional context"
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => {
            if (notes !== tx.notes) void onPatch(tx.id, { notes });
          }}
        />
      </section>

      <nav className="booking-nav">
        <Button onClick={onPrev}>Previous</Button>
        <span className="booking-nav-hint">↑ ↓ · J K</span>
        <Button onClick={onNext}>Next</Button>
      </nav>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="booking-meta-row">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function SplitEditor({
  tx,
  categories,
  onPatch,
}: {
  tx: Transaction;
  categories: Category[];
  onPatch: (id: string, patch: Partial<Transaction>) => Promise<void>;
}) {
  const total = Math.abs(tx.amount);
  const splitCats = categoriesForAmount(categories, tx.amount);
  const options = splitCats.map((c) => ({ value: c.id, label: c.name }));
  const [open, setOpen] = useState(tx.splits.length > 0);
  const [lines, setLines] = useState(() => initialSplitDraft(tx, splitCats));

  const parsed = lines.map((line, index) => {
    const isLast = index === lines.length - 1;
    return {
      ...line,
      isLast,
      amount: isLast ? 0 : tryParseAmount(line.amountText) ?? 0,
    };
  });
  const enteredSum = roundMoney(parsed.slice(0, -1).reduce((sum, line) => sum + line.amount, 0));
  const rest = roundMoney(total - enteredSum);
  const amounts = parsed.map((line) => (line.isLast ? rest : line.amount));
  const cats = lines.map((line) => line.categoryId);
  const uniqueCats = new Set(cats.filter(Boolean));
  const allPositive = amounts.every((amount) => amount > 0);
  const canSave =
    lines.length >= 2 &&
    allPositive &&
    uniqueCats.size === lines.length &&
    cats.every(Boolean) &&
    roundMoney(amounts.reduce((sum, n) => sum + n, 0)) === total;

  const hint = !canSave
    ? splitHint({ lines, amounts, rest, total, uniqueCats: uniqueCats.size })
    : `${lines.length} parts · ${formatEur(total)}`;

  function updateLine(key: string, patch: Partial<SplitDraft>) {
    setLines((prev) => prev.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  }

  function addPart() {
    setLines((prev) => {
      const used = new Set(prev.map((line) => line.categoryId));
      const nextCat = splitCats.find((c) => !used.has(c.id))?.id || "";
      const next = [...prev];
      next.splice(next.length - 1, 0, {
        key: crypto.randomUUID(),
        categoryId: nextCat,
        amountText: "",
      });
      return next;
    });
  }

  function removePart(key: string) {
    setLines((prev) => {
      if (prev.length <= 2) return prev;
      const filtered = prev.filter((line) => line.key !== key);
      return filtered.length >= 2 ? filtered : prev;
    });
  }

  function closeEditor() {
    setOpen(false);
    setLines(initialSplitDraft(tx, splitCats));
  }

  async function clearSplit() {
    await onPatch(tx.id, { splits: [], categoryId: tx.splits[0]?.categoryId ?? null });
    setLines(initialSplitDraft({ ...tx, splits: [] }, splitCats));
    setOpen(false);
  }

  if (!open) {
    return (
      <div className="split-collapsed">
        <CategorySelect
          value={tx.categoryId ?? ""}
          categories={categories}
          amount={tx.amount}
          onChange={(value) => void onPatch(tx.id, categoryPatch(value))}
        />
        <Button type="dashed" className="split-open-btn" onClick={() => setOpen(true)}>
          + Split
        </Button>
      </div>
    );
  }

  return (
    <div className="split-editor">
      {tx.splits.length > 0 && (
        <div className="split-current">
          {tx.splits.map((line) => {
            const cat = categories.find((c) => c.id === line.categoryId);
            return (
              <Flex key={line.id} justify="space-between" gap={8}>
                <span>{cat?.name ?? line.categoryId}</span>
                <Money value={line.amount} absolute />
              </Flex>
            );
          })}
          <Button type="link" size="small" onClick={() => void clearSplit()}>
            Clear split
          </Button>
        </div>
      )}

      <div className="split-editor-head">
        <strong>Split into parts</strong>
        <span>Last part gets the remainder.</span>
      </div>

      {lines.map((line, index) => {
        const isLast = index === lines.length - 1;
        return (
          <div className="split-row" key={line.key}>
            <Select
              showSearch
              optionFilterProp="label"
              className="split-cat"
              value={line.categoryId || undefined}
              options={options}
              onChange={(categoryId) => updateLine(line.key, { categoryId })}
              placeholder={`Part ${index + 1}`}
            />
            {isLast ? (
              <Input
                readOnly
                className="split-amount split-amount-rest"
                value={formatAmountInput(Math.max(0, rest))}
                addonAfter="€"
              />
            ) : (
              <Input
                className="split-amount"
                value={line.amountText}
                placeholder="0,00"
                onChange={(e) => updateLine(line.key, { amountText: e.target.value })}
                addonAfter="€"
              />
            )}
            {lines.length > 2 && !isLast ? (
              <Button type="text" size="small" className="split-remove" onClick={() => removePart(line.key)} aria-label="Remove part">
                ×
              </Button>
            ) : null}
          </div>
        );
      })}

      <div className="split-actions">
        <Button type="link" size="small" onClick={addPart}>
          + Add part
        </Button>
        <span className="split-hint">{hint}</span>
      </div>

      <div className="split-footer">
        {tx.splits.length === 0 ? (
          <Button type="text" onClick={closeEditor}>
            Cancel
          </Button>
        ) : (
          <span />
        )}
        <Button
          type="primary"
          disabled={!canSave}
          onClick={() =>
            void onPatch(
              tx.id,
              splitLoanPatch(
                tx,
                lines.map((line, index) => ({
                  id: crypto.randomUUID(),
                  categoryId: line.categoryId,
                  amount: amounts[index],
                })),
                null,
              ),
            )
          }
        >
          Save split
        </Button>
      </div>
    </div>
  );
}

function formatAmountInput(value: number): string {
  return value.toFixed(2).replace(".", ",");
}

type SplitDraft = { key: string; categoryId: string; amountText: string };

function initialSplitDraft(tx: Transaction, splitCats: Category[]): SplitDraft[] {
  if (tx.splits.length >= 2) {
    return tx.splits.map((line, index) => ({
      key: line.id,
      categoryId: line.categoryId,
      amountText:
        index === tx.splits.length - 1 ? "" : String(line.amount).replace(".", ","),
    }));
  }
  const first =
    splitCats.find((c) => c.id === "miscellaneous")?.id || splitCats[0]?.id || "";
  const second =
    splitCats.find((c) => c.id === "loan_out" && c.id !== first)?.id ||
    splitCats.find((c) => c.id !== first)?.id ||
    "";
  return [
    { key: "a", categoryId: first, amountText: "" },
    { key: "b", categoryId: second, amountText: "" },
  ];
}

function splitHint({
  lines,
  amounts,
  rest,
  total,
  uniqueCats,
}: {
  lines: SplitDraft[];
  amounts: number[];
  rest: number;
  total: number;
  uniqueCats: number;
}): string {
  if (lines.some((line) => !line.categoryId)) return "Pick a category for each part.";
  if (uniqueCats < lines.length) return "Each part needs a different category.";
  if (rest < -0.005) return `Parts add up to more than ${formatEur(total)}.`;
  if (amounts.slice(0, -1).some((amount) => amount <= 0)) {
    return "Enter amounts for every part except the last.";
  }
  if (rest <= 0) return `Leave some of ${formatEur(total)} for the last part.`;
  return `Remainder ${formatEur(rest)}.`;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}
