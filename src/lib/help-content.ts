/** THE HELP CENTER'S SHAPE (v33.36).
 *
 *  The Playbook grew up: /help is a searchable help center — categories,
 *  task-first articles, FAQs, diagrams, deep links, and The Violet Man wired in
 *  as the AI layer. The CONTENT lives in `help-articles.ts` as plain data
 *  (no JSX), so it can be searched, rendered, and — crucially — fact-checked
 *  and regenerated without touching the machinery.
 *
 *  ⚠️ SHIP RULE unchanged, only the address moved: update the articles (and
 *  bump HELP_VERSION) with every release, same commit.
 */

/** ⚠️ Bump with EVERY release — the help center must describe the live system. */
export const HELP_VERSION = "v34.5";
/** The playbook's name for the same rule — kept so nothing else has to move. */
export const PLAYBOOK_VERSION = HELP_VERSION;

export type HelpTone = "tip" | "warn" | "info";

/** One content block. A single tagged shape (not a union of exact types) so
 *  the generated data stays plain JSON and a malformed block degrades to
 *  nothing instead of crashing the page. */
export interface HelpBlock {
  t: "p" | "steps" | "callout" | "table" | "faq" | "diagram";
  /** p / callout */
  md?: string;
  /** steps */
  title?: string;
  items?: string[];
  /** callout */
  tone?: HelpTone;
  /** table */
  headers?: string[];
  rows?: string[][];
  /** faq */
  faqItems?: { q: string; a: string }[];
  /** diagram */
  diagramId?: string;
  caption?: string;
}

export type HelpAudienceKey =
  | "everyone" | "raising" | "b2b" | "b2c" | "ogx" | "consideration"
  | "tm" | "leaders" | "eb" | "mm" | "admin";

export interface HelpArticle {
  /** stable kebab slug — the deep link (?a=) people share */
  id: string;
  title: string;
  emoji: string;
  category: HelpCategoryId;
  /** the human label on the badge ("Raising crews") */
  audience: string;
  /** who it's FOR — drives the "For me" filter; "everyone" always matches */
  audienceKeys: HelpAudienceKey[];
  keywords: string[];
  /** one sentence for cards and search results */
  summary: string;
  blocks: HelpBlock[];
}

export type HelpCategoryId =
  | "getting-started" | "raising" | "ogx" | "consideration" | "b2c"
  | "touchpoints" | "emails-feedback" | "leaders" | "faq";

export interface HelpCategory {
  id: HelpCategoryId;
  emoji: string;
  title: string;
  blurb: string;
  color: string;
  /** which viewer flags make this category "yours" */
  audienceKeys: HelpAudienceKey[];
}

export const HELP_CATEGORIES: HelpCategory[] = [
  {
    id: "getting-started", emoji: "🚀", title: "Getting started",
    blurb: "Signing in, your profile, notifications, and making Sodio yours.",
    color: "var(--chart-1)", audienceKeys: ["everyone"],
  },
  {
    id: "raising", emoji: "🏢", title: "Raising & accounts",
    blurb: "Accounts, contacts, visits, deals, proposals and the archive.",
    color: "var(--chart-1)", audienceKeys: ["raising", "b2b", "b2c"],
  },
  {
    id: "ogx", emoji: "✈️", title: "OGX sign-ups",
    blurb: "The pool, the funnel, CIC second calls, referrals and streaks.",
    color: "#0CB9C1", audienceKeys: ["ogx"],
  },
  {
    id: "consideration", emoji: "🌍", title: "Consideration & IR",
    blurb: "Booking links, IR calls, partner LCs and the CV pool.",
    color: "#F48924", audienceKeys: ["consideration"],
  },
  // "b2c" stays a valid category id, but its content lives inside Raising
  // and OGX today — an empty card teaches nobody anything.
  {
    id: "touchpoints", emoji: "📅", title: "Touch points & calendar",
    blurb: "Meetings, working hours, attendance, ratings and the one calendar.",
    color: "var(--primary)", audienceKeys: ["everyone"],
  },
  {
    id: "emails-feedback", emoji: "✉️", title: "Emails & feedback",
    blurb: "Writing on behalf of the LC, shout-outs, concerns and ratings.",
    color: "#0CB9C1", audienceKeys: ["everyone"],
  },
  {
    id: "leaders", emoji: "🧭", title: "For leaders",
    blurb: "Dashboards, plans, membership, function defaults and distribution.",
    color: "#F85A40", audienceKeys: ["leaders", "eb", "tm", "admin"],
  },
  {
    id: "faq", emoji: "❓", title: "FAQs & troubleshooting",
    blurb: "Login trouble, missing accounts, time zones, and who to call.",
    color: "#F48924", audienceKeys: ["everyone"],
  },
];

