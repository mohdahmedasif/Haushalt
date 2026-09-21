import { useState } from "react";
import { Alert, Button, Checkbox, Col, Row, Table, Typography, Upload } from "antd";
import { InboxOutlined } from "@ant-design/icons";
import { formatDay } from "../lib/dates";
import { PageHeader } from "../ui/PageHeader";
import { Money } from "../ui/Money";
import { StatCard } from "../ui/StatCard";
import { SectionCard } from "../ui/SectionCard";
import { EmptyState } from "../ui/EmptyState";
import type { ImportBatch, ImportPreviewRow } from "../types";

export function ImportPage({
  imports,
  onPreview,
  onCommit,
}: {
  imports: ImportBatch[];
  onPreview: (fileName: string, csvText: string) => Promise<ImportPreviewRow[]>;
  onCommit: (fileName: string, csvText: string, includeSoft: boolean) => Promise<ImportBatch>;
}) {
  const [fileName, setFileName] = useState("");
  const [csvText, setCsvText] = useState("");
  const [preview, setPreview] = useState<ImportPreviewRow[] | null>(null);
  const [includeSoft, setIncludeSoft] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("");

  async function handleFile(file: File) {
    const text = await file.text();
    setFileName(file.name);
    setCsvText(text);
    setResult("");
    setBusy(true);
    try {
      setPreview(await onPreview(file.name, text));
    } catch (error) {
      setResult(error instanceof Error ? error.message : "Preview failed");
      setPreview(null);
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    if (!csvText) return;
    setBusy(true);
    try {
      const batch = await onCommit(fileName, csvText, includeSoft);
      setResult(`Added ${batch.added} · exact duplicates ${batch.duplicates} · skipped ${batch.skipped}`);
      setPreview(null);
      setCsvText("");
    } catch (error) {
      setResult(error instanceof Error ? error.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }

  const counts = preview
    ? {
        new: preview.filter((p) => p.status === "new").length,
        duplicate: preview.filter((p) => p.status === "duplicate").length,
        soft: preview.filter((p) => p.status === "soft").length,
        skip: preview.filter((p) => p.status === "skip").length,
      }
    : null;

  return (
    <>
      <PageHeader title="Import bank CSV">
        CAMT export from the app. Exact re-uploads are blocked. Soft matches need your OK.
      </PageHeader>

      <SectionCard>
        <div className="import-drop">
          <Upload.Dragger
            accept=".csv,.CSV,text/csv"
            showUploadList={false}
            beforeUpload={(file) => {
              void handleFile(file);
              return false;
            }}
          >
            <p className="ant-upload-drag-icon">
              <InboxOutlined />
            </p>
            <p className="ant-upload-text">Drop a bank Umsatz CSV here</p>
            <p className="ant-upload-hint">or click to choose a file{fileName ? ` · ${fileName}` : ""}</p>
          </Upload.Dragger>
        </div>
      </SectionCard>

      {result && (
        <Alert
          className="import-result"
          type={result.startsWith("Added") ? "success" : "error"}
          message={result}
        />
      )}

      {counts && (
        <>
          <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
            <Col xs={12} md={6}>
              <StatCard label="New" value={counts.new} />
            </Col>
            <Col xs={12} md={6}>
              <StatCard label="Exact duplicates" value={counts.duplicate} />
            </Col>
            <Col xs={12} md={6}>
              <StatCard label="Soft matches" value={counts.soft} />
            </Col>
            <Col xs={12} md={6}>
              <StatCard label="Skipped zeros" value={counts.skip} />
            </Col>
          </Row>
          <SectionCard>
            <Checkbox checked={includeSoft} onChange={(e) => setIncludeSoft(e.target.checked)}>
              Import soft matches too
            </Checkbox>
            <Button
              type="primary"
              style={{ marginLeft: 12 }}
              loading={busy}
              disabled={counts.new + (includeSoft ? counts.soft : 0) === 0}
              onClick={() => void commit()}
            >
              Import {counts.new} new
            </Button>
          </SectionCard>
          <SectionCard padded={false}>
            <Table
              size="middle"
              rowKey={(_, i) => String(i)}
              dataSource={preview!.slice(0, 80)}
              pagination={false}
              columns={[
                { title: "Status", width: 110, dataIndex: "status" },
                {
                  title: "Date",
                  width: 120,
                  render: (_, item) => formatDay(item.row.valueDate || item.row.bookingDate),
                },
                {
                  title: "Payee",
                  render: (_, item) => (
                    <div>
                      <div className="tx-payee">{item.row.counterparty || item.row.bookingText}</div>
                      <div className="tx-purpose">{item.row.purpose.slice(0, 80)}</div>
                    </div>
                  ),
                },
                { title: "Amount", align: "right", width: 140, render: (_, item) => <Money value={item.row.amount} /> },
                { title: "Why", render: (_, item) => item.reason || "—" },
              ]}
            />
            {preview!.length > 80 && (
              <Typography.Paragraph type="secondary" style={{ padding: 12 }}>
                Showing first 80 of {preview!.length} rows.
              </Typography.Paragraph>
            )}
          </SectionCard>
        </>
      )}

      <SectionCard title="Past imports" padded={false}>
        <Table
          size="middle"
          rowKey="id"
          dataSource={imports}
          pagination={false}
          locale={{ emptyText: <EmptyState title="Nothing imported yet" /> }}
          columns={[
            { title: "File", dataIndex: "fileName" },
            { title: "When", render: (_, item) => new Date(item.importedAt).toLocaleString("en-GB") },
            { title: "Added", dataIndex: "added" },
            { title: "Duplicates", dataIndex: "duplicates" },
            { title: "Skipped", dataIndex: "skipped" },
          ]}
        />
      </SectionCard>
    </>
  );
}
