import { readFileSync } from "fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { availabilityIssues, overlapIssues } from "@/lib/availability";
import { inPeriod, monthOf, peakForPlanning, peakOf, quarterOf, sprintOf } from "@/lib/plan";
import {
  b2cOutcomeLabel, b2cOutcomeReached, guessContactTag, guessEmailTag, guessPhoneTag, phoneTagsFor,
} from "@/lib/types";
import { emailDomainIssue } from "@/lib/email-check";

/** Jules's third batch (v37.13): the pure helpers it flagged that really had
 *  no test, the two bugs found while writing them, and pins for the fixes. */

describe("availability overlaps — every clashing row is marked", () => {
  it("marks a window inside an EARLIER long one, not only the neighbour", () => {
    // sorted by start: 09–17, 10–11, 12–13. The third never touches the
    // second, but sits inside the first — it used to go unmarked
    const issues = overlapIssues([
      { day: 0, from: "09:00", to: "17:00" },
      { day: 0, from: "10:00", to: "11:00" },
      { day: 0, from: "12:00", to: "13:00" },
    ]);
    expect(issues.has(0)).toBe(false);
    expect(issues.get(1)).toContain("9:00 AM");
    expect(issues.get(2)).toContain("9:00 AM");
  });

  it("lets back-to-back windows touch without clashing", () => {
    expect(
      overlapIssues([
        { day: 2, from: "09:00", to: "10:00" },
        { day: 2, from: "10:00", to: "11:00" },
      ]).size
    ).toBe(0);
  });

  it("treats a window ending at midnight as the latest, not the earliest", () => {
    const issues = overlapIssues([
      { day: 4, from: "22:00", to: "00:00" },
      { day: 4, from: "23:00", to: "23:30" },
    ]);
    expect(issues.get(1)).toContain("10:00 PM");
  });

  it("checks a one-off date against that weekday's weekly windows, as the server does", () => {
    // 2026-10-17 is a Saturday (day 6)
    const issues = availabilityIssues([
      { day: 6, from: "18:00", to: "21:00" },
      { date: "2026-10-17", from: "20:00", to: "22:00" },
    ]);
    expect(issues.has(0)).toBe(false);
    expect(issues.get(1)).toContain("weekly Saturday");
  });

  it("but not against another weekday's windows", () => {
    expect(
      availabilityIssues([
        { day: 5, from: "18:00", to: "21:00" },
        { date: "2026-10-17", from: "18:00", to: "21:00" },
      ]).size
    ).toBe(0);
  });

  it("leaves a broken row to report its own problem", () => {
    const issues = availabilityIssues([
      { day: 1, from: "18:00", to: "21:00" },
      { day: 1, from: "", to: "20:00" },
    ]);
    expect(issues.get(1)).toContain("start");
  });
});

