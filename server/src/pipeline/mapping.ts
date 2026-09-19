import { TARGET_SCHEMA, type TargetField } from "../schema/targetSchema.js";
import { callLLMJson, llmAvailable } from "../lib/llm.js";
import { findMappingOverride } from "../db/mappingOverrides.js";

export interface MappingCandidate {
  targetField: string;
  confidence: number; // 0-1
  reasoning: string;
}

export interface ColumnMapping {
  sourceColumn: string;
  sourceFile: string;
  candidates: MappingCandidate[]; // sorted desc by confidence
  status: "auto" | "escalated" | "unmapped" | "split_name";
  appliedField: string | null; // set once resolved (auto or human-approved)
}

// Column names that represent a single "full name" field, which this
// schema models as two target fields (first_name/last_name). These are
// recognized up front and handled by splitting on whitespace rather than
// forced through the one-column-to-one-field mapping engine, since "which
// single field does this map to" is the wrong question for them.
const FULL_NAME_COLUMN_NAMES = new Set(["full_name", "full name", "contractor name", "name", "employee name"]);

export function isFullNameColumn(sourceColumn: string): boolean {
  return FULL_NAME_COLUMN_NAMES.has(normalize(sourceColumn));
}

/** Splits a "First Last" (optionally "First Middle Last") string into
 * first/last name parts. Ambiguous for names with 3+ space-separated parts
 * (could be a middle name or a two-word last name) — callers should treat
 * that case as needing review rather than guessing. */
export function splitFullName(fullName: string): { firstName: string; lastName: string; ambiguous: boolean } {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: "", lastName: "", ambiguous: false };
  if (parts.length === 1) return { firstName: parts[0], lastName: "", ambiguous: true };
  if (parts.length === 2) return { firstName: parts[0], lastName: parts[1], ambiguous: false };
  // 3+ parts: take first as first name, last as last name, but flag as
  // ambiguous since the middle part(s) could belong to either.
  return { firstName: parts[0], lastName: parts[parts.length - 1], ambiguous: true };
}

// Thresholds that decide the escalation boundary for column mapping.
// - CONFIDENCE_FLOOR: below this, we don't trust the top guess at all.
// - MIN_GAP: even a confident top guess escalates if the runner-up is
//   nearly as confident — that gap is what actually signals ambiguity,
//   since a column can score 0.8 for two different plausible fields.
export const CONFIDENCE_FLOOR = 0.75;
export const MIN_GAP = 0.2;

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Fast-path: exact or near-exact alias match against the schema. Returns
 * a single high-confidence candidate list when a column name unambiguously
 * matches one field's known aliases, skipping the LLM call entirely. */
function aliasFastPath(sourceColumn: string): MappingCandidate[] | null {
  const norm = normalize(sourceColumn);
  const matches: TargetField[] = TARGET_SCHEMA.filter(
    (f) => normalize(f.label) === norm || f.aliases.some((a) => normalize(a) === norm),
  );

  if (matches.length === 1) {
    return [
      {
        targetField: matches[0].key,
        confidence: 0.97,
        reasoning: `Column name "${sourceColumn}" is a direct alias of "${matches[0].label}".`,
      },
    ];
  }

  return null; // 0 or >1 matches — let the LLM (or ambiguity) handle it
}

function sampleValues(rows: Record<string, string>[], column: string, n = 5): string[] {
  const vals: string[] = [];
  for (const row of rows) {
    const v = row[column];
    if (v && v.trim() && !vals.includes(v.trim())) vals.push(v.trim());
    if (vals.length >= n) break;
  }
  return vals;
}

async function llmProposeMapping(
  sourceColumn: string,
  samples: string[],
): Promise<MappingCandidate[]> {
  const schemaDescription = TARGET_SCHEMA.map(
    (f) => `- ${f.key} (${f.type}${f.required ? ", required" : ""}): ${f.description}`,
  ).join("\n");

  const system = `You are a data migration assistant. Given a source spreadsheet column name and sample values, propose which target schema field(s) it most likely maps to. You must return STRICT JSON of the shape:
{"candidates": [{"targetField": "<schema key or null>", "confidence": <0-1 float>, "reasoning": "<one sentence>"}]}
Return up to 2 candidates, sorted by confidence descending. If the column clearly doesn't belong in the schema at all (e.g. free-text notes), return a single candidate with targetField null and low confidence. Be honest about uncertainty — if a column name is genuinely ambiguous between two fields, give both similar confidence rather than picking one arbitrarily.`;

  const user = `Target schema fields:\n${schemaDescription}\n\nSource column name: "${sourceColumn}"\nSample values from this column: ${JSON.stringify(samples)}\n\nPropose the mapping.`;

  try {
    const result = await callLLMJson<{ candidates: MappingCandidate[] }>(system, user);
    return (result.candidates ?? []).filter((c) => c.targetField);
  } catch (err) {
    // LLM call failed (rate limit, network, etc.) — fall back to a
    // conservative "unmapped, escalate" signal rather than crash the run.
    return [
      {
        targetField: "unmapped",
        confidence: 0,
        reasoning: `LLM mapping call failed: ${(err as Error).message}`,
      },
    ];
  }
}

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_SHAPE = /^\d{4}[-/]\d{1,2}[-/]\d{1,2}$|^\d{1,2}[-/]\d{1,2}[-/]\d{4}$/;
const PHONE_SHAPE = /^\+?[\d()\s-]{7,}$/;

/** Cheap value-shape signal used only to break ties/boost confidence in the
 * offline heuristic path — e.g. a column full of "a@b.com" strings is
 * almost certainly an email field regardless of its header text. */
