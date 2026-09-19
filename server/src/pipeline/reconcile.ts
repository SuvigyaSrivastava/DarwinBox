import type { SourceFile } from "./ingest.js";

export interface RawRecordRef {
  sourceFile: string;
  rowIndex: number;
  data: Record<string, string>;
}

export interface ReconciledEntity {
  entityKey: string; // stable key used to group rows across files
  identityHint: string; // human-readable identity for display (name/email)
  sources: RawRecordRef[]; // one or more raw rows contributing to this entity
}

function normEmail(v: string): string {
  return v.trim().toLowerCase();
}

function normName(v: string): string {
  return v.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Best-effort identity key for a raw row, tried in priority order:
 * an explicit id-like column, then email, then first+last name. Returns
 * null if none of these can be derived (row will get its own entity and
 * likely surface a missing-identity escalation later). */
function deriveIdentity(row: Record<string, string>): { key: string; hint: string } | null {
  const idCols = ["Emp ID", "personnel_number", "Employee ID", "emp_id", "id"];
  for (const c of idCols) {
    if (row[c] && row[c].trim()) return { key: `id:${row[c].trim().toUpperCase()}`, hint: row[c].trim() };
  }

  const emailCols = ["Email Address", "work_email", "Contact Email", "email", "Email"];
  for (const c of emailCols) {
    if (row[c] && row[c].trim()) return { key: `email:${normEmail(row[c])}`, hint: row[c].trim() };
  }

  const nameCombos: [string, string][] = [
    ["First Name", "Last Name"],
  ];
  for (const [fc, lc] of nameCombos) {
    if (row[fc] && row[lc]) {
      return { key: `name:${normName(row[fc])}|${normName(row[lc])}`, hint: `${row[fc]} ${row[lc]}` };
    }
  }

  const fullNameCols = ["full_name", "Contractor Name", "Full Name", "name"];
  for (const c of fullNameCols) {
    if (row[c] && row[c].trim()) return { key: `name:${normName(row[c])}`, hint: row[c].trim() };
  }

  return null;
}

/** Groups raw rows from multiple source files into per-employee entities.
 * Rows are matched first by an explicit ID if present, then by email, then
 * by name, in that priority order — this mirrors how a human doing this
 * migration by hand would resolve "is this the same person." Rows that
 * share an ID but present conflicting emails/names later surface as
 * validation issues at the cleaning stage, not here. */
export function reconcileEntities(files: SourceFile[]): ReconciledEntity[] {
  // Two-pass: first pass builds identity keys per row; second pass merges
  // entities that turn out to share a *secondary* identity (e.g. one file
  // keyed by ID, another only by email for the same person) by cross
  // referencing email when both a same-ID and same-email row exist.
  const rowsWithIdentity: { ref: RawRecordRef; idKey: string | null; emailKey: string | null; hint: string }[] = [];

  files.forEach((file) => {
    file.rows.forEach((data, rowIndex) => {
      const identity = deriveIdentity(data);
      const emailCols = ["Email Address", "work_email", "Contact Email", "email", "Email"];
      let emailKey: string | null = null;
      for (const c of emailCols) {
        if (data[c] && data[c].trim()) {
          emailKey = normEmail(data[c]);
          break;
        }
      }
      rowsWithIdentity.push({
        ref: { sourceFile: file.filename, rowIndex, data },
        idKey: identity?.key ?? null,
        emailKey,
        hint: identity?.hint ?? "(no identity found)",
      });
    });
  });

  // Union-find style grouping: group key defaults to idKey (or a synthetic
  // unique key if none found), then merge groups that share an emailKey.
  const groups = new Map<string, RawRecordRef[]>();
  const groupKeyForEmail = new Map<string, string>();
  const hints = new Map<string, string>();

  let anonCounter = 0;

  for (const row of rowsWithIdentity) {
    let groupKey = row.idKey;

    if (row.emailKey && groupKeyForEmail.has(row.emailKey)) {
      // An earlier row with this same email already established a group;
      // fold this row into it even if its own idKey looks different
      // (e.g. missing ID in one file, present in another).
      groupKey = groupKeyForEmail.get(row.emailKey)!;
    }

    if (!groupKey) {
      groupKey = `anon:${anonCounter++}`;
    }

    if (row.emailKey) groupKeyForEmail.set(row.emailKey, groupKey);

    if (!groups.has(groupKey)) groups.set(groupKey, []);
    groups.get(groupKey)!.push(row.ref);
    hints.set(groupKey, row.hint);
  }

  return Array.from(groups.entries()).map(([entityKey, sources]) => ({
    entityKey,
    identityHint: hints.get(entityKey) ?? entityKey,
    sources,
  }));
}
