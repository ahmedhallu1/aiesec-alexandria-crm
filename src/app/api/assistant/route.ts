import { NextResponse } from "next/server";
import {
  fetchAll, getAccount, getDashboard, getViewer, listAccounts, listIrCalls, listPartnerLcDetails,
  listSignupsPage, listVisibleMembers, searchCvs,
} from "@/server/data";
import type { AccountFilters, PipelineRow } from "@/server/data";
import { canSeeCvPool, hasConsiderationAccess, isB2C, ogxFunctions } from "@/lib/rbac";
import { db } from "@/lib/supabase";
import { VIOLET_MAN_SYSTEM_PROMPT, buildAssistantContext } from "@/lib/assistant";
import {
  PERIOD_HELP, PERIOD_KEYS, cairoDay, resolvePeriod, type PeriodKey,
} from "@/lib/ask-period";
import { accountSlug, fmtDay } from "@/lib/types";

export const maxDuration = 60;

/** distinct industry / account_type values, module memory (v37.7) */
const DISTINCT_CACHE = new Map<string, { at: number; vals: string[] }>();

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

/** v36.4 — HE CAN LOOK UP EVERYTHING THIS USER MAY SEE. Asked in as many
 *  words, over a screenshot of him saying "I can't filter by industry with
 *  this search": "he should be able to read EVERYTHING ON THE SYSTEM!". The
 *  account search now filters by every field the accounts list does and
 *  returns every field, and sign-ups, partner LCs, IR calls and members have
 *  tools of their own — each offered only to people who can already open
 *  that data, and each running the same RBAC-scoped read the page does, so
 *  he can never show a member something their own screens wouldn't. */
const TOOLS_NOTE = `
YOUR TOOLS READ THE LIVE SYSTEM. Anything this user may see in Sodio, you can look up: searchAccounts filters accounts by ANY field (industry, type, stage, product lane, project, responsible person, last contact result, Podio, deals, proposal, archived, date added) and matches names, phone numbers, emails and links; getAccountDetail returns every field, contact, visit, deal and comment of one account; the other tools cover sign-ups, partner LCs, IR calls, members and CVs where this user has access. NEVER tell the user you can't search or filter by a field — call the tool with that filter. When a first search finds nothing, try again with a looser word or another field before saying there is nothing.`;

/** Every account field, compact. */
function rowSummary(a: PipelineRow) {
  return {
    name: a.name,
    function: a.function,
    product: a.product,
    project: a.project,
    stage: a.stage,
    responsible: a.responsible_name || "Unassigned",
    contacts_logged: a.attempts,
    deals: a.deals_count ?? 0,
    opens: a.slots_count ?? 0,
    archived: a.out_of_process ? a.oop_reason ?? true : false,
    next_step: a.next_step
      ? `${a.next_step} (${a.next_step_date ?? "no date"})`
      : null,
    link: `/accounts/${accountSlug(a.name).replace(/\(/g, "%28").replace(/\)/g, "%29")}`,
  };
}

function fullRow(a: PipelineRow) {
  const contacts = a.contacts ?? [];
  const of = (kind: "phone" | "email" | "link") =>
    contacts.filter((c) => c.kind === kind).map((c) => `${c.tag}: ${c.value}`);
  return {
    ...rowSummary(a),
    industry: a.industry,
    type: a.account_type,
    sub_product: a.sub_product,
    phones: of("phone"),
    emails: of("email"),
    links: of("link"),
    team: a.responsible_team_name,
    podio: { requested: a.requested_podio, state: a.request_state },
    proposal_sent: a.proposal_sent,
    added: fmtDay(a.created_at),
    last_contact: a.last_contact_at
      ? { date: fmtDay(a.last_contact_at), result: a.last_contact_status, method: a.last_contact_method }
      : null,
    visit: a.visit_date ? { date: a.visit_date, time: a.visit_time, done: a.visit_done } : null,
    pinned_comment: a.pinned_comment ?? null,
  };
}