describe("planning calendar — months, quarters, peaks", () => {
  it("monthOf knows a leap February", () => {
    const m = monthOf(new Date("2028-02-10T10:00:00Z"));
    expect(m.start).toBe("2028-02-01");
    expect(m.end).toBe("2028-02-29");
    expect(m.label).toBe("February 2028");
    expect(m.planKeys).toEqual(["2028-02-01"]);
  });

  it("reads the Cairo day, not the UTC one, right after Cairo midnight", () => {
    // 22:30 UTC on 31 July is already 1 August in Cairo
    const at = new Date("2026-07-31T22:30:00Z");
    expect(monthOf(at).start).toBe("2026-08-01");
    expect(peakOf(at).name).toBe("winter");
  });

  it("quarterOf wraps January into the previous term's Q4", () => {
    const q = quarterOf(new Date("2027-01-15T10:00:00Z"));
    expect(q.q).toBe(4);
    expect(q.start).toBe("2026-11-01");
    expect(q.end).toBe("2027-01-31");
    expect(q.planKeys).toEqual(["2026-11-01", "2026-12-01", "2027-01-01"]);
  });

  it("quarterOf lays the term out Feb–Apr, May–Jul, Aug–Oct", () => {
    expect(quarterOf(new Date("2026-02-01T10:00:00Z"))).toMatchObject({
      q: 1, start: "2026-02-01", end: "2026-04-30",
    });
    expect(quarterOf(new Date("2026-07-20T10:00:00Z"))).toMatchObject({
      q: 2, start: "2026-05-01", end: "2026-07-31",
    });
    expect(quarterOf(new Date("2026-10-01T10:00:00Z"))).toMatchObject({
      q: 3, start: "2026-08-01", end: "2026-10-31",
    });
  });

  it("peakOf puts January in the winter that started the August before", () => {
    const p = peakOf(new Date("2027-01-10T10:00:00Z"));
    expect(p.name).toBe("winter");
    expect(p.start).toBe("2026-08-01");
    expect(p.end).toBe("2027-01-31");
    expect(p.months).toHaveLength(6);
    expect(p.label).toBe("Winter peak (Aug 2026 – Jan 2027)");
  });

  it("peakOf puts March in that year's summer", () => {
    const p = peakOf(new Date("2026-03-10T10:00:00Z"));
    expect(p).toMatchObject({ name: "summer", start: "2026-02-01", end: "2026-07-31" });
  });

  it("peakForPlanning skips to the NEXT peak in a peak's last month", () => {
    expect(peakForPlanning(new Date("2026-07-15T10:00:00Z"))).toMatchObject({
      name: "winter", start: "2026-08-01",
    });
    expect(peakForPlanning(new Date("2027-01-15T10:00:00Z"))).toMatchObject({
      name: "summer", start: "2027-02-01", end: "2027-07-31",
    });
  });

  it("peakForPlanning is the current peak in any other month", () => {
    expect(peakForPlanning(new Date("2026-10-15T10:00:00Z"))).toMatchObject({
      name: "winter", start: "2026-08-01",
    });
    expect(peakForPlanning(new Date("2027-02-15T10:00:00Z"))).toMatchObject({
      name: "summer", start: "2027-02-01",
    });
  });

  it("sprint 2 runs to the month's real last day", () => {
    const s = sprintOf(new Date("2028-02-20T10:00:00Z"));
    expect(s.start).toBe("2028-02-16");
    expect(s.end).toBe("2028-02-29");
    expect(s.label).toBe("February · Sprint 2 (16–29)");
  });

  it("inPeriod is inclusive at both ends and ignores the time part", () => {
    const p = { start: "2026-10-01", end: "2026-10-31" };
    expect(inPeriod("2026-10-01", p)).toBe(true);
    expect(inPeriod("2026-10-31T23:59:00Z", p)).toBe(true);
    expect(inPeriod("2026-11-01", p)).toBe(false);
  });
});

describe("contact auto-tagging and phone tag choices", () => {
  it("a hotline tags itself and offers only what a hotline can be", () => {
    expect(guessPhoneTag("16123")).toBe("Hotline");
    expect(phoneTagsFor("16123")).toEqual(["Hotline", "Contact", "Other"]);
  });

  it("a landline is never offered WhatsApp — in any of the ways it is typed", () => {
    for (const v of ["+2034831234", "034831234", "03 483 1234", "0223456789", "002034831234"]) {
      expect(phoneTagsFor(v), v).not.toContain("Whatsapp");
      expect(phoneTagsFor(v), v).not.toContain("Hotline");
    }
  });

  it("a mobile keeps WhatsApp, written either way", () => {
    for (const v of ["+201012345678", "01012345678"]) {
      expect(phoneTagsFor(v), v).toContain("Whatsapp");
      expect(phoneTagsFor(v), v).not.toContain("Hotline");
    }
  });

  it("never guesses who owns an ordinary number", () => {
    expect(guessPhoneTag("+201012345678")).toBeNull();
    expect(guessContactTag("phone", "01012345678")).toBeNull();
  });

  it("reads an email's tag from whole words before the @", () => {
    expect(guessEmailTag("ceo@company.com")).toBe("CEO");
    expect(guessEmailTag("hr.alex@company.com")).toBe("HR");
    expect(guessEmailTag("sales-team@company.com")).toBe("Contact");
    expect(guessEmailTag("Founder2@company.com")).toBe("Owner");
    expect(guessEmailTag("cecilia@company.com")).toBeNull(); // "ceo" is not a word in it
    expect(guessEmailTag("@company.com")).toBeNull();
  });

  it("routes each kind to its own guesser", () => {
    expect(guessContactTag("email", "careers@x.com")).toBe("HR");
    expect(guessContactTag("link", "instagram.com/somewhere")).toBe("Instagram");
    expect(guessContactTag("phone", "19016")).toBe("Hotline");
  });
});

