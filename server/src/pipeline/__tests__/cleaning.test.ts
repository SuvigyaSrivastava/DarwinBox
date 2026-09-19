// Unit tests for the deterministic cleaning/validation logic. This is the
// module that decides, per field per row, whether the agent can safely fix
// something on its own or must escalate — so a silent regression here is
// exactly the kind of bug that would either (a) start guessing on genuinely
// ambiguous dates, corrupting employment records silently, or (b) start
// escalating things it used to handle safely, quietly eroding the whole
// point of the autonomy boundary. Both failure modes are invisible without
// a test suite watching this file specifically.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { cleanFieldValue, compareForDuplicate } from "../cleaning.js";

describe("cleanFieldValue — date handling", () => {
  test("ISO dates pass through unchanged and unambiguous", () => {
    const result = cleanFieldValue("start_date", "2021-03-15");
    assert.equal(result.value, "2021-03-15");
    assert.equal(result.escalate, null);
  });

  test("YYYY/MM/DD normalizes to ISO without escalating (year-first is never ambiguous)", () => {
    const result = cleanFieldValue("start_date", "2018/06/10");
    assert.equal(result.value, "2018-06-10");
    assert.equal(result.escalate, null);
  });

  test("a day component > 12 resolves DD-MM-YYYY unambiguously", () => {
    // 13/04/2023 cannot be month=13, so it must be day=13, month=04.
    const result = cleanFieldValue("start_date", "13/04/2023");
    assert.equal(result.value, "2023-04-13");
    assert.equal(result.escalate, null);
  });

  test("a day component > 12 in the second slot resolves MM-DD-YYYY unambiguously", () => {
    // 08-22-2022: 22 can't be a month, so this must be month=08, day=22.
    const result = cleanFieldValue("start_date", "08-22-2022");
    assert.equal(result.value, "2022-08-22");
    assert.equal(result.escalate, null);
  });

  test("both slots <= 12 is genuinely ambiguous and MUST escalate rather than guess", () => {
    // 03/01/2019 could be March 1 or January 3 — no signal in the value
    // itself disambiguates it. This is the single most important case in
    // the whole cleaning module: guessing wrong here silently corrupts an
    // employment date with no trace, so escalation is mandatory.
    const result = cleanFieldValue("start_date", "03/01/2019");
    assert.equal(result.escalate !== null, true, "ambiguous date must escalate, not guess");
    assert.equal(result.value, "03/01/2019", "value must be left untouched while ambiguous");
  });

  test("an unparseable date string escalates rather than silently passing through", () => {
    const result = cleanFieldValue("start_date", "sometime last spring");
    assert.equal(result.escalate !== null, true);
  });
});

describe("cleanFieldValue — required fields", () => {
  test("a missing required field escalates rather than getting a placeholder", () => {
    const result = cleanFieldValue("email", "");
    assert.equal(result.escalate !== null, true);
    assert.equal(result.value, "");
  });

  test("a missing OPTIONAL field does not escalate", () => {
    const result = cleanFieldValue("phone", "");
    assert.equal(result.escalate, null);
  });
});

describe("cleanFieldValue — enum normalization", () => {
  test("known status variants normalize without escalating", () => {
    assert.equal(cleanFieldValue("employment_status", "Active").value, "active");
    assert.equal(cleanFieldValue("employment_status", "On Leave").value, "on_leave");
    assert.equal(cleanFieldValue("employment_status", "Terminated").escalate, null);
  });

  test("an unrecognized enum value escalates rather than silently keeping garbage", () => {
    const result = cleanFieldValue("employment_status", "Sabbatical");
    assert.equal(result.escalate !== null, true);
  });

  test("known department codes expand deterministically", () => {
    const result = cleanFieldValue("department", "ENG");
    assert.equal(result.value, "Engineering");
    assert.equal(result.escalate, null);
  });
});

describe("cleanFieldValue — email/phone/whitespace", () => {
  test("emails are lowercased", () => {
    assert.equal(cleanFieldValue("email", "Sarah.Chen@AcmeCorp.com").value, "sarah.chen@acmecorp.com");
  });

  test("an invalid email shape escalates", () => {
    const result = cleanFieldValue("email", "not-an-email");
    assert.equal(result.escalate !== null, true);
  });

  test("phone numbers strip non-digit formatting", () => {
    assert.equal(cleanFieldValue("phone", "+1-512-555-0142").value, "+15125550142");
  });

  test("names get whitespace-collapsed and title-cased", () => {
    assert.equal(cleanFieldValue("first_name", "  mark ").value, "Mark");
  });

  test("titleCase never invents an apostrophe the source data didn't have", () => {
    // This is a deliberate design decision, not a limitation to silently
    // fix later — see cleaning.ts's comment on titleCase. Locking it in a
    // test means nobody "fixes" this into a confident guess by accident.
    assert.equal(cleanFieldValue("last_name", "oconnor").value, "Oconnor");
  });
});

describe("compareForDuplicate", () => {
  test("identical email with no conflicting fields is a safe exact match", () => {
    const a = { email: "a@x.com", employee_type: "full_time" };
    const b = { email: "A@x.com", employee_type: "full_time" };
    const result = compareForDuplicate(a, b);
    assert.equal(result?.matchType, "exact");
  });

  test("identical email with a conflicting field escalates as fuzzy, not auto-merged", () => {
    const a = { email: "a@x.com", employee_type: "full_time" };
    const b = { email: "a@x.com", employee_type: "contractor" };
    const result = compareForDuplicate(a, b);
    assert.equal(result?.matchType, "fuzzy");
  });

  test("very close but non-identical names flag as a fuzzy possible-duplicate", () => {
    const a = { first_name: "Sarah", last_name: "Chen" };
    const b = { first_name: "Sara", last_name: "Chen" };
    const result = compareForDuplicate(a, b);
    assert.equal(result?.matchType, "fuzzy");
  });

  test("clearly different names do not flag as duplicates", () => {
    const a = { first_name: "Sarah", last_name: "Chen" };
    const b = { first_name: "Robert", last_name: "Lee" };
    const result = compareForDuplicate(a, b);
    assert.equal(result, null);
  });

  test("exact same name but two different emails flags as a fuzzy possible-duplicate", () => {
    // This is the counterpart to reconcile.ts's decision to keep an
    // exact-name-but-conflicting-email pair as two separate records
    // instead of silently merging on name alone — without this check,
    // those two records would land here with no path to ever surface as
    // related, since it's neither a same-email match nor a near-miss name.
    const a = { first_name: "Aisha", last_name: "Rahman", email: "aisha.rahman@acme.com" };
    const b = { first_name: "Aisha", last_name: "Rahman", email: "a.rahman@acme.com" };
    const result = compareForDuplicate(a, b);
    assert.equal(result?.matchType, "fuzzy");
    assert.match(result!.reason, /different emails/);
  });
});
