import { NextResponse } from "next/server";
import { getAccount, getDashboard, getViewer, listAccounts, searchCvs } from "@/server/data";
import type { AccountFilters, PipelineRow } from "@/server/data";
import { canSeeCvPool } from "@/lib/rbac";
import { VIOLET_MAN_SYSTEM_PROMPT, buildAssistantContext } from "@/lib/assistant";
import {
  PERIOD_HELP, PERIOD_KEYS, cairoDay, resolvePeriod, type PeriodKey,
} from "@/lib/ask-period";
import { accountSlug, fmtDay } from "@/lib/types";

export const maxDuration = 60;

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

/** v22.2: The Violet Man can LOOK THINGS UP on demand — the context only carries
 *  the freshest 300 accounts of ~4000, so he searches the rest through these
 *  RBAC-scoped functions instead of guessing. */
const FUNCTION_DECLS = [
  {
    name: "searchAccounts",
    description:
      "Search Sodio accounts by (partial) company name. Returns up to 12 matches with stage, responsible, opens and link. Includes archived accounts. Use whenever the user asks about an account you don't see in the context.",
    parameters: {
      type: "object",
      properties: { query: { type: "string", description: "Part of the account name" } },
      required: ["query"],
    },
  },
  {
    name: "getAccountDetail",
    description:
      "Full detail of ONE Sodio account by its exact name: header info, contact history, visits, deals and comments. Use after searchAccounts (or when the user names an account precisely).",
    parameters: {
      type: "object",
      properties: { name: { type: "string", description: "The account's name" } },
      required: ["name"],
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
    // The one fix that matters for "how many visits did I book this week".
    // The context is all-time and the account lines carry no dates, so the
    // model had nothing to count with and produced a plausible number. This
    // runs the REAL dashboard read — same function the dashboard page calls,
    // same per-KPI date rules, same RBAC scope — so his answer and the
    // screen cannot disagree.
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

/** v26 — only offered to viewers with the Consideration module. */
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

/** Compact, token-friendly summary of a pipeline row for tool results. */
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const execTool = async (name: string, args: any): Promise<unknown> => {
    if (name === "searchAccounts") {
      const q = String(args?.query ?? "").trim();
      if (q.length < 2) return { error: "query too short" };
      // scoped actives + the LC-WIDE archive (v22.2: every member may check a
      // dead name) — the Archived query path skips accountScope
      const [scoped, archivedAll] = await Promise.all([
        listAccounts(viewer, { q, includeArchived: true }, 12),
        listAccounts(viewer, { q, archived: true }, 12),
      ]);
      const seen = new Set<string>();
      const rows = [...scoped, ...archivedAll]
        .filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)))
        .slice(0, 12);
      for (const r of rows) allowedSlugs.add(safeDecode(accountSlug(r.name)) ?? r.name);
      return { matches: rows.map(rowSummary) };
    }
    if (name === "getAccountDetail") {
      const nm = String(args?.name ?? "").trim();
      if (!nm) return { error: "name required" };
      // getAccount re-checks canViewAccount — the Violet Man can never show a
      // member something their own account page wouldn't
      const result =
        (await getAccount(viewer, accountSlug(nm))) ??
        (await (async () => {
          const [hit] = await listAccounts(viewer, { q: nm, includeArchived: true }, 1);
          return hit ? getAccount(viewer, accountSlug(hit.name)) : null;
        })());
      if (!result) return { error: "No such account in your scope." };
      const { account, attempts, visits, deals, comments } = result;
      allowedSlugs.add(safeDecode(accountSlug(account.name)) ?? account.name);
      return {
        account: rowSummary(account),
        industry: account.industry,
        type: account.account_type,
        last_contacts: attempts.slice(0, 5).map((c) => ({
          date: fmtDay(c.created_at),
          method: c.method,
          result: c.status,
          comment: c.comment,
        })),
        visits: visits.slice(0, 5).map((v) => ({
          date: v.visit_date,
          done: v.done,
          comment: v.visit_comment,
        })),
        deals: deals.slice(0, 5).map((d) => ({
          date: fmtDay(d.created_at),
          opens: d.slots,
          igv: d.slots_igv,
          igta: d.slots_igta,
          igte: d.slots_igte,
          egp: d.amount || 0,
          note: d.note,
        })),
        comments: comments.slice(-3).map((c) => ({
          by: c.member?.name || c.author_label,
          body: c.body.slice(0, 300),
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
    return { error: `unknown tool ${name}` };
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const contents: any[] = messages.slice(-12).map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content.slice(0, 4000) }],
  }));

  // the CV-pool tool exists only for Consideration-module viewers (v26)
  const functionDecls = canSeeCvPool(viewer)
    ? [...FUNCTION_DECLS, SEARCH_CVS_DECL]
    : FUNCTION_DECLS;

  let text = "";
  try {
    // tool loop: up to 3 rounds of function calls, then the final answer
    for (let round = 0; round < 4; round++) {
      const data = (await callGemini({
        system_instruction: { parts: [{ text: `${VIOLET_MAN_SYSTEM_PROMPT}\n\n${context}` }] },
        contents,
        tools: [{ function_declarations: functionDecls }],
        generationConfig: {
          // detail is the point (v32.7): 1024 truncated real answers —
          // tables, rankings and step-by-steps all need room
          temperature: 0.6, maxOutputTokens: 3072,
          // 2.5-flash "thinks" by default — with up to 5 sequential calls per
          // request that blows the 60s serverless budget; keep it snappy
          thinkingConfig: { thinkingBudget: 0 },
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      })) as any;
      const cand = data.candidates?.[0];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const parts: any[] = cand?.content?.parts ?? [];
      const calls = parts.filter((p) => p.functionCall);
      if (calls.length === 0 || round === 3) {
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
    "/feedback/inbox", "/membership", "/admin", "/consideration",
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
