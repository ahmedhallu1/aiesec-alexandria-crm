"use client";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/** ⚠️ Bump with EVERY release (same commit as the feature) — the playbook is
 *  handed to the next generations and must always describe the live system. */
export const PLAYBOOK_VERSION = "v23";

interface Props {
  role: string;
  isAdmin: boolean;
  isB2B: boolean;
  isB2C: boolean;
  isTm: boolean;
}

interface Section {
  id: string;
  emoji: string;
  title: string;
  audience: string;
  color: string; // accent (AIESEC blue / product colors)
  points: React.ReactNode[];
}

/** Which sections THIS member needs — the playbook renders only these. */
function sectionsForRole(
  role: string, isAdmin: boolean, isB2B: boolean, isB2C: boolean, isTm: boolean
): Set<string> {
  const mine = new Set(["what", "start", "rules"]);
  if (role === "Member" || role === "Coordinator") mine.add("raising");
  if (role === "Team Leader") { mine.add("raising"); mine.add("leaders"); mine.add("data"); }
  if (role === "LCVP" || role === "Director" || role === "LCP") { mine.add("eb"); mine.add("data"); }
  if (isB2B) mine.add("b2b");
  if (isB2C) mine.add("b2c-module");
  if (isTm) mine.add("tm");
  if (isAdmin) { mine.add("im"); mine.add("data"); }
  return mine;
}

