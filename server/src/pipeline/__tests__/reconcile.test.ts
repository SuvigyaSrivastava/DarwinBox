import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { reconcileEntities, type RawRecordRef } from "../reconcile.js";
import type { SourceFile } from "../ingest.js";

function file(filename: string, rows: Record<string, string>[]): SourceFile {
  return { filename, columns: Object.keys(rows[0] ?? {}), rows, sanitizeStats: { neutralizedCells: 0, truncatedCells: 0 } };
}

function sourcesOf(entities: ReturnType<typeof reconcileEntities>, hint: string): RawRecordRef[][] {
  return entities.filter((e) => e.identityHint === hint).map((e) => e.sources);
}

describe("reconcileEntities — grouping rows into per-employee entities", () => {
  test("two rows across files with the same explicit ID merge into one entity", () => {
    const files = [
      file("hr.csv", [{ "Emp ID": "E1001", "Full Name": "Sarah Chen" }]),
      file("payroll.csv", [{ personnel_number: "E1001", full_name: "Sarah Chen" }]),
    ];
    const entities = reconcileEntities(files);
    assert.equal(entities.length, 1);
    assert.equal(entities[0].sources.length, 2);
  });

  test("two rows across files with no shared ID but the same email merge into one entity", () => {
    const files = [
      file("hr.csv", [{ "Email Address": "sarah.chen@acme.com", "Full Name": "Sarah Chen" }]),
      file("contractors.csv", [{ "Contact Email": "SARAH.CHEN@acme.com", "Full Name": "Sarah Chen" }]),
    ];
    const entities = reconcileEntities(files);
    assert.equal(entities.length, 1, "case-insensitive email match should merge across files");
  });

  test("two DIFFERENT people who happen to share a full name, with different emails, do NOT silently merge", () => {
    // This is the exact scenario a same-file upload with a "Full Name"
    // column (and no ID column) can produce: identical names, genuinely
    // different people (or a re-hire / corrected email for the same
    // person) — either way, the agent must not guess by silently keeping
    // only one email and discarding the other. It should stay two
    // separate entities so duplicate-detection gets a chance to ask.
    const files = [
      file("new_hires.csv", [
        { "Full Name": "Aisha Rahman", "Work Email": "aisha.rahman@acme.com" },
        { "Full Name": "Aisha Rahman", "Work Email": "a.rahman@acme.com" },
      ]),
    ];
    const entities = reconcileEntities(files);
    assert.equal(entities.length, 2, "should split into two entities instead of merging on name alone");

    const emails = entities.map((e) => {
      const row = e.sources[0].data;
      return (row["Work Email"] ?? "").toLowerCase();
    });
    assert.deepEqual(new Set(emails), new Set(["aisha.rahman@acme.com", "a.rahman@acme.com"]));
  });

  test("rows sharing a name AND the same email still merge into one entity (not over-split)", () => {
    // Guards against overcorrecting: the same person appearing twice with
    // the SAME email (e.g. listed in two sections of one export) should
    // still merge normally — only a genuine email conflict should split.
    const files = [
      file("export.csv", [
        { "Full Name": "Jordan Lee", "Work Email": "jordan.lee@acme.com" },
        { "Full Name": "Jordan Lee", "Work Email": "jordan.lee@acme.com" },
      ]),
    ];
    const entities = reconcileEntities(files);
    assert.equal(entities.length, 1);
    assert.equal(entities[0].sources.length, 2);
  });

  test("a name-only row with no email at all does not get split away from its email-bearing namesake row incorrectly", () => {
    // One row has an email, the other (same name) has none. There's no
    // conflicting evidence here, so this should NOT split — the no-email
    // row is folded in as an additional source for the same entity.
    const files = [
      file("export.csv", [
        { "Full Name": "Priya Nair", "Work Email": "priya.nair@acme.com" },
        { "Full Name": "Priya Nair", "Work Email": "" },
      ]),
    ];
    const entities = reconcileEntities(files);
    assert.equal(entities.length, 1, "a row with no email should not force a split when there's no conflicting email");
  });

  test("an ID-based match is never split apart by differing emails (ID is stronger evidence than email)", () => {
    const files = [
      file("hr.csv", [{ "Emp ID": "E2002", "Full Name": "Sam Osei", "Email Address": "sam.osei@acme.com" }]),
      file("payroll.csv", [{ personnel_number: "E2002", full_name: "Sam Osei", work_email: "s.osei@acme.com" }]),
    ];
    const entities = reconcileEntities(files);
    assert.equal(entities.length, 1, "matching explicit IDs should merge even if emails differ across systems");
  });
});
