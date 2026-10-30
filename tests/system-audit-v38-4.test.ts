import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

/** The v38.4 audit. Each of these was a real complaint — the test-view chip
 *  running off a phone, the consideration tab pushing the page sideways, a
 *  Team Leader watching their member's IR call go past its slot with no
 *  button to press, a walk-in refused because the account already existed —
 *  and each is pinned here so it cannot quietly come back. */

const read = (f: string) => readFileSync(f, "utf8");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sourceFiles(p));
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

describe("the test-view chip fits a phone", () => {
  const src = read("src/components/crm/view-as-banner.tsx");

  it("caps itself at the box minus both margins, not at the box", () => {
    // `max-w-full` is the WRAPPER's width; placed at its margin the chip then
    // hangs 12px over the right edge and the Exit button is unreachable.
    expect(src).toMatch(/maxWidth: box\.W > 0 \? Math\.max\(120, box\.W - 2 \* margin\)/);
  });

  it("keeps clear of the assistant's floating button", () => {
    // both are fixed z-50; a bottom-snapped chip on a phone is nearly the
    // full width and landed straight on top of it
    expect(src).toContain("const FAB = 72");
    expect(src).toMatch(/overFab/);
  });

  it("lets its controls shrink instead of overflowing", () => {
    // the select gives up width first; the Exit label goes at phone width
    expect(src).toContain("min-w-0 flex-1 gap-1.5 rounded-full");
    expect(src).toMatch(/hidden sm:inline">Exit</);
  });
});

describe("the consideration tab strip does not push the page sideways", () => {
  const src = read("src/components/crm/consideration-view.tsx");

  it("scrolls on its own below sm instead of running off the screen", () => {
    expect(src).toMatch(/max-w-full items-center gap-1 overflow-x-auto rounded-lg bg-muted p-1/);
    expect(src).toContain("sm:w-fit");
  });

  it("every dialog keeps its side gutter on a phone", () => {
    // an unprefixed `max-w-md` overrides the base `max-w-[calc(100%-2rem)]`,
    // so the card runs edge to edge on a 375px screen
    const bad = [...src.matchAll(/<DialogContent[^>]*className="([^"]*)"/g)]
      .map((m) => m[1])
      .filter((cls) => /(?:^|\s)max-w-(?:xs|sm|md|lg|xl|2xl|3xl|4xl)(?:\s|$)/.test(cls));
    expect(bad).toEqual([]);
  });
});

describe("an MM answers for their people's IR calls", () => {
  const actions = read("src/server/actions.ts");
  const view = read("src/components/crm/consideration-view.tsx");

  it("one predicate decides it, and it knows about reach", () => {
    expect(actions).toMatch(/const canActOnIrCall = \(viewer: Viewer, call/);
    expect(actions).toContain("canManageTeamIrCalls(viewer) &&");
    expect(actions).toContain("reachIds(viewer).includes(call.member_id)");
  });

  it("filling notes, cancelling, rescheduling and fixing the email all ask it", () => {
    // four call sites + the definition
    const uses = actions.match(/canActOnIrCall\(viewer, call\)/g) ?? [];
    expect(uses.length).toBe(4);
    // and the old narrow test is gone from those four
    expect(actions).not.toContain("Only the call's owner or a VP/Director can fill its notes.");
    expect(actions).not.toContain("Only the call's owner or a VP/Director can cancel it.");
  });

  it("DELETING a log stays the host's or a lead's — it leaves nothing behind", () => {
    const del = actions.slice(actions.indexOf("export async function deleteIrCall"));
    const body = del.slice(0, del.indexOf("export async function cancelIrCall"));
    expect(body).not.toContain("canActOnIrCall");
    expect(view).toContain("const canDelete = (c: IrCallRow) =>");
  });

  it("the buttons follow the same rule the actions do", () => {
    expect(view).toMatch(/const canTouch = \(c: IrCallRow\) =>[\s\S]*?viewer\.teamIds\.includes\(c\.member_id\)/);
  });

  it("a slot request an MM can see is still only the host's to answer", () => {
    expect(read("src/server/data.ts")).toContain("canManageTeamIrCalls(viewer)");
    expect(read("src/components/crm/ir-slot-requests-card.tsx")).toContain(
      "!(canAnswerAny || r.hostId === viewerId)"
    );
  });

  it("the host's manager hears when an IR moves the call", () => {
    expect(actions).toMatch(/stakeholder_id[\s\S]{0,400}IR call moved/);
  });
});

describe("a walk-in onto an account that already exists", () => {
  const actions = read("src/server/actions.ts");
  const dialog = read("src/components/crm/direct-visit-dialog.tsx");

  it("is never assumed — the member has to choose it", () => {
    expect(actions).toContain('onExisting: z.literal("convert").optional()');
    expect(actions).toMatch(/if \(d\.onExisting !== "convert"\)[\s\S]{0,200}already an account/);
  });

  it("is refused on an account they could not edit anyway", () => {
    expect(actions).toMatch(/if \(!canEditAccount\(viewer, duplicate\)\)/);
  });

  it("leaves the account's owner and function alone, and journals the change", () => {
    const i = actions.indexOf("0b. IT IS ALREADY AN ACCOUNT");
    const body = actions.slice(i, i + 5000);
    expect(body).toContain("duplicate.responsible_id ? {} : { responsible_id: viewer.id }");
    expect(body).toContain('await snapshotForUndo("accounts", duplicate.id)');
    expect(body).toContain("finishDirectVisit(viewer, duplicate.id");
  });

  it("keeps what was collected at the door, through the clash guard", () => {
    const i = actions.indexOf("WHAT YOU COLLECTED AT THE DOOR STILL LANDS");
    expect(i).toBeGreaterThan(0);
    const body = actions.slice(i, i + 2200);
    expect(body).toContain("contactClashes(added, { excludeId: duplicate.id })");
    expect(body).toContain("legacyContactColumns(merged)");
  });

  it("the form only offers it when the server said the account is theirs", () => {
    expect(dialog).toContain("nameCheck.info?.logVisit");
    expect(actions).toContain("logVisit: canEditAccount(viewer, duplicate) ? duplicate.id : null");
  });
});

describe("the rule manager is wired, not decorative", () => {
  it("only rbac.ts resolves a privilege — every other file asks a predicate", () => {
    const offenders = sourceFiles("src")
      .filter((f) => !f.endsWith("src/lib/rbac.ts"))
      .filter((f) => /\bv\.privileges\b|\bviewer\.privileges\b/.test(read(f)));
    expect(offenders).toEqual([]);
  });

  it("the writes are the LCP's and the admins', never from a test view", () => {
    const src = read("src/server/privilege-actions.ts");
    expect(src).toContain("canRunLcTools(viewer)");
    expect(src).toContain("viewer.impersonated");
  });

  it("a save busts the cache, so the person who changed it sees it", () => {
    expect(read("src/server/privilege-actions.ts")).toContain("bustPrivilegeRules()");
  });

  it("the table exists in a migration", () => {
    const sql = read("supabase/migrations/0089_privilege_rules.sql");
    expect(sql).toContain("create table if not exists privilege_rules");
    expect(sql).toContain("alter table privilege_rules enable row level security");
  });
});
