import { describe, it, expect } from "vitest";
import { nextStepDue, nextStepKey, nextStepRemindAt } from "@/lib/next-step-reminder";
import { cairoToUtc } from "@/lib/time";

/**
 * NEXT-STEP REMINDERS (v36.2).
 *
 * Before this, the only reminder was a Google Calendar event, and 44 of 100
 * upcoming next steps belonged to members who had never connected Google —
 * they were reminded of nothing. These pin WHEN Sodio's own reminder goes out.
 */

const today = "2026-09-10";
const at = (hhmm: string) => cairoToUtc(today, hhmm).getTime();
const step = (time: string | null, reminded: string | null = null, date = today) => ({
  next_step_date: date,
  next_step_time: time,
  next_step_reminded_key: reminded,
});

describe("when a next step is reminded", () => {
  it("a step WITH a time: an hour before it", () => {
    expect(nextStepDue(step("15:00:00"), today, at("13:59"))).toBe(false);
    expect(nextStepDue(step("15:00:00"), today, at("14:00"))).toBe(true);
    expect(nextStepRemindAt(today, "15:00")).toBe(at("14:00"));
  });

  it("a step with only a DATE: 09:00 Cairo that morning", () => {
    expect(nextStepDue(step(null), today, at("08:59"))).toBe(false);
    expect(nextStepDue(step(null), today, at("09:00"))).toBe(true);
  });

  it("a step set for today after its hour has passed goes out on the next pass", () => {
    expect(nextStepDue(step("10:00"), today, at("17:30"))).toBe(true);
  });

  it("only TODAY's steps — yesterday's is overdue, tomorrow's is not yet", () => {
    expect(nextStepDue(step(null, null, "2026-09-09"), today, at("12:00"))).toBe(false);
    expect(nextStepDue(step(null, null, "2026-09-11"), today, at("12:00"))).toBe(false);
    expect(nextStepDue({ next_step_date: null, next_step_time: null, next_step_reminded_key: null }, today, at("12:00"))).toBe(false);
  });

  it("never twice for the same step — but a MOVED step is reminded again", () => {
    const key = nextStepKey(today, "15:00:00");
    expect(nextStepDue(step("15:00:00", key), today, at("14:30"))).toBe(false);
    expect(nextStepDue(step("16:00:00", key), today, at("15:30"))).toBe(true);
    expect(nextStepDue(step(null, nextStepKey(today, null)), today, at("10:00"))).toBe(false);
  });

  it("keys by HH:MM, whatever precision the database hands back", () => {
    expect(nextStepKey(today, "15:00:00")).toBe(nextStepKey(today, "15:00"));
    expect(nextStepKey(today, null)).not.toBe(nextStepKey(today, "09:00"));
  });
});
