import { useMemo, useState } from "react";
import { Alert, Button, Col, DatePicker, Form, Input, InputNumber, Row, Select, Space, Switch, Typography } from "antd";
import dayjs from "dayjs";
import { formatEur } from "../lib/money";
import { formatDay, formatMonth } from "../lib/dates";
import { PageHeader } from "../ui/PageHeader";
import { Money } from "../ui/Money";
import { SectionCard } from "../ui/SectionCard";
import { EmptyState } from "../ui/EmptyState";
import { CategoryTag } from "../ui/CategoryTag";
import { CategorySelect } from "../ui/CategorySelect";
import type { CashMovement, Category } from "../types";

const LUMP_PRESETS = [400, 500, 800];

export function CashPage({
  balance,
  movements,
  categories,
  onAdd,
}: {
  balance: number;
  movements: CashMovement[];
  categories: Category[];
  onAdd: (body: {
    type: "in" | "out" | "opening";
    amount: number;
    date: string;
    categoryId?: string;
    note?: string;
    bookRemainder?: boolean;
  }) => Promise<void>;
}) {
  const expenses = categories.filter((c) => c.kind === "expense");
  const [type, setType] = useState<"out" | "in" | "opening">("out");
  const [amount, setAmount] = useState(Math.min(400, balance || 400));
  const [date, setDate] = useState(dayjs());
  const [categoryId, setCategoryId] = useState("groceries");
  const [note, setNote] = useState("Cash · Groceries");
  const [bookRemainder, setBookRemainder] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const fills = movements.filter((m) => m.type === "atm_in" || m.type === "cash_in" || m.type === "opening");
  const outs = movements.filter((m) => m.type === "cash_out");
  const fillMonths = new Set(fills.filter((m) => m.type === "atm_in").map((m) => m.month));
  const lumpMonths = new Set(outs.map((m) => m.month));
  const staleWallet = balance >= 1500 && lumpMonths.size + 1 < fillMonths.size;
  const timeline = useMemo(() => groupByMonth(movements), [movements]);
  const remainder = Math.round((balance - amount) * 100) / 100;
  const showRemainder = type === "out" && balance > 0 && amount > 0 && remainder > 0.005;

  async function submit() {
    setBusy(true);
    setError("");
    try {
      await onAdd({
        type,
        amount,
        date: date.format("YYYY-MM-DD"),
        categoryId: type === "out" ? categoryId : undefined,
        note,
        bookRemainder: type === "out" && showRemainder ? bookRemainder : false,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="Cash wallet">
        ATM withdrawals fill the wallet. When cash is spent, book it here — classify what you know, and leave the rest
        as Cash (to classify) so it still counts as expense until you reclass.
      </PageHeader>

      {staleWallet && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message="Wallet still includes old ATM cash"
          description={`${formatEur(balance)} from ${fillMonths.size} ATM months, but cash spend is only recorded for ${lumpMonths.size} month${lumpMonths.size === 1 ? "" : "s"}. If that cash is already spent, book it below.`}
        />
      )}

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={10}>
          <SectionCard>
            <div className="stat-label">Cash on hand</div>
            <div className="stat-value hero">
              <Money value={balance} />
            </div>
            <div className="stat-caption">Opening + ATM + cash received − cash spend</div>
          </SectionCard>
          <SectionCard title="How this works">
            <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
              Example: ATM 1.500 €, you know 500 € was travel — book 500 € as Traveling and leave the rest as Cash (to
              classify). Budgets see the full 1.500 € expense; later open the cash booking and reclass the remainder.
            </Typography.Paragraph>
          </SectionCard>
        </Col>
        <Col xs={24} lg={14}>
          <SectionCard title="Add movement">
            <Form layout="vertical" onFinish={() => void submit()}>
              <Form.Item label="Movement">
                <Select
                  value={type}
                  onChange={setType}
                  options={[
                    { value: "out", label: "Cash spend" },
                    { value: "in", label: "Cash in (received in cash)" },
                    { value: "opening", label: "Opening balance" },
                  ]}
                />
              </Form.Item>
              {type === "out" && (
                <Form.Item label="Category">
                  <CategorySelect
                    value={categoryId}
                    categories={expenses}
                    onChange={(id) => {
                      const next = id || "groceries";
                      setCategoryId(next);
                      const name = expenses.find((c) => c.id === next)?.name;
                      if (!note || note.startsWith("Cash · ")) setNote(name ? `Cash · ${name}` : "");
                    }}
                  />
                </Form.Item>
              )}
              <Form.Item label="Amount €">
                <InputNumber value={amount} onChange={(v) => setAmount(Number(v || 0))} min={0} style={{ width: "100%" }} />
                {type === "out" && (
                  <Space style={{ marginTop: 8 }} wrap>
                    {LUMP_PRESETS.map((n) => (
                      <Button
                        key={n}
                        size="small"
                        type={amount === n ? "primary" : "default"}
                        onClick={() => setAmount(n)}
                      >
                        {n}
                      </Button>
                    ))}
                    {balance > 0 && (
                      <Button size="small" type={amount === balance ? "primary" : "default"} onClick={() => setAmount(balance)}>
                        All {formatEur(balance)}
                      </Button>
                    )}
                  </Space>
                )}
              </Form.Item>
              {showRemainder && (
                <Form.Item>
                  <label className="cash-remainder">
                    <Switch size="small" checked={bookRemainder} onChange={setBookRemainder} />
                    <span>
                      Also book remaining {formatEur(remainder)} as{" "}
                      <strong>Cash (to classify)</strong>
                      {bookRemainder ? ` · total spend ${formatEur(balance)}` : ""}
                    </span>
                  </label>
                </Form.Item>
              )}
              <Form.Item label="Date">
                <DatePicker value={date} onChange={(v) => v && setDate(v)} allowClear={false} style={{ width: "100%" }} />
              </Form.Item>
              <Form.Item label="Note">
                <Input value={note} onChange={(e) => setNote(e.target.value)} />
              </Form.Item>
              {error && <Alert type="error" message={error} style={{ marginBottom: 12 }} />}
              <Button type="primary" htmlType="submit" loading={busy}>
                {type === "out" && showRemainder && bookRemainder
                  ? `Book ${formatEur(balance)} spend`
                  : "Add to wallet"}
              </Button>
            </Form>
          </SectionCard>
        </Col>
      </Row>

      <SectionCard title="Timeline">
        {timeline.length === 0 ? (
          <EmptyState title="No movements yet" body="Import a CSV with BARGELDAUSZAHLUNG, or record cash spend." />
        ) : (
          timeline.map(([monthKey, items]) => {
            const total = items.reduce((sum, m) => sum + (m.type === "cash_out" ? -m.amount : m.amount), 0);
            return (
              <div className="cash-month" key={monthKey}>
                <div className="cash-month-head">
                  <Typography.Text strong>{formatMonth(monthKey)}</Typography.Text>
                  <Typography.Text type="secondary">
                    {items.length} · {formatEur(total)}
                  </Typography.Text>
                </div>
                {items.map((m) => {
                  const cat = categories.find((c) => c.id === m.categoryId);
                  return (
                    <div className="cash-line" key={m.id}>
                      <Typography.Text type="secondary">{formatDay(m.date)}</Typography.Text>
                      <div>
                        <div>{m.note || labelType(m.type)}</div>
                        <Space size={6} style={{ marginTop: 2 }}>
                          <CategoryTag name={labelType(m.type)} />
                          {cat ? <CategoryTag name={cat.name} color={cat.color} /> : null}
                        </Space>
                      </div>
                      <Money value={m.type === "cash_out" ? -m.amount : m.amount} />
                    </div>
                  );
                })}
              </div>
            );
          })
        )}
      </SectionCard>
    </>
  );
}

function groupByMonth(rows: CashMovement[]): [string, CashMovement[]][] {
  const map = new Map<string, CashMovement[]>();
  for (const row of rows) {
    const list = map.get(row.month) ?? [];
    list.push(row);
    map.set(row.month, list);
  }
  return [...map.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([month, items]) => [month, items.sort((a, b) => b.date.localeCompare(a.date))]);
}

function labelType(type: CashMovement["type"]): string {
  switch (type) {
    case "atm_in":
      return "ATM fill";
    case "cash_in":
      return "Cash in";
    case "cash_out":
      return "Spend";
    case "opening":
      return "Opening";
  }
}
