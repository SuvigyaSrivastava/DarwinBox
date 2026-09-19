import { useEffect, useRef, useState } from "react";
import { api, type AgentEvent, type Escalation, type JobRecord } from "../lib/api";

const ICONS: Record<string, { icon: string; bg: string; color: string }> = {
  job_started: { icon: "▶", bg: "#f4f4f5", color: "#52525b" },
  file_ingested: { icon: "📄", bg: "#eff6ff", color: "#2563eb" },
  column_mapped: { icon: "✓", bg: "#f0fdf4", color: "#16a34a" },
  column_escalated: { icon: "?", bg: "#fffbeb", color: "#d97706" },
  record_ready: { icon: "✓", bg: "#f0fdf4", color: "#16a34a" },
  record_escalated: { icon: "?", bg: "#fffbeb", color: "#d97706" },
  duplicate_escalated: { icon: "⧉", bg: "#f5f3ff", color: "#7c3aed" },
  push_attempt: { icon: "↑", bg: "#f4f4f5", color: "#52525b" },
  push_success: { icon: "✓", bg: "#f0fdf4", color: "#16a34a" },
  push_failed: { icon: "✕", bg: "#fef2f2", color: "#dc2626" },
  retry: { icon: "↻", bg: "#fffbeb", color: "#d97706" },
  rollback: { icon: "↺", bg: "#fef2f2", color: "#dc2626" },
  job_status: { icon: "•", bg: "#f4f4f5", color: "#71717a" },
  escalation_resolved: { icon: "✓", bg: "#f0fdf4", color: "#16a34a" },
};

function formatTime(ts: string) {
  return new Date(ts).toLocaleTimeString([], { hour12: false });
}

export default function ActivityFeed({
  events,
  records,
  escalations,
  jobId,
  jobStatus,
  onPushed,
}: {
  events: AgentEvent[];
  records: JobRecord[];
  escalations: Escalation[];
  jobId: string;
  jobStatus: string;
  onPushed: () => void;
}) {
  const feedRef = useRef<HTMLDivElement>(null);
  const [pushing, setPushing] = useState(false);
  const [pushResult, setPushResult] = useState<{ pushed: number; failed: number; skipped: number; batchId: string } | null>(null);

  useEffect(() => {
    if (feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight;
  }, [events]);

  const ready = records.filter((r) => r.status === "ready").length;
  const needsReview = records.filter((r) => r.status === "needs_review").length;
  const pushed = records.filter((r) => r.status === "pushed").length;
  const failed = records.filter((r) => r.status === "failed").length;
  const openEscalations = escalations.filter((e) => e.status === "open").length;

  async function handlePush() {
    setPushing(true);
    try {
      const result = await api.push(jobId);
      setPushResult(result);
      onPushed();
    } finally {
      setPushing(false);
    }
  }

  async function handleRetry() {
    setPushing(true);
    try {
      const result = await api.retry(jobId);
      setPushResult(result);
      onPushed();
    } finally {
      setPushing(false);
    }
  }

  async function handleRollback() {
    if (!pushResult) return;
    await api.rollback(jobId, pushResult.batchId, "Priya (Consultant)");
    onPushed();
  }

  const canPush = jobStatus === "ready_to_push" || jobStatus === "done";

  return (
    <div>
      <div className="stat-row">
        <div className="stat-card accent">
          <div className="stat-value">{ready}</div>
          <div className="stat-label">Ready to push</div>
        </div>
        <div className="stat-card amber">
          <div className="stat-value">{needsReview}</div>
          <div className="stat-label">Needs review</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{pushed}</div>
          <div className="stat-label">Pushed to target</div>
        </div>
        <div className="stat-card red">
          <div className="stat-value">{failed}</div>
          <div className="stat-label">Failed pushes</div>
        </div>
      </div>

      <div className="grid-2">
        <div className="card" style={{ padding: 20 }}>
          <div className="section-title">Push to target system</div>
          {openEscalations > 0 && (
            <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 14 }}>
              {openEscalations} record{openEscalations === 1 ? "" : "s"} still {openEscalations === 1 ? "has" : "have"} an open
              escalation and will be held back from the push.
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <button className="btn btn-primary" disabled={!canPush || pushing || ready === 0} onClick={handlePush}>
              {pushing ? <span className="spinner" /> : null}
              Push {ready} ready record{ready === 1 ? "" : "s"}
            </button>
            {failed > 0 && (
              <button className="btn btn-secondary" disabled={pushing} onClick={handleRetry}>
                Retry {failed} failed
              </button>
            )}
            {pushResult && pushResult.pushed > 0 && (
              <button className="btn btn-ghost btn-sm" onClick={handleRollback}>
                Roll back last batch ({pushResult.pushed} records)
              </button>
            )}
          </div>

          {pushResult && (
            <div style={{ marginTop: 16, fontSize: 12.5, color: "var(--text-muted)", borderTop: "1px solid var(--border)", paddingTop: 12 }}>
              Last push: <b style={{ color: "var(--text)" }}>{pushResult.pushed}</b> succeeded,{" "}
              <b style={{ color: "var(--text)" }}>{pushResult.failed}</b> failed,{" "}
              <b style={{ color: "var(--text)" }}>{pushResult.skipped}</b> held for review
              <div className="mono" style={{ marginTop: 4, fontSize: 11 }}>batch {pushResult.batchId}</div>
            </div>
          )}

          {pushResult && (
            <div className="whats-next">
              <div className="whats-next-title">What's next</div>
              {openEscalations > 0 ? (
                <>Resolve the {openEscalations} open case{openEscalations === 1 ? "" : "s"} in the Review queue, then push again to send them through.</>
              ) : pushResult.failed > 0 ? (
                <>{pushResult.failed} record{pushResult.failed === 1 ? "" : "s"} failed on a transient error — click "Retry failed" above, or check the Audit trail for details.</>
              ) : (
                <>Everything's through. Check the Audit trail for a full record of what changed and why.</>
              )}
            </div>
          )}
        </div>

        <div className="card" style={{ padding: 20 }}>
          <div className="section-title">Live activity</div>
          <div className="feed" ref={feedRef}>
            {events.length === 0 && <div className="feed-empty">Waiting for agent activity…</div>}
            {events.map((evt, i) => {
              const style = ICONS[evt.type] ?? { icon: "•", bg: "#f4f4f5", color: "#71717a" };
              return (
                <div className="feed-item" key={i}>
                  <div className="feed-icon" style={{ background: style.bg, color: style.color }}>
                    {style.icon}
                  </div>
                  <div className="feed-message">{evt.message}</div>
                  <div className="feed-time">{formatTime(evt.timestamp)}</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
