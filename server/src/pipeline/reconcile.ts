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

/** Normalizes a column header for matching: lowercase, alphanumerics only.
 * This is what lets "Work Email", "work_email", "WORK EMAIL", and
 * "work-email" all resolve to the same recognized column, instead of the
 * exact-case, exact-punctuation string matches this module used to do
 * (which silently failed to recognize a header spelled slightly
 * differently than whatever sample file it was first written against). */
function normHeader(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

const ID_HEADER_ALIASES = ["empid", "personnelnumber", "employeeid", "id", "staffid"].map(normHeader);
const EMAIL_HEADER_ALIASES = ["emailaddress", "workemail", "contactemail", "email", "emailaddr"].map(normHeader);
const FULL_NAME_HEADER_ALIASES = ["fullname", "contractorname", "name", "employeename"].map(normHeader);

/** Finds the first column in a row whose header matches one of the given
 * normalized aliases, and returns its trimmed, non-empty value if any. */
function findColumnValue(row: Record<string, string>, aliases: string[]): string | null {
  for (const col of Object.keys(row)) {
    if (aliases.includes(normHeader(col)) && row[col] && row[col].trim()) {
      return row[col].trim();
    }
  }
  return null;
}

function emailOf(row: Record<string, string>): string | null {
  const v = findColumnValue(row, EMAIL_HEADER_ALIASES);
  return v ? normEmail(v) : null;
}

/** The row's name, independent of whether deriveIdentity ended up using it
 * as the row's primary key (it won't, if the row also has an ID or email).
 * Needed so a row with a name but no email can still be folded into an
 * existing name-matched group established by an email-having row — the
 * two are the same person as far as name evidence goes; only a genuinely
 * conflicting *second* email should ever cause a split (handled below). */
function nameKeyOf(row: Record<string, string>): string | null {
  if (row["First Name"] && row["Last Name"]) {
    return `${normName(row["First Name"])}|${normName(row["Last Name"])}`;
  }
  const fullName = findColumnValue(row, FULL_NAME_HEADER_ALIASES);
  return fullName ? normName(fullName) : null;
}

/** Best-effort identity key for a raw row, tried in priority order:
 * an explicit id-like column, then email, then first+last name. Returns
 * null if none of these can be derived (row will get its own entity and
 * likely surface a missing-identity escalation later). */
function deriveIdentity(row: Record<string, string>): { key: string; hint: string } | null {
  const id = findColumnValue(row, ID_HEADER_ALIASES);
  if (id) return { key: `id:${id.toUpperCase()}`, hint: id };

  const email = findColumnValue(row, EMAIL_HEADER_ALIASES);
  if (email) return { key: `email:${normEmail(email)}`, hint: email };

  if (row["First Name"] && row["Last Name"]) {
    return {
      key: `name:${normName(row["First Name"])}|${normName(row["Last Name"])}`,
      hint: `${row["First Name"]} ${row["Last Name"]}`,
    };
  }

  const fullName = findColumnValue(row, FULL_NAME_HEADER_ALIASES);
  if (fullName) return { key: `name:${normName(fullName)}`, hint: fullName };

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
  const rowsWithIdentity: {
    ref: RawRecordRef;
    idKey: string | null;
    emailKey: string | null;
    nameKey: string | null;
    hint: string;
  }[] = [];

  files.forEach((file) => {
    file.rows.forEach((data, rowIndex) => {
      const identity = deriveIdentity(data);
      rowsWithIdentity.push({
        ref: { sourceFile: file.filename, rowIndex, data },
        idKey: identity?.key ?? null,
        emailKey: emailOf(data),
        nameKey: nameKeyOf(data),
        hint: identity?.hint ?? "(no identity found)",
      });
    });
  });

  // Union-find style grouping: group key defaults to idKey (or a synthetic
  // unique key if none found), then merge groups that share an emailKey or
  // a nameKey when no email is present to disambiguate — this is what
  // lets a no-email row with the same name as an already-grouped
  // email-having row fold in as an additional source, rather than
  // starting a disconnected group of its own.
  const groups = new Map<string, RawRecordRef[]>();
  const groupKeyForEmail = new Map<string, string>();
  const groupKeyForName = new Map<string, string>();
  const hints = new Map<string, string>();

  let anonCounter = 0;

  // Track, per group, whether membership was decided by a *name-only*
  // match (no ID column present) — an ID or email match is strong enough
  // evidence on its own that two rows are the same person, but a shared
  // name is not: two different people can share a name, and a re-hire or
  // data-entry fix can give the same person two different emails across
  // rows. Name-only groups get a second look below.
  const groupIsNameOnly = new Map<string, boolean>();

  for (const row of rowsWithIdentity) {
    // idKey is only a *strong* identity signal when it came from an
    // explicit ID or email column. deriveIdentity() falls back to a
    // name-derived key when neither is present, which is weak evidence —
    // treat that case the same as "no idKey at all" for grouping purposes
    // so it's still eligible to be folded into an existing name-matched
    // group below, rather than starting a disconnected group of its own.
    const idKeyIsWeak = !!row.idKey && row.idKey.startsWith("name:");
    let groupKey = idKeyIsWeak ? null : row.idKey;
    const isNameOnlyRow = !groupKey && !row.emailKey;

    if (row.emailKey && groupKeyForEmail.has(row.emailKey)) {
      // An earlier row with this same email already established a group;
      // fold this row into it even if its own idKey looks different
      // (e.g. missing ID in one file, present in another).
      groupKey = groupKeyForEmail.get(row.emailKey)!;
    } else if (!groupKey && row.nameKey && groupKeyForName.has(row.nameKey)) {
      // No email of its own to match on, but an earlier row with the same
      // name already established a group — most likely this row is just
      // missing the email that row has, not a different person. If it
      // later turns out a *different* email also shares this name, the
      // split pass below still catches that as a genuine conflict.
      groupKey = groupKeyForName.get(row.nameKey)!;
    }

    if (!groupKey) {
      groupKey = `anon:${anonCounter++}`;
    }

    if (row.emailKey) groupKeyForEmail.set(row.emailKey, groupKey);
    if (row.nameKey && !groupKeyForName.has(row.nameKey)) groupKeyForName.set(row.nameKey, groupKey);

    if (!groups.has(groupKey)) groups.set(groupKey, []);
    groups.get(groupKey)!.push(row.ref);
    hints.set(groupKey, row.hint);

    // A group stays "name-only" only if every row that landed in it so
    // far was itself name-only-derived. The moment any row brings a real
    // ID or email, that's the stronger signal and the group is trusted.
    const wasNameOnly = groupIsNameOnly.get(groupKey);
    groupIsNameOnly.set(groupKey, (wasNameOnly ?? true) && isNameOnlyRow);
  }

  // Second pass: a name-only group whose rows carry two or more distinct,
  // non-empty emails is evidence the name match was coincidental (or a
  // genuine near-duplicate with a corrected email) — split it back into
  // one entity per distinct email so each flows through cleaning
  // separately and surfaces at duplicate-detection instead of silently
  // merging into one record with the other row's fields overwritten.
  const finalGroups: { entityKey: string; hint: string; sources: RawRecordRef[] }[] = [];
  let splitCounter = 0;

  for (const [groupKey, sources] of groups.entries()) {
    if (!groupIsNameOnly.get(groupKey)) {
      finalGroups.push({ entityKey: groupKey, hint: hints.get(groupKey) ?? groupKey, sources });
      continue;
    }

    const distinctEmails = new Set(sources.map((s) => emailOf(s.data)).filter((e): e is string => !!e));

    if (distinctEmails.size <= 1) {
      finalGroups.push({ entityKey: groupKey, hint: hints.get(groupKey) ?? groupKey, sources });
      continue;
    }

    // Split: one sub-group per distinct email, plus a catch-all for any
    // rows in this group with no email at all (kept with the first
    // email-bearing sub-group they'd otherwise have no home in).
    const byEmail = new Map<string, RawRecordRef[]>();
    for (const src of sources) {
      const e = emailOf(src.data) ?? "__no_email__";
      if (!byEmail.has(e)) byEmail.set(e, []);
      byEmail.get(e)!.push(src);
    }
    for (const [, subSources] of byEmail.entries()) {
      finalGroups.push({
        entityKey: `${groupKey}#split${splitCounter++}`,
        hint: hints.get(groupKey) ?? groupKey,
        sources: subSources,
      });
    }
  }

  return finalGroups.map(({ entityKey, hint, sources }) => ({
    entityKey,
    identityHint: hint,
    sources,
  }));
}
