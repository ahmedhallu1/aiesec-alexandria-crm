import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import type { Viewer } from "@/lib/rbac";
import { canOpenCalendar, canOpenPlanning } from "@/lib/rbac";
import { homeFor, homeOptionsFor, navFlagsFor, type NavFlags } from "@/lib/home-options";
import { tabOverridesFor, ruleFromRow, type TabOverride, type TabRule } from "@/lib/tabs";

/** WHERE HOME IS (v38.3) — "/", the logo and the gate's bounce share ONE
 *  answer (`homeRouteFor`), and it is never a page that sends the person
 *  back again. Every case below was a redirect loop or a blank page. */

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const m = (over: Partial<Viewer> = {}): Viewer =>
  ({
    id: "m1", name: "T", nickname: null, email: "t@aiesec.net", phone: null,
    functions: [], sub_functions: [], role: "Member", stakeholder_name: null,
    stakeholder_id: null, team_name: null, is_active: true, google_refresh_token: null,
    isAdmin: false, teamMemberIds: [], ...over,
  }) as Viewer;

const ogvMember = m({ functions: ["OGV"] });
const cxpOnly = m({ functions: ["CXP"], sub_functions: ["OGX"] });
const marketingLcvp = m({ role: "LCVP", functions: ["Marketing"] });
const flMember = m({ functions: ["F&L"] });
const imDirector = m({ role: "Director", functions: ["IM"] });
const moduleless = m({ functions: ["Marketing"] });
const igvMember = m({ functions: ["IGV"], sub_functions: ["Raising"] });
const igvVp = m({ role: "LCVP", functions: ["IGV"] });
const SAMPLE = { ogvMember, cxpOnly, marketingLcvp, flMember, imDirector, moduleless, igvMember, igvVp };

/** The routes the layout's GateClient lets a NON-raiser open — mirrors
 *  layout.tsx (gateRoutes + gate-client's ALWAYS_ALLOWED). */
function openRoutes(f: NavFlags, ov: Record<string, TabOverride>): Set<string> {
  const flagged: [string, boolean][] = [
    ["/calendar", f.calendar], ["/members", f.tm], ["/membership", f.membership],
    ["/planning", f.planning], ["/signups", f.signups], ["/consideration", f.consideration],
    ["/cxp", f.cxp], ["/dashboard", f.dashboard], ["/emails", f.mailbox],
    ["/activation", f.activation], ["/war-room", f.warRoom],
  ];
  return new Set([
    "/", "/profile", "/feedback", "/help", "/playbook", "/lc-feedback", "/pdp", "/attendance",
    ...flagged.filter(([, ok]) => ok).map(([h]) => h),
    ...Object.keys(ov).filter((h) => ov[h] === "show"),
  ]);
}

/** Would landing on `home` stick? It must be open to them by code or by a
 *  rule, and not hidden by a rule. */
function lands(v: Viewer, ov: Record<string, TabOverride>): string {
  const f = navFlagsFor(v);
  const home = homeFor(v, ov);
  expect(ov[home], `${home} is hidden`).not.toBe("hide");
  if (home === "/accounts") expect(f.raising || ov["/accounts"] === "show").toBe(true);
  else expect(openRoutes(f, ov).has(home), `${home} would be bounced`).toBe(true);
  return home;
}

const hideRule = (href: string, over: Partial<TabRule> = {}): TabRule => ({
  ...ruleFromRow({ href }),
  hide: { members: [], roles: [], functions: ["OGV"] },
  ...over,
});

describe("home under the tab rules", () => {
  it("an OGV Member whose Sign-ups tab is hidden lands on another of their pages, not a blank one", () => {
    const ov = tabOverridesFor([hideRule("/signups")], ogvMember);
    expect(ov).toEqual({ "/signups": "hide" });
    expect(lands(ogvMember, ov)).toBe("/dashboard");
  });

  it("…and with Sign-ups retired and the Dashboard hidden too, the Calendar", () => {
    const ov = tabOverridesFor(
      [ruleFromRow({ href: "/signups", retired_at: "2026-01-01T00:00:00Z" }), hideRule("/dashboard")],
      ogvMember
    );
    expect(lands(ogvMember, ov)).toBe("/calendar");
  });

  it("a CXP-only member lands on CXP (no rule needed — it used to be a blank page)", () => {
    expect(lands(cxpOnly, {})).toBe("/cxp");
  });

  it("a module-less member lands on a page every member keeps, never /accounts", () => {
    expect(lands(moduleless, {})).toBe("/attendance");
    expect(lands(moduleless, { "/attendance": "hide" })).toBe("/profile");
  });

  it("a tab a rule opens to a module-less person is their home", () => {
    expect(lands(moduleless, { "/planning": "show" })).toBe("/planning");
  });

  it("the EB opens on the Dashboard only when they own a lane there", () => {
    expect(lands(igvVp, {})).toBe("/dashboard");
    expect(lands(marketingLcvp, {})).toBe("/membership");
  });

  it("a raiser whose Raising tab is hidden is not sent to it", () => {
    expect(lands(igvMember, { "/accounts": "hide" })).toBe("/dashboard");
  });

  it("no sample viewer, with or without rules, is sent somewhere that bounces", () => {
    const ruleSets: Record<string, TabOverride>[] = [
      {}, { "/signups": "hide" }, { "/dashboard": "hide", "/calendar": "hide" }, { "/cxp": "hide" },
      { "/membership": "hide" }, { "/accounts": "hide", "/dashboard": "hide", "/calendar": "hide" },
      { "/planning": "show" },
    ];
    for (const v of Object.values(SAMPLE)) for (const ov of ruleSets) lands(v, ov);
  });
});

