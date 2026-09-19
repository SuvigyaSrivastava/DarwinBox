import { TARGET_SCHEMA_BY_KEY, type FieldType } from "../schema/targetSchema.js";

export interface CleaningResult {
  value: string;
  changed: boolean;
  note: string | null;
  /** null = no issue; otherwise a reason this needs human attention */
  escalate: string | null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Known department-code abbreviations seen in the sample payroll export.
// A real implementation would source this from the client's own code book
// (often provided as a lookup sheet during discovery); here it's a safe,
// deterministic expansion the agent can apply without asking, and codes
// not in this map fall through to the generic string cleaning path
// (and, if still unrecognized structurally, could be escalated in a
// future iteration — see write-up "what's next").
const DEPARTMENT_CODE_MAP: Record<string, string> = {
  ENG: "Engineering",
  SLS: "Sales",
  MKT: "Marketing",
  FIN: "Finance",
  HR: "Human Resources",
  OPS: "Operations",
  LEGAL: "Legal",
};

// Title-cases on whitespace/hyphen boundaries only. Deliberately does NOT
// try to guess apostrophe placement in surnames (e.g. turning "oconnor"
// into "O'Connor") — that would be inventing a character the source data
// never had, which is a worse failure mode than leaving "Oconnor" as a
// faithful-but-imperfect capitalization of what was actually provided.
function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(/(\s+|-)/)
    .map((part) => (part.match(/^[a-z]/) ? part[0].toUpperCase() + part.slice(1) : part))
    .join("");
}

/** Tries to parse a date string that could be in several common export
 * formats. Returns an ISO date (YYYY-MM-DD) when the format is
 * unambiguous, or null when it genuinely can't tell (e.g. "03/01/2019"
 * could be March 1 or January 3 with no other signal in this row alone). */
function parseAmbiguousDate(raw: string): { iso: string | null; ambiguous: boolean } {
  const s = raw.trim();

  // Already ISO — unambiguous.
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return { iso: s, ambiguous: false };

  // YYYY/MM/DD — unambiguous (year-first is never ambiguous about which
  // part is the year).
  const ymd = s.match(/^(\d{4})\/(\d{2})\/(\d{2})$/);
  if (ymd) return { iso: `${ymd[1]}-${ymd[2]}-${ymd[3]}`, ambiguous: false };

  // DD-MM-YYYY with a day > 12 is unambiguous (can't be a month).
  const dmy1 = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (dmy1) {
    const [, a, b, year] = dmy1;
    const aNum = parseInt(a, 10);
    const bNum = parseInt(b, 10);
    if (aNum > 12 && bNum <= 12) {
      // a must be day, b must be month
      return { iso: `${year}-${b.padStart(2, "0")}-${a.padStart(2, "0")}`, ambiguous: false };
    }
    if (bNum > 12 && aNum <= 12) {
      // a must be month, b must be day
      return { iso: `${year}-${a.padStart(2, "0")}-${b.padStart(2, "0")}`, ambiguous: false };
    }
    // Both <= 12: genuinely ambiguous between MM/DD and DD/MM without more
    // context (e.g. a locale hint for the whole file).
    return { iso: null, ambiguous: true };
  }

  return { iso: null, ambiguous: true };
}

/** Applies safe, deterministic cleaning to a single field value. This is
 * the "fixes what it safely can without asking" layer: whitespace/casing
 * normalization always happens silently; date parsing normalizes when the
 * format is unambiguous and escalates only when it genuinely isn't;
 * required-field-missing and enum-mismatch escalate rather than guessing. */
