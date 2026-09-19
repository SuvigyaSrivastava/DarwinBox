import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { sanitizeRows, assertWithinLimits, SourceFileTooLargeError } from "../sanitize.js";

describe("sanitizeRows — CSV/formula injection guard", () => {
  test("a cell starting with '=' is neutralized with a leading quote", () => {
    const { rows, stats } = sanitizeRows([{ Notes: '=HYPERLINK("http://evil.com","click")' }]);
    assert.equal(rows[0].Notes.startsWith("'"), true);
    assert.equal(stats.neutralizedCells, 1);
  });

  test("cells starting with +, -, or @ that actually look like formulas are neutralized", () => {
    // "+1234" is deliberately excluded here — a bare numeric body after a
    // '+' is exactly the phone-number shape this guard must NOT flag (see
    // the dedicated false-positive test below). "-cmd" and "@SUM(A1)"
    // contain letters/parens, so they read as an actual formula/command.
    const { rows, stats } = sanitizeRows([{ b: "-cmd", c: "@SUM(A1)" }]);
    assert.equal(rows[0].b.startsWith("'"), true);
    assert.equal(rows[0].c.startsWith("'"), true);
    assert.equal(stats.neutralizedCells, 2);
  });

  test("an ordinary value is left completely untouched", () => {
    const { rows, stats } = sanitizeRows([{ name: "Sarah Chen", dept: "Engineering" }]);
    assert.equal(rows[0].name, "Sarah Chen");
    assert.equal(rows[0].dept, "Engineering");
    assert.equal(stats.neutralizedCells, 0);
  });

  test("a plain '=' formula trigger is caught even with a purely numeric/plain body", () => {
    // '=' is unconditionally suspicious — no legitimate business value
    // starts with a literal equals sign, so this doesn't need the
    // formula-body heuristic the +/-/@ prefixes rely on.
    const { rows, stats } = sanitizeRows([{ a: "=45" }]);
    assert.equal(rows[0].a.startsWith("'"), true);
    assert.equal(stats.neutralizedCells, 1);
  });

  test("a real-world phone number starting with '+' is NOT flagged as a false positive", () => {
    // This is the regression this test exists to prevent: an earlier
    // version of this guard flagged every '+'-prefixed cell, which meant
    // ordinary '+1-512-555-0142'-shaped phone numbers (exactly what the
    // sample payroll export contains) tripped the injection guard on
    // every row, burying any real signal in noise.
    const { rows, stats } = sanitizeRows([{ phone: "+1-512-555-0142" }]);
    assert.equal(rows[0].phone, "+1-512-555-0142");
    assert.equal(stats.neutralizedCells, 0);
  });

  test("a plausible negative numeric code starting with '-' is not flagged", () => {
    const { rows, stats } = sanitizeRows([{ code: "-45" }]);
    assert.equal(rows[0].code, "-45");
    assert.equal(stats.neutralizedCells, 0);
  });

  test("a '+'-prefixed value that actually looks like a formula (contains letters/parens) IS flagged", () => {
    const { rows, stats } = sanitizeRows([{ notes: '+HYPERLINK("http://evil.com","click")' }]);
    assert.equal(rows[0].notes.startsWith("'"), true);
    assert.equal(stats.neutralizedCells, 1);
  });

  test("a '-'-prefixed shell-style payload is flagged", () => {
    const { rows, stats } = sanitizeRows([{ notes: "-cmd|'/c calc'!A1" }]);
    assert.equal(rows[0].notes.startsWith("'"), true);
    assert.equal(stats.neutralizedCells, 1);
  });

  test("an '@'-prefixed mention-style formula is flagged, but a bare '@' is not treated as risky text", () => {
    const flagged = sanitizeRows([{ a: "@SUM(A1:A9)" }]);
    assert.equal(flagged.rows[0].a.startsWith("'"), true);

    const plain = sanitizeRows([{ a: "@" }]);
    assert.equal(plain.stats.neutralizedCells, 0);
  });
});

describe("assertWithinLimits", () => {
  test("does not throw for a normal-sized file", () => {
    assert.doesNotThrow(() => assertWithinLimits("test.csv", 100, 10));
  });

  test("throws SourceFileTooLargeError when row count exceeds the cap", () => {
    assert.throws(() => assertWithinLimits("huge.csv", 100_000, 10), SourceFileTooLargeError);
  });

  test("throws SourceFileTooLargeError when column count exceeds the cap", () => {
    assert.throws(() => assertWithinLimits("wide.csv", 10, 500), SourceFileTooLargeError);
  });
});
