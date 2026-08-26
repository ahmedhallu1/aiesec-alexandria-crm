import { describe, it, expect, afterEach } from "vitest";
import {
  CXP_EMAIL_GO_LIVE_DEFAULT,
  configuredEmailMode,
  emailGoLiveDate,
  resolveEmailMode,
} from "@/server/cxp-reminders";
import {
  deadlineOneDayAfter,
  recentWeeklyDeadlines,
  upcomingWeeklyDeadlines,
  addDays,
} from "@/lib/cxp/deadlines";

/**
 * THE EMAIL CUTOVER TESTS.
 *
 * The module went live in August; the EMAILS hand over on 1 September. Until
 * then the standalone auditing system still owns them, so this one must resolve
 * everything and send nothing — otherwise every VP gets two reminders per
 * deadline, from two systems, with different branding.
 *
 * The risk being tested is asymmetric and worth naming. Sending EARLY is a
 * visible mess: duplicate mail to the LC's leadership. Sending LATE is worse
 * and quieter: a deadline passes with nobody reminded, documents go uncollected,
 * and the LC is fined for it. So the cases below pin BOTH edges of the switch,
 * not just the happy path.
 */

const ENV_KEYS = ["CXP_EMAIL_MODE", "CXP_EMAIL_GO_LIVE"] as const;
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const withEnv = (mode?: string, goLive?: string) => {
  if (mode === undefined) delete process.env.CXP_EMAIL_MODE;
  else process.env.CXP_EMAIL_MODE = mode;
  if (goLive === undefined) delete process.env.CXP_EMAIL_GO_LIVE;
  else process.env.CXP_EMAIL_GO_LIVE = goLive;
};

describe("the cutover date", () => {
  it("is 1 September 2026 by default", () => {
    withEnv(undefined, undefined);
    expect(CXP_EMAIL_GO_LIVE_DEFAULT).toBe("2026-09-01");
    expect(emailGoLiveDate()).toBe("2026-09-01");
  });

  it("can be moved by env without a deploy", () => {
    withEnv(undefined, "2026-10-01");
    expect(emailGoLiveDate()).toBe("2026-10-01");
  });

  it("ignores a malformed override rather than failing open", () => {
    // a typo must not become "no cutover at all"
    for (const junk of ["soon", "01/09/2026", "2026-9-1", ""]) {
      withEnv(undefined, junk);
      expect(emailGoLiveDate(), junk).toBe("2026-09-01");
    }
  });
});

describe("BEFORE the cutover, nothing is sent — whatever the env says", () => {
  const before = ["2026-08-26", "2026-08-27", "2026-08-31"];

  it("holds back even when CXP_EMAIL_MODE=production", () => {
    withEnv("production", "2026-09-01");
    for (const today of before) {
      const r = resolveEmailMode(today);
      expect(r.mode, today).toBe("dry-run");
      expect(r.heldBack, today).toBe(true);
      // the configured value is preserved so the log can show the difference
      expect(r.configured, today).toBe("production");
      expect(r.reason).toContain("2026-09-01");
    }
  });

  it("holds back on beta too", () => {
    withEnv("beta", "2026-09-01");
    expect(resolveEmailMode("2026-08-31").mode).toBe("dry-run");
  });

  it("and on the day before, which is the classic off-by-one", () => {
    withEnv("production", "2026-09-01");
    const r = resolveEmailMode("2026-08-31");
    expect(r.mode).toBe("dry-run");
    expect(r.heldBack).toBe(true);
  });
});

describe("ON and AFTER the cutover, the env decides", () => {
  it("goes live exactly ON the 1st — not the 2nd", () => {
    withEnv("production", "2026-09-01");
    const r = resolveEmailMode("2026-09-01");
    expect(r.mode).toBe("production");
    expect(r.heldBack).toBe(false);
  });

  it("stays live afterwards", () => {
    withEnv("production", "2026-09-01");
    for (const today of ["2026-09-05", "2026-09-06", "2026-12-31", "2027-03-01"]) {
      expect(resolveEmailMode(today).mode, today).toBe("production");
    }
  });

  it("still respects an explicit dry-run after the cutover", () => {
    // the gate is a floor, not a ceiling: someone can still hold it back
    withEnv("dry-run", "2026-09-01");
    expect(resolveEmailMode("2026-09-10").mode).toBe("dry-run");
  });

  it("defaults to dry-run after the cutover if the env is UNSET", () => {
    // fail-safe survives the gate: an unset variable never mails anyone
    withEnv(undefined, "2026-09-01");
    expect(configuredEmailMode()).toBe("dry-run");
    expect(resolveEmailMode("2026-09-10").mode).toBe("dry-run");
  });
});

