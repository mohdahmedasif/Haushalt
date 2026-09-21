import { useMemo, useState } from "react";
import { Button, Flex, Input, Select, Space, Typography } from "antd";
import { formatDayShort } from "../lib/dates";
import {
  attachReturnPatch,
  candidateReturnBookings,
  detachReturnPatch,
  isLoanOrigin,
  isWaitingToAttach,
  loanOriginStatus,
  openOriginsForAttach,
} from "../lib/lending";
import { amountMatchesFilter, formatEur, tryParseAmount } from "../lib/money";
import type { Person, Transaction } from "../types";
import { Money } from "./Money";

export function LoanPanel({
  tx,
  ledger,
  people,
  onPatch,
}: {
  tx: Transaction;
  ledger: Transaction[];
  people: Person[];
  onPatch: (id: string, patch: Partial<Transaction>) => Promise<void>;
}) {
  const origin = isLoanOrigin(tx);
  const attachedOrigin = tx.loanOriginId ? ledger.find((row) => row.id === tx.loanOriginId) : null;
  const openHits = tx.amount > 0 ? openOriginsForAttach(tx, people, ledger) : [];
  const waiting = isWaitingToAttach(tx, ledger, people);

  if (origin) {
    return (
      <div className="loan-panel">
        <OriginLent tx={tx} ledger={ledger} onPatch={onPatch} />
      </div>
    );
  }
  if (attachedOrigin) {
    return (
      <div className="loan-panel">
        <AttachedReturn tx={tx} origin={attachedOrigin} ledger={ledger} onPatch={onPatch} />
      </div>
    );
  }
  if (tx.amount > 0 && (waiting || openHits.length > 0 || tx.categoryId === "loan_in")) {
    return (
      <div className="loan-panel">
        <AttachReturn tx={tx} openHits={openHits} onPatch={onPatch} />
      </div>
    );
  }
  return null;
}

function OriginLent({
  tx,
  ledger,
  onPatch,
}: {
  tx: Transaction;
  ledger: Transaction[];
  onPatch: (id: string, patch: Partial<Transaction>) => Promise<void>;
}) {
  const status = loanOriginStatus(tx, ledger);
  const allCandidates = candidateReturnBookings(tx, ledger);
  const [amountQuery, setAmountQuery] = useState(
    status.outstanding > 0 ? String(status.outstanding).replace(".", ",") : "",
  );
  const amountFilter = tryParseAmount(amountQuery);

  const candidates = useMemo(() => {
    if (amountFilter != null) {
      return allCandidates.filter((row) =>
        amountMatchesFilter(row.amount, null, null, amountFilter),
      );
    }
    if (status.outstanding > 0) {
      return [...allCandidates].sort(
        (a, b) =>
          Math.abs(Math.abs(a.amount) - status.outstanding) -
          Math.abs(Math.abs(b.amount) - status.outstanding),
      );
    }
    return allCandidates;
  }, [allCandidates, amountFilter, status.outstanding]);

  const [returnId, setReturnId] = useState("");
  const selectedId = candidates.some((row) => row.id === returnId)
    ? returnId
    : candidates[0]?.id ?? "";

  return (
    <Space direction="vertical" size="small" style={{ width: "100%" }}>
      <Typography.Text strong>Money lent</Typography.Text>
      <Typography.Text type="secondary">
        Stays open until you attach return bookings. Returns can be one booking or several installments.
      </Typography.Text>
      <Flex justify="space-between">
        <span>Lent</span>
        <Money value={-status.lent} />
      </Flex>
      <Flex justify="space-between">
        <span>Returned</span>
        <Money value={status.repaid} />
      </Flex>
      <Flex justify="space-between">
        <span>{status.settled ? "Settled" : "Still open"}</span>
        <strong>
          <Money value={status.settled ? 0 : -status.outstanding} />
        </strong>
      </Flex>

      {status.installments.length > 0 && (
        <div className="loan-installments">
          <Typography.Text type="secondary">Attached returns</Typography.Text>
          {status.installments.map((row, index) => (
            <Flex key={row.id} justify="space-between" gap={8} align="center" style={{ marginTop: 6 }}>
              <span>
                {formatDayShort(row.valueDate || row.bookingDate)} · {row.counterparty || "Incoming"}
                {status.installments.length > 1 ? ` · ${index + 1}/${status.installments.length}` : ""}
              </span>
              <Flex gap={8} align="center">
                <Money value={row.amount} />
                <Button type="link" size="small" onClick={() => void onPatch(row.id, detachReturnPatch(row))}>
                  Detach
                </Button>
              </Flex>
            </Flex>
          ))}
        </div>
      )}

      {!status.settled && (
        <div style={{ marginTop: 4 }}>
          <Typography.Text type="secondary">Attach a return booking</Typography.Text>
          <Input
            allowClear
            value={amountQuery}
            onChange={(e) => setAmountQuery(e.target.value)}
            placeholder={`Amount · ${formatEur(status.outstanding)} still open`}
            style={{ marginTop: 6 }}
            addonAfter="€"
          />
          {allCandidates.length === 0 ? (
            <Typography.Text type="secondary" style={{ display: "block", marginTop: 6 }}>
              No unattached incoming bookings after this date yet.
            </Typography.Text>
          ) : candidates.length === 0 ? (
            <Typography.Text type="secondary" style={{ display: "block", marginTop: 6 }}>
              No returns match that amount. Clear the amount filter to see all.
            </Typography.Text>
          ) : (
            <>
              <Select
                showSearch
                optionFilterProp="label"
                value={selectedId || undefined}
                onChange={setReturnId}
                style={{ width: "100%", marginTop: 6 }}
                placeholder="Pick the return booking"
                options={candidates.map((row) => ({
                  value: row.id,
                  label: `${formatDayShort(row.valueDate || row.bookingDate)} · ${row.counterparty || "Incoming"} · ${formatEur(row.amount)}`,
                }))}
              />
              <Button
                type="primary"
                style={{ marginTop: 8 }}
                disabled={!selectedId}
                onClick={() => void onPatch(selectedId, attachReturnPatch(tx))}
              >
                Attach return
              </Button>
            </>
          )}
        </div>
      )}
    </Space>
  );
}

