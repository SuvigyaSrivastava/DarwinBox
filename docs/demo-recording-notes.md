# Demo recording — what to capture

Suggested ~3-4 minute walkthrough:

1. **Upload screen** — show the sample-dataset button, mention the three source files
   have different column names/shapes for the same "employee" entity.
2. **Live activity tab** — click "Try sample dataset," let the feed populate. Point out
   the mix of auto-mapped columns, auto-cleaned records, and escalations appearing
   inline as the agent finds them.
3. **Review queue tab** — walk through one of each escalation type:
   - A **mapping** escalation (e.g. "Contact Email" tied between `email` and
     `manager_email`) — show the two candidates with confidence bars, resolve it by
     clicking "Use email".
   - A **cleaning** escalation (a contractor missing a required field) — type in a
     correct value and save it, or leave it blank, showing the queue count drop live.
   - The **duplicate** escalation ("Sarah Chen" vs "Sara Chen") — show both records
     side by side, resolve as confirmed duplicate.
4. **Records tab** — show the status filter, point out a fully clean auto-resolved
   record (e.g. Sarah Chen, merged from all three source files with a normalized date,
   expanded department code, and stripped phone formatting).
5. **Push** — go back to Live activity, click "Push N ready records," show the push
   attempts streaming in, and manufacture (or simply catch, since it's random) a
   failure to show the retry button working.
6. **Rollback** — click "Roll back last batch" and show the audit trail tab reflecting
   the rollback entries with reasoning.
7. **Audit trail tab** — scroll through, filter by actor, point out that every action
   — agent or human — has a plain-language reason attached.

The recording should show **at least one escalation getting resolved through the UI**
(step 3 covers three).
