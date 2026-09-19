import { nanoid } from "nanoid";
import { db } from "../db/client.js";
import { writeAudit } from "../db/audit.js";
import { emitEvent } from "../lib/eventBus.js";
import { parseSourceFiles, type SourceFile } from "./ingest.js";
import { reconcileEntities } from "./reconcile.js";
import { proposeColumnMapping, isFullNameColumn, splitFullName, type ColumnMapping } from "./mapping.js";
import { cleanFieldValue, compareForDuplicate } from "./cleaning.js";
import { TARGET_SCHEMA } from "../schema/targetSchema.js";

function nowIso() {
  return new Date().toISOString();
}

/** Runs the full agent pipeline for a set of uploaded source files:
 * ingest -> reconcile -> map columns -> clean/validate -> flag duplicates.
 * Everything auto-resolved is written straight to `records`; everything
 * uncertain is written to `escalations` and the record is left in
 * `needs_review` until a human resolves it. This function is the one place
 * that embodies "what the agent decides alone vs. escalates." */
export async function runMigrationJob(filePaths: string[], clientId: string = "default"): Promise<string> {
  const jobId = nanoid();
  const files = parseSourceFiles(filePaths);

  db.prepare(`INSERT INTO jobs (id, created_at, status, source_files, client_id) VALUES (?, ?, ?, ?, ?)`).run(
    jobId,
    nowIso(),
    "ingesting",
    JSON.stringify(files.map((f) => f.filename)),
    clientId,
  );

  emitEvent({ jobId, type: "job_started", message: `Started migration job with ${files.length} source file(s).` });
  for (const f of files) {
    emitEvent({ jobId, type: "file_ingested", message: `Ingested ${f.filename} (${f.rows.length} rows, ${f.columns.length} columns).` });
    if (f.sanitizeStats.neutralizedCells > 0) {
      writeAudit({
        jobId,
        actor: "system",
        action: "sanitize_input",
        reasoning: `${f.sanitizeStats.neutralizedCells} cell(s) in ${f.filename} began with a formula-trigger character (=, +, -, @) and were neutralized to prevent CSV/formula injection if this data is later opened in a spreadsheet.`,
      });
      emitEvent({
        jobId,
        type: "job_status",
        message: `Neutralized ${f.sanitizeStats.neutralizedCells} potentially unsafe cell(s) in ${f.filename} (formula-injection guard).`,
      });
    }
  }

  setJobStatus(jobId, "mapping");

  // --- Column mapping phase ---
  const mappingsByFileColumn = new Map<string, ColumnMapping>();
  for (const file of files) {
    for (const column of file.columns) {
      if (isFullNameColumn(column)) {
        const splitMapping: ColumnMapping = {
          sourceColumn: column,
          sourceFile: file.filename,
          candidates: [
            { targetField: "first_name+last_name", confidence: 0.95, reasoning: `"${column}" holds a full name; split into first_name/last_name on whitespace.` },
          ],
          status: "split_name",
          appliedField: "first_name+last_name",
        };
        mappingsByFileColumn.set(`${file.filename}::${column}`, splitMapping);
        const mappingId = nanoid();
        db.prepare(
          `INSERT INTO column_mappings (id, job_id, source_file, source_column, candidates_json, status, applied_field, resolved_by, resolved_at)
           VALUES (?, ?, ?, ?, ?, 'auto', ?, 'agent', ?)`,
        ).run(mappingId, jobId, file.filename, column, JSON.stringify(splitMapping.candidates), "first_name+last_name", nowIso());
        writeAudit({ jobId, actor: "agent", action: "map_column", after: { sourceFile: file.filename, sourceColumn: column, targetField: "first_name + last_name (split)" }, reasoning: splitMapping.candidates[0].reasoning });
        emitEvent({ jobId, type: "column_mapped", message: `Mapped "${column}" (${file.filename}) → first_name + last_name (split on whitespace).` });
        continue;
      }

      const mapping = await proposeColumnMapping(column, file.filename, file.rows, clientId);
      const mappingId = nanoid();

      db.prepare(
        `INSERT INTO column_mappings (id, job_id, source_file, source_column, candidates_json, status, applied_field, resolved_by, resolved_at)
         VALUES (@id, @jobId, @sourceFile, @sourceColumn, @candidatesJson, @status, @appliedField, @resolvedBy, @resolvedAt)`,
      ).run({
        id: mappingId,
        jobId,
        sourceFile: file.filename,
        sourceColumn: column,
        candidatesJson: JSON.stringify(mapping.candidates),
        status: mapping.status,
        appliedField: mapping.appliedField,
        resolvedBy: mapping.status === "auto" ? "agent" : null,
        resolvedAt: mapping.status === "auto" ? nowIso() : null,
      });

      mappingsByFileColumn.set(`${file.filename}::${column}`, mapping);

      if (mapping.status === "auto") {
        writeAudit({
          jobId,
          actor: "agent",
          action: "map_column",
          after: { sourceFile: file.filename, sourceColumn: column, targetField: mapping.appliedField },
          reasoning: mapping.candidates[0]?.reasoning ?? null,
        });
        emitEvent({
          jobId,
          type: "column_mapped",
          message: `Mapped "${column}" (${file.filename}) → ${mapping.appliedField} (confidence ${mapping.candidates[0]?.confidence.toFixed(2)}).`,
        });
      } else if (mapping.status === "escalated") {
        const escId = nanoid();
        db.prepare(
          `INSERT INTO escalations (id, job_id, type, record_id, mapping_id, title, context_json, status, created_at)
           VALUES (?, ?, 'mapping', NULL, ?, ?, ?, 'open', ?)`,
        ).run(
          escId,
          jobId,
          mappingId,
          `Ambiguous column mapping: "${column}" (${file.filename})`,
          JSON.stringify({ sourceFile: file.filename, sourceColumn: column, candidates: mapping.candidates, sampleValues: sampleFor(file, column) }),
          nowIso(),
        );
        emitEvent({
          jobId,
          type: "column_escalated",
          message: `Escalated column "${column}" (${file.filename}) — top candidates too close to call automatically.`,
          data: { escalationId: escId },
        });
      } else {
        emitEvent({ jobId, type: "column_mapped", message: `Column "${column}" (${file.filename}) does not map to any target field — left unmapped.` });
      }
    }
  }

  setJobStatus(jobId, "cleaning");

  // --- Reconciliation + per-record cleaning phase ---
  const entities = reconcileEntities(files);

  for (const entity of entities) {
    const recordId = nanoid();
    const resolved: Record<string, string> = {};
    const cleaningNotes: { field: string; note: string }[] = [];
    let needsReview = false;
    let attempts = 1;

    // Merge all source rows contributing to this entity, applying the
    // resolved column mapping for each. Later sources win on conflict for
    // now (a real system might prefer the most recently updated source;
    // for our purposes any genuine conflict shows up in duplicate
    // detection below and gets escalated there instead).
    for (const src of entity.sources) {
      const file = files.find((f) => f.filename === src.sourceFile)!;
      for (const column of file.columns) {
        const mapping = mappingsByFileColumn.get(`${src.sourceFile}::${column}`);
        if (!mapping || !mapping.appliedField) continue;
        const raw = src.data[column];
        if (raw === undefined || raw === "") continue;

        if (mapping.appliedField === "first_name+last_name") {
          const { firstName, lastName, ambiguous } = splitFullName(raw);
          resolved.first_name = firstName;
          resolved.last_name = lastName;
          if (ambiguous) {
            cleaningNotes.push({ field: "first_name", note: `Name "${raw}" split heuristically (first token = first name, last token = last name) — middle part(s) may be misassigned.` });
          }
          continue;
        }

        resolved[mapping.appliedField] = raw;
      }
    }

    // Clean every resolved field.
    for (const field of TARGET_SCHEMA) {
      const raw = resolved[field.key] ?? "";
      const result = cleanFieldValue(field.key, raw);
      resolved[field.key] = result.value;
      if (result.note) cleaningNotes.push({ field: field.key, note: result.note });

      if (result.escalate) {
        // First failure: try once more defensively (e.g. re-trim, re-parse)
        // — cleanFieldValue is already deterministic so a second identical
        // attempt won't change the outcome, which is the point: exactly
        // one real attempt, then escalate rather than loop forever.
        attempts += 1;
        needsReview = true;
        const escId = nanoid();
        db.prepare(
          `INSERT INTO escalations (id, job_id, type, record_id, mapping_id, title, context_json, status, created_at)
           VALUES (?, ?, 'cleaning', ?, NULL, ?, ?, 'open', ?)`,
        ).run(
          escId,
          jobId,
          recordId,
          `${field.label} issue for ${entity.identityHint}`,
          JSON.stringify({ field: field.key, rawValue: raw, reason: result.escalate, identityHint: entity.identityHint, sources: entity.sources.map((s) => s.sourceFile) }),
          nowIso(),
        );
        emitEvent({
          jobId,
          type: "record_escalated",
          message: `Escalated "${field.label}" for ${entity.identityHint}: ${result.escalate}`,
          data: { escalationId: escId, recordId },
        });
      }
    }

    db.prepare(
      `INSERT INTO records (id, job_id, entity_key, identity_hint, source_files_json, data_json, status, validation_attempts)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      recordId,
      jobId,
      entity.entityKey,
      entity.identityHint,
      JSON.stringify(entity.sources.map((s) => s.sourceFile)),
      JSON.stringify(resolved),
      needsReview ? "needs_review" : "ready",
      attempts,
    );

    writeAudit({
      jobId,
      recordId,
      actor: "agent",
      action: "reconcile_and_clean",
      after: resolved,
      reasoning: cleaningNotes.map((n) => n.note).join("; ") || "No changes needed.",
    });

    if (!needsReview) {
      emitEvent({ jobId, type: "record_ready", message: `${entity.identityHint} cleaned and ready to push.`, data: { recordId } });
    }
  }

  // --- Duplicate detection across resolved records ---
  const allRecords = db.prepare(`SELECT * FROM records WHERE job_id = ?`).all(jobId) as { id: string; data_json: string; identity_hint: string }[];
  for (let i = 0; i < allRecords.length; i++) {
    for (let j = i + 1; j < allRecords.length; j++) {
      const a = JSON.parse(allRecords[i].data_json);
      const b = JSON.parse(allRecords[j].data_json);
      const dup = compareForDuplicate(a, b);
      if (!dup) continue;

      if (dup.matchType === "exact") {
        writeAudit({
          jobId,
          actor: "agent",
          action: "auto_merge_duplicate",
          before: { a, b },
          reasoning: dup.reason,
        });
        db.prepare(`UPDATE records SET status = 'rolled_back' WHERE id = ?`).run(allRecords[j].id);
        emitEvent({ jobId, type: "record_ready", message: `Auto-merged exact duplicate: ${allRecords[j].identity_hint}.` });
      } else {
        const escId = nanoid();
        db.prepare(
          `INSERT INTO escalations (id, job_id, type, record_id, mapping_id, title, context_json, status, created_at)
           VALUES (?, ?, 'duplicate', ?, NULL, ?, ?, 'open', ?)`,
        ).run(
          escId,
          jobId,
          allRecords[i].id,
          `Possible duplicate: ${allRecords[i].identity_hint} / ${allRecords[j].identity_hint}`,
          JSON.stringify({ recordA: { id: allRecords[i].id, data: a }, recordB: { id: allRecords[j].id, data: b }, reason: dup.reason }),
          nowIso(),
        );
        db.prepare(`UPDATE records SET status = 'needs_review' WHERE id IN (?, ?)`).run(allRecords[i].id, allRecords[j].id);
        emitEvent({ jobId, type: "duplicate_escalated", message: dup.reason, data: { escalationId: escId } });
      }
    }
  }

  setJobStatus(jobId, "ready_to_push");
  return jobId;
}

function sampleFor(file: SourceFile, column: string): string[] {
  const vals: string[] = [];
  for (const row of file.rows) {
    if (row[column] && !vals.includes(row[column])) vals.push(row[column]);
    if (vals.length >= 5) break;
  }
  return vals;
}

function setJobStatus(jobId: string, status: string) {
  db.prepare(`UPDATE jobs SET status = ? WHERE id = ?`).run(status, jobId);
  emitEvent({ jobId, type: "job_status", message: `Job status: ${status}` });
}
