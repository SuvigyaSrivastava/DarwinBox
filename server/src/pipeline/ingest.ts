import { parse } from "csv-parse/sync";
import * as XLSX from "xlsx";
import { readFileSync } from "node:fs";
import path from "node:path";
import { sanitizeRows, assertWithinLimits, type SanitizeStats } from "./sanitize.js";

export interface SourceFile {
  filename: string;
  columns: string[];
  rows: Record<string, string>[];
  sanitizeStats: SanitizeStats;
}

/** Parses a CSV or XLSX file into a uniform column/row shape. Blank cells
 * become empty strings (not undefined) so downstream code has one shape to
 * reason about. */
export function parseSourceFile(filePath: string): SourceFile {
  const filename = path.basename(filePath);
  const ext = path.extname(filename).toLowerCase();

  let rows: Record<string, string>[];

  if (ext === ".xlsx" || ext === ".xls") {
    const wb = XLSX.readFile(filePath);
    const sheet = wb.Sheets[wb.SheetNames[0]];
    rows = XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false });
  } else {
    // Also handles files named *.xlsx.csv (our sample contractor file is a
    // CSV masquerading with an .xlsx-flavored name to simulate an export
    // that started life as a spreadsheet).
    const raw = readFileSync(filePath, "utf-8");
    rows = parse(raw, {
      columns: true,
      skip_empty_lines: true,
      trim: false,
      bom: true,
    });
  }

  const columns = rows.length > 0 ? Object.keys(rows[0]) : [];

  assertWithinLimits(filename, rows.length, columns.length);

  // Normalize every cell to a trimmed string (preserve internal content,
  // just strip outer whitespace at the parse boundary so "  Mark " and
  // "Mark" are the same value going into reconciliation).
  const normalizedRows = rows.map((row) => {
    const out: Record<string, string> = {};
    for (const col of columns) {
      const v = row[col];
      out[col] = v === undefined || v === null ? "" : String(v).trim();
    }
    return out;
  });

  // Security boundary: neutralize CSV/formula-injection payloads and cap
  // pathological cell sizes before any other pipeline stage — mapping,
  // cleaning, reconciliation, the audit trail — ever sees this data. See
  // sanitize.ts for why this runs unconditionally rather than as a
  // cleaning rule a human could review/override.
  const { rows: sanitizedRows, stats } = sanitizeRows(normalizedRows);

  return { filename, columns, rows: sanitizedRows, sanitizeStats: stats };
}

export function parseSourceFiles(filePaths: string[]): SourceFile[] {
  return filePaths.map(parseSourceFile);
}
