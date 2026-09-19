import { WebSocketServer, WebSocket } from "ws";

export interface AgentEvent {
  type:
    | "job_started"
    | "file_ingested"
    | "column_mapped"
    | "column_escalated"
    | "record_cleaned"
    | "record_escalated"
    | "duplicate_escalated"
    | "record_ready"
    | "push_attempt"
    | "push_success"
    | "push_failed"
    | "retry"
    | "rollback"
    | "job_status"
    | "escalation_resolved";
  jobId: string;
  message: string;
  data?: unknown;
  timestamp: string;
}

const clients = new Set<WebSocket>();

// In-memory backlog per job. The pipeline runs to completion synchronously
// (often in well under a second for this prototype's data volumes), so a
// browser client that connects its WebSocket only after navigating to the
// job view would otherwise miss the entire "live" feed. Buffering recent
// events per job lets the client fetch the backlog on mount and then
// subscribe for anything after — the UI reads as live regardless of
// whether the human opened it before, during, or after the run.
const MAX_BACKLOG_PER_JOB = 500;
const backlogByJob = new Map<string, AgentEvent[]>();

export function attachWebSocketServer(wss: WebSocketServer) {
  wss.on("connection", (ws) => {
    clients.add(ws);
    ws.on("close", () => clients.delete(ws));
  });
}

export function emitEvent(event: Omit<AgentEvent, "timestamp">) {
  const full: AgentEvent = { ...event, timestamp: new Date().toISOString() };
  const payload = JSON.stringify(full);

  const backlog = backlogByJob.get(event.jobId) ?? [];
  backlog.push(full);
  if (backlog.length > MAX_BACKLOG_PER_JOB) backlog.shift();
  backlogByJob.set(event.jobId, backlog);

  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) client.send(payload);
  }
  return full;
}

export function getEventBacklog(jobId: string): AgentEvent[] {
  return backlogByJob.get(jobId) ?? [];
}