function AttachedReturn({
  tx,
  origin,
  ledger,
  onPatch,
}: {
  tx: Transaction;
  origin: Transaction;
  ledger: Transaction[];
  onPatch: (id: string, patch: Partial<Transaction>) => Promise<void>;
}) {
  const status = loanOriginStatus(origin, ledger);
  const index = status.installments.findIndex((row) => row.id === tx.id);
  return (
    <Space direction="vertical" size="small" style={{ width: "100%" }}>
      <Typography.Text strong>Attached return</Typography.Text>
      <Typography.Text>
        {formatDayShort(origin.valueDate || origin.bookingDate)} · {origin.counterparty || "Money lent"} ·{" "}
        {formatEur(status.lent)} lent
        {status.installments.length > 1 && index >= 0
          ? ` · installment ${index + 1} of ${status.installments.length}`
          : ""}
      </Typography.Text>
      <Typography.Text type="secondary">
        {status.settled ? "Fully returned." : `${formatEur(status.outstanding)} still open.`}
      </Typography.Text>
      <Button type="link" size="small" onClick={() => void onPatch(tx.id, detachReturnPatch(tx))}>
        Detach
      </Button>
    </Space>
  );
}

function AttachReturn({
  tx,
  openHits,
  onPatch,
}: {
  tx: Transaction;
  openHits: ReturnType<typeof openOriginsForAttach>;
  onPatch: (id: string, patch: Partial<Transaction>) => Promise<void>;
}) {
  const [amountQuery, setAmountQuery] = useState(String(Math.abs(tx.amount)).replace(".", ","));
  const amountFilter = tryParseAmount(amountQuery);
  const filtered = useMemo(() => {
    if (amountFilter == null) return openHits;
    return openHits.filter(
      (hit) =>
        amountMatchesFilter(hit.outstanding, null, null, amountFilter) ||
        amountMatchesFilter(hit.lent, null, null, amountFilter),
    );
  }, [openHits, amountFilter]);
  const [originId, setOriginId] = useState("");
  const selectedId = filtered.some((hit) => hit.origin.id === originId)
    ? originId
    : filtered[0]?.origin.id ?? "";

  if (tx.amount <= 0) return null;
  if (!openHits.length) {
    return tx.categoryId === "loan_in" ? (
      <Typography.Text type="secondary">
        Marked as money returned, but it is not attached to a lent booking yet.
      </Typography.Text>
    ) : null;
  }

  return (
    <Space direction="vertical" size="small" style={{ width: "100%" }}>
      <Typography.Text strong>Attach to money lent</Typography.Text>
      <Typography.Text type="secondary">
        Pick which lent booking this incoming returns — including a partial installment.
      </Typography.Text>
      <Input
        allowClear
        value={amountQuery}
        onChange={(e) => setAmountQuery(e.target.value)}
        placeholder="Filter by amount"
        addonAfter="€"
      />
      {filtered.length === 0 ? (
        <Typography.Text type="secondary">No open money lent matches that amount.</Typography.Text>
      ) : (
        <>
          <Select
            showSearch
            optionFilterProp="label"
            value={selectedId || undefined}
            onChange={setOriginId}
            style={{ width: "100%" }}
            options={filtered.map((hit) => ({
              value: hit.origin.id,
              label: `${formatDayShort(hit.origin.valueDate || hit.origin.bookingDate)} · ${hit.origin.counterparty || "Money lent"} · ${formatEur(hit.outstanding)} open`,
            }))}
          />
          <Button
            type="primary"
            disabled={!selectedId}
            onClick={() => {
              const origin = filtered.find((hit) => hit.origin.id === selectedId)?.origin;
              if (origin) void onPatch(tx.id, attachReturnPatch(origin));
            }}
          >
            Attach this booking
          </Button>
        </>
      )}
    </Space>
  );
}
