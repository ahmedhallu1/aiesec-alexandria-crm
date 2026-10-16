import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { contactDaysByMember } from "@/lib/streak";
import { cairoToday } from "@/lib/types";
import { podioDueDay, type ActionableAccount } from "@/lib/account-actions";
import { emailLayout, externalEmailLayout } from "@/lib/email/templates";
import { RATE_BUCKET_SCOPES } from "@/server/rate-limit";

/** The v37.14 system audit: production data and logs turned up each of these,
 *  and every one is pinned here so it can't quietly come back. */

const read = (f: string) => readFileSync(f, "utf8");

/** every .ts/.tsx under a folder, recursively */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sourceFiles(p));
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

describe("cairoToday(at) names the Cairo day of any instant", () => {
  it("is the next day once Cairo has passed midnight, while UTC has not", () => {
    // 22:30 UTC on the 16th is 01:30 (EEST, +3) on the 17th in Cairo
    expect(cairoToday(new Date("2026-10-16T22:30:00Z"))).toBe("2026-10-17");
    expect(new Date("2026-10-16T22:30:00Z").toISOString().slice(0, 10)).toBe("2026-10-16");
  });
  it("agrees with UTC in the middle of the day", () => {
    expect(cairoToday(new Date("2026-10-16T10:00:00Z"))).toBe("2026-10-16");
  });
});

describe("podioDueDay is the Cairo day the refresh falls due", () => {
  const base: ActionableAccount = {
    out_of_process: false,
    responsible_id: "m1",
    visit_id: null,
    visit_done: null,
    visit_date: null,
    next_step_missing: false,
    no_response_attempts: 0,
    podio_update_enabled: true,
    podio_update_every_days: 14,
    podio_updated_at: null,
    created_at: null,
  } as unknown as ActionableAccount;

  it("does not come due a day early when the instant is just past Cairo midnight", () => {
    // anchor 2026-10-02 22:30Z + 14 days = 2026-10-16 22:30Z = the 17th in Cairo
    expect(podioDueDay({ ...base, podio_updated_at: "2026-10-02T22:30:00Z" })).toBe("2026-10-17");
  });
});

describe("contactDaysByMember — one streak rule for the card and the nag", () => {
  const row = (id: string, who: string, at: string, source: string | null = "ogv_main") => ({
    id, assigned_to: who, contacted_at: at, source,
  });

  it("counts an ordinary sign-up on its Cairo contact day", () => {
    const days = contactDaysByMember([row("s1", "amr", "2026-10-16T22:30:00Z")], []);
    expect(days.get("amr")).toEqual(["2026-10-17"]);
  });

  it("does NOT count a referral someone else logged as contacted", () => {
    const days = contactDaysByMember(
      [row("r1", "amr", "2026-10-16T09:00:00Z", "referral")],
      [{ signup_id: "r1", member_id: "someone-else", at: "2026-10-16T09:00:00Z" }]
    );
    expect(days.get("amr")).toBeUndefined();
  });

  it("counts a referral on the day the ASSIGNEE flipped it themselves", () => {
    const days = contactDaysByMember(
      [row("r1", "amr", "2026-10-15T09:00:00Z", "referral")],
      [
        { signup_id: "r1", member_id: "amr", at: "2026-10-16T08:00:00Z" },
        { signup_id: "r1", member_id: "amr", at: "2026-10-16T12:00:00Z" },
      ]
    );
    expect(days.get("amr")).toEqual(["2026-10-16"]);
  });

  it("keeps one entry per sign-up (the card's today-count needs them)", () => {
    const days = contactDaysByMember(
      [row("a", "amr", "2026-10-16T09:00:00Z"), row("b", "amr", "2026-10-16T10:00:00Z")],
      []
    );
    expect(days.get("amr")).toEqual(["2026-10-16", "2026-10-16"]);
  });

  it("skips unassigned rows and unreadable dates", () => {
    const days = contactDaysByMember(
      [{ id: "x", assigned_to: null, contacted_at: "2026-10-16T09:00:00Z", source: null },
       row("y", "amr", "not a date")],
      []
    );
    expect(days.size).toBe(0);
  });

  it("is what BOTH the card and the 19:00 nag read", () => {
    expect(read("src/server/data.ts")).toMatch(/contactDaysByMember\(rows, contactLogs\)/);
    const cron = read("src/app/api/cron/streak-nags/route.ts");
    expect(cron).toMatch(/contactDaysByMember\(rows, logs\)/);
    // the nag needs the logs and the source to apply the referral rule
    expect(cron).toMatch(/from\("signup_logs"\)/);
    expect(cron).toMatch(/select\("id, assigned_to, contacted_at, source"\)/);
  });
});

