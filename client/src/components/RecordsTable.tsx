import { useState } from "react";
import type { JobRecord } from "../lib/api";

const STATUS_LABEL: Record<string, string> = {
  ready: "Ready",
  needs_review: "Needs review",
  pushed: "Pushed",
  failed: "Failed",
  rolled_back: "Rolled back",
};

export default function RecordsTable({ records }: { records: JobRecord[]; jobId: string; onChanged: () => void }) {
  const [filter, setFilter] = useState<string>("all");

  const visible = filter === "all" ? records : records.filter((r) => r.status === filter);
  const statuses = Array.from(new Set(records.map((r) => r.status)));

  return (
    <div className="card">
      <div style={{ padding: "16px 20px", display: "flex", gap: 8, borderBottom: "1px solid var(--border)" }}>
        <button className={`btn btn-sm ${filter === "all" ? "btn-secondary" : "btn-ghost"}`} onClick={() => setFilter("all")}>
          All ({records.length})
        </button>
        {statuses.map((s) => (
          <button key={s} className={`btn btn-sm ${filter === s ? "btn-secondary" : "btn-ghost"}`} onClick={() => setFilter(s)}>
            {STATUS_LABEL[s] ?? s} ({records.filter((r) => r.status === s).length})
          </button>
        ))}
      </div>
      <table>
        <thead>
          <tr>
            <th>Employee</th>
            <th>Department</th>
            <th>Title</th>
            <th>Status</th>
            <th>Sources</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((r) => (
            <tr key={r.id}>
              <td>
                <div className="identity-cell">
                  {r.data.first_name} {r.data.last_name}
                </div>
                <div className="identity-sub mono">{r.data.email || "—"}</div>
              </td>
              <td>{r.data.department || <span style={{ color: "var(--text-faint)" }}>—</span>}</td>
              <td>{r.data.job_title || <span style={{ color: "var(--text-faint)" }}>—</span>}</td>
              <td>
                <span className={`status-pill ${r.status}`}>{STATUS_LABEL[r.status] ?? r.status}</span>
              </td>
              <td style={{ fontSize: 12, color: "var(--text-muted)" }}>{r.sourceFiles.join(", ")}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {visible.length === 0 && <div className="empty-state">No records in this view.</div>}
    </div>
  );
}
