import { parseGermanAmount } from "./money";
import { parseGermanDate } from "./dates";
import { buildFingerprint } from "./fingerprint";
import type { ParsedRow } from "../types";

const HEADER_MARKERS = ["Auftragskonto", "Buchungstag", "Betrag"];

export function parseSparkasseCsv(text: string): ParsedRow[] {
  const normalized = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n").filter((line) => line.trim().length > 0);
  if (lines.length < 2) return [];

  const headerLine = lines[0];
  if (!HEADER_MARKERS.every((marker) => headerLine.includes(marker))) {
    throw new Error(
      "This does not look like a German bank CAMT CSV. Expected columns like Auftragskonto, Buchungstag, Betrag.",
    );
  }

  const headers = parseCsvLine(headerLine);
  const index = Object.fromEntries(headers.map((h, i) => [h.trim().replace(/^"|"$/g, ""), i]));

  const rows: ParsedRow[] = [];
  for (const line of lines.slice(1)) {
    const cols = parseCsvLine(line);
    if (cols.length < 10) continue;

    const amountRaw = cell(cols, index, "Betrag");
    if (!amountRaw) continue;

    const accountIban = cell(cols, index, "Auftragskonto");
    const bookingDate = parseGermanDate(cell(cols, index, "Buchungstag"));
    const valueDate = parseGermanDate(cell(cols, index, "Valutadatum"));
    const bookingText = cell(cols, index, "Buchungstext");
    const purpose = cell(cols, index, "Verwendungszweck");
    const counterparty = cell(cols, index, "Beguenstigter/Zahlungspflichtiger");
    const iban = cell(cols, index, "Kontonummer/IBAN");
    const bic = cell(cols, index, "BIC (SWIFT-Code)");
    const amount = parseGermanAmount(amountRaw);
    const currency = cell(cols, index, "Waehrung") || "EUR";
    const endToEndRef = cell(cols, index, "Kundenreferenz (End-to-End)");
    const mandateRef = cell(cols, index, "Mandatsreferenz");
    const creditorId = cell(cols, index, "Glaeubiger ID");
    const info = cell(cols, index, "Info");

    const fingerprint = buildFingerprint({
      accountIban,
      bookingDate,
      valueDate,
      bookingText,
      purpose,
      counterparty,
      iban,
      amount,
      endToEndRef,
    });

    rows.push({
      accountIban,
      bookingDate,
      valueDate,
      bookingText,
      purpose,
      counterparty,
      iban,
      bic,
      amount,
      currency,
      endToEndRef,
      mandateRef,
      creditorId,
      info,
      fingerprint,
      rawLine: line,
    });
  }

  return rows;
}

function cell(cols: string[], index: Record<string, number>, key: string): string {
  const i = index[key];
  if (i == null) return "";
  return (cols[i] ?? "").trim();
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ";") {
      out.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  out.push(current);
  return out;
}

export async function readCsvFile(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const utf8 = new TextDecoder("utf-8", { fatal: false }).decode(buffer);
  if (utf8.includes("Auftragskonto") && !utf8.includes("\uFFFD")) {
    return utf8;
  }
  const latin = new TextDecoder("windows-1252").decode(buffer);
  if (latin.includes("Auftragskonto")) return latin;
  return utf8;
}
