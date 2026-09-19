# Approach — Darwin Migration Agent

## The core design decision

The brief asks for a "defensible escalation boundary" — not just an agent that works,
but one whose autonomy is scoped on purpose. I split that boundary into two different
kinds of decision, because they fail in different ways and need different guardrails.

**Column mapping** (which target field does this source column represent?) is a
one-time structural decision made once per column, not per row. Getting it wrong
silently corrupts every row that flows through it, so I wanted a boundary that's
*conservative on ties*, not just on low scores. Each column gets ranked candidate
target fields with a confidence score. The agent auto-applies the top candidate only
when two conditions both hold: confidence ≥ 0.75, **and** the gap to the runner-up
is ≥ 0.20. The gap check is the important part — a column can score 0.8 for two
different plausible fields (in the sample data, "Contact Email" scores identically
for `email` and `manager_email`), and a threshold on the top score alone would auto-pick
one arbitrarily. The gap is what actually signals "this is ambiguous," independent of
how confident the top guess looks in isolation.

**Value cleaning** (is this specific cell correct/complete?) is a per-row, per-field
decision, and here the risk profile is different: guessing wrong on one row is a
contained, correctable mistake, so the bar for autonomy is "can I be sure," not "am I
confident." Whitespace, casing, and date-format normalization happen automatically
*only* when the format is structurally unambiguous — e.g. `2024-01-15` or `15/13/2024`
(day > 12, so it can't be a month) normalize silently; `03/01/2019` does not, because
it's genuinely readable two ways with nothing else in the row to disambiguate it, and
guessing wrong there plants a silent, undetectable error in someone's employment date.
A required field that's simply missing escalates rather than getting a placeholder,
because a placeholder in an HR system is worse than an honest gap. Enum values
(status, employee type) normalize against known variants and escalate only on values
that don't match anything recognized. Department codes I deemed a codebook (`ENG` →
`Engineering`) are expanded automatically as a known, deterministic lookup — the same
class of fix a human would make instantly and never think to double check.

**Duplicates** get a similar two-tier treatment: identical email across sources with no
conflicting fields auto-merges (there's no real decision to make); an exact-email match
with conflicting fields, or a close-but-not-identical name match, escalates with both
records shown side by side, because collapsing two different employees into one is a
much worse failure than asking once.

The result on the bundled sample data (20 reconciled employee records from 3 files,
running in the fully offline heuristic mode with no LLM key): 13 records clear
automatically, 7 need a human look, and the escalations map to real ambiguity — three
genuinely tied column mappings, several contractors missing required fields their
source system never captured, and one near-duplicate name. Nothing escalates that a
human wouldn't also have needed to think about, and nothing silently guesses on
something material. Everything the agent does or asks about is logged to an
append-only audit trail with a plain-language reason, whether the actor was the agent
or the consultant — so "why did this happen" is always answerable after the fact, and
rollback is a mechanical replay of that log, not a wish.

## Beyond the acceptance criteria

Three things I added past the minimum bar, because a real forward-deployed engagement
would need them on day one, not as a "someday" backlog item:

**Learned per-client mapping overrides.** The first time a consultant resolves "Contact
Email → email" for a client, that decision is written to a `mapping_overrides` table
keyed on (client, normalized column name). Every subsequent file from the *same*
client checks this table before falling back to the LLM/heuristic mapper — so the
agent gets measurably cheaper to run per client over time instead of re-asking the
identical question on every export. Running the bundled sample dataset twice
demonstrates this directly: 26 escalations on the first run, 15 on the second, with
the UI's "N learned mappings" badge reflecting exactly how many of the client's
confirmed mappings were reused rather than re-escalated.

**Input sanitization at the ingestion boundary.** Every cell is checked for
CSV/formula-injection payloads (a value starting with `=`, or with `+`/`-`/`@`
followed by something that reads as an actual formula body rather than a phone number
or numeric code) before anything else in the pipeline touches it, and neutralized by
prefixing a single quote — the same mitigation Google Sheets uses internally. This
matters concretely for an HR export: a "Notes" column is exactly the kind of free-text
field where someone might paste a hyperlink-formula payload, and if that payload
survives untouched into an exported file that's later opened in Excel, it executes.
The bundled sample data includes one such row to make this concretely demonstrable
rather than theoretical, and every neutralization is logged to the audit trail so it's
visible, not silent.

**A test suite for the two modules where a silent regression would be most damaging
and least visible**: the mapping confidence/gap-check boundary and the cleaning
module's date-ambiguity detection. These are the two places where "it still runs
without crashing" and "it's still making the right autonomy calls" can silently
diverge — a test suite is the only way to know the difference. 40 tests, `node:test`
(no extra dependency), runnable with `npm test` from `server/`.

## What I'd build next

1. **Two-attempt cleaning with a real second strategy**, not just re-running the same
   deterministic rule. Right now a first failure escalates directly; a genuinely richer
   agent would try a second, different heuristic (e.g. cross-referencing another source
   file's value for the same field) before giving up.
2. **Confidence calibration feedback loop** — log every human resolution against the
   agent's original confidence score, and surface where the thresholds are actually
   miscalibrated for a given column type, rather than leaving them as constants I
   picked once.
3. **Real target-schema validation feedback loop** — right now the mock API either
   succeeds or fails randomly; a more realistic version would return structured
   validation errors (e.g. "email domain not in allowed list") that the agent could
   route back into its own cleaning/escalation logic rather than treating as a generic
   retry-able failure.
4. **Batch-level confidence summary before push** — a one-line "here's what changed and
   why" digest a consultant can approve for an entire batch, not just record-by-record,
   for when they trust the agent's cleanup pattern and want to move faster.
5. **Production hardening not yet built**: authentication on the API (the audit
   trail's "actor" field is currently free text, not a verified identity), encryption
   of PII at rest, a job queue instead of the synchronous in-process pipeline (needed
   before this could handle a real multi-hundred-thousand-row export), and structured
   observability separate from the business-facing audit trail.