/** Any row, reduced to its readable fields — ids, tokens and blobs dropped. */
function compact(row: object): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (/(^id$|_id$|token|hash|password|refresh|secret)/i.test(k) || v == null || v === "") continue;
    if (typeof v === "string") out[k] = v.length > 300 ? `${v.slice(0, 300)}…` : v;
    else if (typeof v === "number" || typeof v === "boolean") out[k] = v;
    else if (Array.isArray(v) && v.every((x) => typeof x === "string")) out[k] = v.slice(0, 12);
  }
  return out;
}

const fold = (s: unknown) =>
  String(s ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

const DAY = /^\d{4}-\d{2}-\d{2}$/;

const ACCOUNT_SEARCH = {
  name: "searchAccounts",
  description:
    "Find Sodio accounts by ANY field, or a mix: part of the name, a phone number, email or link (partial is fine), industry, type, stage, product lane, project, IGT sub-product, who holds it, last contact result, Podio, deals, proposal, archived, date added. Returns up to 25 accounts with every field (phones, emails, links, industry, stage, next step, Podio…). Use it for EVERY question about accounts — 'veterinary clinics', 'IT companies Salma holds', 'who has 01012345678', 'accounts that reached Deal Done in IGT', 'unassigned schools'. Industry and type are matched loosely.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Part of the name, or a phone / email / link" },
      industry: { type: "string", description: "Any part of the industry word, e.g. 'veterin', 'software', 'school'" },
      accountType: { type: "string" },
      lane: { type: "string", description: "IGV, IGT, IGTa, IGTe, B2B, BD, B2C — comma-separate several" },
      stage: { type: "string" },
      project: { type: "string" },
      subProduct: { type: "string" },
      responsible: { type: "string", description: "A member's name, 'me', or 'unassigned'" },
      lastContactResult: { type: "string", description: "e.g. No Response, Interested, Not Interested" },
      podio: { type: "string", description: "requested | not_requested | Checking | Approved | Rejected" },
      hasDeals: { type: "boolean" },
      proposalSent: { type: "boolean" },
      archived: { type: "string", enum: ["exclude", "include", "only"], description: "default exclude" },
      addedFrom: { type: "string", description: "YYYY-MM-DD" },
      addedTo: { type: "string", description: "YYYY-MM-DD" },
      limit: { type: "number" },
    },
  },
};

const BASE_DECLS = [
  ACCOUNT_SEARCH,
  {
    name: "getAccountDetail",
    description:
      "EVERYTHING about ONE Sodio account by its name: every field, every phone/email/link, the contact history, visits, deals and comments.",
    parameters: {
      type: "object",
      properties: { name: { type: "string", description: "The account's name" } },
      required: ["name"],
    },
  },
  {
    name: "findMembers",
    description:
      "Members of the LC this user works with: name, role, function(s), sub-function and team. Filter by part of a name, a function (IGV, IGT, B2B, BD, B2C, OGV, OGT, TM…) or a role.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string" },
        function: { type: "string" },
        role: { type: "string" },
      },
    },
  },
  {
    name: "webInfo",
    description:
      "Answer a question that needs LIVE web information (AIESEC sites, core.aiesec.org.eg rankings beyond the digest, general facts) via Google Search. Pass a self-contained question.",
    parameters: {
      type: "object",
      properties: { question: { type: "string" } },
      required: ["question"],
    },
  },
  {
    // ── THE DATE TOOL (v34.8) ────────────────────────────────────────────
    // Runs the REAL dashboard read — same function the dashboard page calls,
    // same per-KPI date rules, same RBAC scope — so his answer and the screen
    // cannot disagree.
    name: "getNumbers",
    description:
      "THE ONLY correct way to answer any question about a TIME PERIOD (today, this week, last month, this sprint, a date range…). Returns the real funnel numbers — market research, contacted, visits booked, visits done, deals, opens — counted over that window, each KPI on its own date, scoped to what this user may see. NEVER answer a dated question from the all-time KPI block; call this instead. Always repeat the returned `window` label back to the user.",
    parameters: {
      type: "object",
      properties: {
        period: {
          type: "string",
          enum: [...PERIOD_KEYS],
          description: Object.entries(PERIOD_HELP)
            .map(([k, v]) => `${k}: ${v}`)
            .concat("custom: an explicit from/to (only when the user named real dates)")
            .join(" · "),
        },
        from: { type: "string", description: "custom only — YYYY-MM-DD, inclusive" },
        to: { type: "string", description: "custom only — YYYY-MM-DD, inclusive" },
        whose: {
          type: "string",
          enum: ["me", "my_team", "everyone"],
          description:
            "'me' when the user says I/my/mine (the default for a personal question), 'my_team' for their team, 'everyone' for their whole visible scope.",
        },
        lane: {
          type: "string",
          description:
            "Optional lane to narrow to: all, IGV, IGT, IGTa, IGTe, B2B, BD, B2C. Omit for everything they can see.",
        },
      },
      required: ["period"],
    },
  },
];

