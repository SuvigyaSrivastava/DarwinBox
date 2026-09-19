import { useCallback, useEffect, useState } from "react";
import { api, connectEvents, type AgentEvent, type Escalation, type JobRecord } from "./lib/api";
import UploadScreen from "./components/UploadScreen";
import ActivityFeed from "./components/ActivityFeed";
import EscalationQueue from "./components/EscalationQueue";
import RecordsTable from "./components/RecordsTable";
import AuditLog from "./components/AuditLog";
import PipelineStatus from "./components/PipelineStatus";

type Tab = "overview" | "escalations" | "records" | "audit";

export default function App() {
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<string>("idle");
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [escalations, setEscalations] = useState<Escalation[]>([]);
  const [records, setRecords] = useState<JobRecord[]>([]);
  const [tab, setTab] = useState<Tab>("overview");
  const [llmAvailable, setLlmAvailable] = useState<boolean | null>(null);
  const [clientId, setClientId] = useState<string | null>(null);
  const [learnedCount, setLearnedCount] = useState<number>(0);

  useEffect(() => {
    api.getSchema().then((s) => setLlmAvailable(s.llmAvailable)).catch(() => {});
  }, []);

  const refresh = useCallback(async (id: string) => {
    const [job, esc, recs] = await Promise.all([api.getJob(id), api.getEscalations(id), api.getRecords(id)]);
    setJobStatus(job.status);
    setEscalations(esc);
    setRecords(recs);
    setClientId(job.client_id);
    try {
      const overrides = await api.getMappingOverrides(job.client_id);
      // Count overrides this job's run actually benefited from (reused at
      // least once), not just how many exist for the client in general.
      setLearnedCount(overrides.filter((o) => o.times_reused > 0).length);
    } catch {
      // non-critical — the badge just won't show a count
    }
  }, []);

  useEffect(() => {
    if (!jobId) return;
    const unsub = connectEvents((evt) => {
      if (evt.jobId !== jobId) return;
      setEvents((prev) => [...prev, evt].slice(-300));
      // Refresh derived state on any structural event.
      if (
        evt.type === "job_status" ||
        evt.type === "column_escalated" ||
        evt.type === "record_escalated" ||
        evt.type === "duplicate_escalated" ||
        evt.type === "record_ready" ||
        evt.type === "escalation_resolved" ||
        evt.type === "push_success" ||
        evt.type === "push_failed" ||
        evt.type === "rollback"
      ) {
        refresh(jobId);
      }
    });
    return unsub;
  }, [jobId, refresh]);

  const handleJobStarted = useCallback(
    async (id: string) => {
      setJobId(id);
      setTab("overview");
      const backlog = await api.getEventBacklog(id);
      setEvents(backlog);
      await refresh(id);
    },
    [refresh],
  );

  const openEscalations = escalations.filter((e) => e.status === "open");

  if (!jobId) {
    return <UploadScreen onJobStarted={handleJobStarted} llmAvailable={llmAvailable} />;
  }

  return (
    <div className="app-shell">
      <div className="topbar">
        <div className="brand">
          <div className="brand-mark">D</div>
          Darwin Migration Agent
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {clientId && (
            <span className="badge" title={`Scoped to client "${clientId}" — mapping decisions this consultant confirms are remembered for this client's future files`}>
              client: {clientId}
            </span>
          )}
          {learnedCount > 0 && (
            <span className="badge" style={{ color: "var(--accent)", borderColor: "var(--accent-border)", background: "var(--accent-soft)" }} title="Column mappings applied automatically because a consultant confirmed them on a prior run for this client">
              {learnedCount} learned mapping{learnedCount === 1 ? "" : "s"}
            </span>
          )}
          {llmAvailable === false && (
            <span className="badge" title="No GROQ_API_KEY configured — using deterministic heuristic mapping">
              Heuristic mode
            </span>
          )}
          <span className={`badge ${jobStatus !== "done" ? "live" : ""}`}>
            <span className="badge-dot" />
            {jobStatus}
          </span>
          <button className="btn btn-ghost btn-sm" onClick={() => setJobId(null)}>
            New job
          </button>
        </div>
      </div>

      <PipelineStatus status={jobStatus} />

      <div className="tabs">
        <button className={`tab ${tab === "overview" ? "active" : ""}`} onClick={() => setTab("overview")}>
          Live activity
        </button>
        <button className={`tab ${tab === "escalations" ? "active" : ""}`} onClick={() => setTab("escalations")}>
          Review queue
          {openEscalations.length > 0 && <span className="tab-count attn">{openEscalations.length}</span>}
        </button>
        <button className={`tab ${tab === "records" ? "active" : ""}`} onClick={() => setTab("records")}>
          Records
          <span className="tab-count">{records.length}</span>
        </button>
        <button className={`tab ${tab === "audit" ? "active" : ""}`} onClick={() => setTab("audit")}>
          Audit trail
        </button>
      </div>

      {tab === "overview" && (
        <ActivityFeed
          events={events}
          records={records}
          escalations={escalations}
          jobId={jobId}
          jobStatus={jobStatus}
          onPushed={() => refresh(jobId)}
        />
      )}
      {tab === "escalations" && (
        <EscalationQueue escalations={openEscalations} onResolved={() => refresh(jobId)} />
      )}
      {tab === "records" && <RecordsTable records={records} jobId={jobId} onChanged={() => refresh(jobId)} />}
      {tab === "audit" && <AuditLog jobId={jobId} />}

      <div className="footer-note">Darwin — Forward Deployed Engineer take-home · client data migration agent</div>
    </div>
  );
}
