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
          Upload your client's raw HR/CRM exports. The agent reconciles multiple files into one dataset, proposes a
          field mapping, cleans values it can safely fix, and only stops you for the calls it can't confidently make.
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
      </div>
    </div>
  );
}