/** Offered only to viewers with the Consideration CV pool (v26). */
const SEARCH_CVS_DECL = {
  name: "searchCvs",
  description:
    "Search the consideration CV pool by skills, industry, name or any text from the CVs (e.g. 'C#', 'ERP', 'marketing Tunisia'). Every word must match; returns up to 8 CVs with name, partner LC, industry, phone, email, skills and summary.",
  parameters: {
    type: "object",
    properties: { query: { type: "string", description: "Skills / keywords to look for" } },
    required: ["query"],
  },
};

/** Offered only to viewers who work OGX sign-ups (or call them for B2C). */
const SEARCH_SIGNUPS_DECL = {
  name: "searchSignups",
  description:
    "Search OGX sign-ups — people who signed up to go abroad — by name, phone or email, optionally by status, programme or country. Returns up to 15 with their status, contact and interest, programme, country, who holds them and when they signed up.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string" },
      status: { type: "string" },
      program: { type: "string" },
      country: { type: "string" },
    },
  },
};

/** Offered only to viewers with the Consideration module. */
const CONSIDERATION_DECLS = [
  {
    name: "searchPartnerLcs",
    description:
      "Partner LCs (AIESEC LCs abroad we work with): calls made, CVs received, products reached, their IRs (names, roles, emails, phones) and partnerships. Filter by part of the LC name or country; empty returns the busiest.",
    parameters: { type: "object", properties: { query: { type: "string" } } },
  },
  {
    name: "searchIrCalls",
    description:
      "IR calls with partner LCs — upcoming and past: when, which LC, who ran it, status, notes, demand, who booked it. Filter by text (LC, person, notes), status (scheduled, completed, cancelled) and date range.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string" },
        status: { type: "string", enum: ["scheduled", "completed", "cancelled"] },
        from: { type: "string", description: "YYYY-MM-DD" },
        to: { type: "string", description: "YYYY-MM-DD" },
      },
    },
  },
];

