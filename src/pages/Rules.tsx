import { useState } from "react";
import { Alert, Button, Flex, Input, Popconfirm, Select, Table, Typography } from "antd";
import { PageHeader } from "../ui/PageHeader";
import { SectionCard } from "../ui/SectionCard";
import { CategoryTag } from "../ui/CategoryTag";
import { EmptyState } from "../ui/EmptyState";
import type { Category, CategoryRule } from "../types";

export function RulesPage({
  rules,
  categories,
  uncategorizedCount,
  onAdd,
  onDelete,
  onApply,
}: {
  rules: CategoryRule[];
  categories: Category[];
  uncategorizedCount: number;
  onAdd: (rule: { categoryId: string; field: CategoryRule["field"]; value: string }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onApply: () => Promise<{ scanned: number; applied: number }>;
}) {
  const [categoryId, setCategoryId] = useState("family");
  const [field, setField] = useState<CategoryRule["field"]>("counterparty");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("");

  async function apply() {
    setBusy(true);
    setResult("");
    try {
      const next = await onApply();
      setResult(`Tagged ${next.applied} of ${next.scanned} uncategorized bookings.`);
    } catch (err) {
      setResult(err instanceof Error ? err.message : "Could not apply rules");
    } finally {
      setBusy(false);
    }
  }

  function addRule() {
    if (!value.trim()) return;
    void onAdd({ categoryId, field, value: value.trim() });
    setValue("");
  }

  return (
    <>
      <PageHeader
        title="Categorization rules"
        extra={
          <Button type="primary" disabled={uncategorizedCount === 0} loading={busy} onClick={() => void apply()}>
            Apply rules to uncategorized ({uncategorizedCount})
          </Button>
        }
      >
        Payee and purpose matches. Assigning a category on a transaction also learns the payee.
      </PageHeader>
      {result && <Alert type="success" message={result} style={{ marginBottom: 16 }} />}
      <SectionCard title="New rule">
        <Flex gap={8} wrap="wrap">
          <Select
            value={field}
            onChange={setField}
            style={{ minWidth: 180 }}
            options={[
              { value: "counterparty", label: "Payee contains" },
              { value: "purpose", label: "Purpose contains" },
              { value: "iban", label: "IBAN contains" },
              { value: "bookingText", label: "Booking text contains" },
            ]}
          />
          <Input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="e.g. Amazon"
            style={{ flex: 1, minWidth: 200 }}
            onPressEnter={addRule}
          />
          <Select
            value={categoryId}
            onChange={setCategoryId}
            style={{ minWidth: 180 }}
            options={categories.map((c) => ({ value: c.id, label: c.name }))}
          />
          <Button type="primary" onClick={addRule}>
            Add rule
          </Button>
        </Flex>
      </SectionCard>
      <SectionCard title={`Rules (${rules.length})`} padded={false}>
        <Table
          size="middle"
          rowKey="id"
          dataSource={rules}
          pagination={false}
          locale={{ emptyText: <EmptyState title="No rules yet" body="Add a payee or purpose match above." /> }}
          columns={[
            { title: "When", render: (_, r) => `${r.field} contains “${r.value}”` },
            {
              title: "Category",
              render: (_, r) => {
                const cat = categories.find((c) => c.id === r.categoryId);
                return cat ? <CategoryTag name={cat.name} color={cat.color} /> : r.categoryId;
              },
            },
            {
              title: "Source",
              render: (_, r) => (
                <Typography.Text type="secondary">{r.learned ? "learned" : r.note || "seed"}</Typography.Text>
              ),
            },
            {
              title: "",
              width: 90,
              render: (_, r) => (
                <Popconfirm title="Delete this rule?" onConfirm={() => void onDelete(r.id)}>
                  <Button type="link" danger size="small">
                    Delete
                  </Button>
                </Popconfirm>
              ),
            },
          ]}
        />
      </SectionCard>
    </>
  );
}