function inferTypeFromSamples(samples: string[]): FieldTypeGuess {
  if (samples.length === 0) return null;
  if (samples.every((s) => EMAIL_SHAPE.test(s))) return "email";
  if (samples.every((s) => DATE_SHAPE.test(s))) return "date";
  if (samples.every((s) => PHONE_SHAPE.test(s) && /\d{5,}/.test(s))) return "phone";
  return null;
}

type FieldTypeGuess = "email" | "date" | "phone" | null;

/** Deterministic fallback used when no LLM is configured at all, so the
 * pipeline remains fully runnable offline. Combines three cheap signals:
 * (1) token overlap between the column name and each field's label/alias
 * words, (2) substring containment (catches things like "Contact Email"
 * vs. alias "email" that share no whole-token match under naive
 * tokenization edge cases), and (3) a value-shape check against sample
 * data (catches columns whose header wording is idiosyncratic but whose
 * values are unambiguously email/date/phone shaped). Still deliberately
 * more conservative than the LLM path on genuinely ambiguous names — ties
 * and near-ties are common and correctly escalate. */
// Exported for direct unit testing of the scoring logic — see
// __tests__/mapping.test.ts. Not part of the module's public API for
// production callers; proposeColumnMapping is the real entry point.
export function heuristicProposeMapping(sourceColumn: string, samples: string[]): MappingCandidate[] {
  const colTokens = normalize(sourceColumn).split(" ").filter(Boolean);
  const colTokenSet = new Set(colTokens);
  const colNormFull = normalize(sourceColumn);
  const shapeGuess = inferTypeFromSamples(samples);

  const scored = TARGET_SCHEMA.map((f) => {
    const aliasPhrases = [f.label, ...f.aliases].map(normalize);
    const fieldTokens = new Set(aliasPhrases.flatMap((s) => s.split(" ")).filter(Boolean));

    let tokenOverlap = 0;
    for (const t of colTokenSet) if (fieldTokens.has(t)) tokenOverlap++;
    const tokenScore = tokenOverlap / Math.max(colTokenSet.size, 1);

    // Substring containment: does any full alias phrase appear inside the
    // column name, or vice versa? Handles "Contact Email" containing
    // "email", "dept_code" containing "dept", etc.
    const substringHit = aliasPhrases.some(
      (phrase) => colNormFull.includes(phrase) || (phrase.length > 2 && phrase.includes(colNormFull)),
    );

    let score = tokenScore * 0.7 + (substringHit ? 0.3 : 0);

    // Value-shape agreement is a strong independent signal — boost it,
    // but only toward fields of the matching type.
    if (shapeGuess && f.type === shapeGuess) score = Math.max(score, 0.75);

    return { field: f, score };
  })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    return [{ targetField: "unmapped", confidence: 0.3, reasoning: "No token, substring, or value-shape match with any schema field." }];
  }

  return scored.slice(0, 2).map((s) => {
    const confidence = Math.min(0.95, 0.35 + s.score * 0.6);
    const reasonParts: string[] = [];
    if (s.score >= 0.75) reasonParts.push(`strong name/value match with "${s.field.label}"`);
    else reasonParts.push(`partial match with "${s.field.label}"`);
    return {
      targetField: s.field.key,
      confidence,
      reasoning: `Heuristic ${reasonParts[0]} (no LLM configured).`,
    };
  });
}

export async function proposeColumnMapping(
  sourceColumn: string,
  sourceFile: string,
  rows: Record<string, string>[],
  clientId: string = "default",
): Promise<ColumnMapping> {
  // A learned override takes priority over everything else, including the
  // exact-alias fast path: it represents a specific human's decision for
  // THIS client, which is more trustworthy than a generic schema alias
  // that was written before this client's data was ever seen. This is
  // what makes the agent get cheaper to run per-client over time — a
  // mapping a consultant confirmed once doesn't get re-asked on the next
  // file from the same client, even if it's a column name the generic
  // heuristic/LLM would still find ambiguous on its own.
  const override = findMappingOverride(clientId, sourceColumn);
  if (override) {
    const isUnmapped = override.targetField === "";
    return {
      sourceColumn,
      sourceFile,
      candidates: [
        {
          targetField: isUnmapped ? "unmapped" : override.targetField,
          confidence: 0.99,
          reasoning: `Learned from a prior confirmation by ${override.confirmedBy} for this client (reused ${override.timesReused} time${override.timesReused === 1 ? "" : "s"} since).`,
        },
      ],
      status: isUnmapped ? "unmapped" : "auto",
      appliedField: isUnmapped ? null : override.targetField,
    };
  }

  const fastPath = aliasFastPath(sourceColumn);
  if (fastPath) {
    return {
      sourceColumn,
      sourceFile,
      candidates: fastPath,
      status: "auto",
      appliedField: fastPath[0].targetField,
    };
  }

  const samples = sampleValues(rows, sourceColumn);
  const candidates = llmAvailable
    ? await llmProposeMapping(sourceColumn, samples)
    : heuristicProposeMapping(sourceColumn, samples);

  const sorted = [...candidates].sort((a, b) => b.confidence - a.confidence);
  const top = sorted[0];
  const runnerUp = sorted[1];

  const gap = runnerUp ? top.confidence - runnerUp.confidence : 1;
  const confidentEnough = top.confidence >= CONFIDENCE_FLOOR && gap >= MIN_GAP;

  if (!top || top.targetField === "unmapped") {
    return { sourceColumn, sourceFile, candidates: sorted, status: "unmapped", appliedField: null };
  }

  if (confidentEnough) {
    return { sourceColumn, sourceFile, candidates: sorted, status: "auto", appliedField: top.targetField };
  }

  return { sourceColumn, sourceFile, candidates: sorted, status: "escalated", appliedField: null };
}
