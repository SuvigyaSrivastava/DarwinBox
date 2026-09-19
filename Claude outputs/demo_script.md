# Darwin — 2-minute demo script

Record in one take against the live site. Say the bracketed lines close to verbatim;
narrate the rest naturally.

---

**[0:00–0:15] Frame it**

> "Darwin migrates a client's HR data from messy source exports into a target
> schema. The core idea: it handles anything it can be genuinely confident about on
> its own, and only stops me for the calls a human would also have had to think
> about — never everything, never nothing."

*(Show the upload screen briefly — point at the "What you'll get" panel.)*

---

**[0:15–0:40] Run it**

Click **Try sample dataset**.

> "Three source files, three different schemas — different column names, different
> date formats, different department codes — for the same set of employees."

Let the live feed run for a few seconds. Point at one line:

> "Here — it caught a formula-injection payload in a free-text Notes column and
> neutralized it automatically. That's the same class of vulnerability that hits
> Excel exports."

---

**[0:40–1:20] The escalation boundary — the actual point of this project**

Switch to **Review queue**.

> "26 things needed a human decision here. Not because the agent gave up — because
> each one is a case where guessing wrong would silently corrupt data."

Resolve **one of each type**, narrating in one sentence each:

1. **Mapping** ("Contact Email"): *"This column scored almost identically for
   `email` and `manager_email` — not just low confidence, a genuine tie. I approve
   the recommended one."*
2. **Cleaning** (a missing required field): *"No safe default exists, so it asks
   rather than guesses — a placeholder in an HR record is worse than an honest
   gap."*
3. **Duplicate** (Sarah Chen / Sara Chen): *"Edit distance of one — could be a
   misspelling, could be two people. Collapsing them wrongly is worse than asking
   once."*

---

**[1:20–1:40] Push, and the safety rails**

Click **Push**.

> "It pushes what's ready, retries transient failures automatically, and holds
> back anything still under review — nothing reaches the target system with an
> open escalation against it."

Point at one retry-then-fail line in the feed if one shows up.

---

**[1:40–2:00] Close**

Switch to **Audit trail**, scroll briefly.

> "Every decision — the agent's and mine — is logged with a plain-language reason,
> so 'why did this happen' is always answerable later. This is deployed live —
> link's in the README — along with a one-page write-up on exactly how I drew this
> escalation boundary, and what I'd build next for a real engagement."

*(End.)*

---

## If you have an extra 20–30 seconds

Show the **"N learned mappings"** badge after running the sample dataset a second
time — concrete before/after evidence (26 → 15 escalations) that the agent gets
cheaper to run for a client over repeated use, not just a claim.

## Things to have ready before hitting record

- Fresh browser tab, live URL loaded, nothing already run (so "Try sample dataset"
  is the first real action on camera).
- Know the Render free-tier cold-start note — if the first click is slow, don't
  panic-narrate it, just wait a beat; it's already explained in the README.
- Decide in advance which escalation of each type you'll click — don't hunt for
  one on camera.
