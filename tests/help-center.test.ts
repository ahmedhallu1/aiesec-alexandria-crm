import { describe, it, expect } from "vitest";
import {
  articleIsForViewer, articleSearchText, foldText, HELP_CATEGORIES,
  searchArticles, viewerAudienceKeys,
} from "../src/lib/help-content";
import { HELP_ARTICLES } from "../src/lib/help-articles";

/** THE HELP CENTER'S CONTRACT (v33.36).
 *
 *  The knowledge base is data, and data drifts: a hand-edited article with a
 *  broken category or a link to a route that doesn't exist fails silently in
 *  the UI. These tests make it fail loudly instead.
 */

const ROUTES = new Set([
  "/", "/accounts", "/accounts/import", "/signups", "/consideration",
  "/calendar", "/attendance", "/dashboard", "/emails", "/feedback",
  "/lc-feedback", "/profile", "/members", "/membership", "/planning",
  "/admin", "/help", "/ogt-mail", "/playbook",
]);
const CATEGORY_IDS = new Set([
  "getting-started", "raising", "ogx", "consideration", "b2c",
  "touchpoints", "emails-feedback", "leaders", "faq",
]);
const DIAGRAM_IDS = new Set([
  "pipeline", "signup-funnel", "ir-booking", "visit-flow", "roles",
  "touch-point-flow",
]);

function allText(a: (typeof HELP_ARTICLES)[number]): string[] {
  const out: string[] = [a.title, a.summary];
  for (const b of a.blocks) {
    if (b.md) out.push(b.md);
    if (b.items) out.push(...b.items);
    if (b.headers) out.push(...b.headers);
    if (b.rows) for (const r of b.rows) out.push(...r);
    if (b.faqItems) for (const f of b.faqItems) out.push(f.q, f.a);
  }
  return out;
}

describe("the knowledge base is well-formed", () => {
  it("has a real amount of content", () => {
    expect(HELP_ARTICLES.length).toBeGreaterThanOrEqual(40);
  });

  it("every id is unique and slug-shaped", () => {
    const seen = new Set<string>();
    for (const a of HELP_ARTICLES) {
      expect(a.id).toMatch(/^[a-z0-9-]+$/);
      expect(seen.has(a.id)).toBe(false);
      seen.add(a.id);
    }
  });

  it("every category and diagram id exists", () => {
    for (const a of HELP_ARTICLES) {
      expect(CATEGORY_IDS.has(a.category)).toBe(true);
      for (const b of a.blocks)
        if (b.t === "diagram") expect(DIAGRAM_IDS.has(b.diagramId ?? "")).toBe(true);
    }
  });

  it("every internal link points at a real route or a real article", () => {
    const ids = new Set(HELP_ARTICLES.map((a) => a.id));
    for (const a of HELP_ARTICLES) {
      for (const text of allText(a)) {
        for (const m of text.matchAll(/\]\(([^)\s]+)\)/g)) {
          const href = m[1];
          if (!href.startsWith("/")) continue; // external
          const [base, query] = href.split("?");
          const clean = base.replace(/\/$/, "") || "/";
          const ok =
            ROUTES.has(clean) ||
            clean.startsWith("/accounts/") ||
            clean.startsWith("/book/");
          expect(ok, `${a.id} links to unknown route ${href}`).toBe(true);
          if (clean === "/help" && query?.startsWith("a=")) {
            const target = query.slice(2).split("&")[0];
            expect(ids.has(target), `${a.id} deep-links to missing article ${target}`).toBe(true);
          }
        }
      }
    }
  });

  it("every rendered category card has at least one article", () => {
    for (const c of HELP_CATEGORIES) {
      const n = HELP_ARTICLES.filter((a) => a.category === c.id).length;
      expect(n, `category ${c.id} is empty`).toBeGreaterThan(0);
    }
  });
});

describe("search actually finds things", () => {
  const index = new Map(HELP_ARTICLES.map((a) => [a.id, articleSearchText(a)]));

  const top = (q: string) => searchArticles(HELP_ARTICLES, index, q).map((h) => h.article.id);

  it("finds the obvious", () => {
    expect(top("add account").length).toBeGreaterThan(0);
    expect(top("forgot password")[0]).toContain("password");
    expect(top("visit").length).toBeGreaterThan(0);
    expect(top("touch point").length).toBeGreaterThan(0);
  });

  it("folds Arabic variants so either spelling matches", () => {
    expect(foldText("أزاي")).toBe(foldText("ازاي"));
    // at least one article carries Arabic keywords
    expect(top("الباسورد").length).toBeGreaterThan(0);
  });

  it("returns nothing for junk instead of everything", () => {
    expect(top("qzqzqzqz")).toEqual([]);
  });
});

describe("the For-me filter", () => {
  it("a plain OGX member is matched by ogx content and never by admin content", () => {
    const keys = viewerAudienceKeys({
      role: "Member", isAdmin: false, isB2B: false, isB2C: false,
      isTm: false, isOgx: true, isConsideration: false, hasRaising: false,
    });
    const ogx = HELP_ARTICLES.find((a) => a.category === "ogx")!;
    expect(articleIsForViewer(ogx, keys)).toBe(true);
    const adminOnly = HELP_ARTICLES.find(
      (a) => a.audienceKeys.length === 1 && a.audienceKeys[0] === "admin"
    );
    if (adminOnly) expect(articleIsForViewer(adminOnly, keys)).toBe(false);
  });
});
