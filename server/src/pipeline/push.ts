import { nanoid } from "nanoid";
import { db } from "../db/client.js";
import { writeAudit } from "../db/audit.js";
import { emitEvent } from "../lib/eventBus.js";
import { pushRecordToTarget } from "./mockTargetApi.js";

const MAX_RETRIES = 2;

/** Pushes every 'ready' record for a job to the mock target API, retrying
 * transient failures up to MAX_RETRIES times, and leaving anything that
 * still fails in a 'failed' state for manual retry/rollback from the UI.
 * Records in 'needs_review' are skipped — nothing goes to the target
 * system while an escalation on it is still open. */
export async function pushJobRecords(jobId: string): Promise<{ batchId: string; pushed: number; failed: number; skipped: number }> {
  const batchId = nanoid();
  db.prepare(`UPDATE jobs SET status = 'pushing' WHERE id = ?`).run(jobId);
  emitEvent({ jobId, type: "job_status", message: "Pushing ready records to target system..." });

  const records = db
    .prepare(`SELECT * FROM records WHERE job_id = ? AND status = 'ready'`)
    .all(jobId) as { id: string; data_json: string; identity_hint: string }[];

  let pushed = 0;
  let failed = 0;

  for (const record of records) {
    const data = JSON.parse(record.data_json);
    let attempt = 0;
    let result;

    do {
      attempt += 1;
      emitEvent({ jobId, type: "push_attempt", message: `Pushing ${record.identity_hint} (attempt ${attempt})...`, data: { recordId: record.id } });
      result = await pushRecordToTarget(data);
      writeAudit({
        jobId,
        batchId,
        recordId: record.id,
        actor: "agent",
        action: attempt === 1 ? "push" : "retry",
        after: result.success ? { remoteId: result.remoteId } : undefined,
        reasoning: result.success ? "Push succeeded." : `Push failed: ${result.error}`,
      });
      if (!result.success && attempt < MAX_RETRIES) {
        emitEvent({ jobId, type: "retry", message: `Retrying ${record.identity_hint} after failure: ${result.error}`, data: { recordId: record.id } });
      }
    } while (!result.success && attempt < MAX_RETRIES);

    if (result.success) {
      db.prepare(`UPDATE records SET status = 'pushed' WHERE id = ?`).run(record.id);
      pushed += 1;
      emitEvent({ jobId, type: "push_success", message: `${record.identity_hint} pushed successfully (remote id ${result.remoteId}).`, data: { recordId: record.id } });
    } else {
      db.prepare(`UPDATE records SET status = 'failed' WHERE id = ?`).run(record.id);
      failed += 1;
      emitEvent({ jobId, type: "push_failed", message: `${record.identity_hint} failed after ${MAX_RETRIES} attempts: ${result.error}`, data: { recordId: record.id } });
    }
  }

  const skipped = (db.prepare(`SELECT COUNT(*) as c FROM records WHERE job_id = ? AND status = 'needs_review'`).get(jobId) as { c: number }).c;

  db.prepare(`UPDATE jobs SET status = 'done' WHERE id = ?`).run(jobId);
  emitEvent({ jobId, type: "job_status", message: `Push complete: ${pushed} pushed, ${failed} failed, ${skipped} held back for review.` });

  return { batchId, pushed, failed, skipped };
}

/** Retries only the records currently in 'failed' state for a job. */
export async function retryFailedRecords(jobId: string) {
  db.prepare(`UPDATE records SET status = 'ready' WHERE job_id = ? AND status = 'failed'`).run(jobId);
  return pushJobRecords(jobId);
}

/** Rolls back an entire push batch by replaying its audit trail backwards:
 * every record successfully pushed in that batch is marked rolled_back,
 * and a rollback audit entry is written per record explaining why. This
 * doesn't call a real "delete" on the target system (our mock API has no
 * such endpoint, matching many real bulk-import APIs) but records the
 * intent and resets local state so the batch can be corrected and
 * re-pushed cleanly. */
export function rollbackBatch(jobId: string, batchId: string, actor: string) {
  const pushedInBatch = db
    .prepare(`SELECT DISTINCT record_id FROM audit_log WHERE job_id = ? AND batch_id = ? AND action = 'push' AND after_json IS NOT NULL`)
    .all(jobId, batchId) as { record_id: string }[];

  let count = 0;
  for (const row of pushedInBatch) {
    const record = db.prepare(`SELECT * FROM records WHERE id = ?`).get(row.record_id) as { status: string } | undefined;
    if (!record || record.status !== "pushed") continue;

    db.prepare(`UPDATE records SET status = 'rolled_back' WHERE id = ?`).run(row.record_id);
    writeAudit({
      jobId,
      batchId,
      recordId: row.record_id,
      actor,
      action: "rollback",
      reasoning: `Batch ${batchId} rolled back by ${actor}.`,
    });
    emitEvent({ jobId, type: "rollback", message: `Rolled back record ${row.record_id} from batch ${batchId}.`, data: { recordId: row.record_id } });
    count += 1;
  }

  return { rolledBack: count };
}
