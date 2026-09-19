import { useEffect, useState } from "react";
import { api, type AuditEntry } from "../lib/api";

const ACTION_LABEL: Record<string, string> = {
  map_column: "Mapped column",
  reconcile_and_clean: "Reconciled + cleaned",
  resolve_mapping_escalation: "Resolved mapping",
  resolve_cleaning_escalation: "Resolved value",
  confirm_duplicate: "Confirmed duplicate",
  reject_duplicate: "Rejected duplicate",
  resolve_duplicate_custom: "Resolved duplicate",
  auto_merge_duplicate: "Auto-merged duplicate",
  push: "Pushed to target",
  retry: "Retried push",
  rollback: "Rolled back",
};

function formatTime(ts: string) {
  return new Date(ts).toLocaleString([], { hour12: false });
}

export default function AuditLog({ jobId }: { jobId: string }) {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [actorFilter, setActorFilter] = useState<string>("all");

  useEffect(() => {
    api.getAudit(jobId).then(setEntries);
    const interval = setInterval(() => api.getAudit(jobId).then(setEntries), 4000);
    return () => clearInterval(interval);
  }, [jobId]);

  const actors = Array.from(new Set(entries.map((e) => e.actor)));
  const visible = actorFilter === "all" ? entries : entries.filter((e) => e.actor === actorFilter);

  return (
    <div className="card">
      <div style={{ padding: "16px 20px", display: "flex", gap: 8, borderBottom: "1px solid var(--border)" }}>
        <button className={`btn btn-sm ${actorFilter === "all" ? "btn-secondary" : "btn-ghost"}`} onClick={() => setActorFilter("all")}>
          All ({entries.length})
        </button>
        {actors.map((a) => (
          <button key={a} className={`btn btn-sm ${actorFilter === a ? "btn-secondary" : "btn-ghost"}`} onClick={() => setActorFilter(a)}>
            {a} ({entries.filter((e) => e.actor === a).length})
          </button>
        ))}
      </div>
      <table>
        <thead>
          <tr>
            <th>Time</th>
            <th>Actor</th>
            <th>Action</th>
            <th>Reasoning</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((e) => (
            <tr key={e.id}>
              <td className="mono" style={{ fontSize: 11.5, color: "var(--text-faint)", whiteSpace: "nowrap" }}>
                {formatTime(e.created_at)}
              </td>
              <td style={{ fontWeight: e.actor === "agent" ? 400 : 600 }}>{e.actor}</td>
              <td>{ACTION_LABEL[e.action] ?? e.action}</td>
              <td className="audit-row-detail" title={e.reasoning ?? ""}>
                {e.reasoning || "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {visible.length === 0 && <div className="empty-state">No audit entries yet.</div>}
    </div>
  );
}
