// Input-hardening applied at the ingestion boundary, before any parsed
// cell value is stored, displayed, or re-exported anywhere downstream.
// This is a security control, not a data-cleaning one — it runs
// unconditionally on every cell regardless of what the mapping/cleaning
// pipeline later decides to do with that column, and it never escalates
// to a human (there's no legitimate reason a human would want the raw
// injection payload preserved).

// `=` is always a formula trigger in every spreadsheet application — no
// legitimate business data cell starts with a literal equals sign, so
// this one is unconditional.
const UNCONDITIONAL_FORMULA_PREFIX_RE = /^[=\t\r]/;

// `+`, `-`, and `@` are ALSO formula/mention triggers in some spreadsheet
// apps, but unlike `=` they collide with real HR/CRM data: phone numbers
// routinely start with `+1...` or a leading `-` shows up in negative
// numeric codes, and neither is an injection attempt. Flagging every such
// cell would bury the one real payload in noise and make the audit trail
// actively misleading (see the sample dataset's phone column, which is
// entirely `+1-xxx-xxx-xxxx` shaped). So these three only count as
// suspicious when what follows ISN'T shaped like a plausible phone
// number/numeric value — i.e. when it contains a letter, parenthesis, or
// quote, which is what an actual formula payload
// (`+HYPERLINK(...)`, `-cmd|'/c calc'!A1`, `@SUM(A1:A9)`) always has and a
// phone number never does.
const CONDITIONAL_FORMULA_PREFIX_RE = /^[+\-@]/;
const LOOKS_LIKE_FORMULA_BODY_RE = /[a-zA-Z(")]/;

export interface SanitizeStats {
  neutralizedCells: number;
  truncatedCells: number;
}

// Defensive cap on a single cell's length. Not a business rule — just a
// blunt guard against a pathological file (e.g. a single 50MB "cell")
// being used to exhaust memory or slow every downstream string operation
// to a crawl. Cleaning/validation logic still runs on (and can still
// legitimately reject) whatever's left after truncation.
const MAX_CELL_LENGTH = 20_000;

/** Neutralizes a single cell value in place, returning the safe value and
 * whether it was modified. Prefixing a defused value with a single quote
 * is the standard mitigation (it's what Google Sheets/Excel's own "paste
 * as text" does) — it keeps the original characters visible/auditable
 * rather than silently deleting content, while stopping it from being
 * interpreted as a formula if the exported file is later opened in a
 * spreadsheet application. */
function sanitizeCell(value: string): { value: string; neutralized: boolean; truncated: boolean } {
  let v = value;
  let truncated = false;

  if (v.length > MAX_CELL_LENGTH) {
    v = v.slice(0, MAX_CELL_LENGTH);
    truncated = true;
  }

  const isUnconditionalTrigger = UNCONDITIONAL_FORMULA_PREFIX_RE.test(v);
  const isConditionalTrigger = CONDITIONAL_FORMULA_PREFIX_RE.test(v) && LOOKS_LIKE_FORMULA_BODY_RE.test(v.slice(1));

  if (isUnconditionalTrigger || isConditionalTrigger) {
    return { value: `'${v}`, neutralized: true, truncated };
  }

  return { value: v, neutralized: false, truncated };
}

/** Sanitizes every cell of every row of a parsed source file in place.
 * Called immediately after parsing, before reconciliation, mapping, or
 * cleaning ever sees the data — so every downstream stage is already
 * working with defused values. */
export function sanitizeRows(
  rows: Record<string, string>[],
): { rows: Record<string, string>[]; stats: SanitizeStats } {
  let neutralizedCells = 0;
  let truncatedCells = 0;

  const sanitized = rows.map((row) => {
    const out: Record<string, string> = {};
    for (const [col, val] of Object.entries(row)) {
      const result = sanitizeCell(val);
      if (result.neutralized) neutralizedCells++;
      if (result.truncated) truncatedCells++;
      out[col] = result.value;
    }
    return out;
  });

  return { rows: sanitized, stats: { neutralizedCells, truncatedCells } };
}

// Defensive caps on overall file shape. These exist to blunt a
// pathological upload (an accidentally-or-maliciously huge file) rather
// than to enforce any real business limit — a legitimate client export
// this large should be chunked/streamed by a future iteration (see
// write-up), not silently accepted into a synchronous in-memory pipeline.
export const MAX_ROWS_PER_FILE = 50_000;
export const MAX_COLUMNS_PER_FILE = 200;

export class SourceFileTooLargeError extends Error {}

export function assertWithinLimits(filename: string, rowCount: number, columnCount: number) {
  if (rowCount > MAX_ROWS_PER_FILE) {
    throw new SourceFileTooLargeError(
      `${filename} has ${rowCount} rows, which exceeds the ${MAX_ROWS_PER_FILE}-row limit for this prototype's synchronous pipeline.`,
    );
  }
  if (columnCount > MAX_COLUMNS_PER_FILE) {
    throw new SourceFileTooLargeError(
      `${filename} has ${columnCount} columns, which exceeds the ${MAX_COLUMNS_PER_FILE}-column limit.`,
    );
  }
}
