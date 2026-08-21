"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft, BookOpen, ChevronDown, ChevronRight, Lightbulb, Search, Sparkles,
  TriangleAlert, X,
} from "lucide-react";
import {
  articleIsForViewer, articleSearchText, HELP_CATEGORIES, HELP_VERSION,
  searchArticles, viewerAudienceKeys,
  type HelpArticle, type HelpBlock, type HelpCategory, type HelpViewer,
} from "@/lib/help-content";
import { HELP_ARTICLES } from "@/lib/help-articles";
import { HelpDiagram } from "./help-diagrams";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

/** THE HELP CENTER (v33.36) — the Playbook, grown up.
 *
 *  One page, four states driven by the URL (so every one of them is
 *  shareable): home (?nothing), search (?q=), a category (?c=), an article
 *  (?a=). Search is instant and local — the whole knowledge base ships with
 *  the page — and the escape hatch everywhere is The Violet Man, who answers
 *  what a static article can't.
 */

// ------------------------------------------------------------ mini-markdown

/** Renders the article dialect: **bold**, `code`, [text](/route). Nothing
 *  else, on purpose — content stays data, and data can't break the page. */
function md(text: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  // tokenise: links first (they may contain backticks), then bold, then code
  const re = /\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*|`([^`]+)`/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1] !== undefined) {
      const href = m[2];
      out.push(
        href.startsWith("/") ? (
          <Link prefetch={false} key={k++} href={href} className="font-medium text-primary hover:underline">
            {m[1]}
          </Link>
        ) : (
          <a key={k++} href={href} target="_blank" rel="noreferrer" className="font-medium text-primary hover:underline">
            {m[1]}
          </a>
        )
      );
    } else if (m[3] !== undefined) {
      out.push(<b key={k++}>{md(m[3])}</b>);
    } else if (m[4] !== undefined) {
      out.push(
        <code key={k++} className="rounded bg-muted px-1.5 py-0.5 text-[0.85em] font-semibold">
          {m[4]}
        </code>
      );
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

// ------------------------------------------------------------ block renderers

const CALLOUT_STYLE: Record<string, { icon: React.ReactNode; cls: string }> = {
  tip: {
    icon: <Lightbulb className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />,
    cls: "border-emerald-500/40 bg-emerald-500/10",
  },
  warn: {
    icon: <TriangleAlert className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />,
    cls: "border-amber-500/40 bg-amber-500/10",
  },
  info: {
    icon: <Sparkles className="size-4 shrink-0 text-primary" />,
    cls: "border-primary/40 bg-primary/5",
  },
};

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm font-medium"
      >
        <span dir="auto" className="min-w-0">{md(q)}</span>
        <ChevronDown
          className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")}
        />
      </button>
      {open ? (
        <p dir="auto" className="border-t px-3 py-2 text-sm leading-relaxed text-muted-foreground">
          {md(a)}
        </p>
      ) : null}
    </div>
  );
}

/** A table block. **ON A PHONE IT IS NOT A TABLE** (v33.50).
 *
 *  The rule everywhere else in Sodio is that card lists replace tables on
 *  phones; the help center was the one place still shipping a real `<table>`
 *  to a 375px screen. Three columns of prose inside `overflow-x-auto` came out
 *  as slivers two words wide with the LAST column cut off at the edge and
 *  nothing to say it could be scrolled — which is what "the help center is
 *  broken on mobile" looks like: the reference tables (who sees which lane,
 *  what each KPI means) were the part you couldn't read.
 *
 *  Below `sm` each ROW becomes a card: the first cell is its heading, the rest
 *  are labelled with their own column header. Same data, same order, nothing
 *  hidden, no sideways scrolling. From `sm` up the table is exactly what it
 *  was. */
function HelpTable({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <>
      {/* phones — one card per row */}
      <div className="space-y-2 sm:hidden">
        {rows.map((r, i) => (
          <div key={i} className="rounded-lg border">
            <p dir="auto" className="rounded-t-lg bg-muted/60 px-3 py-1.5 text-sm font-semibold">
              {md(r[0])}
            </p>
            <div className="space-y-1.5 px-3 py-2">
              {r.slice(1).map((c, j) => (
                <div key={j}>
                  <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                    {md(headers[j + 1] ?? "")}
                  </p>
                  <p dir="auto" className="text-sm leading-relaxed">{md(c)}</p>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      {/* everything wider — the table it always was */}
      <div className="hidden overflow-x-auto rounded-lg border sm:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/60 text-left text-xs text-muted-foreground">
              {headers.map((h, i) => (
                <th key={i} className="px-3 py-1.5 font-semibold">{md(h)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t">
                {r.map((c, j) => (
                  <td key={j} dir="auto" className="px-3 py-1.5 align-top leading-relaxed">
                    {md(c)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Block({ b }: { b: HelpBlock }) {
  switch (b.t) {
    case "p":
      return b.md ? <p dir="auto" className="text-sm leading-relaxed">{md(b.md)}</p> : null;
    case "callout": {
      const s = CALLOUT_STYLE[b.tone ?? "info"] ?? CALLOUT_STYLE.info;
      return b.md ? (
        <div className={cn("flex items-start gap-2.5 rounded-lg border p-3 text-sm leading-relaxed", s.cls)}>
          {s.icon}
          <span dir="auto" className="min-w-0">{md(b.md)}</span>
        </div>
      ) : null;
    }
    case "steps":
      return b.items && b.items.length > 0 ? (
        <div className="space-y-1.5">
          {b.title ? <p className="text-sm font-semibold">{md(b.title)}</p> : null}
          <ol className="space-y-1.5">
            {b.items.map((it, i) => (
              <li key={i} className="flex gap-2.5 text-sm leading-relaxed">
                <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-bold text-primary">
                  {i + 1}
                </span>
                <span dir="auto" className="min-w-0">{md(it)}</span>
              </li>
            ))}
          </ol>
        </div>
      ) : null;
    case "table":
      return b.headers && b.rows ? <HelpTable headers={b.headers} rows={b.rows} /> : null;
    case "faq":
      return b.faqItems && b.faqItems.length > 0 ? (
        <div className="space-y-1.5">
          <p className="text-sm font-semibold">Quick answers</p>
          {b.faqItems.map((f, i) => (
            <FaqItem key={i} q={f.q} a={f.a} />
          ))}
        </div>
      ) : null;
    case "diagram":
      return b.diagramId ? <HelpDiagram id={b.diagramId} caption={b.caption} /> : null;
    default:
      return null;
  }
}

// ------------------------------------------------------------ the Violet Man

function AskAiCard({ prefill, label }: { prefill?: string; label?: string }) {
  return (
    <button
      type="button"
      onClick={() =>
        window.dispatchEvent(new CustomEvent("sodio:ask-violet-man", { detail: { prefill } }))
      }
      className="group flex w-full items-center gap-3 rounded-xl border border-primary/30 bg-primary/5 p-3.5 text-left transition-colors hover:border-primary/60 hover:bg-primary/10"
    >
      <span className="text-2xl">🚶</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-primary">
          {label ?? "Ask The Violet Man"}
        </span>
        <span className="block text-xs text-muted-foreground">
          The AI that knows the whole system AND your own numbers. Arabic works
          too — he never sleeps.
        </span>
      </span>
      <Sparkles className="size-4 shrink-0 text-primary transition-transform group-hover:rotate-12" />
    </button>
  );
}

// ------------------------------------------------------------ the view

export function HelpView({ viewer }: { viewer: HelpViewer }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [navPending, startNav] = useTransition();

  const keys = useMemo(() => viewerAudienceKeys(viewer), [viewer]);
  const articleId = searchParams.get("a");
  const categoryId = searchParams.get("c");
  const urlQuery = searchParams.get("q") ?? "";
  const [query, setQuery] = useState(urlQuery);
  const [forMe, setForMe] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  // one navigation helper: URL is the state, so every view is shareable
  const go = useCallback(
    (patch: Record<string, string | null>) => {
      const p = new URLSearchParams(searchParams.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === "") p.delete(k);
        else p.set(k, v);
      }
      startNav(() => router.replace(`/help${p.size ? `?${p}` : ""}`, { scroll: false }));
    },
    [router, searchParams]
  );

  // the search box writes the URL debounced — back button = previous search
  useEffect(() => {
    const t = setTimeout(() => {
      if (query !== urlQuery) go({ q: query || null, a: null, c: null });
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  // the body-text search index, built once
  const index = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of HELP_ARTICLES) m.set(a.id, articleSearchText(a));
    return m;
  }, []);

  const visible = useMemo(
    () => (forMe ? HELP_ARTICLES.filter((a) => articleIsForViewer(a, keys)) : HELP_ARTICLES),
    [forMe, keys]
  );

  const hits = useMemo(
    () => searchArticles(visible, index, urlQuery),
    [visible, index, urlQuery]
  );

  const article = articleId ? HELP_ARTICLES.find((a) => a.id === articleId) ?? null : null;
  const category = categoryId
    ? HELP_CATEGORIES.find((c) => c.id === categoryId) ?? null
    : null;

  // an opened article always starts at the top
  useEffect(() => {
    if (articleId) window.scrollTo({ top: 0 });
  }, [articleId]);

  const catOf = (a: HelpArticle): HelpCategory | undefined =>
    HELP_CATEGORIES.find((c) => c.id === a.category);

  const countIn = (c: HelpCategory) => visible.filter((a) => a.category === c.id).length;

  // ------------------------------------------------------------ pieces

  const searchBox = (
    <div className="relative">
      <Search className="absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" />
      <Input
        ref={searchRef}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && hits[0]) go({ a: hits[0].article.id });
          if (e.key === "Escape") setQuery("");
        }}
        // SHORT ON PURPOSE: a 375px box fits ~28 characters, so the old
        // placeholder ("Search anything — accounts, visits, sign-ups, لو سمحت
        // بالعربي كمان…") was cut mid-word and the Arabic half — the part that
        // tells half the LC they can type Arabic — was never seen on a phone.
        placeholder="Search anything — بالعربي كمان…"
        className="h-12 rounded-xl border-2 pl-11 pr-10 text-base shadow-sm"
        dir="auto"
        aria-label="Search the help center"
      />
      {query ? (
        <button
          type="button"
          onClick={() => setQuery("")}
          className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted-foreground hover:bg-muted"
          aria-label="Clear search"
        >
          <X className="size-4" />
        </button>
      ) : null}
    </div>
  );

  const articleRow = (a: HelpArticle, snippet?: string | null) => {
    const c = catOf(a);
    return (
      <button
        key={a.id}
        type="button"
        onClick={() => go({ a: a.id })}
        className="flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-colors hover:border-primary/50 hover:bg-muted/40"
      >
        <span className="mt-0.5 text-xl">{a.emoji}</span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold">{a.title}</span>
            {c ? (
              <span
                className="rounded-full px-2 py-0.5 text-[10px] font-bold text-white"
                style={{ backgroundColor: c.color }}
              >
                {c.title}
              </span>
            ) : null}
          </span>
          <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
            {snippet ?? a.summary}
          </span>
        </span>
        <ChevronRight className="mt-1 size-4 shrink-0 text-muted-foreground" />
      </button>
    );
  };

  // ------------------------------------------------------------ article view

  if (article) {
    const c = catOf(article);
    const related = visible
      .filter((x) => x.category === article.category && x.id !== article.id)
      .slice(0, 4);
    return (
      <div className={cn("mx-auto max-w-3xl space-y-4", navPending && "nav-pending")}>
        <div className="flex flex-wrap items-center gap-2 rise-in">
          <button
            type="button"
            onClick={() => go({ a: null })}
            className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary"
          >
            <ArrowLeft className="size-3.5" /> Help center
          </button>
          {c ? (
            <button
              type="button"
              onClick={() => go({ a: null, c: c.id, q: null })}
              className="rounded-full px-3 py-1.5 text-xs font-bold text-white transition-opacity hover:opacity-85"
              style={{ backgroundColor: c.color }}
            >
              {c.emoji} {c.title}
            </button>
          ) : null}
        </div>

        <Card className="rise-in rise-in-1">
          <CardContent className="space-y-3.5 pt-5">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <h1 className="flex items-center gap-2.5 text-xl font-bold">
                <span className="text-2xl">{article.emoji}</span> {article.title}
              </h1>
              <Badge
                variant="outline"
                className="font-semibold"
                style={c ? { color: c.color, borderColor: c.color } : undefined}
              >
                For: {article.audience}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">{article.summary}</p>
            <div className="space-y-3.5 border-t pt-3.5">
              {article.blocks.map((b, i) => (
                <Block key={i} b={b} />
              ))}
            </div>
          </CardContent>
        </Card>

        <AskAiCard
          label={`Still stuck? Ask The Violet Man about "${article.title}"`}
          prefill={`About "${article.title}": `}
        />

        {related.length > 0 ? (
          <div className="space-y-1.5 rise-in rise-in-2">
            <p className="px-1 text-xs font-bold uppercase tracking-wide text-muted-foreground">
              Related
            </p>
            {related.map((r) => articleRow(r))}
          </div>
        ) : null}

        <p className="pb-4 text-center text-xs text-muted-foreground">
          Wrong or unclear? Say it on <Link prefetch={false} href="/feedback" className="font-medium text-primary hover:underline">Feedback</Link> — it reaches the IM team directly. 💙
        </p>
      </div>
    );
  }

  // ------------------------------------------------------------ home / search / category

  const showCategories = !urlQuery && !category;
  const catArticles = category ? visible.filter((a) => a.category === category.id) : [];

  return (
    <div className={cn("mx-auto max-w-4xl space-y-5", navPending && "nav-pending")}>
      {/* hero */}
      <div className="rise-in hero-animate overflow-hidden rounded-2xl border bg-gradient-to-br from-[#037EF3] to-[#7552CC] p-6 text-white sm:p-8">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="flex items-center gap-2 text-2xl font-extrabold tracking-tight sm:text-3xl">
            <BookOpen className="size-7" /> How can we help? 💙
          </h1>
          <Badge className="border-white/30 bg-white/15 text-white">{HELP_VERSION}</Badge>
          <button
            type="button"
            className="ml-auto rounded-full border border-white/30 bg-white/10 px-3 py-1 text-xs font-medium text-white transition hover:bg-white/20"
            onClick={() => window.dispatchEvent(new Event("sodio:replay-tour"))}
          >
            ↻ Replay the walkthrough
          </button>
        </div>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-white/85">
          Everything about Sodio, searchable — how-tos, FAQs and the fine
          print, updated with every release. Can&apos;t find it? The Violet Man
          reads your actual data and answers anything.
        </p>
        <div className="mt-4">{searchBox}</div>
      </div>

      {/* search results */}
      {urlQuery ? (
        <div className="space-y-1.5 rise-in">
          <div className="flex items-center justify-between px-1">
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
              {hits.length > 0
                ? `${hits.length} result${hits.length === 1 ? "" : "s"}`
                : "No results"}
            </p>
            <ForMeToggle forMe={forMe} setForMe={setForMe} />
          </div>
          {hits.map((h) => articleRow(h.article, h.snippet))}
          <AskAiCard
            label={
              hits.length > 0
                ? `Not what you meant? Ask The Violet Man about "${urlQuery}"`
                : `Ask The Violet Man about "${urlQuery}"`
            }
            prefill={urlQuery}
          />
        </div>
      ) : null}

      {/* one category */}
      {category && !urlQuery ? (
        <div className="space-y-1.5 rise-in">
          <div className="flex flex-wrap items-center gap-2 px-1">
            <button
              type="button"
              onClick={() => go({ c: null })}
              className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary"
            >
              <ArrowLeft className="size-3.5" /> All topics
            </button>
            <h2 className="flex items-center gap-2 text-lg font-bold">
              <span>{category.emoji}</span> {category.title}
            </h2>
            <span className="text-xs text-muted-foreground">{category.blurb}</span>
          </div>
          {catArticles.map((a) => articleRow(a))}
          {catArticles.length === 0 ? (
            <p className="px-1 py-4 text-sm text-muted-foreground">
              Nothing here for your filter — switch off &quot;For me&quot; above.
            </p>
          ) : null}
        </div>
      ) : null}

      {/* home: category grid */}
      {showCategories ? (
        <>
          <div className="flex items-center justify-between px-1 rise-in rise-in-1">
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
              Browse by topic
            </p>
            <ForMeToggle forMe={forMe} setForMe={setForMe} />
          </div>
          <div className="stagger grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {HELP_CATEGORIES.map((c) => {
              const n = countIn(c);
              if (forMe && n === 0) return null;
              const yours = c.audienceKeys.some((k) => k === "everyone" || keys.has(k));
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => go({ c: c.id })}
                  className="rise-in flex flex-col items-start gap-1.5 rounded-xl border-l-4 border-y border-r bg-card p-4 text-left shadow-xs transition-all hover:-translate-y-0.5 hover:shadow-md"
                  style={{ borderLeftColor: c.color }}
                >
                  <span className="flex w-full items-center gap-2">
                    <span className="text-xl">{c.emoji}</span>
                    <span className="text-sm font-bold">{c.title}</span>
                    {yours && !forMe ? (
                      <span
                        className="ml-auto rounded-full px-2 py-0.5 text-[10px] font-bold text-white"
                        style={{ backgroundColor: c.color }}
                      >
                        That&apos;s you
                      </span>
                    ) : (
                      <span className="ml-auto text-xs text-muted-foreground">{n}</span>
                    )}
                  </span>
                  <span className="text-xs leading-relaxed text-muted-foreground">{c.blurb}</span>
                </button>
              );
            })}
          </div>

          {/* popular quick answers — the FAQ articles' questions, flattened */}
          <PopularFaqs visible={visible} onOpen={(id) => go({ a: id })} />

          <AskAiCard />
          <p className="pb-4 text-center text-xs text-muted-foreground">
            Sodio Help · {HELP_VERSION} — updated with every release. Something
            wrong or missing? Tell us on{" "}
            <Link prefetch={false} href="/feedback" className="font-medium text-primary hover:underline">Feedback</Link>. 💙
          </p>
        </>
      ) : null}
    </div>
  );
}

function ForMeToggle({ forMe, setForMe }: { forMe: boolean; setForMe: (v: boolean) => void }) {
  return (
    <div className="inline-flex items-center gap-1 rounded-full border bg-muted p-0.5">
      {([
        { v: false, label: "Everything" },
        { v: true, label: "For me" },
      ] as const).map((t) => (
        <button
          key={t.label}
          type="button"
          onClick={() => setForMe(t.v)}
          className={cn(
            "rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors",
            forMe === t.v ? "bg-background shadow-sm" : "text-muted-foreground"
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

/** A handful of high-traffic questions on the home page, pulled from the FAQ
 *  category's articles — tap one and it opens the article that answers it. */
function PopularFaqs({
  visible, onOpen,
}: {
  visible: HelpArticle[];
  onOpen: (articleId: string) => void;
}) {
  const qs = useMemo(() => {
    const out: { q: string; articleId: string }[] = [];
    for (const a of visible.filter((x) => x.category === "faq")) {
      for (const b of a.blocks) {
        if (b.t === "faq" && b.faqItems) {
          for (const f of b.faqItems) out.push({ q: f.q, articleId: a.id });
        }
      }
    }
    return out.slice(0, 8);
  }, [visible]);
  if (qs.length === 0) return null;
  return (
    <div className="space-y-1.5 rise-in rise-in-2">
      <p className="px-1 text-xs font-bold uppercase tracking-wide text-muted-foreground">
        Popular questions
      </p>
      <div className="grid gap-1.5 sm:grid-cols-2">
        {qs.map((f, i) => (
          <button
            key={i}
            type="button"
            onClick={() => onOpen(f.articleId)}
            className="flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors hover:border-primary/50 hover:bg-muted/40"
          >
            <span className="shrink-0 text-muted-foreground">❓</span>
            {/* two lines on a phone, one from sm up: a truncated question is
                one you can't decide whether to tap */}
            <span dir="auto" className="min-w-0 flex-1 line-clamp-2 sm:truncate">{f.q}</span>
            <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
          </button>
        ))}
      </div>
    </div>
  );
}
