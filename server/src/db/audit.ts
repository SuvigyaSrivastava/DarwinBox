import { nanoid } from "nanoid";
import { db } from "./client.js";

export function writeAudit(entry: {
  jobId: string;
  batchId?: string | null;
  recordId?: string | null;
  actor: string;
  action: string;
  before?: unknown;
  after?: unknown;
  reasoning?: string | null;
}) {
  const stmt = db.prepare(
    `INSERT INTO audit_log (id, job_id, batch_id, record_id, actor, action, before_json, after_json, reasoning, created_at)
     VALUES (@id, @jobId, @batchId, @recordId, @actor, @action, @beforeJson, @afterJson, @reasoning, @createdAt)`,
  );
  stmt.run({
    id: nanoid(),
    jobId: entry.jobId,
    batchId: entry.batchId ?? null,
    recordId: entry.recordId ?? null,
    actor: entry.actor,
    action: entry.action,
    beforeJson: entry.before !== undefined ? JSON.stringify(entry.before) : null,
    afterJson: entry.after !== undefined ? JSON.stringify(entry.after) : null,
    reasoning: entry.reasoning ?? null,
    createdAt: new Date().toISOString(),
  });
}