const SECTIONS: Section[] = [
  {
    id: "what",
    emoji: "💙",
    title: "What is Sodio?",
    audience: "Everyone",
    color: "#037EF3",
    points: [
      <>A <b>100% free CRM</b> built by AIESEC in Alexandria&apos;s IM team for the ICX <b>Raising</b> process — IGV, IGT and B2B.</>,
      <>Everything lives here: <b>accounts → contacts → visits → deals</b>, plus goals, leaderboards and dashboards.</>,
      <>It automates the boring parts: calendar reminders, follow-up emails, Google Sheets mirrors, notifications.</>,
      <>The one rule everything else builds on: <b>if it&apos;s not in Sodio, it didn&apos;t happen.</b></>,
    ],
  },
  {
    id: "start",
    emoji: "🚀",
    title: "Getting started",
    audience: "Everyone",
    color: "#0CB9C1",
    points: [
      <>First sign-in is <b>Google only</b> (it grants your calendar reminders + Gmail drafts). Onboarding then sets your password.</>,
      <>After that, sign in with <b>email or phone + password</b>, or Google — whatever you like.</>,
      <>Forgot the password? The login page emails you a fresh one instantly. Your old one keeps working until you change it.</>,
      <>Signing in lands you on <b>Accounts</b> — your daily workspace; the Dashboard, Calendar and the rest live in the sidebar.</>,
      <>Meet <b>The Blue Man</b> 🚶 (bottom-right) — he answers questions using your real CRM data and AIESEC sources.</>,
      <>The first-run <b>tour</b> walks you through your workspace. Rewatch it any time from your Profile.</>,
    ],
  },
  {
    id: "raising",
    emoji: "📇",
    title: "The raising cycle",
    audience: "Members & Coordinators",
    color: "#F85A40",
    points: [
      <><b>Add the account first</b> — the name is checked <b>the moment you type it</b> against every ICX account and the archive, so you learn it&apos;s taken BEFORE filling the rest. Bulk import exists for whole research sheets.</>,
      <><b>Log every contact attempt</b> with its result. Picking <b>&quot;Visit Scheduled&quot;</b> books the visit — calendar invite and reminders included.</>,
      <>Every in-process account carries a <b>next step with a date</b> or a pending visit. Three no-responses → the CRM suggests archiving.</>,
      <>The <b>Proposal email</b> button builds a branded, AIESEC-blue outreach draft in <b>your own Gmail</b> — review, attach, send.</>,
      <>Two hours after a visit, you (and your TL) get the <b>report-it email</b> — report from it, the top button, or by clicking the pending visit in History. Ignore it a week and the reminder comes back firmer — report it or archive the account.</>,
      <>The <b>Calendar</b> page (sidebar) shows your whole function&apos;s visits, one color per member — see the rhythm, plan around it.</>,
      <>Deal signed → <b>Record deal</b> 🏆: opens per product, optional <b>contract upload</b> (any file format — add later from History; the account grows a <b>Contracts</b> button to preview & download them). Need to share the credit? <b>Split the opens</b> between members right in the popup (e.g. 3 to the owner, 3 to whoever helped) — leaderboards count each person&apos;s share.</>,
      <>&quot;Not interested&quot; is a valid result: mark the account <b>Out of Process</b> with its reason — from the account page or the ✕ right on the list. Leaders can <b>Select</b> many accounts and archive or reassign them in one go (reassign only offers people you&apos;re allowed to hand accounts to). The archive IS the blacklist — those names never come back, and (v22.2) <b>everyone can browse the whole archive</b> and open any archived account read-only to see who burned it and why.</>,
      <><b>Comments</b> are numbered per author and can be <b>pinned</b> (they surface on the list) or <b>archived</b> to declutter — archived ones tuck behind an &quot;Archived (n)&quot; toggle on the comments card without changing the numbering.</>,
      <>On your phone, the little <b>Cards / Compact / Table</b> switcher above the accounts list lets you pick the density you like — it remembers your choice.</>,
      <><b>Raising Coordinators plan too</b> (v22): on first sign-in Sodio asks for your <b>opens per month</b> of the peak, and the profile&apos;s <b>My plan</b> card lets you update it — with what you actually raised next to each month. Your VP sees it on the Planning board.</>,
    ],
  },
  {
    id: "leaders",
    emoji: "👥",
    title: "Leading a team",
    audience: "Team Leaders",
    color: "#F48924",
    points: [
      <>You see and work <b>your whole team&apos;s accounts</b>, pick the Responsible on each, and can revive archived accounts.</>,
      <><b>Your plan IS the team goal</b> (v22): on first sign-in Sodio asks for your team&apos;s <b>opens per month</b> of the peak, and the profile&apos;s <b>My plan</b> card lets you update it any time — with each month&apos;s actual next to it. The dashboard&apos;s team card and the Planning board track your team against it. Nobody &quot;sets goals&quot; in Sodio anymore.</>,
      <>OGX &amp; Consideration MMs: on your first sign-in Sodio asks for your <b>6-month plan</b> (applicants · accepted · approvals per month of the peak) — those numbers are your goals, visible to your VP on the Planning board and in the period reports.</>,
      <>You&apos;re on your members&apos; <b>visit follow-up emails</b> (and the week-later &quot;forgotten&quot; nags). A nag means an account is frozen — unfreeze it together.</>,
      <>Leaderboards rank <b>Members & Coordinators</b> on their own accounts; deals always belong to the account&apos;s Responsible.</>,
      <>Use the dashboard&apos;s team filter (and <b>My numbers</b> for your own raising) to steer the week.</>,
    ],
  },
  {
    id: "eb",
    emoji: "🧭",
    title: "Steering a function",
    audience: "VPs & Directors",
    color: "#037EF3",
    points: [
      <>Dashboards run per lane: <b>IGV / IGTa / IGTe</b> (All-IGT shows IGTa + IGTe combined).</>,
      <><b>Goals come from planning</b> (v22): the lane goal card shows YOUR planned opens (from the LC&apos;s planning sheet) against what the lane actually raised, per sprint or month. Nothing is set in-app — update the planning sheet and re-import instead.</>,
      <>The <b>Planning</b> tab (v21) carries the term plan from the LC&apos;s planning sheet: opens per month, the consideration funnel per <b>sprint</b> (half-months — 1–15 and 16–end), conversions, quarter totals, and every MM&apos;s filed plan. The dashboard&apos;s product lanes show the current sprint&apos;s plan vs achieved (toggle to month), and the Planning board lists every TL&apos;s and MM&apos;s filed plan.</>,
      <><b>Unassigned accounts</b> (v22): the old sheets&apos; market research was imported with no owner — filter Responsible → <b>Unassigned</b> and hand them out with reassign / bulk-reassign. Members see an account once it&apos;s theirs.</>,
      <>Every <b>sprint, month and quarter</b> close, your whole function + the LCP get the <b>period report email</b>: totals, plan-vs-achieved, and a waterfall with every team&apos;s and every person&apos;s numbers.</>,
      <>The <b>Membership sheet</b> is the source of truth for people — edit in the app or in the sheet, both stay in sync (30-min imports + instant write-back).</>,
      <>Visit reports and function-wide visit announcements reach you automatically. The LCP never receives operational email.</>,
      <>Archive powers: remove wrong entries, import pre-CRM blacklists (Archived tab).</>,
    ],
  },
  {
    id: "b2b",
    emoji: "🤝",
    title: "B2B & BD — raising for the whole ICX",
    audience: "B2B & BD crew",
    color: "#0CB9C1",
    points: [
      <>One function, two names (<b>B2B & BD</b> — may split in future peaks): either grants the same raising access.</>,
      <>When adding an account you <b>choose its label: B2B or BD</b>. Both split every deal&apos;s opens across <b>IGV / IGTa / IGTe</b> — each product lane picks up its share.</>,
      <>Your dashboard is <b>your own B2B lane</b>; your TLs&apos; filed plans are the team goals (v22 — nothing is set in-app). IGV/IGT VPs & Directors also see the B2B lane, because you raise for them.</>,
      <><b>Podio worklist</b> (MMs & Director/VP): the &quot;Podio pending&quot; filter lists accounts not yet requested — copy names for the form, set the request state inline, or <b>Ask to submit</b>: the owner gets an in-app notification and the account pins to the top of their list until they act.</>,
      <><b>BD deals are measured in MONEY</b>: recording a deal on a BD account asks for the <b>amount (EGP)</b> + other benefits — opens are optional extras. The account header and Drive sheet show the EGP totals.</>,
      <>Proposal emails: B2B accounts get the <b>all-programs variant</b> (aiesec.org/partners); <b>BD accounts get the Talent-Solutions pitch</b> (aiesec.org.eg/partner.html) with no ready-made attachments.</>,
    ],
  },
  {
    id: "b2c-module",
    emoji: "🎪",
    title: "B2C — partners for courses, events & student activities",
    audience: "B2C crew",
    color: "#C464D9",
    points: [
      <>Your accounts work like raising accounts — <b>add → contact → visit → deal</b> — but each carries a single <b>Type</b>: <b>Courses / Events / Student activities</b> (no products, no industries).</>,
      <><b>Podio is your live database</b>: every B2C account must be refreshed on Podio <b>every N days</b> (default 10 — adjustable per account). The account page shows the <b>countdown</b>; when the date arrives, you AND the B2C VP/Director get a bell + email. After refreshing, hit <b>&quot;Updated on Podio&quot;</b> — the countdown restarts.</>,
      <><b>Deals carry no details</b> — no opens, no amounts. Fill the official <b>contract form</b> (linked right in the popup), then hit <b>Deal signed</b>. Your MOS is the number of deals.</>,
      <>Your dashboard is <b>your own B2C lane</b>: MR · Contacted · Visits · Visits done · Deals, with the leaderboard ranked by <b>Deals</b>.</>,
      <>No proposal emails for B2C — your flow is the visit, Podio and the contract form.</>,
    ],
  },
  {
    id: "tm",
    emoji: "🧠",
    title: "Talent Management",
    audience: "TM crew",
    color: "#8E44AD",
    points: [
      <>The <b>Members</b> page (sidebar) is your module: the whole LC in one view — role, functions, team, manager, and every member&apos;s <b>MOS/KPIs</b> (MR · Contacted · Visits · Done · Deals · Opens).</>,
      <>Search and filter by function or role; reach anyone instantly with the <b>email / call / WhatsApp</b> buttons.</>,
      <>More TM tools are on the roadmap — this is v1.</>,
    ],
  },
  {
    id: "data",
    emoji: "📊",
    title: "Where the data lives",
    audience: "Leaders & IM",
    color: "#F48924",
    points: [
      <>Google Drive mirrors (hourly): <b>CRM — Raising Accounts</b> = ALL accounts in one sheet — filter by the <b>Function / Product / Archived?</b> flag columns; <b>CRM — Archived Accounts</b> = the blacklist view; plus Contact Log and Visits.</>,
      <><b>CRM — Membership</b> is the only two-way sheet (with its <b>Teams</b> tab naming the standing teams). Everything else is a read-only mirror — <b>the CRM is the truth</b>: deleting or editing rows in a mirror sheet changes NOTHING in Sodio, and the hourly export rewrites the sheet. All edits happen inside Sodio.</>,
      <>Automatic emails: welcome, passwords, visit invites/reports/follow-ups/nags, period reports, broadcasts. All AIESEC-branded.</>,
      <>In-app 🔔 notifications mirror the important ones and open the related page on click.</>,
    ],
  },
  {
    id: "im",
    emoji: "🛠️",
    title: "IM & maintenance",
    audience: "IM team / Admin",
    color: "#F85A40",
    points: [
      <><b>Ship rule:</b> every change goes <b>commit → merge to main → push to GitHub → <code>vercel deploy --prod</code></b>. Never leave finished work on a side branch.</>,
      <><b>Test view</b>: from your Profile, view & use the whole app as ANY member (banner at the bottom exits). Actions taken in a test view are real — look, don&apos;t touch.</>,
      <>DB migrations run <b>manually, in order</b> in the Supabase SQL editor (<code>supabase/migrations/0001 → 0018</code>). Cron schedules live in <code>supabase/cron.sql</code>.</>,
      <><code>AI_CONTEXT.md</code> in the repo is the technical single source of truth — update it (and <b>this playbook + its version</b>) in the same commit as any change.</>,
      <>Secrets live in <code>.env.local</code> + Vercel env — never in the repo. The feedback inbox is restricted to the IM director + coach.</>,
      <>Google side: a service account syncs the Drive sheets; Gmail sends from the IM mailbox; each member&apos;s own Google grant powers their calendar + drafts.</>,
    ],
  },
  {
    id: "rules",
    emoji: "📜",
    title: "The golden rules",
    audience: "Everyone",
    color: "#037EF3",
    points: [
      <><b>0.</b> Two feedback doors (v21): <b>Sodio feedback</b> (bugs/ideas) lives on your <b>Profile</b>; the sidebar&apos;s <b>LC Feedback</b> is about PEOPLE — 🎉 shout-outs reach the person directly, 😟 concerns go ONLY to the LCP, anonymously if you like.</>,
      <><b>1.</b> If it&apos;s not in Sodio, it didn&apos;t happen.</>,
      <><b>2.</b> Every in-process account has a next step with a date — always.</>,
      <><b>3.</b> Log the result the same day you get it.</>,
      <><b>4.</b> &quot;Not interested&quot; is a result. Archive it — don&apos;t hoard dead accounts.</>,
      <><b>5.</b> The archive is sacred: archived names are never re-added.</>,
      <><b>6.</b> Deals belong to the account&apos;s Responsible — record every deal, upload the contract.</>,
      <><b>7.</b> When the report email arrives, report the visit. Don&apos;t wait for the nag.</>,
      <><b>8.</b> Track yourself: hit <b>My numbers</b> on the dashboard and own your KPIs.</>,
    ],
  },
];

