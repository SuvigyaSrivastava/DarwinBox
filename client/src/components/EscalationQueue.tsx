import { useState } from "react";
import { api, type Escalation } from "../lib/api";

const CONSULTANT = "Priya (Consultant)";

function ConfidenceBar({ value }: { value: number }) {
  return (
    <div className="confidence-bar">
      <div className={`confidence-fill ${value < 0.75 ? "low" : ""}`} style={{ width: `${Math.round(value * 100)}%` }} />
    </div>
  );
}

function MappingEscalation({ esc, onResolved }: { esc: Escalation; onResolved: () => void }) {
  const [busy, setBusy] = useState(false);
  const [customField, setCustomField] = useState("");
  const { sourceColumn, sourceFile, candidates, sampleValues } = esc.context;

  async function act(action: string, correction?: any) {
    setBusy(true);
    try {
      await api.resolveEscalation(esc.id, action, CONSULTANT, correction);
      onResolved();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="escalation-card">
      <div className="escalation-header">
        <div>
          <div className="escalation-title">
            Column "<span className="mono">{sourceColumn}</span>" could map to more than one field
          </div>
          <div className="escalation-meta">from {sourceFile}</div>
        </div>
        <span className="type-pill mapping">Mapping</span>
      </div>

      <div className="escalation-context">
        <b>Sample values:</b> {sampleValues?.slice(0, 4).join(", ") || "—"}
      </div>

      {candidates.map((c: any, i: number) => (
        <div className="candidate-row" key={i}>
          <span className="candidate-field">{c.targetField}</span>
          <div style={{ display: "flex", alignItems: "center", flex: 1, justifyContent: "flex-end" }}>
            <span style={{ fontSize: 12, color: "var(--text-muted)", marginRight: 10 }}>{c.reasoning}</span>
            <ConfidenceBar value={c.confidence} />
            <span className="confidence-label">{Math.round(c.confidence * 100)}%</span>
          </div>
        </div>
      ))}

      <div className="escalation-actions" style={{ marginTop: 12 }}>
        <button className="btn btn-approve btn-sm" disabled={busy} onClick={() => act("approve")}>
          Use "{candidates[0]?.targetField}"
        </button>
        <input
          className="correction-input"
          placeholder="or type the correct target field key…"
          value={customField}
          onChange={(e) => setCustomField(e.target.value)}
        />
        <button
          className="btn btn-secondary btn-sm"
          disabled={busy || !customField}
          onClick={() => act("correct", { field: customField })}
        >
          Set field
        </button>
        <button className="btn btn-reject btn-sm" disabled={busy} onClick={() => act("reject")}>
          Leave unmapped
        </button>
      </div>
    </div>
  );
}

function CleaningEscalation({ esc, onResolved }: { esc: Escalation; onResolved: () => void }) {
  const [busy, setBusy] = useState(false);
  const [value, setValue] = useState("");
  const { field, rawValue, reason, identityHint, sources } = esc.context;

  async function act(action: string, correction?: any) {
    setBusy(true);
    try {
      await api.resolveEscalation(esc.id, action, CONSULTANT, correction);
      onResolved();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="escalation-card">
      <div className="escalation-header">
        <div>
          <div className="escalation-title">
            {esc.title}
          </div>
          <div className="escalation-meta">
            {identityHint} · from {sources?.join(", ")}
          </div>
        </div>
        <span className="type-pill cleaning">Cleaning</span>
      </div>

      <div className="escalation-context">
        <b>Field:</b> <span className="mono">{field}</span> &nbsp;·&nbsp; <b>Raw value:</b>{" "}
        <span className="mono">{rawValue || "(empty)"}</span>
        <br />
        {reason}
      </div>

      <div className="escalation-actions">
        <input
          className="correction-input"
          placeholder="Enter the correct value…"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <button className="btn btn-approve btn-sm" disabled={busy || !value} onClick={() => act("correct", { value })}>
          Save value
        </button>
        <button className="btn btn-reject btn-sm" disabled={busy} onClick={() => act("reject")}>
          Leave blank
        </button>
      </div>
    </div>
  );
}

function DuplicateEscalation({ esc, onResolved }: { esc: Escalation; onResolved: () => void }) {
  const [busy, setBusy] = useState(false);
  const { recordA, recordB, reason } = esc.context;

  async function act(action: string, correction?: any) {
    setBusy(true);
    try {
      await api.resolveEscalation(esc.id, action, CONSULTANT, correction);
      onResolved();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="escalation-card">
      <div className="escalation-header">
        <div>
          <div className="escalation-title">{esc.title}</div>
        </div>
        <span className="type-pill duplicate">Duplicate</span>
      </div>

      <div className="escalation-context">{reason}</div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
        {[recordA, recordB].map((r, i) => (
          <div key={i} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 12, fontSize: 12.5 }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>
              {r.data.first_name} {r.data.last_name}
            </div>
            <div className="mono" style={{ color: "var(--text-muted)", lineHeight: 1.8 }}>
              {r.data.email || "(no email)"}
              <br />
              {r.data.department} · {r.data.job_title}
              <br />
              {r.data.employee_type}
            </div>
          </div>
        ))}
      </div>

      <div className="escalation-actions">
        <button className="btn btn-approve btn-sm" disabled={busy} onClick={() => act("approve")}>
          Confirm duplicate — keep first
        </button>
        <button
          className="btn btn-secondary btn-sm"
          disabled={busy}
          onClick={() => act("correct", { value: recordA.id })}
        >
          Keep second, drop first
        </button>
        <button className="btn btn-reject btn-sm" disabled={busy} onClick={() => act("reject")}>
          Not duplicates — keep both
        </button>
      </div>
    </div>
  );
}

export default function EscalationQueue({ escalations, onResolved }: { escalations: Escalation[]; onResolved: () => void }) {
  if (escalations.length === 0) {
    return (
      <div className="card empty-state">
        <div className="empty-state-icon">✓</div>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>Nothing needs your attention</div>
        <div style={{ fontSize: 13 }}>The agent resolved everything else on its own.</div>
      </div>
    );
  }

  return (
    <div>
      {escalations.map((esc) => {
        if (esc.type === "mapping") return <MappingEscalation key={esc.id} esc={esc} onResolved={onResolved} />;
        if (esc.type === "cleaning") return <CleaningEscalation key={esc.id} esc={esc} onResolved={onResolved} />;
        if (esc.type === "duplicate") return <DuplicateEscalation key={esc.id} esc={esc} onResolved={onResolved} />;
        return null;
      })}
    </div>
  );
}
