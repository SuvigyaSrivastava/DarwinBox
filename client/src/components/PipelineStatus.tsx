const STEPS = [
  { key: "ingesting", label: "Ingest" },
  { key: "mapping", label: "Map fields" },
  { key: "cleaning", label: "Clean & reconcile" },
  { key: "ready_to_push", label: "Review" },
  { key: "pushing", label: "Push" },
  { key: "done", label: "Done" },
];

export default function PipelineStatus({ status }: { status: string }) {
  const currentIdx = STEPS.findIndex((s) => s.key === status);

  return (
    <div className="pipeline-steps">
      {STEPS.map((step, i) => {
        const state = i < currentIdx ? "done" : i === currentIdx ? "active" : "";
        return (
          <div key={step.key} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div className={`pipeline-step ${state}`}>
              {state === "done" ? "✓ " : ""}
              {step.label}
            </div>
            {i < STEPS.length - 1 && <span className="pipeline-arrow">→</span>}
          </div>
        );
      })}
    </div>
  );
}