export async function POST(req: Request) {
  let viewer;
  try {
    viewer = await getViewer();
  } catch {
    return NextResponse.json({ error: "Sign in first 🙂" }, { status: 401 });
  }

  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    return NextResponse.json(
      { error: "The Violet Man is missing his GEMINI_API_KEY. Tell the IM director." },
      { status: 500 }
    );
  }

  const { messages } = (await req.json()) as { messages: ChatMessage[] };
  if (!Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json({ error: "Say something first 😄" }, { status: 400 });
  }

  const { text: context, slugs } = await buildAssistantContext(viewer);
  // every slug the model may legitimately link to this request (grounding) —
  // stored DECODED so any encoding variant the model emits still matches
  const safeDecode = (s: string): string | null => {
    try {
      return decodeURIComponent(s);
    } catch {
      return null;
    }
  };
  const allowedSlugs = new Set(slugs.map((s) => safeDecode(s) ?? s));
  const allow = (rows: PipelineRow[]) => {
    for (const r of rows) allowedSlugs.add(safeDecode(accountSlug(r.name)) ?? r.name);
  };

  const callGemini = async (body: unknown) => {
    const res = await fetch(GEMINI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error("[violet-man] Gemini error", res.status, detail.slice(0, 500));
      throw Object.assign(new Error("gemini"), { status: res.status });
    }
    return res.json();
  };

  // secondary, search-grounded call — Gemini can't mix google_search with
  // custom functions in one request, so webInfo() bridges the two worlds
  const webInfo = async (question: string): Promise<string> => {
    try {
      const data = await callGemini({
        system_instruction: {
          parts: [
            {
              text: "Answer concisely with facts found via Google Search. Prefer aiesec.org, aiesec.org.eg, core.aiesec.org.eg, expa.aiesec.org.",
            },
          ],
        },
        contents: [{ role: "user", parts: [{ text: question.slice(0, 1000) }] }],
        tools: [{ google_search: {} }],
        generationConfig: {
          temperature: 0.3, maxOutputTokens: 1024,
          thinkingConfig: { thinkingBudget: 0 },
        },
      });
      return (
        (data as { candidates?: { content?: { parts?: { text?: string }[] } }[] }).candidates?.[0]?.content?.parts
          ?.map((p) => p.text ?? "")
          .join("")
          .trim() || "No web result."
      );
    } catch {
      return "Web lookup unavailable right now.";
    }
  };

  /** Loose words → the exact values stored in a column ("veterin" →
   *  "Veterinary"). Only the distinct VALUES are read here; the accounts
   *  themselves still come through the viewer's scoped list. */
  const valuesLike = async (column: "industry" | "account_type", term: string) => {
    const t = term.replace(/[%_,()"]/g, " ").trim();
    if (!t) return { hits: [] as string[], all: [] as string[] };
    // (v37.7) the DISTINCT values come from a FULL paged read — the old
    // .limit(5000) was capped at 1000 arbitrary rows by PostgREST, so most
    // industries "did not exist". Cached a few minutes (two slim columns).
    let all = DISTINCT_CACHE.get(column)?.vals;
    if (!all || Date.now() - (DISTINCT_CACHE.get(column)?.at ?? 0) > 5 * 60_000) {
      try {
        const rows = await fetchAll<Record<string, string | null>>(() =>
          db().from("accounts").select(column).not(column, "is", null).order("id")
        );
        all = [...new Set(rows.map((r) => r[column]).filter((x): x is string => !!x))];
        DISTINCT_CACHE.set(column, { at: Date.now(), vals: all });
      } catch {
        all = all ?? [];
      }
    }
    const words = fold(t).split(/\s+/).filter(Boolean);
    return { hits: all.filter((v) => words.every((w) => fold(v).includes(w))), all };
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const execTool = async (name: string, args: any): Promise<unknown> => {
    if (name === "searchAccounts") {
      const filters: AccountFilters = {};
      const q = String(args?.query ?? "").trim();
      if (q) filters.q = q;
      for (const [col, arg, prop] of [
        ["industry", args?.industry, "industry"],
        ["account_type", args?.accountType, "accountType"],
      ] as const) {
        const term = String(arg ?? "").trim();
        if (!term) continue;
        const { hits, all } = await valuesLike(col, term);
        if (hits.length === 0)
          return {
            matches: [],
            note: `No account has ${col === "industry" ? "an industry" : "a type"} like "${term}". The ones that exist: ${all.slice(0, 60).join(", ")}. Pick the closest and search again.`,
          };
        filters[prop] = hits.join(",");
      }
      if (args?.lane) filters.lane = String(args.lane);
      if (args?.stage) filters.stage = String(args.stage) as AccountFilters["stage"];
      if (args?.project) filters.project = String(args.project);
      if (args?.subProduct) filters.subProduct = String(args.subProduct);
      if (args?.lastContactResult) filters.lastStatus = String(args.lastContactResult);
      if (args?.podio) filters.podio = String(args.podio);
      if (typeof args?.hasDeals === "boolean") filters.deals = args.hasDeals ? "has" : "none";
      if (typeof args?.proposalSent === "boolean") filters.proposal = args.proposalSent ? "sent" : "not_sent";
      if (DAY.test(String(args?.addedFrom ?? ""))) filters.from = String(args.addedFrom);
      if (DAY.test(String(args?.addedTo ?? ""))) filters.to = String(args.addedTo);
      const who = fold(args?.responsible);
      if (who === "me") filters.responsibleId = viewer.id;
      else if (["unassigned", "nobody", "none", "no one"].includes(who)) filters.responsibleId = "none";
      else if (who) {
        const people = (await listVisibleMembers(viewer)).filter((m) => fold(m.name).includes(who));
        if (people.length === 0) return { matches: [], note: `Nobody called "${args.responsible}" in this user's scope.` };
        filters.responsibleId = people.map((m) => m.id).join(",");
      }
      const limit = Math.min(40, Math.max(1, Number(args?.limit) || 25));
      const archived = String(args?.archived ?? "exclude");
      let rows: PipelineRow[];
      if (archived === "only") {
        rows = await listAccounts(viewer, { ...filters, archived: true }, limit);
      } else if (archived === "include") {
        // scoped actives + the LC-WIDE archive (v22.2: every member may check
        // a dead name) — the Archived query path skips accountScope
        const [scoped, archivedAll] = await Promise.all([
          listAccounts(viewer, { ...filters, includeArchived: true }, limit),
          listAccounts(viewer, { ...filters, archived: true }, limit),
        ]);
        const seen = new Set<string>();
        rows = [...scoped, ...archivedAll]
          .filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)))
          .slice(0, limit);
      } else {
        rows = await listAccounts(viewer, filters, limit);
      }
      allow(rows);
      return { count: rows.length, matches: rows.map(fullRow) };
    }
    if (name === "getAccountDetail") {
      const nm = String(args?.name ?? "").trim();
      if (!nm) return { error: "name required" };
      // getAccount re-checks canViewAccount — never more than the account
      // page itself would show this member
      const result =
        (await getAccount(viewer, accountSlug(nm))) ??
        (await (async () => {
          const [hit] = await listAccounts(viewer, { q: nm, includeArchived: true }, 1);
          return hit ? getAccount(viewer, accountSlug(hit.name)) : null;
        })());
      if (!result) return { error: "No such account in your scope." };
      const { account, attempts, visits, deals, comments } = result;
      allow([account]);
      return {
        account: fullRow(account),
        contact_history: attempts.slice(0, 20).map((c) => ({
          date: fmtDay(c.created_at),
          method: c.method,
          result: c.status,
          comment: c.comment,
        })),
        visits: visits.slice(0, 10).map((v) => compact(v)),
        deals: deals.slice(0, 10).map((d) => ({
          date: fmtDay(d.created_at),
          opens: d.slots,
          igv: d.slots_igv,
          igta: d.slots_igta,
          igte: d.slots_igte,
          egp: d.amount || 0,
          note: d.note,
        })),
        comments: comments.slice(-12).map((c) => ({
          by: c.member?.name || c.author_label,
          body: c.body.slice(0, 600),
        })),
      };
    }
    if (name === "findMembers") {
      const q = fold(args?.query);
      const fn = String(args?.function ?? "").trim().toUpperCase();
      const role = fold(args?.role);
      const people = (await listVisibleMembers(viewer))
        .filter((m) => !q || fold(m.name).includes(q))
        .filter(
          (m) =>
            !fn ||
            (m.functions ?? []).map((f) => f.toUpperCase()).includes(fn) ||
            (m.sub_functions ?? []).map((f) => f.toUpperCase()).includes(fn)
        )
        .filter((m) => !role || fold(m.role).includes(role))
        .slice(0, 40);
      return {
        count: people.length,
        members: people.map((m) => ({
          name: m.name,
          role: m.role,
          functions: m.functions,
          sub_functions: m.sub_functions,
          team: m.team_name,
        })),
      };
    }
    if (name === "webInfo") return { answer: await webInfo(String(args?.question ?? "")) };
    if (name === "getNumbers") {
      // an unknown period name must NOT quietly become "all time" — that is
      // the exact failure this tool exists to remove
      const raw = String(args?.period ?? "");
      const period = (PERIOD_KEYS as readonly string[]).includes(raw)
        ? (raw as PeriodKey)
        : null;
      if (!period) {
        return {
          error: `Unknown period "${raw}". Use one of: ${PERIOD_KEYS.join(", ")}.`,
        };
      }
      const win = resolvePeriod(period, cairoDay(), {
        from: args?.from ?? null,
        to: args?.to ?? null,
      });

      const whose = ["me", "my_team", "everyone"].includes(String(args?.whose))
        ? String(args.whose)
        : "everyone";
      // getDashboard applies these itself and re-checks the viewer's scope, so
      // "my team" can never resolve to a team this member cannot see
      const filters: AccountFilters = {
        from: win.from ?? undefined,
        to: win.to ?? undefined,
      };
      if (whose === "me") filters.responsibleId = viewer.id;
      if (whose === "my_team") filters.teamId = viewer.id;

      const laneRaw = String(args?.lane ?? "").trim();
      const lane =
        laneRaw && /^(all|IGV|IGT|IGTa|IGTe|B2B|BD|B2C)$/i.test(laneRaw) ? laneRaw : undefined;

      try {
        const d = await getDashboard(viewer, filters, lane);
        return {
          window: win.label,
          from: win.from ?? "(no start — all time)",
          to: win.to ?? "(no end — all time)",
          whose:
            whose === "me" ? `${viewer.name}'s own accounts`
            : whose === "my_team" ? `${viewer.name}'s team`
            : "everything this user can see",
          lane: lane ?? "everything in scope",
          marketResearch: d.total.mr,
          contacted: d.total.contacted,
          visitsBooked: d.total.visitScheduled,
          visitsDone: d.total.visitDone,
          deals: d.total.deals,
          opens: d.total.slots,
          counted_on:
            "research = day the account was added · contacted = day of the contact attempt · visitsBooked = day the visit was booked · visitsDone = the visit's own date · deals & opens = the day the deal was signed",
        };
      } catch (e) {
        console.error("[violet-man] getNumbers failed:", e);
        return { error: "Couldn't read the numbers for that window. Say so — do not estimate." };
      }
    }
    if (name === "searchCvs") {
      // searchCvs re-checks canSeeCvPool server-side too (IGT-only since v27)
      if (!canSeeCvPool(viewer))
        return { error: "The consideration CV pool is outside this user's access." };
      const q = String(args?.query ?? "").trim();
      if (q.length < 2) return { error: "query too short" };
      return await searchCvs(viewer, q);
    }
    if (name === "searchSignups") {
      const filters = {
        q: String(args?.query ?? "").trim() || undefined,
        status: args?.status ? String(args.status) : undefined,
        program: args?.program ? String(args.program) : undefined,
        country: args?.country ? String(args.country) : undefined,
      };
      const res = await listSignupsPage(viewer, filters, 0, 15);
      return { total: res.total, matches: res.rows.map((r) => compact(r)) };
    }
    if (name === "searchPartnerLcs") {
      if (!hasConsiderationAccess(viewer)) return { error: "Partner LCs are outside this user's access." };
      const q = fold(args?.query);
      const lcs = (await listPartnerLcDetails(viewer))
        .filter((l) => !q || fold(l.name).includes(q) || fold(l.country).includes(q))
        .slice(0, 15);
      return {
        count: lcs.length,
        lcs: lcs.map((l) => ({
          ...compact(l),
          products: l.products,
          irs: (l.contacts ?? []).slice(0, 8).map((c) => compact(c)),
          partnerships: (l.partnerships ?? []).map((p) => compact(p)),
        })),
      };
    }
    if (name === "searchIrCalls") {
      if (!hasConsiderationAccess(viewer)) return { error: "IR calls are outside this user's access." };
      const res = await listIrCalls(viewer, 0, 20, undefined, {
        q: String(args?.query ?? "").trim() || undefined,
        status: args?.status ? String(args.status) : undefined,
        from: DAY.test(String(args?.from ?? "")) ? String(args.from) : undefined,
        to: DAY.test(String(args?.to ?? "")) ? String(args.to) : undefined,
      });
      return {
        total: res.total,
        upcoming: res.scheduled.slice(0, 10).map((c) => compact(c)),
        log: res.rows.map((c) => compact(c)),
      };
    }
    return { error: `unknown tool ${name}` };
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const contents: any[] = messages.slice(-12).map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content.slice(0, 4000) }],
  }));

  // each module's tools exist only for people who can open that module
  const functionDecls = [
    ...BASE_DECLS,
    ...(canSeeCvPool(viewer) ? [SEARCH_CVS_DECL] : []),
    ...(ogxFunctions(viewer).length > 0 || isB2C(viewer) ? [SEARCH_SIGNUPS_DECL] : []),
    ...(hasConsiderationAccess(viewer) ? CONSIDERATION_DECLS : []),
  ];

  let text = "";
  try {
    // tool loop: up to 4 rounds of function calls, then the final answer
    for (let round = 0; round < 5; round++) {
      const data = (await callGemini({
        system_instruction: {
          parts: [{ text: `${VIOLET_MAN_SYSTEM_PROMPT}\n${TOOLS_NOTE}\n\n${context}` }],
        },
        contents,
        tools: [{ function_declarations: functionDecls }],
        generationConfig: {
          // detail is the point (v32.7): 1024 truncated real answers —
          // tables, rankings and step-by-steps all need room
          temperature: 0.6, maxOutputTokens: 3072,
          // 2.5-flash "thinks" by default — with several sequential calls per
          // request that blows the 60s serverless budget; keep it snappy
          thinkingConfig: { thinkingBudget: 0 },
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      })) as any;
      const cand = data.candidates?.[0];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const parts: any[] = cand?.content?.parts ?? [];
      const calls = parts.filter((p) => p.functionCall);
      if (calls.length === 0 || round === 4) {
        text = parts
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .map((p: any) => p.text ?? "")
          .join("")
          .trim();
        break;
      }
      contents.push(cand.content);
      const responses = await Promise.all(
        calls.map(async (c) => ({
          functionResponse: {
            name: c.functionCall.name,
            response: { result: await execTool(c.functionCall.name, c.functionCall.args) },
          },
        }))
      );
      contents.push({ role: "user", parts: responses });
    }
  } catch (e) {
    const status = (e as { status?: number }).status;
    return NextResponse.json(
      {
        error:
          status === 429
            ? "The Violet Man walked too much today (free-tier limit). Try again in a minute 🚶💨"
            : "The Violet Man tripped over a cable. Try again.",
      },
      { status: 502 }
    );
  }

  if (!text) text = "…I blanked. Ask me again? 🚶";

  // ---- GROUNDING (v22.2): every internal link must point at something REAL
  // and visible to THIS viewer — hallucinated slugs are stripped down to text.
  const STATIC_PATHS = new Set([
    "/accounts", "/accounts/import", "/dashboard", "/calendar", "/help", "/playbook",
    "/profile", "/planning", "/members", "/lc-feedback", "/feedback",
    "/feedback/inbox", "/membership", "/admin", "/consideration", "/signups",
  ]);
  text = text.replace(
    /\[([^\]]+)\]\((\/[^)\s]*)\)/g,
    (whole, label: string, path: string) => {
      const [clean] = path.split("?");
      if (STATIC_PATHS.has(clean)) return whole;
      const m = clean.match(/^\/accounts\/(.+)$/);
      if (m) {
        const decoded = safeDecode(m[1]);
        if (decoded !== null && allowedSlugs.has(decoded)) return whole;
      }
      return label; // unknown/hallucinated target → keep the words, drop the link
    }
  );

  return NextResponse.json({ text });
}
