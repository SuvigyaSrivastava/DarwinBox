import { db } from "../db/client.js";
import { writeAudit } from "../db/audit.js";
import { emitEvent } from "../lib/eventBus.js";
import { cleanFieldValue } from "./cleaning.js";
import { TARGET_SCHEMA } from "../schema/targetSchema.js";
import type { EscalationRow } from "../db/types.js";
import { upsertMappingOverride } from "../db/mappingOverrides.js";

function nowIso() {
  return new Date().toISOString();
}

export type EscalationAction = "approve" | "correct" | "reject";

/** Applies a human decision to an open escalation: approve (accept the
 * agent's top suggestion, or the flagged state as-is for duplicates),
 * correct (human supplies the actual value/field), or reject (discard
 * this row's proposed value/field, leaving it unmapped/unresolved).
 * Every resolution is written to the audit trail with the consultant's
 * identity as actor. */
export function resolveEscalation(
  escalationId: string,
  action: EscalationAction,
  actor: string,
  correction?: { field?: string; value?: string },
) {
  const esc = db.prepare(`SELECT * FROM escalations WHERE id = ?`).get(escalationId) as EscalationRow | undefined;
  if (!esc) throw new Error("Escalation not found");
  if (esc.status !== "open") throw new Error("Escalation already resolved");

  const context = JSON.parse(esc.context_json);
  const resolution = { action, correction: correction ?? null };

  db.prepare(`UPDATE escalations SET status = ?, resolution_json = ?, resolved_by = ?, resolved_at = ? WHERE id = ?`).run(
    action === "approve" ? "approved" : action === "correct" ? "corrected" : "rejected",
    JSON.stringify(resolution),
    actor,
    nowIso(),
    escalationId,
  );

  if (esc.type === "mapping") {
    const mapping = db.prepare(`SELECT * FROM column_mappings WHERE id = ?`).get(esc.mapping_id) as { id: string; job_id: string } | undefined;
    if (mapping) {
      const targetField = action === "reject" ? null : action === "correct" ? correction?.field ?? null : context.candidates?.[0]?.targetField ?? null;
      db.prepare(`UPDATE column_mappings SET status = ?, applied_field = ?, resolved_by = ?, resolved_at = ? WHERE id = ?`).run(
        action === "reject" ? "unmapped" : "resolved",
        targetField,
        actor,
        nowIso(),
        mapping.id,
      );
      writeAudit({
        jobId: esc.job_id,
        actor,
        action: "resolve_mapping_escalation",
        before: context,
        after: { targetField },
        reasoning: `Consultant ${action}d mapping for "${context.sourceColumn}" (${context.sourceFile}).`,
      });

      // Learn from this decision: persist it as a per-client override so
      // the NEXT file from the same client applies this mapping
      // automatically instead of re-escalating the same ambiguity. This
      // is what makes the agent cheaper to run over repeated engagements
      // with one client, rather than re-asking the identical question on
      // every export. `targetField` is null on reject (confirmed
      // unmapped) — upsertMappingOverride stores that as "" deliberately,
      // distinct from "no override recorded at all".
      const job = db.prepare(`SELECT client_id FROM jobs WHERE id = ?`).get(esc.job_id) as { client_id: string } | undefined;
      if (job) {
        upsertMappingOverride(job.client_id, context.sourceColumn, targetField ?? "", actor);
      }

      // Re-run cleaning downstream is out of scope for a single mapping fix
      // in this prototype; the mapping is recorded and will apply to any
      // future run. For records already reconciled in this job, the
      // consultant resolves the resulting field value directly in the
      // record's own escalation if one appears.
    }
  } else if (esc.type === "cleaning" && esc.record_id) {
    const record = db.prepare(`SELECT * FROM records WHERE id = ?`).get(esc.record_id) as { id: string; data_json: string; job_id: string } | undefined;
    if (record) {
      const data = JSON.parse(record.data_json);
      const field = context.field as string;

      let finalValue: string;
      if (action === "reject") {
        finalValue = "";
      } else if (action === "correct") {
        finalValue = correction?.value ?? "";
      } else {
        // Approve: try cleaning again in case the human just wants the
        // agent's best-effort value accepted as-is.
        finalValue = context.rawValue;
      }

      data[field] = finalValue;
      db.prepare(`UPDATE records SET data_json = ? WHERE id = ?`).run(JSON.stringify(data), record.id);

      writeAudit({
        jobId: record.job_id,
        recordId: record.id,
        actor,
        action: "resolve_cleaning_escalation",
        before: { field, value: context.rawValue },
        after: { field, value: finalValue },
        reasoning: `Consultant ${action}ed value for "${field}" on ${context.identityHint}.`,
      });

      maybeMarkReady(record.job_id, record.id);
    }
  } else if (esc.type === "duplicate") {
    const recordA = context.recordA;
    const recordB = context.recordB;
    if (action === "approve") {
      // Approve = confirm they are duplicates; keep A, drop B.
      db.prepare(`UPDATE records SET status = 'rolled_back' WHERE id = ?`).run(recordB.id);
      writeAudit({ jobId: esc.job_id, actor, action: "confirm_duplicate", before: { a: recordA, b: recordB }, reasoning: `Consultant confirmed duplicate; kept ${recordA.id}, dropped ${recordB.id}.` });
      maybeMarkReady(esc.job_id, recordA.id);
    } else if (action === "reject") {
      // Reject = they are different people; keep both, clear needs_review.
      maybeMarkReady(esc.job_id, recordA.id);
      maybeMarkReady(esc.job_id, recordB.id);
      writeAudit({ jobId: esc.job_id, actor, action: "reject_duplicate", before: { a: recordA, b: recordB }, reasoning: `Consultant confirmed these are different people; kept both records.` });
    } else if (action === "correct" && correction?.value) {
      // Correct = human specifies which id to drop.
      const dropId = correction.value;
      const keepId = dropId === recordA.id ? recordB.id : recordA.id;
      db.prepare(`UPDATE records SET status = 'rolled_back' WHERE id = ?`).run(dropId);
      maybeMarkReady(esc.job_id, keepId);
      writeAudit({ jobId: esc.job_id, actor, action: "resolve_duplicate_custom", reasoning: `Consultant chose to keep ${keepId} and drop ${dropId}.` });
    }
  }

  emitEvent({ jobId: esc.job_id, type: "escalation_resolved", message: `Escalation "${esc.title}" ${action}d by ${actor}.`, data: { escalationId } });
}

/** Re-checks whether a record still has any open escalations against it;
 * if not, and required fields are present, promotes it to 'ready'. */
function maybeMarkReady(jobId: string, recordId: string) {
  const openCount = (
    db.prepare(`SELECT COUNT(*) as c FROM escalations WHERE record_id = ? AND status = 'open'`).get(recordId) as { c: number }
  ).c;
  if (openCount > 0) return;

  const record = db.prepare(`SELECT * FROM records WHERE id = ?`).get(recordId) as { data_json: string; status: string } | undefined;
  if (!record || record.status === "rolled_back" || record.status === "pushed") return;

  const data = JSON.parse(record.data_json);
  const missingRequired = TARGET_SCHEMA.filter((f) => f.required && !data[f.key]);

  db.prepare(`UPDATE records SET status = ? WHERE id = ?`).run(missingRequired.length > 0 ? "needs_review" : "ready", recordId);
}
