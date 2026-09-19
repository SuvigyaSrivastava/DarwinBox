const STEPS = [
  {
    key: "ingesting",
    label: "Ingest",
    who: "agent",
    explain: "Reading your source files and lining up the columns that describe the same people.",
  },
  {
    key: "mapping",
    label: "Map fields",
    who: "agent",
    explain: "Working out which source column goes to which target field — anything genuinely ambiguous will wait for you in the review queue.",
  },
  {
    key: "cleaning",
    label: "Clean & reconcile",
    who: "agent",
    explain: "Normalizing dates, fixing formatting, merging obvious duplicates, and combining each person's records from every file into one.",
  },
  {
    key: "ready_to_push",
    label: "Review",
    who: "you",
    explain: "Everything the agent couldn't confidently decide on its own is waiting in the review queue below — resolve those, then push.",
  },
  {
    key: "pushing",
    label: "Push",
    who: "agent",
    explain: "Sending each ready record to the target system, retrying anything that fails transiently.",
  },
  {
    key: "done",
    label: "Done",
    who: "agent",
    explain: "Migration complete. Check the Records and Audit tabs for a full account of what happened.",
  },
];

export default function PipelineStatus({ status }: { status: string }) {
  const currentIdx = STEPS.findIndex((s) => s.key === status);
  const current = STEPS[currentIdx];

  return (
    <div>
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
      {current && (
        <div className="pipeline-explainer">
          <span className={`who ${current.who === "you" ? "you" : ""}`}>
            {current.who === "you" ? "Needs you" : "Agent"}
          </span>
          {current.explain}
        </div>
      )}
    </div>
  );
}
