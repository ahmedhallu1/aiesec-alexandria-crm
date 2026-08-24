import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PERIOD_KEYS } from "@/lib/ask-period";

/**
 * THE VIOLET MAN'S DATE WIRING.
 *
 * He answered "how many visits did I schedule this week" with numbers that
 * were simply wrong. The cause was not a bad prompt — it was that NOTHING in
 * his context had a date in it: the KPI block is all-time, the account lines
 * carry no dates, and there was no tool that could count over a window. He
 * had to invent a number, so he did.
 *
 * `tests/ask-period.test.ts` proves the arithmetic. This file proves the
 * arithmetic is actually REACHABLE — that the tool exists, that the handler
 * runs it, and that the rule telling him to use it is still in the prompt.
 * All three can be deleted by accident in a refactor, and the symptom would
 * be a silent return to confidently wrong numbers.
 */

// read as SOURCE, not imported: `@/lib/assistant` pulls in server/data and
// next-auth, which will not load outside Next. These are source invariants
// anyway — the point is that the wiring is still present in the file.
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const route = read("src/app/api/assistant/route.ts");
const assistant = read("src/lib/assistant.ts");
/** just the system prompt, so a match can't be satisfied by the data-builder */
const VIOLET_MAN_SYSTEM_PROMPT = assistant.slice(
  assistant.indexOf("export const VIOLET_MAN_SYSTEM_PROMPT")
);

describe("the getNumbers tool exists and is wired", () => {
  it("is declared to the model", () => {
    expect(route).toContain('name: "getNumbers"');
    expect(route).toMatch(/enum:\s*\[\.\.\.PERIOD_KEYS\]/);
  });

  it("is handled, and the handler runs the REAL dashboard read", () => {
    expect(route).toContain('if (name === "getNumbers")');
    // the whole point: same function the dashboard page calls, so his answer
    // and the screen cannot disagree
    expect(route).toContain("getDashboard(viewer, filters, lane)");
    expect(route).toContain("resolvePeriod(period");
  });

  it("resolves the window against the CAIRO day, not the server's", () => {
    expect(route).toContain("cairoDay()");
  });

  it("refuses an unknown period instead of falling back to all time", () => {
    // a silent fallback to an unbounded window is the exact failure this
    // tool exists to remove — it would answer "this week" with all-time
    expect(route).toMatch(/Unknown period/);
  });

  it("hands the window's LABEL back so the answer can state its own dates", () => {
    expect(route).toMatch(/window:\s*win\.label/);
  });

  it("tells the model to say so rather than estimate when the read fails", () => {
    expect(route).toMatch(/do not estimate/i);
  });
});

describe("the prompt still forbids answering a dated question from memory", () => {
  it("carries the hard date rule", () => {
    expect(VIOLET_MAN_SYSTEM_PROMPT).toMatch(/DATES — THIS IS A HARD RULE/);
    expect(VIOLET_MAN_SYSTEM_PROMPT).toContain("getNumbers");
  });

  it("names the time words that must trigger the tool, in both languages", () => {
    for (const w of ["this week", "last month", "this sprint", "الأسبوع ده", "امبارح"]) {
      expect(VIOLET_MAN_SYSTEM_PROMPT, w).toContain(w);
    }
  });

  it("says out loud that the KPI block is all-time", () => {
    expect(VIOLET_MAN_SYSTEM_PROMPT).toMatch(/ALL-TIME/);
    expect(assistant).toMatch(/### KPIs — ⚠️ ALL TIME/);
  });

  it("explains that each KPI is counted on its own date", () => {
    // so he doesn't 'correct' contacted > research, which is legitimate
    expect(VIOLET_MAN_SYSTEM_PROMPT).toMatch(/counted on ITS OWN date/i);
  });
});

describe("the context carries today", () => {
  it("puts the resolved windows in front of him", () => {
    expect(assistant).toContain("### Today & the periods");
    expect(assistant).toContain("THE WEEK STARTS ON SATURDAY");
    // every named period the tool accepts is spelled out with its real dates
    for (const key of ["this_week", "last_week", "this_month", "last_month", "this_sprint", "this_peak"]) {
      expect(assistant, key).toContain(key);
    }
  });

  it("tells him not to compute the windows himself", () => {
    expect(assistant).toMatch(/Do not compute any of these yourself/);
  });

  it("describes every period to the model, not just the dated ones", () => {
    // a key the resolver handles but the model is never told about is a
    // question he'll answer some other, worse way. The tool's `enum` is
    // PERIOD_KEYS itself and its description is built from PERIOD_HELP, which
    // ask-period.test.ts pins as covering every key — so what has to be true
    // HERE is that both actually reach the schema.
    expect(route).toMatch(/enum:\s*\[\.\.\.PERIOD_KEYS\]/);
    expect(route).toContain("Object.entries(PERIOD_HELP)");
  });

  it("spells out the DATED windows in the context, with real dates", () => {
    for (const key of PERIOD_KEYS) {
      if (key === "custom" || key === "all_time") continue; // no dates to print
      expect(assistant.includes(key) || key === "today" || key === "yesterday", key).toBe(true);
    }
  });
});
