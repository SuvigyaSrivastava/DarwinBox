import { nanoid } from "nanoid";
import { db } from "./client.js";

function normalizeColumnName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export interface MappingOverride {
  targetField: string; // "" means confirmed-unmapped
  confirmedBy: string;
  confirmedAt: string;
  timesConfirmed: number;
  timesReused: number;
}

/** Looks up a learned mapping override for this client + source column, if
 * one exists, and — when found — increments its reuse counter, since
 * being looked up successfully from here IS the reuse event (this is what
 * "the agent got cheaper to run" actually means: one fewer escalation on
 * a later job because of a decision made on an earlier one). Returns null
 * when there's no prior human decision for this exact (client,
 * column-name) pair — callers fall back to the normal mapping engine in
 * that case. */
export function findMappingOverride(clientId: string, sourceColumn: string): MappingOverride | null {
  const norm = normalizeColumnName(sourceColumn);
  const row = db
    .prepare(`SELECT * FROM mapping_overrides WHERE client_id = ? AND normalized_column = ?`)
    .get(clientId, norm) as
    | { target_field: string; confirmed_by: string; confirmed_at: string; times_confirmed: number; times_reused: number }
    | undefined;

  if (!row) return null;

  db.prepare(`UPDATE mapping_overrides SET times_reused = times_reused + 1 WHERE client_id = ? AND normalized_column = ?`).run(
    clientId,
    norm,
  );

  return {
    targetField: row.target_field,
    confirmedBy: row.confirmed_by,
    confirmedAt: row.confirmed_at,
    timesConfirmed: row.times_confirmed,
    timesReused: row.times_reused + 1,
  };
}

/** Records (or updates) a human's mapping decision as a learned override
 * for this client, so the next job for the same client applies it
 * automatically instead of re-escalating. Called whenever a consultant
 * resolves a mapping escalation, and whenever a mapping the agent applied
 * automatically is later corrected. */
export function upsertMappingOverride(
  clientId: string,
  sourceColumn: string,
  targetField: string,
  confirmedBy: string,
) {
  const norm = normalizeColumnName(sourceColumn);
  const existing = db
    .prepare(`SELECT id, times_confirmed FROM mapping_overrides WHERE client_id = ? AND normalized_column = ?`)
    .get(clientId, norm) as { id: string; times_confirmed: number } | undefined;

  const now = new Date().toISOString();

  if (existing) {
    db.prepare(
      `UPDATE mapping_overrides SET target_field = ?, confirmed_by = ?, confirmed_at = ?, times_confirmed = times_confirmed + 1 WHERE id = ?`,
    ).run(targetField, confirmedBy, now, existing.id);
  } else {
    db.prepare(
      `INSERT INTO mapping_overrides (id, client_id, normalized_column, target_field, confirmed_by, confirmed_at, times_confirmed, times_reused)
       VALUES (?, ?, ?, ?, ?, ?, 1, 0)`,
    ).run(nanoid(), clientId, norm, targetField, confirmedBy, now);
  }
}

export function listMappingOverrides(clientId: string) {
  return db
    .prepare(`SELECT * FROM mapping_overrides WHERE client_id = ? ORDER BY confirmed_at DESC`)
    .all(clientId) as {
    id: string;
    client_id: string;
    normalized_column: string;
    target_field: string;
    confirmed_by: string;
    confirmed_at: string;
    times_confirmed: number;
    times_reused: number;
  }[];
}
