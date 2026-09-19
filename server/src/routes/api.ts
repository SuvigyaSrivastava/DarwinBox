import { Router } from "express";
import multer from "multer";
import path from "node:path";
import { mkdirSync, renameSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { db } from "../db/client.js";
import { runMigrationJob } from "../pipeline/orchestrator.js";
import { pushJobRecords, retryFailedRecords, rollbackBatch } from "../pipeline/push.js";
import { resolveEscalation } from "../pipeline/resolveEscalation.js";
import { TARGET_SCHEMA } from "../schema/targetSchema.js";
import { llmAvailable } from "../lib/llm.js";
import { getEventBacklog } from "../lib/eventBus.js";
import { listMappingOverrides } from "../db/mappingOverrides.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadDir = path.join(__dirname, "..", "..", "data", "uploads");
mkdirSync(uploadDir, { recursive: true });

const upload = multer({ dest: uploadDir });

export const apiRouter = Router();

apiRouter.get("/schema", (_req, res) => {
  res.json({ fields: TARGET_SCHEMA, llmAvailable });
});

// Client IDs are constrained to a safe, boring shape. They flow into a
// SQLite UNIQUE index and are echoed back in API responses, so this isn't
// about SQL injection (parameterized queries already prevent that) — it's
// about keeping the identifier predictable for the mapping_overrides
// lookup and preventing someone from using this free-text field to stash
// arbitrary content in the audit trail's client scoping.
const CLIENT_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;

function resolveClientId(raw: unknown): string {
  if (typeof raw === "string" && CLIENT_ID_RE.test(raw)) return raw;
  return "default";
}

apiRouter.post("/jobs", upload.array("files"), async (req, res) => {
  try {
    const files = req.files as Express.Multer.File[];
    if (!files || files.length === 0) {
      return res.status(400).json({ error: "No files uploaded" });
    }
    const clientId = resolveClientId(req.body?.clientId);
    const filePaths = files.map((f) => {
      // Preserve original extension so the parser can detect csv/xlsx.
      const withExt = path.join(uploadDir, `${f.filename}${path.extname(f.originalname)}`);
      renameSync(f.path, withExt);
      return withExt;
    });
    const jobId = await runMigrationJob(filePaths, clientId);
    res.json({ jobId });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

apiRouter.post("/jobs/sample", async (req, res) => {
  try {
    const clientId = resolveClientId(req.body?.clientId) ?? "acme-corp-demo";
    const sampleDir = path.join(__dirname, "..", "..", "..", "data", "sample-sources");
    const fs = await import("node:fs");
    const files = fs.readdirSync(sampleDir).map((f) => path.join(sampleDir, f));
    const jobId = await runMigrationJob(files, clientId === "default" ? "acme-corp-demo" : clientId);
    res.json({ jobId });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

apiRouter.get("/clients/:clientId/mapping-overrides", (req, res) => {
  res.json(listMappingOverrides(req.params.clientId));
});

apiRouter.get("/jobs/:jobId/events", (req, res) => {
  res.json(getEventBacklog(req.params.jobId));
});

apiRouter.get("/jobs/:jobId", (req, res) => {
  const job = db.prepare(`SELECT * FROM jobs WHERE id = ?`).get(req.params.jobId);
  if (!job) return res.status(404).json({ error: "Job not found" });
  res.json(job);
});

apiRouter.get("/jobs/:jobId/records", (req, res) => {
  const records = db.prepare(`SELECT * FROM records WHERE job_id = ?`).all(req.params.jobId);
  res.json(records.map(deserializeRecord));
});

apiRouter.get("/jobs/:jobId/mappings", (req, res) => {
  const mappings = db.prepare(`SELECT * FROM column_mappings WHERE job_id = ?`).all(req.params.jobId);
  res.json(mappings.map((m: any) => ({ ...m, candidates: JSON.parse(m.candidates_json) })));
});

apiRouter.get("/jobs/:jobId/escalations", (req, res) => {
  const status = req.query.status as string | undefined;
  const rows = status
    ? db.prepare(`SELECT * FROM escalations WHERE job_id = ? AND status = ? ORDER BY created_at ASC`).all(req.params.jobId, status)
    : db.prepare(`SELECT * FROM escalations WHERE job_id = ? ORDER BY created_at ASC`).all(req.params.jobId);
  res.json(rows.map((r: any) => ({ ...r, context: JSON.parse(r.context_json), resolution: r.resolution_json ? JSON.parse(r.resolution_json) : null })));
});

apiRouter.post("/escalations/:escalationId/resolve", (req, res) => {
  try {
    const { action, actor, correction } = req.body;
    resolveEscalation(req.params.escalationId, action, actor || "Consultant", correction);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

apiRouter.post("/jobs/:jobId/push", async (req, res) => {
  try {
    const result = await pushJobRecords(req.params.jobId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

apiRouter.post("/jobs/:jobId/retry", async (req, res) => {
  try {
    const result = await retryFailedRecords(req.params.jobId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

apiRouter.post("/jobs/:jobId/rollback", (req, res) => {
  try {
    const { batchId, actor } = req.body;
    const result = rollbackBatch(req.params.jobId, batchId, actor || "Consultant");
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

apiRouter.get("/jobs/:jobId/audit", (req, res) => {
  const rows = db.prepare(`SELECT * FROM audit_log WHERE job_id = ? ORDER BY created_at ASC`).all(req.params.jobId);
  res.json(
    rows.map((r: any) => ({
      ...r,
      before: r.before_json ? JSON.parse(r.before_json) : null,
      after: r.after_json ? JSON.parse(r.after_json) : null,
    })),
  );
});

function deserializeRecord(r: any) {
  return {
    ...r,
    data: JSON.parse(r.data_json),
    sourceFiles: JSON.parse(r.source_files_json),
  };
}
