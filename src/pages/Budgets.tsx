import { useState } from "react";
import { Button, Col, Input, InputNumber, Progress, Row, Select, Space, Typography } from "antd";
import { formatEur } from "../lib/money";
import { formatMonth } from "../lib/dates";
import { summarizeMonth } from "../lib/summary";
import { PageHeader } from "../ui/PageHeader";
import { Money } from "../ui/Money";
import { StatCard } from "../ui/StatCard";
import { SectionCard } from "../ui/SectionCard";
import { CategoryTag } from "../ui/CategoryTag";
import type { Category, Transaction } from "../types";

export function BudgetsPage({
  month,
  categories,
  transactions,
  onSave,
  onAdd,
}: {
  month: string;
  categories: Category[];
  transactions: Transaction[];
  onSave: (id: string, budget: number) => Promise<void>;
  onAdd: (body: { name: string; kind: "expense" | "income"; budget: number }) => Promise<void>;
}) {
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const summary = summarizeMonth(month, transactions, categories);
  const expenses = categories.filter((c) => c.kind === "expense");
  const incomes = categories.filter((c) => c.kind === "income");
  const dirty = categories.filter((c) => {
    const next = parseAmount(draft[c.id] ?? String(c.budget));
    return next !== c.budget;
  });
  const expenseCap = expenses.reduce((sum, c) => sum + planned(c, draft), 0);
  const incomeCap = incomes.reduce((sum, c) => sum + planned(c, draft), 0);
  const leftover = round2(incomeCap - expenseCap);

  async function saveAll() {
    setBusy(true);
    try {
      await Promise.all(dirty.map((c) => onSave(c.id, parseAmount(draft[c.id] ?? String(c.budget)))));
      setDraft({});
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="Monthly budgets">
        Caps for {formatMonth(month)}. Same Budget column as the year sheet.
      </PageHeader>

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} md={8}>
          <StatCard label="Expense caps" value={<Money value={expenseCap} absolute />} />
        </Col>
        <Col xs={24} md={8}>
          <StatCard label="Income target" value={<Money value={incomeCap} />} />
        </Col>
        <Col xs={24} md={8}>
          <StatCard label="Planned leftover" value={<Money value={leftover} />} />
        </Col>
      </Row>

      <Section
        title="Expenses"
        rows={expenses}
        draft={draft}
        summary={summary}
        onDraft={(id, value) => setDraft((d) => ({ ...d, [id]: value }))}
        onSave={async (id) => {
          await onSave(id, parseAmount(draft[id] ?? "0"));
          setDraft((d) => {
            const next = { ...d };
            delete next[id];
            return next;
          });
        }}
      />
      <Section
        title="Income"
        rows={incomes}
        draft={draft}
        summary={summary}
        onDraft={(id, value) => setDraft((d) => ({ ...d, [id]: value }))}
        onSave={async (id) => {
          await onSave(id, parseAmount(draft[id] ?? "0"));
          setDraft((d) => {
            const next = { ...d };
            delete next[id];
            return next;
          });
        }}
      />
      <AddCategory onAdd={onAdd} />

      {dirty.length > 0 && (
        <div className="save-bar">
          <span>
            {dirty.length} unsaved cap{dirty.length === 1 ? "" : "s"}
          </span>
          <Button type="primary" loading={busy} onClick={() => void saveAll()}>
            Save changes
          </Button>
        </div>
      )}
    </>
  );
}

