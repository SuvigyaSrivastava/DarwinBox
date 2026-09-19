export interface TargetField {
  key: string;
  label: string;
  type: string;
  required: boolean;
  enumValues?: string[];
  aliases: string[];
  description: string;
}

export interface JobRecord {
  id: string;
  job_id: string;
  entity_key: string;
  identity_hint: string;
  status: string;
  data: Record<string, string>;
  sourceFiles: string[];
}

export interface MappingCandidate {
  targetField: string;
  confidence: number;
  reasoning: string;
}

export interface Escalation {
  id: string;
  job_id: string;
  type: "mapping" | "cleaning" | "duplicate" | "validation";
  record_id: string | null;
  mapping_id: string | null;
  title: string;
  context: any;
  status: "open" | "approved" | "corrected" | "rejected";
  resolution: any;
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
}

export interface AuditEntry {
  id: string;
  job_id: string;
  batch_id: string | null;
  record_id: string | null;
  actor: string;
  action: string;
  before: any;
  after: any;
  reasoning: string | null;
  created_at: string;
}

export interface AgentEvent {
  type: string;
  jobId: string;
  message: string;
  data?: unknown;
  timestamp: string;
}

const BASE = "/api";

async function req<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, opts);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  return res.json();
}

export const api = {
  getSchema: () => req<{ fields: TargetField[]; llmAvailable: boolean }>("/schema"),
  runSample: () => req<{ jobId: string }>("/jobs/sample", { method: "POST" }),
  uploadFiles: (files: FileList) => {
    const form = new FormData();
    Array.from(files).forEach((f) => form.append("files", f));
    return req<{ jobId: string }>("/jobs", { method: "POST", body: form });
  },
  getJob: (jobId: string) => req<{ id: string; status: string; created_at: string; source_files: string; client_id: string }>(`/jobs/${jobId}`),
  getMappingOverrides: (clientId: string) =>
    req<{ normalized_column: string; target_field: string; confirmed_by: string; times_confirmed: number; times_reused: number }[]>(
      `/clients/${clientId}/mapping-overrides`,
    ),
  getEventBacklog: (jobId: string) => req<AgentEvent[]>(`/jobs/${jobId}/events`),
  getRecords: (jobId: string) => req<JobRecord[]>(`/jobs/${jobId}/records`),
  getMappings: (jobId: string) => req<any[]>(`/jobs/${jobId}/mappings`),
  getEscalations: (jobId: string) => req<Escalation[]>(`/jobs/${jobId}/escalations`),
  resolveEscalation: (escalationId: string, action: string, actor: string, correction?: { field?: string; value?: string }) =>
    req<{ ok: boolean }>(`/escalations/${escalationId}/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, actor, correction }),
    }),
  push: (jobId: string) => req<{ batchId: string; pushed: number; failed: number; skipped: number }>(`/jobs/${jobId}/push`, { method: "POST" }),
  retry: (jobId: string) => req<{ batchId: string; pushed: number; failed: number; skipped: number }>(`/jobs/${jobId}/retry`, { method: "POST" }),
  rollback: (jobId: string, batchId: string, actor: string) =>
    req<{ rolledBack: number }>(`/jobs/${jobId}/rollback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ batchId, actor }),
    }),
  getAudit: (jobId: string) => req<AuditEntry[]>(`/jobs/${jobId}/audit`),
};

export function connectEvents(onEvent: (evt: AgentEvent) => void): () => void {
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${window.location.host}/ws`);
  ws.onmessage = (msg) => {
    try {
      onEvent(JSON.parse(msg.data));
    } catch {
      // ignore malformed frames
    }
  };
  return () => ws.close();
}
