export interface JobRow {
  id: string;
  created_at: string;
  status: string;
  source_files: string; // JSON
}

export interface ColumnMappingRow {
  id: string;
  job_id: string;
  source_file: string;
  source_column: string;
  candidates_json: string;
  status: string;
  applied_field: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
}

export interface RecordRow {
  id: string;
  job_id: string;
  entity_key: string;
  identity_hint: string;
  source_files_json: string;
  data_json: string;
  status: string;
  validation_attempts: number;
}

export interface EscalationRow {
  id: string;
  job_id: string;
  type: "mapping" | "cleaning" | "duplicate" | "validation";
  record_id: string | null;
  mapping_id: string | null;
  title: string;
  context_json: string;
  status: "open" | "approved" | "corrected" | "rejected";
  resolution_json: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
}

export interface AuditLogRow {
  id: string;
  job_id: string;
  batch_id: string | null;
  record_id: string | null;
  actor: string;
  action: string;
  before_json: string | null;
  after_json: string | null;
  reasoning: string | null;
  created_at: string;
}