/** The viewer flags the help page derives "for me" from — a plain object so
 *  the client component can take it as a prop. */
export interface HelpViewer {
  role: string;
  isAdmin: boolean;
  isB2B: boolean;
  isB2C: boolean;
  isTm: boolean;
  isOgx: boolean;
  isConsideration: boolean;
  hasRaising: boolean;
}

export function viewerAudienceKeys(v: HelpViewer): Set<HelpAudienceKey> {
  const keys = new Set<HelpAudienceKey>(["everyone"]);
  if (v.hasRaising) keys.add("raising");
  if (v.isB2B) keys.add("b2b");
  if (v.isB2C) keys.add("b2c");
  if (v.isOgx) keys.add("ogx");
  if (v.isConsideration) keys.add("consideration");
  if (v.isTm) keys.add("tm");
  if (["Team Leader", "Coordinator"].includes(v.role)) keys.add("leaders");
  if (["LCVP", "Director", "LCP"].includes(v.role)) {
    keys.add("leaders");
    keys.add("eb");
  }
  // the Emails tab rule (v33.24): MMs and above
  if (v.role !== "Member" || v.isAdmin) keys.add("mm");
  if (v.isAdmin) keys.add("admin");
  return keys;
}

export function articleIsForViewer(a: HelpArticle, keys: Set<HelpAudienceKey>): boolean {
  if (a.audienceKeys.length === 0) return true;
  return a.audienceKeys.some((k) => k === "everyone" || keys.has(k));
}

// ------------------------------------------------------------------ search

/** Fold case + Arabic letter variants so "ازاي" finds "أزاي" etc.
 *  NFKD decomposes أ into ا + a combining hamza (U+0654), so the combining
 *  strip has to cover the Arabic combining block too — and it must run AFTER
 *  normalize, or the pre-composed forms sail through untouched. */
export function foldText(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    // combining marks: Latin diacritics + Arabic harakat/hamza marks
    .replace(/[\u0300-\u036f\u064b-\u065f\u0670]/g, "")
    .replace(/[أإآٱ]/g, "ا") // any pre-composed alef that survived
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه");
}

/** Everything searchable in one string per article (built once, memoised by
 *  the view). Block text is flattened; markdown syntax is left in — it never
 *  hurts a substring match. */
export function articleSearchText(a: HelpArticle): string {
  const parts: string[] = [a.title, a.summary, ...a.keywords];
  for (const b of a.blocks) {
    if (b.md) parts.push(b.md);
    if (b.title) parts.push(b.title);
    if (b.items) parts.push(...b.items);
    if (b.headers) parts.push(...b.headers);
    if (b.rows) for (const r of b.rows) parts.push(...r);
    if (b.faqItems) for (const f of b.faqItems) parts.push(f.q, f.a);
    if (b.caption) parts.push(b.caption);
  }
  return foldText(parts.join(" \n "));
}

export interface HelpSearchHit {
  article: HelpArticle;
  score: number;
  /** a short body snippet around the first match, for the result row */
  snippet: string | null;
}

export function searchArticles(
  articles: HelpArticle[],
  index: Map<string, string>,
  rawQuery: string
): HelpSearchHit[] {
  const q = foldText(rawQuery.trim());
  if (q.length < 2) return [];
  const terms = q.split(/\s+/).filter((t) => t.length >= 2);
  if (terms.length === 0) return [];
  const hits: HelpSearchHit[] = [];
  for (const a of articles) {
    const title = foldText(a.title);
    const keywords = foldText(a.keywords.join(" "));
    const summary = foldText(a.summary);
    const body = index.get(a.id) ?? "";
    let score = 0;
    let matchedAll = true;
    for (const t of terms) {
      if (title.includes(t)) score += 6;
      else if (keywords.includes(t)) score += 4;
      else if (summary.includes(t)) score += 3;
      else if (body.includes(t)) score += 1;
      else matchedAll = false;
    }
    if (score === 0) continue;
    // every term matching somewhere beats a partial match of one term
    if (matchedAll) score += 4 * terms.length;
    // snippet: first body occurrence of the first term
    let snippet: string | null = null;
    const at = body.indexOf(terms[0]);
    if (at >= 0) {
      const start = Math.max(0, at - 40);
      snippet =
        (start > 0 ? "…" : "") +
        body.slice(start, at + 120).replace(/\s+/g, " ").trim() +
        "…";
    }
    hits.push({ article: a, score, snippet });
  }
  return hits.sort((x, y) => y.score - x.score).slice(0, 12);
}