export function PlaybookView({ role, isAdmin, isB2B, isB2C, isTm }: Props) {
  const mine = sectionsForRole(role, isAdmin, isB2B, isB2C, isTm);
  // the playbook is DYNAMIC: it renders only what THIS member needs to know
  const sections = SECTIONS.filter((s) => mine.has(s.id));

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      {/* Hero */}
      <div className="rise-in hero-animate overflow-hidden rounded-2xl border bg-gradient-to-br from-[#037EF3] via-[#0a5fd0] to-[#0A2540] p-6 text-white sm:p-8">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">
            The Sodio Playbook
          </h1>
          <Badge className="border-white/30 bg-white/15 text-white">{PLAYBOOK_VERSION}</Badge>
        </div>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-white/85">
          Your manual, tailored to <b>your role</b> — only what you need, nothing
          else. It lives with the system, is updated with <b>every release</b>,
          and is written to be handed to the next generations of AIESEC in
          Alexandria. 💙
        </p>
        <div className="mt-4 flex items-start gap-2.5 rounded-xl bg-white/10 p-3 text-sm leading-relaxed text-white/90">
          <span className="text-lg">🚶</span>
          <p>
            Anything unclear, ever? Ask <b>The Blue Man</b> — the walking blue
            button at the bottom-right corner. He knows the whole system, sees
            your own numbers, and answers in Arabic too. Don&apos;t be shy, he
            never sleeps.
          </p>
        </div>
      </div>

      {/* Index */}
      <nav className="stagger flex flex-wrap gap-1.5" aria-label="Playbook index">
        {sections.map((s) => (
          <a
            key={s.id}
            href={`#${s.id}`}
            className="inline-flex items-center gap-1.5 rounded-full border border-transparent px-3 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-85"
            style={{ backgroundColor: s.color }}
          >
            <span>{s.emoji}</span> {s.title}
          </a>
        ))}
      </nav>

      {/* Sections */}
      {sections.map((s, i) => (
        <Card
          key={s.id}
          id={s.id}
          className={cn("rise-in scroll-mt-20 border-l-4", i < 3 && `rise-in-${i + 1}`)}
          style={{ borderLeftColor: s.color }}
        >
          <CardHeader className="pb-2">
            <CardTitle className="flex flex-wrap items-center gap-2 text-lg">
              <span className="text-xl">{s.emoji}</span> {s.title}
              <Badge
                variant="outline"
                className="ml-auto font-semibold"
                style={{ color: s.color, borderColor: s.color }}
              >
                For: {s.audience}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm leading-relaxed">
              {s.points.map((p, j) => (
                <li key={j} className="flex gap-2.5">
                  <span
                    className="mt-[7px] size-1.5 shrink-0 rounded-full"
                    style={{ backgroundColor: s.color }}
                  />
                  <span className="min-w-0">{p}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ))}

      <p className="pb-4 text-center text-xs text-muted-foreground">
        Sodio Playbook · {PLAYBOOK_VERSION} — updated with every release.
        Something unclear? Say it on the <b>Feedback</b> page — it reaches the IM team directly. 💙
      </p>
    </div>
  );
}
