import { useRef, useState } from "react";
import { api } from "../lib/api";

export default function UploadScreen({
  onJobStarted,
  llmAvailable,
}: {
  onJobStarted: (jobId: string) => void;
  llmAvailable: boolean | null;
}) {
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function startWithFiles(files: FileList) {
    setLoading(true);
    setError(null);
    try {
      const { jobId } = await api.uploadFiles(files);
      onJobStarted(jobId);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function startWithSample() {
    setLoading(true);
    setError(null);
    try {
      const { jobId } = await api.runSample();
      onJobStarted(jobId);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="app-shell">
      <div className="topbar" style={{ borderBottom: "none" }}>
        <div className="brand">
          <div className="brand-mark">D</div>
          Darwin Migration Agent
        </div>
        {llmAvailable === false && (
          <span className="badge" title="Set GROQ_API_KEY in server/.env for LLM-backed mapping">
            Heuristic mode
          </span>
        )}
      </div>

      <div className="hero">
        <h1>Migrate client data without babysitting it</h1>
        <p>
          Add the client's raw HR exports below. From there, the agent takes over — you'll only be asked to weigh in
          on the handful of cases it genuinely can't decide on its own.
        </p>

        <div
          className={`dropzone ${dragging ? "active" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            if (e.dataTransfer.files.length) startWithFiles(e.dataTransfer.files);
          }}
        >
          <div style={{ fontSize: 28, marginBottom: 10 }}>📂</div>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Drop CSV or Excel exports here</div>
          <div style={{ color: "var(--text-muted)", fontSize: 13, marginBottom: 20 }}>
            Multiple files representing the same entity (e.g. employees) are supported
          </div>

          <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
            <button className="btn btn-primary" disabled={loading} onClick={() => inputRef.current?.click()}>
              {loading ? <span className="spinner" /> : null}
              Choose files
            </button>
            <button className="btn btn-secondary" disabled={loading} onClick={startWithSample}>
              Try sample dataset
            </button>
          </div>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept=".csv,.xlsx,.xls"
            style={{ display: "none" }}
            onChange={(e) => e.target.files && startWithFiles(e.target.files)}
          />
        </div>

        {error && (
          <div style={{ color: "var(--red)", marginTop: 16, fontSize: 13 }}>
            {error}
          </div>
        )}

        <div className="expect-panel">
          <div className="expect-panel-title">What you'll get</div>
          <ul className="expect-list">
            <li>
              <span className="check">✓</span>
              One reconciled dataset, even if your files use different column names, date formats, or department
              codes for the same people.
            </li>
            <li>
              <span className="check">✓</span>
              Automatic cleanup — dates normalized, duplicates merged, obvious formatting fixed — with nothing
              guessed on anything that mattered.
            </li>
            <li>
              <span className="check">✓</span>
              A short review queue with only the calls the agent couldn't confidently make on its own, each with
              enough context to resolve in one glance.
            </li>
            <li>
              <span className="check">✓</span>
              A full record of what changed and why, so "why did this happen" is always answerable later.
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