describe("the handover lands cleanly between two ECB cycles", () => {
  // deadlines are the 6th / 13th / 20th / 27th, mailed the day before
  it("the last deadline before the cutover is 27 Aug, mailed the 26th", () => {
    expect(deadlineOneDayAfter("2026-08-26")?.date).toBe("2026-08-27");
    withEnv("production", "2026-09-01");
    // …and that mail is still the OLD system's job
    expect(resolveEmailMode("2026-08-26").mode).toBe("dry-run");
  });

  it("the first deadline after it is 6 Sep, mailed the 5th — by us", () => {
    expect(deadlineOneDayAfter("2026-09-05")?.date).toBe("2026-09-06");
    withEnv("production", "2026-09-01");
    expect(resolveEmailMode("2026-09-05").mode).toBe("production");
  });

  it("NO deadline falls in the gap, so none is sent twice or missed", () => {
    // every reminder-eve between the two cycles must be silent
    withEnv("production", "2026-09-01");
    let cursor = "2026-08-27";
    const firing: string[] = [];
    while (cursor < "2026-09-06") {
      if (deadlineOneDayAfter(cursor)) firing.push(cursor);
      cursor = addDays(cursor, 1);
    }
    // the only reminder-eve in the window is 5 Sep, and it is ours
    expect(firing).toEqual(["2026-09-05"]);
    expect(resolveEmailMode("2026-09-05").mode).toBe("production");
  });

  it("every deadline in September is covered by the new system", () => {
    withEnv("production", "2026-09-01");
    const september = upcomingWeeklyDeadlines("2026-09-01", 4).map((d) => d.date);
    expect(september).toEqual([
      "2026-09-06",
      "2026-09-13",
      "2026-09-20",
      "2026-09-27",
    ]);
    for (const d of september) {
      const eve = addDays(d, -1);
      expect(deadlineOneDayAfter(eve)?.date, eve).toBe(d);
      expect(resolveEmailMode(eve).mode, eve).toBe("production");
    }
  });

  it("and every August deadline was covered by the old one", () => {
    withEnv("production", "2026-09-01");
    for (const d of ["2026-08-06", "2026-08-13", "2026-08-20", "2026-08-27"]) {
      expect(resolveEmailMode(addDays(d, -1)).mode, d).toBe("dry-run");
    }
  });
});

describe("the reminder still only fires the day before a deadline", () => {
  it("is silent on every other day of the month", () => {
    let cursor = "2026-09-01";
    const fired: string[] = [];
    for (let i = 0; i < 30; i++) {
      if (deadlineOneDayAfter(cursor)) fired.push(cursor);
      cursor = addDays(cursor, 1);
    }
    expect(fired).toEqual(["2026-09-05", "2026-09-12", "2026-09-19", "2026-09-26"]);
  });

  it("crosses a month boundary correctly", () => {
    // 30 Sep -> 1 Oct is not a deadline; 5 Oct -> 6 Oct is
    expect(deadlineOneDayAfter("2026-09-30")).toBe(null);
    expect(deadlineOneDayAfter("2026-10-05")?.date).toBe("2026-10-06");
  });

  it("the weekly board still shows six chips around the cutover", () => {
    for (const day of ["2026-08-31", "2026-09-01", "2026-09-05"]) {
      const all = [
        ...recentWeeklyDeadlines(day, 2),
        ...upcomingWeeklyDeadlines(day, 4),
      ].map((d) => d.date);
      expect(all, day).toHaveLength(6);
      expect(new Set(all).size, day).toBe(6);
    }
  });
});
