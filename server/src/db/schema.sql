-- Migration jobs. One row per "run" of the agent against an uploaded set
-- of source files.
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL, -- ingesting | mapping | cleaning | ready_to_push | pushing | done
  source_files TEXT NOT NULL, -- JSON array of filenames
  client_id TEXT NOT NULL DEFAULT 'default' -- scopes learned mapping overrides (see mapping_overrides)
);

-- Learned per-client column-mapping overrides. When a consultant resolves
-- a mapping escalation (or corrects an auto-mapping) for a given client,
-- that decision is written here keyed on the client and a normalized
-- version of the source column name. Future jobs for the SAME client
-- check this table before falling back to the LLM/heuristic mapper, so
-- the same client's next file re-asks fewer questions than the last one —
-- the agent gets cheaper to run per-client over time instead of re-solving
-- the same ambiguity on every export.
CREATE TABLE IF NOT EXISTS mapping_overrides (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  normalized_column TEXT NOT NULL, -- lowercased, punctuation-stripped source column name
  target_field TEXT NOT NULL, -- '' (empty string) means "confirmed unmapped"
  confirmed_by TEXT NOT NULL,
  confirmed_at TEXT NOT NULL,
  times_confirmed INTEGER NOT NULL DEFAULT 1, -- incremented each time a human (re-)confirms this mapping
  times_reused INTEGER NOT NULL DEFAULT 0, -- incremented each time a LATER job auto-applies it instead of re-asking
  UNIQUE(client_id, normalized_column)
);

CREATE INDEX IF NOT EXISTS idx_mapping_overrides_client ON mapping_overrides(client_id);

-- Column-level mapping decisions for a job (source column -> target field).
CREATE TABLE IF NOT EXISTS column_mappings (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  source_file TEXT NOT NULL,
  source_column TEXT NOT NULL,
  candidates_json TEXT NOT NULL, -- JSON array of {targetField, confidence, reasoning}
  status TEXT NOT NULL, -- auto | escalated | resolved | unmapped
  applied_field TEXT,
  resolved_by TEXT, -- 'agent' | consultant name/id
  resolved_at TEXT,
  FOREIGN KEY (job_id) REFERENCES jobs(id)
);

-- One reconciled employee entity per row, with its resolved field values
-- and per-field cleaning notes.
CREATE TABLE IF NOT EXISTS records (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  entity_key TEXT NOT NULL,
  identity_hint TEXT NOT NULL,
  source_files_json TEXT NOT NULL, -- JSON array of filenames this entity was built from
  data_json TEXT NOT NULL, -- JSON object of resolved target-field values
  status TEXT NOT NULL, -- pending | clean | needs_review | ready | pushed | failed | rolled_back
  validation_attempts INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (job_id) REFERENCES jobs(id)
);

-- Escalation queue: anything the agent surfaces for a human, of any kind
-- (mapping ambiguity, cleaning failure, duplicate).
CREATE TABLE IF NOT EXISTS escalations (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  type TEXT NOT NULL, -- mapping | cleaning | duplicate | validation
  record_id TEXT, -- nullable: mapping escalations aren't tied to one record
  mapping_id TEXT,
  title TEXT NOT NULL,
  context_json TEXT NOT NULL, -- everything needed to resolve it in one glance
  status TEXT NOT NULL DEFAULT 'open', -- open | approved | corrected | rejected
  resolution_json TEXT,
  resolved_by TEXT,
  resolved_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (job_id) REFERENCES jobs(id)
);

-- Append-only audit trail. Every state-changing action, automated or
-- human, is recorded here with enough detail to explain and to reverse.
CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  batch_id TEXT, -- groups a set of pushes together for rollback
  record_id TEXT,
  actor TEXT NOT NULL, -- 'agent' | consultant name/id | 'system'
  action TEXT NOT NULL, -- e.g. 'map_column', 'clean_value', 'push', 'retry', 'rollback', 'approve_escalation'
  before_json TEXT,
  after_json TEXT,
  reasoning TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (job_id) REFERENCES jobs(id)
);

CREATE INDEX IF NOT EXISTS idx_records_job ON records(job_id);
CREATE INDEX IF NOT EXISTS idx_escalations_job ON escalations(job_id);
CREATE INDEX IF NOT EXISTS idx_audit_job ON audit_log(job_id);
CREATE INDEX IF NOT EXISTS idx_audit_batch ON audit_log(batch_id);
