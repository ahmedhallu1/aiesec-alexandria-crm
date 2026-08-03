"use client";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/** ⚠️ Bump with EVERY release (same commit as the feature) — the playbook is
 *  handed to the next generations and must always describe the live system. */
export const PLAYBOOK_VERSION = "v32.3";

interface Props {
  role: string;
  isAdmin: boolean;
  isB2B: boolean;
  isB2C: boolean;
  isTm: boolean;
  isOgx: boolean;
  isConsideration: boolean;
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
  role: string, isAdmin: boolean, isB2B: boolean, isB2C: boolean, isTm: boolean,
  isOgx: boolean, isConsideration: boolean
): Set<string> {
  const mine = new Set(["what", "start", "touch-points", "rules"]);
  if (role === "Member" || role === "Coordinator") mine.add("raising");
  if (role === "Team Leader") { mine.add("raising"); mine.add("leaders"); mine.add("data"); }
  if (role === "LCVP" || role === "Director" || role === "LCP") { mine.add("eb"); mine.add("data"); }
  if (isB2B) mine.add("b2b");
  if (isB2C) mine.add("b2c-module");
  if (isTm) mine.add("tm");
  if (isOgx) mine.add("ogx");
  if (isConsideration) mine.add("consideration");
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
      <><b>Every table is yours to shape</b> 🧩 (v31): hit <b>⚙ Columns</b> on any list — accounts, sign-ups, members, attendance, IR calls, CVs — to <b>drag columns into the order you like</b>, switch extra ones on (project, industry, opens, campaign, person status…) or hide what you don&apos;t use, and <b>Reset</b> when you want the default back. Pick how many rows per page, and click any header to sort. Your layout is remembered on your own device. No more &quot;the sheet was more flexible&quot;.</>,
      <><b>Contacting someone always gets recorded</b>: tap WhatsApp, Call or Email on an account or a sign-up and the link opens as usual — then Sodio asks how it went, with the method already filled in. One tap to log it, or &quot;Not now&quot; if you mis-clicked.</>,
      <>First sign-in is <b>Google only</b> (it grants your calendar reminders + Gmail drafts). Onboarding then sets your password.</>,
      <><b>Put your @aiesec.net mail on your phone</b> 📲 and turn notifications ON. Sodio reaches you by email for the things that actually matter — visit follow-ups, Podio nags, attendance reminders and your streak. Miss the mail, miss the nudge.</>,
      <>After that, sign in with <b>email or phone + password</b>, or Google — whatever you like.</>,
      <>No AIESEC email yet? (v24) Sign in with your <b>phone number typed in BOTH fields</b> — identifier AND password. Once the EB adds your email that door closes: sign in with <b>Google once</b> to unlock everything, then set a password from your Profile.</>,
      <>Deactivated members never chase a login loop (v24): a clear <b>&quot;your account is inactive&quot;</b> screen says to contact your manager or the IM team.</>,
      <>Forgot the password? The login page emails you a fresh one instantly. Your old one keeps working until you change it.</>,
      <>Signing in lands you on <b>Raising</b> — your daily workspace; the Dashboard, Calendar and the rest live in the sidebar.</>,
      <>Meet <b>The Blue Man</b> 🚶 (bottom-right) — he answers questions using your real CRM data and AIESEC sources. He <b>remembers your recent chats</b> now (v27): reopen the popup and pick a past conversation from the history, or start fresh with the new-chat button — a fresh chat greets you with <b>ready questions tuned to your role</b>.</>,
      <>The first-run <b>tour</b> walks you through your workspace — and (v28) onboarding + the tour <b>speak your module&apos;s language</b> now: raisers hear accounts &amp; visits, OGX hears sign-ups, B2C hears Podio, consideration hears IR calls. Rewatch it any time from your Profile.</>,
      <>Make the avatar YOURS (v24): the profile avatar dialog has a <b>🎨 Create your own</b> builder — style, seed text, a dice randomizer, flip, background gradients — and <b>The Blue Man himself</b> is pickable.</>,
      <><b>Drag &amp; drop works everywhere</b> (v27): drop a file straight onto any attachment spot — deal contracts, bulk-import files, CV uploads, IR-call screenshots, even your avatar tile. Browsing for the file still works too.</>,
      <>Small joys (v27): anyone with a live module <b>never meets &quot;coming soon&quot;</b> anymore, in-page jumps <b>glide smoothly</b> instead of teleporting, and spotting <b>wrong info on your Profile</b> now opens WhatsApp straight to the admin to get it fixed.</>,
    ],
  },
  {
    id: "raising",
    emoji: "📇",
    title: "The raising cycle",
    audience: "Members & Coordinators",
    color: "#F85A40",
    points: [
      <><b>Add the account first</b> — the name is checked <b>the moment you type it</b> against every function&apos;s accounts and your function&apos;s archive, so you learn it&apos;s taken BEFORE filling the rest. Bulk import exists for whole research sheets.</>,
      <><b>Log every contact attempt</b> with its result. Picking <b>&quot;Visit Scheduled&quot;</b> books the visit — calendar invite and reminders included.</>,
      <>Every in-process account carries a <b>next step with a date</b> or a pending visit. Three no-responses → the CRM suggests archiving. Setting that date is one tap now (v24): the date fields (account card + Log-contact dialog) have a <b>&quot;Next week&quot;</b> button — +7 days, done.</>,
      <>The <b>Proposal email</b> button builds a branded, AIESEC-blue outreach draft in <b>your own Gmail</b> — review, attach, send.</>,
      <>Two hours after a visit, you (and your TL) get the <b>report-it email</b> — report from it, the top button, or by clicking the pending visit in History. Ignore it a week and the reminder comes back firmer — report it or archive the account.</>,
      <>The <b>Calendar</b> page (sidebar) shows your whole function&apos;s visits, one color per member — see the rhythm, plan around it.</>,
      <>Your accounts live on Podio too (v24): every raising account has a <b>&quot;Podio — continuous update&quot;</b> card with an ON/OFF switch and a countdown — new IGV accounts start ON (IGT off), every <b>14 days</b> by default (editable 1–90). When it&apos;s due, you and your VP/Director get a bell + email; a week ignored brings a firmer second email. <b>&quot;Updated on Podio&quot;</b> restarts the clock.</>,
      <>Deal signed → <b>Record deal</b> 🏆: opens per product, optional <b>contract upload</b> (any file format — add later from History; the account grows a <b>Contracts</b> button to preview & download them). Need to share the credit? <b>Split the opens</b> between members right in the popup (e.g. 3 to the owner, 3 to whoever helped) — leaderboards count each person&apos;s share.</>,
      <>&quot;Not interested&quot; is a valid result: mark the account <b>Out of Process</b> with its reason — from the account page or the ✕ right on the list. Leaders can <b>Select</b> many accounts and archive or reassign them in one go (reassign only offers people you&apos;re allowed to hand accounts to). The archive IS the blacklist — those names never come back, and (v22.2) <b>everyone can browse the whole archive</b> and open any archived account read-only to see who burned it and why.</>,
      <><b>Comments</b> are numbered per author and can be <b>pinned</b> (they surface on the list) or <b>archived</b> to declutter — archived ones tuck behind an &quot;Archived (n)&quot; toggle on the comments card without changing the numbering.</>,
      <>On your phone, the little <b>Cards / Compact / Table</b> switcher above the accounts list lets you pick the density you like — it remembers your choice. On desktop the list sorts itself your way (v24): <b>click any column header</b> — Date added, Account, Product, Status, Contacts, Next step — to sort, click again to flip.</>,
      <>The <b>WhatsApp quick-action</b> on the list opens <b>ready to send</b> (v24): a prefilled intro with your name, who AIESEC in Alexandria is, and the ask for a chat — review and hit send.</>,
      <>The dashboard&apos;s filter bar gained a <b>&quot;This sprint&quot;</b> chip next to &quot;This month&quot; (v24) — sprints are half-months: 1–15 and 16–end.</>,
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
      <>The <b>Archived tab does bulk</b> (v24): select archived accounts → <b>Back to active</b> returns them to the process with their history intact (after a confirmation), and every row also has a per-row ↩️ revive button. Permanent <b>Delete</b> is VP/Director/LCP only.</>,
      <>Bulk-reassigning accounts? Tick <b>&quot;Email them about it&quot;</b> (v24) and each new responsible gets a bell + a branded email listing their new accounts, with a button straight to the list.</>,
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
      <><b>Consideration lane</b> (v27, IGV/IGT VPs &amp; Directors): your dashboard gained the consideration pulse next to the raising lanes — IR calls happening and the CV pool growing — so the supply side is visible right where you steer. (The CV pool itself is IGT-only; IGV sees the IR-call side.)</>,
      <><b>Goals come from planning</b> (v22): the lane goal card shows YOUR planned opens (from the LC&apos;s planning sheet) against what the lane actually raised, per sprint or month. Nothing is set in-app — update the planning sheet and re-import instead.</>,
      <>The <b>Planning</b> tab (v21) carries the term plan from the LC&apos;s planning sheet: opens per month, the consideration funnel per <b>sprint</b> (half-months — 1–15 and 16–end), conversions, quarter totals, and every MM&apos;s filed plan. The dashboard&apos;s product lanes show the current sprint&apos;s plan vs achieved (toggle to month), and the Planning board lists every TL&apos;s and MM&apos;s filed plan.</>,
      <><b>Unassigned accounts</b> (v22): the old sheets&apos; market research was imported with no owner — filter Responsible → <b>Unassigned</b> and hand them out with reassign / bulk-reassign. Members see an account once it&apos;s theirs. (v24: tick <b>&quot;Email them about it&quot;</b> when bulk-reassigning and each new responsible gets a bell + a branded email listing their new accounts.)</>,
      <><b>Podio continuous updates cover every raising function now</b> (v24): each account&apos;s card has an ON/OFF switch (new IGV/BD/B2C accounts start ON; IGT/B2B off), cadence <b>14 days</b> by default for every function (editable 1–90). Due accounts bell + email the responsible AND you, once per cycle — with a firmer <b>second email</b> a week later if nothing moves.</>,
      <>Every <b>sprint, month and quarter</b> close, your whole function + the LCP get the <b>period report email</b>: totals, plan-vs-achieved, and a waterfall with every team&apos;s and every person&apos;s numbers.</>,
      <>The <b>Membership sheet</b> is the source of truth for people — edit in the app or in the sheet, both stay in sync (30-min imports + instant write-back).</>,
      <>Visit reports and function-wide visit announcements reach you automatically. The LCP never receives operational email.</>,
      <>Archive powers (Archived tab): remove wrong entries, import pre-CRM blacklists, bulk <b>Back to active</b> (v24 — per-row ↩️ too), and — VP/Director/LCP only — permanent <b>Delete</b>: the account is gone forever and its <b>name is freed</b>, so read the confirmation before you click.</>,
      <><b>Teams registry</b> (v24.2, Membership page, EB): the <b>Teams card</b> manages EVERY named team — the 5 types are <b>EB</b> &amp; <b>LB</b> (one each), <b>Function</b> &amp; <b>Function leaders</b> (one per function) and <b>Team</b> (a TL&apos;s team, many per function). Add, rename or remove any of them; the sheet&apos;s Teams tab follows automatically. The member dialog then offers a role-aware team picker (Member → a registered TL team; TL/Coordinator/Director → the function&apos;s &quot;leaders&quot; team; LCP/LCVP → the EB team; custom still possible), and a plain Member can never be set as anyone&apos;s manager. Email is now <b>optional</b> when adding a member — phone-only people sign in with their number in both login fields until you add it.</>,
      <><b>Expectation mail</b> (v25 — OGT <b>and OGV</b> VPs/Directors + LCP): fill the standardized <b>&quot;Home Entity Expectation Setting&quot;</b> form (OGT has <b>Salary</b>, OGV has <b>TN Fee and what it covers</b>; recipients = the <b>EP email + IR email</b>, with customer.support@aiesec.net.eg always in CC), then <b>review the FINAL email</b> — edit any line right there — and hit <b>Send now</b> (goes out from your own Gmail, with your signature) or save it as a draft.</>,
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
      <>Podio isn&apos;t only the submission worklist anymore (v24): every account carries a <b>&quot;Podio — continuous update&quot;</b> card — new <b>BD accounts start ON</b>, B2B off, every <b>14 days</b> by default (editable 1–90). Due → bell + email to the owner + your VP/Director; a week ignored → a firmer second email; <b>&quot;Updated on Podio&quot;</b> resets it.</>,
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
      <><b>Podio is your live database</b>: every B2C account must be refreshed on Podio <b>every N days</b> (default 10 — adjustable per account). The account page shows the <b>countdown</b>; when the date arrives, you AND the B2C VP/Director get a bell + email. After refreshing, hit <b>&quot;Updated on Podio&quot;</b> — the countdown restarts. (v24: the card gained an <b>ON/OFF switch</b> — new B2C accounts start ON — and a due account still untouched a week after the first reminder gets a firmer <b>second email</b>.)</>,
      <><b>Deals carry no details</b> — no opens, no amounts. Fill the official <b>contract form</b> (linked right in the popup), then hit <b>Deal signed</b>. Your MOS is the number of deals.</>,
      <>Your dashboard is <b>your own B2C lane</b>: MR · Contacted · Visits · Visits done · Deals, with the leaderboard ranked by <b>Deals</b>.</>,
      <>No proposal emails for B2C — your flow is the visit, Podio and the contract form.</>,
      <><b>Your archive is YOURS</b>: a name the raising crews burned doesn&apos;t block you (different offer, different door) — the add-form even tells you when a name sits in their archive so you walk in informed. Only <b>your own</b> archived B2C names are blocked.</>,
    ],
  },
  {
    id: "ogx",
    emoji: "✈️",
    title: "OGX — the sign-ups module",
    audience: "OGV & OGT crews",
    color: "#0CB9C1",
    points: [
      <><b>Sign-ups</b> (sidebar) is your workspace: every sign-up from your tracker sheet lives here, <b>two-way synced</b> — the sheet imports every 15 minutes and every edit you make in Sodio lands back on the sheet instantly. Same data, two doors.</>,
      <>The main view is the <b>🆕 Unassigned pool</b>: open a fresh sign-up, reach them (the WhatsApp/call buttons are right in the row), then hit <b>Contact</b> — it&apos;s yours, your name is on the sheet, and the details open right away so you can log everything (v26).</>,
      <><b>Leaders bulk-assign</b> (v26): select several sign-ups → <b>Assign to…</b> a member or <b>Unassign</b> back to the pool. The phone filter goes <b>both ways</b> now (v27): show only sign-ups <b>with a phone</b>, or only the <b>📵 missing-phone</b> ones.</>,
      <><b>Your plan, live</b> (v26): if you filed an MM plan, a card above the list shows this month&apos;s <b>Applicants / Accepted / Approvals plan vs your current pipeline</b> — the Approvals bar is your MOS race.</>,
      <><b>Your function has a real DASHBOARD now</b> (v28): open it from the chips on the Dashboard page or the button on Sign-ups. The full funnel — <b>Sign-ups → Contacted → Interested → Applied → Accepted → Approved</b> — with conversions between every step, an <b>Approvals leaderboard</b>, a per-team drill and plan-vs-pipeline, all filterable by <b>date, team and member</b>.</>,
      <><b>The potential flow</b> (v28): whoever OWNS a sign-up moves it <b>Applied → Accepted → Approved</b> right from the details dialog — no waiting on a VP. These stages live <b>only in Sodio</b> (the sheet only ever sees Out of Process), and the <b>🎯 Potential</b> filter finds the sign-ups at each stage in one tap.</>,
      <><b>OGV keeps a daily 🔥 streak</b> (v27): at least one sign-up contact action a day — a <b>Contact</b>, a status change or a comment — saves it. The streak card on Sign-ups shows your <b>current + best streak</b> and the LC&apos;s <b>top-3</b>; sit on a 3+ day streak with nothing logged by <b>19:00</b> and a (funny) reminder email lands before the day kills it.</>,
      <>Views: <b>Unassigned · My sign-ups · My team</b> (Team Leaders) · <b>All</b> (VPs/Directors) · <b>Archived</b>. Members see their own + the pool; TLs their team; leaders everything in their function.</>,
      <>You edit <b>Contacted</b> (Yes/No), <b>Interested</b> (Yes/No) and <b>comments</b> — everything else (phone, email, program, referral, university…) is the sign-up&apos;s own data, read-only in the details.</>,
      <>Comments are an <b>organized log</b>: yours land in the sheet&apos;s Comment cell, the VP&apos;s in the VP Comment cell — each entry stamped with the author and time. Assigned/contacted dates stamp themselves.</>,
      <><b>VP/Director only</b>: VP comments, <b>Country</b> (autocomplete), <b>Sub Product</b> (OGT: GTa/GTe) and <b>Out of Process</b> (archives the sign-up with a reason; revivable). The Applied / Accepted / Approved statuses belong to the sign-up&apos;s <b>owner</b> since v28 — see the potential flow above.</>,
      <><b>Approved is the MOS</b> 🏆 — accepted by the host entity, paid, contract signed, ready to start the travel process. Your real Approvals count shows in the members directory.</>,
      <>VPs/Directors: the <b>Expectation mail</b> tab builds the pre-approval &quot;Home Entity Expectation Setting&quot; email — review the final version, edit inline, and send it from your own Gmail (EP + IR in To, customer support in CC, your signature at the end).</>,
    ],
  },
  {
    id: "consideration",
    emoji: "🌍",
    title: "Consideration — IR calls & the CV pool",
    audience: "Consideration crew",
    color: "#F48924",
    points: [
      <><b>Consideration</b> (sidebar) has two tabs. <b>IR calls</b>: record every International-Relations call — pick the partner LC (or add a new one on the spot), the date &amp; time default to now, drop the call screenshot and it lands named in the system&apos;s Drive folder. The whole crew sees the shared call log.</>,
      <><b>Your personal booking link</b> (v27, supercharged in v28): every consideration member has one. Set it up on the <b>My booking link</b> card, copy <b>sodio.vercel.app/book/your-name</b> and send it to IRs abroad. When they book, their <b>email is collected</b> and they&apos;re <b>invited to a real Google Meet</b> on your calendar — the call lands in Sodio as a <b>scheduled call</b>, with a bell + email to you.</>,
      <><b>Reschedule &amp; cancel, civilized</b> (v28): the IR&apos;s confirmation email carries a <b>manage link</b> to reschedule or cancel (a reason is required). On your side, you can <b>cancel with a reason</b> (they&apos;re emailed) or <b>request a reschedule</b> — they pick a new time from your availability.</>,
      <><b>Booking settings match Google Calendar appointments</b> (v28): slot lengths from <b>15 minutes to 2 hours</b>, buffer time between calls, minimum notice, a book-up-to horizon, start/end dates, guests-can-invite — and availability rows that are <b>weekly OR one specific date</b>.</>,
      <><b>Partner LCs are editable</b> (v28): hit the <b>⚙</b> in the partner-LC picker — VPs and above can <b>rename or delete</b> an entry, so typos and duplicates stop living forever.</>,
      <>When the call happens, open its <b>notes dialog</b>: their demand (domain chips), <b>&quot;When are your B2C campaigns?&quot;</b>, free notes and the screenshot — <b>saving completes the call</b>. Manual recording still exists for calls that already happened.</>,
      <><b>CVs</b> (IGT-only since v27 — IGV VPs see just the IR calls): upload a CV in any format and tag its LC — the AI reads it and extracts the <b>name, phone (with country code), email, industry match and skills</b> automatically. Fix any field by hand; open the original file any time.</>,
      <><b>Ask The Blue Man about the pool</b> 🤖: &quot;give me the CVs with C# in their skills&quot; or &quot;who has ERP experience?&quot; — he searches every extracted CV and answers with the matches.</>,
      <>PDFs and images get the full AI read; exotic formats are stored anyway and you fill the fields manually.</>,
    ],
  },
  {
    id: "touch-points",
    emoji: "📅",
    title: "Touch points & attendance",
    audience: "Everyone",
    color: "#8E44AD",
    points: [
      <><b>Touch points</b> are the LC&apos;s moments: <b>meetings, working hours and outings</b>. Who books what: a <b>Team Leader</b> books their team&apos;s (and may invite sibling teams of the same function), a <b>VP/Director</b> the function&apos;s (and may invite another function), <b>TM</b> the LC-wide ones — the LCP books anything. You set a date and a START time (no end time) plus an optional note; everyone invited gets an email + a bell, with the TM VP always CC&apos;d. </>,
      <>They all land on <b>Calendar</b> — together with visits and IR calls. You see what you belong to: your team&apos;s, your function&apos;s (yes, including other teams&apos; points), and every LC-wide one.</>,
      <><b>Attendance is taken afterwards</b> — attended · late · absent, with a &quot;valid excuse?&quot; box. Team points are recorded by the Team Leader, function points by the VP/Director (MMs can edit, but never their own row), LC points by TM.</>,
      <><b>Working hours record themselves</b> 🤖 — <b>then a human confirms</b>: you&apos;re pre-filled as attended when you did at least <b>two real actions at least 10 minutes apart</b> during the session (log a contact, book a visit, record a deal, work a sign-up, log an IR call, add or update an account). Two clicks in a row won&apos;t fool it. The AI&apos;s answer is a <b>proposal</b> — your TL (team) / VP (function) / TM (LC) reviews it and hits <b>Confirm attendance</b>. Until they do, it counts as unrecorded and keeps reminding them. </>,
      <>Plans change: whoever booked a touch point (plus the function&apos;s VP/Director and TM) can <b>move it or cancel it</b> from the calendar — tap it and pick <b>Move or cancel</b>. A cancel needs a reason, and either way everyone invited is emailed again. </>,
      <>Check <b>Attendance</b> any time — your own history and rate, your team&apos;s if you lead one, your function&apos;s if you run one. Disagree with a mark? Hit <b>Appeal</b> and whoever recorded it hears from you, with TM on CC.</>,
      <>Owed a record? Sodio reminds you daily — and after <b>three reminders</b> it greets you with a prompt you can&apos;t wave away. Just fill it. 💙</>,
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

export function PlaybookView({ role, isAdmin, isB2B, isB2C, isTm, isOgx, isConsideration }: Props) {
  const mine = sectionsForRole(role, isAdmin, isB2B, isB2C, isTm, isOgx, isConsideration);
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
          <button
            type="button"
            className="ml-auto rounded-full border border-white/30 bg-white/10 px-3 py-1 text-xs font-medium text-white transition hover:bg-white/20"
            onClick={() => window.dispatchEvent(new Event("sodio:replay-tour"))}
          >
            ↻ Replay the walkthrough
          </button>
        </div>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-white/85">
          Your manual, tailored to <b>your role</b> — only what you need, nothing
          else. It lives with the system, is updated with <b>every release</b>,
          and is written to be handed to the next generations of AIESEC in
          Alexandria. 💙
        </p>
        <p className="mt-3 max-w-xl text-xs leading-relaxed text-white/75">
          <b>New in v29:</b> THE TM MODULE — touch points (team · function · LC meetings, working hours and outings) on one calendar with visits and IR calls, attendance with AUTOMATIC working hours, appeals and reminders that don&apos;t let go · booking v3 · split IGV/IGT consideration lanes. v28: <b>booking v2</b> — IRs
          are invited to a real <b>Google Meet</b> and can reschedule or cancel
          from their confirmation email · <b>OGX dashboards</b> — the full
          Sign-ups → Approved funnel with conversions &amp; an Approvals
          leaderboard · the <b>potential flow</b> — owners move sign-ups
          Applied → Accepted → Approved right from the details. v27: booking
          links · OGV daily 🔥 streaks · The Blue Man remembers your chats ·
          drag &amp; drop on every upload spot.
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