function Section({
  title,
  rows,
  draft,
  summary,
  onDraft,
  onSave,
}: {
  title: string;
  rows: Category[];
  draft: Record<string, string>;
  summary: { byCategory: Record<string, number> };
  onDraft: (id: string, value: string) => void;
  onSave: (id: string) => Promise<void>;
}) {
  const withCap = rows.filter((c) => planned(c, draft) > 0 || Math.abs(summary.byCategory[c.id] ?? 0) > 0);
  const unused = rows.filter((c) => !withCap.includes(c));

  return (
    <SectionCard title={title} extra={<Typography.Text type="secondary">{withCap.length} with a cap or spend</Typography.Text>}>
      <Row gutter={[12, 12]}>
        {withCap.map((category) => (
          <Col xs={24} sm={12} lg={8} key={category.id}>
            <BudgetCard
              category={category}
              draft={draft}
              spent={spentAmount(category, summary.byCategory[category.id] ?? 0)}
              onDraft={onDraft}
              onSave={onSave}
            />
          </Col>
        ))}
      </Row>
      {unused.length > 0 && (
        <>
          <Typography.Title level={5} style={{ marginTop: 20 }}>
            No cap
          </Typography.Title>
          <Row gutter={[12, 12]}>
            {unused.map((category) => (
              <Col xs={24} sm={12} lg={8} key={category.id}>
                <BudgetCard category={category} draft={draft} spent={0} onDraft={onDraft} onSave={onSave} />
              </Col>
            ))}
          </Row>
        </>
      )}
    </SectionCard>
  );
}

function BudgetCard({
  category,
  draft,
  spent,
  onDraft,
  onSave,
}: {
  category: Category;
  draft: Record<string, string>;
  spent: number;
  onDraft: (id: string, value: string) => void;
  onSave: (id: string) => Promise<void>;
}) {
  const value = draft[category.id] ?? String(category.budget);
  const next = parseAmount(value);
  const dirty = next !== category.budget;
  const ratio = next > 0 ? spent / next : spent > 0 ? 1 : 0;
  const over = ratio > 1;

  return (
    <div className={`budget-tile${dirty ? " dirty" : ""}${over ? " over" : ""}`}>
      <Space style={{ width: "100%", justifyContent: "space-between", marginBottom: 8 }}>
        <CategoryTag name={category.name} color={category.color} />
        {dirty && <Typography.Text type="secondary">was {formatEur(category.budget)}</Typography.Text>}
      </Space>
      <InputNumber
        prefix="€"
        value={value}
        style={{ width: "100%" }}
        onChange={(v) => onDraft(category.id, String(v ?? 0))}
        onBlur={() => {
          if (dirty) void onSave(category.id);
        }}
      />
      {spent > 0 && (
        <div style={{ marginTop: 8 }}>
          <Progress percent={Math.min(100, Math.round(ratio * 100))} status={over ? "exception" : "normal"} />
          <Typography.Text type={over ? "danger" : "secondary"}>{formatEur(spent)} spent this month</Typography.Text>
        </div>
      )}
    </div>
  );
}

function AddCategory({
  onAdd,
}: {
  onAdd: (body: { name: string; kind: "expense" | "income"; budget: number }) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"expense" | "income">("expense");
  const [budget, setBudget] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  return (
    <SectionCard title="New category">
      <Space wrap>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name — e.g. Pets"
          style={{ width: 220 }}
        />
        <Select
          value={kind}
          onChange={setKind}
          style={{ width: 140 }}
          options={[
            { value: "expense", label: "Expense" },
            { value: "income", label: "Income" },
          ]}
        />
        <InputNumber prefix="€" value={budget} onChange={(v) => setBudget(Number(v || 0))} />
        <Button
          type="primary"
          disabled={!name.trim()}
          loading={busy}
          onClick={() => {
            setBusy(true);
            setError("");
            void onAdd({ name: name.trim(), kind, budget })
              .then(() => {
                setName("");
                setBudget(0);
              })
              .catch((err) => setError(err instanceof Error ? err.message : "Could not add"))
              .finally(() => setBusy(false));
          }}
        >
          Add category
        </Button>
        {error && <Typography.Text type="danger">{error}</Typography.Text>}
      </Space>
    </SectionCard>
  );
}

function spentAmount(category: Category, raw: number): number {
  if (category.kind === "income") return Math.max(0, raw);
  return Math.abs(Math.min(0, raw));
}

function planned(category: Category, draft: Record<string, string>): number {
  return parseAmount(draft[category.id] ?? String(category.budget));
}

function parseAmount(raw: string): number {
  const n = Number(String(raw).trim().replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? round2(n) : 0;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