export function cleanFieldValue(fieldKey: string, rawValue: string): CleaningResult {
  const field = TARGET_SCHEMA_BY_KEY[fieldKey];
  const value = rawValue.trim().replace(/\s+/g, " ");

  if (!field) {
    return { value, changed: value !== rawValue, note: null, escalate: null };
  }

  if (!value) {
    if (field.required) {
      return {
        value: "",
        changed: false,
        note: null,
        escalate: `Required field "${field.label}" is missing and has no safe default.`,
      };
    }
    return { value: "", changed: false, note: null, escalate: null };
  }

  switch (field.type as FieldType) {
    case "email": {
      const lower = value.toLowerCase();
      if (!EMAIL_RE.test(lower)) {
        return { value: lower, changed: lower !== rawValue, note: null, escalate: `Value "${rawValue}" does not look like a valid email address.` };
      }
      return { value: lower, changed: lower !== rawValue, note: lower !== rawValue ? "Lowercased email." : null, escalate: null };
    }

    case "date": {
      const { iso, ambiguous } = parseAmbiguousDate(value);
      if (ambiguous || !iso) {
        return {
          value,
          changed: false,
          note: null,
          escalate: `Date "${value}" is ambiguous (day/month both ≤12 and format is not year-first) — could be read two ways.`,
        };
      }
      return { value: iso, changed: iso !== rawValue, note: iso !== rawValue ? `Normalized date "${rawValue}" → "${iso}".` : null, escalate: null };
    }

    case "enum": {
      if (!field.enumValues) return { value, changed: false, note: null, escalate: null };
      const norm = value.toLowerCase().replace(/[\s-]+/g, "_");
      const match = field.enumValues.find((ev) => ev === norm || ev.replace(/_/g, "") === norm.replace(/_/g, ""));
      if (match) {
        return { value: match, changed: match !== rawValue, note: match !== rawValue ? `Normalized "${rawValue}" → "${match}".` : null, escalate: null };
      }
      return { value, changed: false, note: null, escalate: `Value "${rawValue}" does not match any known ${field.label} option (${field.enumValues.join(", ")}).` };
    }

    case "phone": {
      const digits = value.replace(/[^\d+]/g, "");
      return { value: digits, changed: digits !== rawValue, note: digits !== rawValue ? "Stripped formatting from phone number." : null, escalate: null };
    }

    case "string":
    default: {
      if (fieldKey === "department") {
        const expanded = DEPARTMENT_CODE_MAP[value.toUpperCase()];
        if (expanded) {
          return { value: expanded, changed: true, note: `Expanded department code "${rawValue}" → "${expanded}".`, escalate: null };
        }
      }
      // Whitespace/casing fix for name-like short strings; leave longer
      // free text (e.g. department names that are already fine) alone
      // beyond whitespace collapse.
      const isNameLike = ["first_name", "last_name", "location"].includes(fieldKey);
      const cleaned = isNameLike ? titleCase(value) : value;
      return { value: cleaned, changed: cleaned !== rawValue, note: cleaned !== rawValue ? "Normalized casing/whitespace." : null, escalate: null };
    }
  }
}

export interface DuplicateCandidate {
  entityKeyA: string;
  entityKeyB: string;
  matchType: "exact" | "fuzzy";
  reason: string;
}

function levenshtein(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

/** Compares two resolved employee records (already field-mapped) to decide
 * if they're duplicates, and whether that's confident enough to auto-merge
 * or needs human review. Exact match on email = safe auto-merge. Close
 * name match with differing other fields = escalate, since collapsing two
 * different people is a much worse mistake than asking once. */
export function compareForDuplicate(
  a: Record<string, string>,
  b: Record<string, string>,
): DuplicateCandidate | null {
  const emailA = (a.email || "").toLowerCase();
  const emailB = (b.email || "").toLowerCase();

  if (emailA && emailB && emailA === emailB) {
    const fieldsDiffer = Object.keys(a).some((k) => k !== "email" && a[k] && b[k] && a[k] !== b[k]);
    return {
      entityKeyA: "",
      entityKeyB: "",
      matchType: fieldsDiffer ? "fuzzy" : "exact",
      reason: fieldsDiffer
        ? `Same email (${emailA}) but conflicting field values across sources (e.g. employee_type) — needs a human call on which source wins.`
        : `Identical email (${emailA}) across sources with no conflicting fields — safe to merge automatically.`,
    };
  }

  const nameA = `${a.first_name || ""} ${a.last_name || ""}`.trim().toLowerCase();
  const nameB = `${b.first_name || ""} ${b.last_name || ""}`.trim().toLowerCase();
  if (nameA && nameB && nameA !== nameB) {
    const dist = levenshtein(nameA, nameB);
    if (dist <= 2 && Math.max(nameA.length, nameB.length) > 4) {
      return {
        entityKeyA: "",
        entityKeyB: "",
        matchType: "fuzzy",
        reason: `Names "${nameA}" and "${nameB}" are very close (edit distance ${dist}) but not identical — could be the same person misspelled, or two different people.`,
      };
    }
  }

  // Exact same name, but two different, non-empty emails — reconciliation
  // deliberately keeps these as separate records rather than guessing
  // which email is right (see reconcile.ts), so this is the other half of
  // that decision: surface it as a duplicate candidate rather than
  // silently leaving two same-named people unlinked. This is a distinct
  // case from the fuzzy-name check above (identical name, not a
  // near-miss) and from the same-email check (here the emails differ).
  if (nameA && nameA === nameB && emailA && emailB && emailA !== emailB) {
    return {
      entityKeyA: "",
      entityKeyB: "",
      matchType: "fuzzy",
      reason: `Same name ("${a.first_name} ${a.last_name}") but different emails (${emailA} vs ${emailB}) — could be the same person with a corrected email, or two different people who share a name.`,
    };
  }

  return null;
}
