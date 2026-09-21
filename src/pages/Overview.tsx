import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Col, Row, Typography } from "antd";
import { PageHeader } from "../ui/PageHeader";
import { Money } from "../ui/Money";
import { StatCard } from "../ui/StatCard";
import { SectionCard } from "../ui/SectionCard";
import { EmptyState } from "../ui/EmptyState";
import { TrendChart } from "../ui/TrendChart";
import { MixChart } from "../ui/MixChart";
import { addMonths, currentMonth, formatDay, formatMonth, monthsBetween } from "../lib/dates";
import { summarizeMonth, visibleInMonth } from "../lib/summary";
import { buildForecast } from "../lib/forecast";
import { buildInsights } from "../lib/insights";
import { withMonth } from "../hooks/useMonth";
import type { DetectedContract } from "../lib/contracts";
import type { CashMovement, Category, Transaction } from "../types";

export function OverviewPage({
  month,
  transactions,
  categories,
  cashOnHand,
  cashMovements,
  bankBalance,
  bankBalanceAsOf,
  contracts,
}: {
  month: string;
  transactions: Transaction[];
  categories: Category[];
  cashOnHand: number;
  cashMovements: CashMovement[];
  bankBalance: number | null;
  bankBalanceAsOf: string | null;
  contracts: DetectedContract[];
}) {
  const navigate = useNavigate();
  const forecast = buildForecast({
    transactions,
    contracts,
    categories,
    bankBalance,
    cashOnHand,
  });
  const summary = summarizeMonth(month, transactions, categories);
  const monthTx = transactions.filter((tx) => visibleInMonth(tx, month) && !tx.excluded);
  const uncat = monthTx.filter((tx) => !tx.categoryId && tx.splits.length === 0).length;
  const hasAtm = cashMovements.some((m) => m.type === "atm_in" && m.month === month);
  const hasCashSpend = cashMovements.some((m) => m.type === "cash_out" && m.month === month);
  const needCashSpend = hasAtm && !hasCashSpend;
  const today = currentMonth();
  const trend = monthsBetween(addMonths(month, -5), month).map((m) => ({
    label: formatMonth(m).replace(/ \d{4}$/, "").slice(0, 3),
    value: summarizeMonth(m, transactions, categories).leftover,
  }));
  const mix = categories
    .filter((c) => c.kind === "expense")
    .map((c) => ({
      name: c.name,
      value: Math.abs(Math.min(0, summary.byCategory[c.id] ?? 0)),
      color: c.color,
    }))
    .filter((row) => row.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 6);
  const insights = useMemo(
    () => buildInsights(Number(month.slice(0, 4)), transactions, categories),
    [month, transactions, categories],
  );

  return (
    <>
      <PageHeader
        title="Home"
        extra={
          <Button type="primary" onClick={() => navigate(withMonth("/import", month))}>
            Import CSV
          </Button>
        }
      >
        {formatMonth(month)} · {monthTx.length} bookings
      </PageHeader>

      <div className="hero-row">
        <div className="hero-panel">
          <BankCard value={bankBalance} asOf={bankBalanceAsOf} />
        </div>
        <div className="hero-panel">
          <div className="stat-label">Until payday</div>
          <div className="stat-value hero">
            <Money value={forecast.availableUntilSalary ?? 0} />
          </div>
          <div className="stat-caption">
            {forecast.nextSalaryDate
              ? `${forecast.daysUntilSalary} days · ${formatDay(forecast.nextSalaryDate)}`
              : "No salary pattern yet"}
          </div>
        </div>
      </div>

      <Row gutter={[16, 16]}>
        <Col xs={24} md={8}>
          <StatCard
            label="This month leftover"
            value={<Money value={summary.leftover} />}
            caption={`Income ${summary.income.toLocaleString("de-DE")} · spend ${summary.expense.toLocaleString("de-DE")}`}
          />
        </Col>
        <Col xs={24} md={8}>
          <StatCard
            label="Uncategorized"
            value={uncat}
            caption={uncat ? "Open Transactions to assign" : "All tagged this month"}
            onClick={() => navigate(withMonth("/transactions", month, { uncat: "1" }))}
          />
        </Col>
        <Col xs={24} md={8}>
          <StatCard
            label="Cash wallet"
            value={<Money value={cashOnHand} />}
            caption={
              needCashSpend
                ? "ATM cash this month — record what you spent it on"
                : "ATM in, cash spend out"
            }
            onClick={() => navigate(withMonth("/cash", month))}
          />
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} lg={14}>
          <SectionCard title="Leftover last 6 months">
            <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
              Income minus expenses. {today === month ? "This month is still open." : null}
            </Typography.Paragraph>
            <TrendChart data={trend} />
          </SectionCard>
        </Col>
        <Col xs={24} lg={10}>
          <SectionCard title="Spend mix">
            {mix.length ? (
              <MixChart data={mix} />
            ) : (
              <EmptyState title="No expenses yet" body="Import a CSV or wait for bookings this month." />
            )}
          </SectionCard>
        </Col>
      </Row>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={14}>
          <SectionCard
            title="Upcoming until payday"
            extra={
              <Button type="link" onClick={() => navigate(withMonth("/contracts", month))}>
                Open contracts
              </Button>
            }
          >
            {forecast.upcoming.length === 0 ? (
              <EmptyState
                title="Nothing left before payday"
                body="Contracts are already booked this cycle, or none were detected."
              />
            ) : (
              <>
                {forecast.upcoming.map((item) => (
                  <div className="upcoming-row" key={item.name + item.date}>
                    <div>
                      <div>{item.name}</div>
                      <Typography.Text type="secondary">{formatDay(item.date)}</Typography.Text>
                    </div>
                    <Money value={item.amount} />
                  </div>
                ))}
                <Typography.Text type="secondary">
                  Remaining outflows <Money value={-forecast.remainingOutflows} />
                </Typography.Text>
              </>
            )}
          </SectionCard>
        </Col>
        <Col xs={24} lg={10}>
          <SectionCard title="Watch">
            {insights.notes.length === 0 ? (
              <EmptyState title="All quiet" body="No tax or investment notes for this year." />
            ) : (
              <div className="insight-list">
                {insights.notes.slice(0, 6).map((note) => (
                  <div className="insight-item" key={note.id}>
                    <span className={`insight-chip ${note.severity}`}>{note.severity}</span>
                    <div>
                      <div className="insight-title">{note.title}</div>
                      <div className="insight-body">{note.body}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
        </Col>
      </Row>
    </>
  );
}

function BankCard({
  value,
  asOf,
}: {
  value: number | null;
  asOf: string | null;
}) {
  return (
    <>
      <div className="stat-label">Bank</div>
      <div className="stat-value hero">
        <Money value={value ?? 0} />
      </div>
      <div className="stat-caption">
        {asOf ? `As of ${formatDay(asOf.slice(0, 10))}` : "No bank bookings yet"}
        {" · opening + imported bookings"}
      </div>
    </>
  );
}