describe("email preheaders are escaped like every body", () => {
  const evil = `</div><a href="https://evil.example">Click</a>`;
  it("never lets markup out of the hidden preheader (internal layout)", () => {
    const html = emailLayout({ preheader: evil, body: "<p>x</p>" });
    expect(html).not.toContain(`<a href="https://evil.example">`);
    expect(html).toContain("&lt;/div&gt;&lt;a href=&quot;https://evil.example&quot;&gt;");
  });
  it("and the external layout (IR emails) shares the same shell", () => {
    const html = externalEmailLayout({ preheader: evil, body: "<p>x</p>" });
    expect(html).not.toContain(`<a href="https://evil.example">`);
  });
});

describe("the IR registry insert can actually land", () => {
  const src = read("src/server/actions.ts");
  it("no longer upserts on a column list no index matches", () => {
    // the real key is (partner_lc_id, lower(email)) WHERE email IS NOT NULL
    expect(src).not.toMatch(/onConflict:\s*"partner_lc_id,email"/);
  });
  it("registers the IR from the public booking AND an accepted request", () => {
    expect((src.match(/await registerBookingContact\(/g) ?? []).length).toBeGreaterThanOrEqual(2);
    // a duplicate is "already there", anything else is logged
    expect(src).toMatch(/error\.code !== "23505"\)\s*\n\s*console\.error\("\[ir-booking\] contact insert failed/);
  });
});

describe("supabase-js resolves with an error — it does not reject", () => {
  it("leaves no `.then(undefined, …)` that can never see a failed write", () => {
    for (const f of sourceFiles("src/server")) {
      const code = read(f)
        .split("\n")
        .filter((l) => !/^\s*(\/\/|\/?\*)/.test(l))
        .join("\n");
      expect(code, f).not.toMatch(/\.then\(undefined,/);
    }
  });
});

describe("IR-call events are linked with a checked write", () => {
  const src = read("src/server/actions.ts");
  it("stores every new event through linkIrCallEvent", () => {
    expect(src).toMatch(/async function linkIrCallEvent\(/);
    // the only raw calendar_event_id write left is the helper's own patch
    const raw = src.match(/calendar_event_id: (made|own|viaMailbox|rebuilt)\.id/g) ?? [];
    expect(raw).toEqual([]);
  });
  it("never deletes the old event on a hand-over the call doesn't point away from", () => {
    expect(src).toMatch(/if \(made && !linked\) \{/);
  });
  it("invites the host to a mailbox event created from an accepted request", () => {
    expect(src).not.toMatch(/attendeeEmail: req\.booker_email, ownerEmail: null/);
    expect(src).toMatch(/ownerEmail: owner\.email \?\? owner\.fallback_email \?\? null/);
  });
});

describe("archiving clears the calendar on every path", () => {
  const src = read("src/server/actions.ts");
  it("has one helper and every archive path calls it", () => {
    // setOutOfProcess, the Not Interested contact result, a Podio "Rejected"
    expect((src.match(/await clearArchivedCalendar\(accountId\)/g) ?? []).length).toBe(3);
  });
});

describe("deal counters and the Deal Done stage are derived", () => {
  const src = read("src/server/actions.ts");
  it("cancelling the last deal takes the account out of Deal Done", () => {
    expect(src).toMatch(/all\.length === 0 \? \{ slot_raised: false, slot_raised_at: null \} : \{\}/);
  });
  it("recording a deal sums the stored deals instead of adding to a stale read", () => {
    expect(src).toMatch(/const \{ data: dealSums, error: sumError \} = await db\(\)/);
    expect(src).toMatch(/deals_count: stored\.length/);
  });
});

describe("visit reports and invites reach a Director-led function", () => {
  const src = read("src/server/actions.ts");
  it("the report goes to LCVPs AND Directors, B2B and BD as one function", () => {
    expect(src).toMatch(/\.in\("role", \["LCVP", "Director"\]\)\s*\n\s*\.overlaps\("functions", headLabels\)/);
    expect(src).toMatch(/account\.function === "B2B" \|\| account\.function === "BD" \? \["B2B", "BD"\]/);
  });
  it("a Director rides only their OWN function's visit invites", () => {
    expect(src).toMatch(/\(m\.role === "Director" && inFns\(announceFns, m\)\)/);
  });
});

describe("identity lookups by email are exact everywhere", () => {
  it("no .ilike('email', …) is handed a raw value anywhere in src", () => {
    for (const f of sourceFiles("src")) {
      for (const m of read(f).matchAll(/\.ilike\("email",\s*([A-Za-z_.]+)\)/g)) {
        // every caller passes the output of exactIlike — named …pat / …Pat / pattern
        expect(m[1], `${f}: .ilike("email", ${m[1]})`).toMatch(/pat|Pat|pattern/);
      }
    }
  });
});

describe("no read relies on a limit the API ignores", () => {
  it("leaves no .limit(5000)/.limit(10000) in the server code", () => {
    for (const f of sourceFiles("src/server")) {
      // comments may tell the story of a past cap; code may not carry one
      const code = read(f)
        .split("\n")
        .filter((l) => !/^\s*(\/\/|\/?\*)/.test(l))
        .join("\n");
      expect(code, f).not.toMatch(/\.limit\((5000|10000|20000)\)/);
    }
  });
});

describe("filter lists are cached where revalidatePath can't evict them", () => {
  const src = read("src/server/data.ts");
  it("uses module memory for the sign-up, CIC and IR-call funnels", () => {
    expect(src).toMatch(/memoOptions\(`signup-filter-options:\$\{fn\}`/);
    expect(src).toMatch(/memoOptions\(`cic-first-callers:/);
    expect(src).toMatch(/memoOptions\("ir-call-filter-options"/);
    expect(src).not.toMatch(/unstable_cache\(/);
  });
});

describe("dead rate buckets are pruned", () => {
  it("knows every scope that writes a bucket", () => {
    const scopes = new Set<string>();
    for (const f of sourceFiles("src")) {
      const code = read(f);
      for (const m of code.matchAll(/`([a-z]+):\$\{[^}]+\}:\$\{new Date\(\)\.toISOString\(\)\.slice\(0, 13\)\}`/g))
        scopes.add(m[1]);
      for (const m of code.matchAll(/underHourlyLimit\("([a-z]+)"/g)) scopes.add(m[1]);
    }
    expect(scopes.size).toBeGreaterThan(0);
    for (const s of scopes) expect(RATE_BUCKET_SCOPES as readonly string[]).toContain(s);
  });
  it("runs after the nightly backup", () => {
    const cron = read("src/app/api/cron/backup/route.ts");
    expect(cron.indexOf("pruneRateBuckets()")).toBeGreaterThan(cron.indexOf("runBackup()"));
  });
});

describe("fire-and-forget emails are kept alive past the response", () => {
  it("every detached sendEmail in the actions rides keepAlive", () => {
    const lines = read("src/server/actions.ts").split("\n");
    lines.forEach((l, i) => {
      if (!/^\s*sendEmail\(/.test(l)) return;
      // the call is either the argument of keepAlive( on the line above, or awaited/returned
      expect(lines[i - 1], `line ${i + 1}`).toMatch(/keepAlive\($/);
    });
  });
});

describe("migration 0086 ships with the release", () => {
  const sql = read("supabase/migrations/0086_list_indexes_and_ir_registry.sql");
  it("indexes the list orders and the pinned-comment lookup", () => {
    expect(sql).toMatch(/accounts \(updated_at desc nulls last, id\)/);
    expect(sql).toMatch(/accounts \(created_at, id\)/);
    expect(sql).toMatch(/account_comments \(account_id, created_at desc\)\s*\n\s*where pinned/);
  });
  it("repairs the data the bugs left behind, idempotently", () => {
    expect(sql).toMatch(/on conflict do nothing/);
    expect(sql).toMatch(/not exists \(select 1 from deals d where d\.account_id = a\.id\)/);
    expect(sql).toMatch(/next_step_date > date '2100-12-31'/);
  });
});