describe("B2C call outcomes", () => {
  it("only 'answered' means the conversation happened", () => {
    expect(b2cOutcomeReached("answered")).toBe(true);
    for (const v of ["busy", "no_answer", "out_of_service", "call_back", "", null, undefined])
      expect(b2cOutcomeReached(v)).toBe(false);
  });

  it("labels known outcomes and nothing else", () => {
    expect(b2cOutcomeLabel("busy")).toContain("Busy");
    expect(b2cOutcomeLabel("made-up")).toBeNull();
    expect(b2cOutcomeLabel(null)).toBeNull();
  });
});

describe("the email check's DNS step, offline", () => {
  afterEach(() => vi.unstubAllGlobals());

  // each test uses its own domain: verdicts are cached per domain for 6 hours
  const dns = (answers: { MX?: boolean; A?: boolean }) =>
    vi.fn(async (url: string) => {
      const type = new URL(url).searchParams.get("type") as "MX" | "A";
      return new Response(
        JSON.stringify(answers[type] ? { Status: 0, Answer: [{}] } : { Status: 3 }),
        { status: 200 }
      );
    });

  it("passes a domain with an MX record", async () => {
    vi.stubGlobal("fetch", dns({ MX: true }));
    expect(await emailDomainIssue("someone@mx-only.example.org")).toBeNull();
  });

  it("falls back to an A record when there is no MX (RFC 5321)", async () => {
    vi.stubGlobal("fetch", dns({ A: true }));
    expect(await emailDomainIssue("someone@a-only.example.org")).toBeNull();
  });

  it("refuses a domain with neither, naming the provider it is one edit from", async () => {
    vi.stubGlobal("fetch", dns({}));
    const issue = await emailDomainIssue("someone@aiesec.nett");
    expect(issue).toContain("aiesec.net");
  });

  it("fails OPEN when DNS itself is down or errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    expect(await emailDomainIssue("someone@unreachable-dns.example.org")).toBeNull();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 503 })));
    expect(await emailDomainIssue("someone@dns-503.example.org")).toBeNull();
  });
});

describe("pins for the v37.13 fixes", () => {
  it("the visit-followups cron checks every stamp it writes", () => {
    const src = readFileSync("src/server/cron/visit-followups.ts", "utf8");
    // every stamp is `const { error… } = await db()` — none fire-and-forget
    for (const col of [
      "followup_prompt_sent_at", "forgotten_nag_sent_at", "next_step_reminded_key", "call_back_reminded_at",
    ]) {
      const at = src.indexOf(`.update({ ${col}`);
      expect(at, col).toBeGreaterThan(-1);
      const head = src.slice(src.lastIndexOf("await db()", at) - 40, at);
      expect(head, col).toMatch(/const \{ error(: \w+)? \} = await db\(\)/);
    }
  });

  it("the Emails tab sanitizes a restored draft before it reaches innerHTML", () => {
    const src = readFileSync("src/components/crm/emails-view.tsx", "utf8");
    expect(src).toContain("editor.current.innerHTML = sanitizeEditedEmailHtml(d.body)");
  });

  it("attendance journals the whole audience in one batch, not a row at a time", () => {
    const src = readFileSync("src/server/attendance.ts", "utf8");
    expect(src).toContain('snapshotManyForUndo(\n      "touch_point_attendance"');
    expect(src).toContain('recordUndoMany(\n      "touch_point_attendance"');
    expect(src).not.toMatch(/for \(const \w+ of [^\n]*\)\s*\n?\s*if \([^\n]*\) await recordUndo\("touch_point_attendance"/);
  });
});