describe("the home picker only offers pages that open", () => {
  it("Calendar and Planning use the pages' own predicates", () => {
    for (const [name, v] of Object.entries(SAMPLE)) {
      const offered = new Set(homeOptionsFor(v).map((o) => o.value));
      expect(offered.has("/calendar"), name).toBe(canOpenCalendar(v));
      expect(offered.has("/planning"), name).toBe(canOpenPlanning(v));
    }
  });

  it("the pre-v38.3 loops are closed", () => {
    // a CXP-only member and a Marketing LCVP were offered Calendar, which
    // their page refused
    expect(homeOptionsFor(cxpOnly).map((o) => o.value)).not.toContain("/calendar");
    expect(homeOptionsFor(marketingLcvp).map((o) => o.value)).not.toContain("/calendar");
    // F&L and the IM Director reach canSeePlanning through `master` with no
    // planned function — the board had nothing for them and bounced to "/"
    expect(navFlagsFor(flMember).planning).toBe(false);
    expect(navFlagsFor(imDirector).planning).toBe(false);
    expect(navFlagsFor(igvVp).planning).toBe(true);
    expect(navFlagsFor(m({ role: "LCP" })).planning).toBe(true);
  });

  it("a saved home the LC's rules now hide is ignored", () => {
    const opts = homeOptionsFor(ogvMember, { "/signups": "hide" }).map((o) => o.value);
    expect(opts).not.toContain("/signups");
    expect(opts).toContain("/calendar");
    expect(read("src/app/(app)/page.tsx")).toMatch(/homeOptionsFor\(viewer, ov\)/);
  });
});

describe("the wiring", () => {
  it("'/', the logo and the gate's bounce all use the one home", () => {
    expect(read("src/app/(app)/page.tsx")).toMatch(/redirect\(homeFor\(viewer, ov\)\)/);
    const layout = read("src/app/(app)/layout.tsx");
    expect(layout).toMatch(/homeHref=\{home\}/);
    expect(layout).toMatch(/hasModule=\{hasModule\} home=\{home\}/);
    // "having a module" counts only what a rule leaves visible
    expect(layout).toMatch(/extraRoutes\.some\(\(h\) => tabOverrides\[h\] !== "hide"\)/);
    const shell = read("src/components/crm/app-shell.tsx");
    expect(shell).not.toMatch(/\["\/membership", nav\.membership\]/);
    const gate = read("src/components/crm/gate-client.tsx");
    expect(gate).toMatch(/router\.replace\(home\)/);
    expect(gate).toMatch(/pathname !== home/);
  });

  it("no page refuses with a bounce to '/' after its tab gate passed", () => {
    for (const p of ["planning/page.tsx", "cxp/weekly/page.tsx", "accounts/import/page.tsx"])
      expect(read(`src/app/(app)/${p}`), p).not.toMatch(/redirect\("\/"\)/);
  });

  it("the Expectation mail and the CXP downloads follow their tab's rule", () => {
    expect(read("src/app/(app)/ogt-mail/page.tsx")).toMatch(/gateTab\(viewer, "\/emails", canUseMailboxTab\(viewer\)\)/);
    expect(read("src/app/(app)/layout.tsx")).toMatch(/tabOverrides\["\/emails"\] !== "hide" \? \["\/ogt-mail"\]/);
    for (const p of ["src/app/api/cxp/file/route.ts", "src/app/api/cxp/zip/route.ts"])
      expect(read(p), p).toMatch(/tabAllows\(viewer, "\/cxp", hasCxpAccess\(viewer\)\)\)\) return notFound\(\)/);
  });

  it("a hidden bid tab sends people to the public copy only while it is live", () => {
    expect(read("src/app/(app)/activation/page.tsx")).toMatch(
      /\(await publicPageLive\(ACTIVATION_TAB\)\) \? ACTIVATION_PUBLIC_PATH : "\/"/
    );
  });
});
