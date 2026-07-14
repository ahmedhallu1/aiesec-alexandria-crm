# AI_CONTEXT.md — Single Source of Truth (Sodio — AIESEC in Alexandria ICX CRM)

> **⚠️ LIVING DOCUMENT.** Update this file **in the same commit** as any change
> to the system (feature, rule, route, schema, env var, deployment fact).
> Add a dated entry to the **Changelog** at the bottom. No secrets in this file.

Last updated: 2026-07-14 · Version: v10

---

## 1. What this is

**Sodio** — a **100% free** CRM for AIESEC in Alexandria's ICX functions
(**IGV** & **IGT**), covering the **Raising** process. The brand name is
**Sodio** (shown in the sidebar, tab titles, manifest, emails); the built-in
AI assistant is **The Blue Man**. Members log accounts, contacts, visits and
deals; leaders steer with goals, leaderboards and dashboards. The RBAC engine is
the blueprint for future OGX/other-function modules.

| | |
|---|---|
| Live URL | https://aiesec-alexandria-crm.vercel.app |
| Repo | github.com/ahmedhallu1/aiesec-alexandria-crm (private) |
| Vercel project | `aiesec-alexandria-crm` (scope `ahmedhallu1s-projects`) — deploy with `vercel deploy --prod` |
| Stack | Next.js 16 (App Router, Turbopack) · React 19 · Tailwind v4 · shadcn/ui · Supabase (Postgres, project `iesrpuuoduxtihuaqfic`) |
| Auth | Auth.js v5: **FIRST sign-in is Google-only** (grants `calendar` + `gmail.compose`) → onboarding sets a password → afterwards **email OR phone + password**, or Google, all work. **Forgot password emails a fresh password** (`issueTempPassword` in `server/password.ts`); the old password still works until the member changes it (no lockouts) |
| Google | Service account (Sheets sync) · Gmail API from `ahmedhallul@aiesec.net` · Calendar events on each member's own calendar |
| Cron | Supabase `pg_cron` + `pg_net` → `/api/cron/*` (visit-followups 15 min · membership-import 30 min · sheets-export hourly) |
| Admin | `ADMIN_EMAILS` env (= IM director, treated as LCP) |

**Migrations** live in `supabase/migrations/` and are run **manually** in the
Supabase SQL editor (no CLI on this machine): `0001_init` → `0002_membership_v2`
→ `0003_ops_v2` → `0004_pins_v2` → `0005_deals` → `0006_admin_label` → `0007_visit_scheduled_result` → `0008_notifications_feedback` → `0009_b2b_deals_v9` → `0010_notif_link`.

---

## 2. Membership & RBAC

Source of truth = the **"CRM — Membership"** Google Sheet (two-way):
imported every 30 min AND written back by in-app edits (EB membership editor,
member profile/onboarding confirmations). Columns A→J:
`Name · Nickname · Email · Phone · Role · Function (multi) · Sub Function (multi) · Stakeholder (by NAME) · Team Name · Active`.

- **Function/sub-function values are FREE-FORM**: known values are normalized,
  unknown ones (e.g. `TM`) are imported as-is and appear as chips in the editor.
- **Manager defaults** (UI word for Stakeholder): MM (TL/Coordinator/Member) →
  their function's **VP** → else the function's **Director** → else **LCP**;
  VP/Director → LCP. Applied on import + in-app edits when no manager is named.

| Role | Powers |
|---|---|
| LCP | Sees everything; **never receives operational emails**; excluded from member filters (doesn't do market research) |
| LCVP (EB) | Function authority (accounts, goals, archive) + membership editing |
| Director | Function authority like a VP but **NOT EB** — no membership editing |
| Team Leader | Team accounts, picks Responsible (self/member), sets the team goal |
| Coordinator / Member | Own accounts only |

**B2B** (function or sub-function contains "B2B") raises **for the whole ICX**:
they add accounts as **product "B2B"** (not IGV/IGT), and every deal records its
opens **split across IGV / IGTa / IGTe** (e.g. 3 IGV · 2 IGTe · 1 IGTa). Those
per-product opens feed the IGV / IGTa / IGTe dashboard lanes (a B2B account's
IGV opens count in the IGV lane, etc.), while the account itself lives in the
All-ICX + B2B drill. Detected by `isB2B` in `rbac.ts`; feeds `scopeFunctions`,
`hasRaisingAccess`, `allowedAccountFunctions`.

**Account visibility** (`accountScope` in `rbac.ts`):
- Member / Coordinator → own accounts only.
- Team Leader → own + their team members' accounts.
- VP (LCVP) → all accounts of their function(s) **+ B2B** (B2B raises for them).
- Director → all accounts of their function(s) **+ B2B** (e.g. Yara, Director of
  B2B → every B2B account; an IGV/IGT Director also sees B2B).
- LCP / admin → everything.
`scopeFunctions(v)` returns a leader's `AccountFunction[]` — always appends
`"B2B"` when the leader owns IGV/IGT or is B2B, so IGV & IGT VPs/Directors see
B2B accounts.

**OGX ↔ ICX isolation**: neither side sees the other's operations. IGV-only
members can't create IGT accounts and vice versa (both = dual-function, LCVP, LCP).
Functions without modules see a blurred "Soon" workspace (profile+feedback still work).

Engine: `src/lib/rbac.ts` — every read goes through `accountScope`, every
mutation through a `can*` predicate, **server-side**.

---

## 3. Accounts & pipeline

- Stage is **derived** in the `accounts_pipeline` view: Lead → Contacted →
  Visit Scheduled → Visit Done → Deal Done, exit lane Out of Process.
- **Deals are MANY-per-account** (`deals` table + running `deals_count`/
  `slots_count` totals): 3 slots today + 6 next month = 2 deals · 9 slots.
  `recordDeal` appends; the account stays workable after a deal (more deals,
  more contacts, more visits). Deal history shows in the account timeline.
- **IGV accounts always carry a Project** (Skill Up!, Rooted, …) — required at
  creation/import, shown on the accounts list next to the IGV badge, editable
  in Details, filterable.
- **Unique name across ALL ICX** (normalized); duplicates/archived names are
  blocked at creation with full context (who, stage, why archived).
- **The archive IS the blacklist**: OOP accounts are hidden, unre-addable,
  revivable by TL+. No blacklist tab/sheet.
- **Auto-archive rules**: contact result **"Not Interested"** and Podio request
  state **"Rejected"** both archive the account (with warning confirmations).
- **Out-of-Process reasons** (`OOP_REASONS` in `types.ts`) are a fixed pick-list
  — Not responding · Financial issues · Not Interested · Backed out · Other Plans
  · Needs too technical background EPs · Conflict of Values between AIESEC and
  organization · Blacklisted — plus **Other** (free text).
- **Manual archive** (Archived tab, TL+): **Add archived** (name + reason) and
  **Import archived** (CSV/XLSX with Name + Reason, editable preview, ≤1000 rows,
  free-form reasons kept as-is) blacklist names that were burned before the CRM
  existed — no active account needed. Entries live in the `blacklist` table and
  block re-adding exactly like an OOP account; VP+ can remove an entry.
- **Tagged contacts** (`accounts.contacts` jsonb): phones with tags
  `[Contact, Whatsapp, Manager, HR, CEO, Owner, Other]`, emails with the same
  list **minus Whatsapp**, links with `[Website, LinkedIn, Instagram, Facebook,
  Other]`. First-of-kind is synced to the legacy flat columns for the mirrors.
  Quick actions use brand glyphs (real WhatsApp logo, LinkedIn, Instagram,
  Facebook — `src/components/crm/icons.tsx`).
- **Phone rule** (`normalizePhone` in `src/lib/types.ts`): Egyptian mobile →
  canonical `+201[0/1/2/5]XXXXXXXX`; landline → `+203XXXXXXX` (Alexandria) /
  `+202…` (Cairo); anything else must be full international `+<7–15 digits>`.
- **Comments**: unlimited, auto-numbered per author class (`Comment #n`,
  `TL/VP/LCP/Admin Comment #n` — the IM director's label is **Admin**, not LCP).
  Any comment can be **pinned** → highlighted in the card AND shown as a ❗
  (CircleAlert) on the accounts list; hover reveals the text.
- **ICX Proposal Email** (`src/lib/email/proposal.ts` + `createProposalDraft`):
  the "Proposal email" button on every account opens a popup (recipient,
  sector, custom note, attachments note — product auto-detected iGV/iGTa/iGTe,
  company prefilled). It creates a ready-to-send DRAFT **in the member's own
  Gmail** via their `gmail.compose` grant; the UI reminds them to review,
  attach files and hit send (email goes out from THEIR address). An
  **"Attach the official proposal"** switch adds the per-product PDF from
  `proposals/<iGV|iGTa|iGTe>.pdf` (bundled via `outputFileTracingIncludes`;
  missing file → clear error). Sets `proposal_sent` on the account. Members
  who signed in before the scope change must re-login with Google once.
- **Contact log results**: No Response / Responded / Interested / Not Interested
  (archives) / Wrong Contact / **Visit Scheduled** (requires date+time and
  BOOKS the visit through the exact same path as the Schedule-visit button —
  calendar reminders included; 'Call Scheduled' is a legacy value kept for old
  rows only). Golden rule: every in-process account carries a next step with a
  date or a pending visit; 3 unanswered attempts → OOP prompt.
- **Visits**: calendar event on the responsible's Google Calendar (24h + 1h
  reminders), +2h follow-up email, report emails to VP + manager (never LCP).
  `scheduleVisit` returns a `calendarHint` (`linked`/`no_grant`/`relogin`/
  `error`) so the UI says exactly why a reminder wasn't created (dead Google
  grant → re-login) instead of failing silently.
  - **Shared with leaders** (calendar attendees, Google invite): a **Member's**
    visit is shared with their **Team Leader + function VP(s)**; a **Team Leader
    or Coordinator's** with the **VP(s)**. Raising only (not consideration).
  - **Function-wide announcement**: booking a visit **emails + in-app notifies
    the whole product's raising crew + B2B** (IGV visit → IGV raising + B2B;
    IGT → IGT raising + B2B; B2B → IGV + IGT raising + B2B) — an FYI, no
    calendar reminder for them. `resolveVisitRecipients` + `visitAnnouncementEmail`;
    notification kind `visit_announcement`.
- **Next-step reminders**: whenever an account's next step gets a date, a
  calendar follow-up event is upserted on the responsible's calendar (at the
  step's time, or **11:00** when date-only) — kept in sync on change and removed
  when the step clears / the account is archived. `syncNextStepReminder` +
  `upsertFollowupEvent`; stored in `accounts.next_step_event_id`.
- **Bulk import** (`/accounts/import`): CSV/XLSX parsed client-side (sheetjs),
  editable preview, owner select per reassign rules, ≤500 rows, every row passes
  the exact same checks as a manual add.
- **Accounts list columns**: Date added (filterable range, clamped to today) ·
  Account (+📌, responsible under the name for leaders) · Product badge ·
  Status · Contacts count · Next step · **Quick actions** (WhatsApp = number
  tagged `Whatsapp` else first phone; Call = first non-Whatsapp phone; Email =
  first email; one icon per link; overflow collapses into a "…" menu).

---

## 4. URLs, titles & security

- Accounts are addressed by **slug**: `/accounts/hadana` (slug = unique
  normalized name, spaces→dashes; UUID links still resolve). Browser-tab titles
  are dynamic (= account name / page name).
- `generateMetadata` re-checks authorization before exposing a name; guessing a
  URL outside your scope → 404, never data. All reads/mutations re-check RBAC
  server-side (`getAccount` → `canViewAccount`; every action → `can*`).
- Route protection: `src/proxy.ts` (Auth.js) — everything requires a session
  except `/login`, auth/cron APIs, static assets, `/brand`, PWA files.
  ⚠️ Any new public asset folder must be added to the matcher or the proxy
  307s it to /login.
- `/api/cron/*` guarded by `CRON_SECRET`. Feedback inbox = ONLY
  `ahmedhallul@aiesec.net` + `omareldeeb123@aiesec.net`.

---

## 5. Dashboard

**Teams are real Team Leaders only** — the EB (IRIS) is never a "team": VP/
admin-owned accounts don't create an EB row in team drills/leaderboards, and
the team goal/leaderboard cards only appear when the viewer's manager is an
actual Team Leader.

**Goals live per product lane** — set on IGV / IGTa / IGTe; the IGT goal is
DERIVED: `goal(IGT) = goal(IGTa) + goal(IGTe)` (the All-IGT lane shows the sum
and has no Set button). Filter bar sits on a single h-9 baseline (the date
range is one inline "Added → →" group) and KPI cards have equal-height labels
so the numbers align.

**KPI row (this exact order, nothing else):** Market Research (total accounts) ·
Contacted · Visits (scheduled) · Visits done · Deals (count of deals, not
accounts) · Slots raised · Lead → Deal (% of accounts reaching a deal).
Directly below: the step-to-step **conversion strip** — MR→Contacted,
Contacted→Visits, Visits→Done, Done→Deals. (The old funnel bars and flag KPI
cards were removed on request; flags remain reachable via accounts filters.)

- Lanes gated by the member's functions: `All ICX / IGV / All IGT / IGTa / IGTe`
  (product colors: GV `#F85A40`, GTa `#0CB9C1`, GTe `#F48924`).
- **Everyone in a module sees their whole function's aggregates** (accounts list
  stays scoped); member filter shows only lane members (never the LCP).
- **Goals** (`performance_goals`): VP/Director sets the function goal, TL the
  team goal (month or peak period) — progress bars on everyone's dashboard.
- **Leaderboards**: ONE **wide** board per scope (function + team) listing
**Members & Coordinators only** (never Team Leaders, VPs, Directors or the LCP),
full-width, showing **every** funnel number per member at once — **MR ·
Contacted (count of accounts with ≥1 contact, not contact-log count) · Visits ·
Visits done · Deals · Opens**, in funnel order. **Clicking any KPI header
re-sorts** with a **FLIP glide animation** (`useFlipReorder`); default sort is
**Opens**. Deals belong to the account's **Responsible**. The old By-member drill
table and the Flags column were removed. Product/team drills remain.
- Filters: This month chip · team · member · date range (labeled inputs,
  `max=today`, server-side clamp — future dates are impossible).

---

### Deal attribution & per-product opens

- A recorded deal belongs to the **account's Responsible** (whoever the opens
  were raised for), NOT the person clicking the button.
- **Opens are recorded per product** (`deals.slots_igv/igta/igte`, mirrored to
  `accounts.slots_igv_count/igta_count/igte_count`): IGV accounts sign IGV opens;
  IGT accounts split IGTa + IGTe; B2B accounts mix all three. `slots_count` is
  their sum. The dashboard lane attributes each lane's slots from these splits,
  so a B2B account's IGV opens land in the IGV lane.
- **Leaderboards list Members & Coordinators only** — no TL rollup, no VPs/LCP.
  Each member's row is their own accounts' numbers for the active lane.

## 6. UX conventions

**Loading = the walking AIESEC human** (`public/brand/walk.png`, looping alpha
**APNG** converted from the official brand `.mov` — WebP was dropped because
its frame disposal stacked frames over each other; component `WalkingLoader`,
used inside `PageSkeleton`). Motion system (all
`prefers-reduced-motion`-safe): `rise-in` entrances, KPI **count-up** numbers,
card hover-lift, button press scale, nav-pending shimmer, and a **confetti
burst** when a deal is recorded.

- **Mobile-first**: card lists replace tables on phones; `<main>` needs
  `min-w-0` (flex) — tables otherwise inflate the page width.
- Loading: `loading.tsx` skeletons per segment + `useTransition` pending
  shimmer (`.nav-pending`) on lane/filter switches.
- `Hint` (tooltip) on every action button; first-run **Tour** dialog dynamic by
  role+function (localStorage `crm-tour-v1:<email>`).
- Passwords always render in `PasswordInput` (eye toggle).
- Branding: official AIESEC logos (`public/brand/`), Lato, light/dark toggle
  (system default), `rise-in` entrance animations, branded gradient emails
  (`src/lib/email/templates.ts`).
- The word **"Manager"** is used in the UI for the sheet's "Stakeholder".

---

## 7. Repository map

```
supabase/migrations/          0001..0009 (run manually in SQL editor)
supabase/cron.sql             pg_cron schedules
src/lib/types.ts              domain types, pick-lists (OOP_REASONS), phone/slug, fmtDateTime
src/lib/rbac.ts               THE RBAC engine (scopeFunctions = leader visibility, B2B-aware)
src/lib/auth.ts|auth.config.ts  Auth.js (credentials email/phone + Google)
src/lib/google/{sheets,gmail,calendar}.ts  sheets (+archived mirror) · mail · calendar (visit + next-step events)
src/lib/avatars.ts            fun DiceBear avatar choices
src/lib/core-analytics.ts     CORE live digest (national rankings + Alexandria funnel)
src/lib/email/templates.ts    branded emails (welcome/visit/feedback/newPassword/module-ready)
src/server/data.ts            scoped reads, dashboard per-lane aggregates, goals, slug, manual-archive list
src/server/actions.ts         ALL mutations (deals per product, manual archive, avatars…)
src/server/password.ts        forgot-password: generate + email a fresh password
src/server/notify.ts          in-app notifications helper (best-effort inserts)
src/lib/assistant.ts          The Blue Man: RBAC-scoped context + CORE digest + prompt
src/app/api/assistant/        POST → Gemini 2.5 Flash + Google Search grounding
src/server/auth-actions.ts    login (email/phone), Google, forgot-password (emails a password)
src/app/(app)/                dashboard, accounts (+import, [id]=slug), membership,
                              feedback(+inbox), profile; loading.tsx everywhere
src/app/welcome/              first-login onboarding
src/components/crm/           views, dialogs, ContactsEditor, QuickActions, Tour, Hint,
                              NotificationsBell (+Broadcast), BlueManChat, FeedbackInboxView…
```

## 8. Where to change what

| Change… | Edit |
|---|---|
| Pick-lists (types, industries, tags, roles) | `src/lib/types.ts` |
| Phone/slug rules | `src/lib/types.ts` (`normalizePhone`, `accountSlug`) |
| Permissions / scopes | `src/lib/rbac.ts` |
| Business rules (archive, goals, comments…) | `src/server/actions.ts` |
| Sheet import/write-back/mirrors | `src/lib/google/sheets.ts` |
| Manager default chain | `defaultManagerId` in `src/lib/google/sheets.ts` |
| Emails | `src/lib/email/templates.ts` |
| Tour steps / role blurbs | `src/components/crm/tour.tsx`, `ROLE_BLURBS` in types |
| DB schema | new file in `supabase/migrations/` (+ run in SQL editor + note here) |
| The Blue Man (prompt / data scope) | `src/lib/assistant.ts` (+ `/api/assistant/route.ts`) |
| CORE digest (scraping / entity ids) | `src/lib/core-analytics.ts` |
| Notifications kinds / broadcast | `src/server/notify.ts`, bell UI in `notifications-bell.tsx` |
| Avatars (styles / seeds) | `src/lib/avatars.ts`; picker in `profile-view.tsx` |
| Leader visibility (who sees which accounts) | `scopeFunctions` in `src/lib/rbac.ts` |

---

## 9. Pending / operational notes

- **Pending user action:** 0007–0009 are already run. **Run
  `0010_notif_link.sql`** in the Supabase SQL editor — it adds
  `notifications.link` so notification clicks can open the related account.
  Until it runs, notifications simply aren't clickable (the code retries the
  insert/select without the column, so nothing breaks).
- **CORE data (The Blue Man):** `src/lib/core-analytics.ts` fetches
  core.aiesec.org.eg's public national dashboard + Alexandria's LC page
  (id 899, cached 15 min) and injects the top-10 national rankings per product
  and Alexandria's funnel into the assistant context. No key needed. If CORE's
  HTML structure changes, adjust `extractMainText`'s `main-container` marker.
- `GEMINI_API_KEY` must exist in `.env.local` AND Vercel env (The Blue Man).
- **Module-ready announcement email**: template `moduleReadyEmail` is ready;
  send ONLY when Ahmed says go.
- Legacy columns (`project`, `package_plan`, `podio_link`, flat contact
  columns) remain in the DB for mirrors/history but are out of the UI.

---

## 10. Changelog

- **2026-07-14 · v10** — Visit **shared with leaders** (calendar attendees: Member
  → TL+VP, TL/Coordinator → VP; raising only) and a **function-wide visit
  announcement** (email + in-app notification to the product's raising crew +
  B2B; `visit_announcement` kind); **leaderboard reworked** into ONE wide board
  showing all funnel numbers with **click-to-sort FLIP animation** (default
  Opens); **notifications are actionable** — visit/follow-up notices carry a
  `link` (migration 0010) and open the account on click; **profile forgot-
  password** now emails a fresh password (was still saying "ask IM team");
  **12-hour AM/PM** timestamps everywhere; **last-contact-result filter** on the
  accounts list; **avatar upload** (client-downscaled to a ~256px data URL) + a
  **bearded** avatar set; removed the B2B blurb from the add-account dialog;
  **fixed invisible mobile date inputs** (pinned `color-scheme` to the active
  theme so native date placeholders show).

- **2026-07-14 · v9** — **B2B accounts** are their own product: B2B people add
  accounts as B2B and each deal records **opens per product** (IGV/IGTa/IGTe —
  migration 0009 `deals.slots_igv/igta/igte` + account totals), those splits
  feeding the product dashboard lanes; **visibility** clarified — Member/
  Coordinator=own, TL=own+team, VP=whole function **+ B2B**, Director=their
  function(s) **+ B2B**, LCP=all (`scopeFunctions`); **one leaderboard** listing
  **Members & Coordinators only** with metric buttons (Opens default · MR ·
  Contacted · Visits · Visits done · Deals) — the by-member drill and Flags
  column removed; **OOP reasons** are a fixed pick-list + Other; **manual
  archive** on the Archived tab (Add archived · Import archived CSV/XLSX with
  editable preview) writing to `blacklist`, mirrored to a **"CRM — Archived
  Accounts (DO NOT re-add)"** sheet (all OOP + manual names); **forgot password
  emails a fresh password** (old one still valid until changed) and **login
  accepts email OR phone**; **profile avatars** (fun DiceBear characters or the
  Google photo, shown in sidebar); **calendar fixed** — `scheduleVisit` reports
  why a reminder failed (dead grant → re-login) and **next-step follow-up events**
  land on the calendar at the step's time (or 11:00 if date-only), synced/removed
  with the step; **The Blue Man reads CORE** (core.aiesec.org.eg national
  rankings + Alexandria funnel, cached 15 min); **timestamps show HH:mm** in the
  timeline/history/comments; accounts list gains a **last-contact-result column**
  and **hover details** on every field (status → deal/visit/contact specifics),
  and its **Responsible filter lists only members with accounts in the current
  view**; **smoother theme switch** (View Transitions circular reveal + eased
  color transitions).

- **2026-07-11 · v8** — **Sodio** branding everywhere (sidebar, tab titles,
  manifest/PWA, login, emails, tour, onboarding); **The Blue Man** AI assistant
  (floating walking-man button → chat popup; Gemini 2.5 Flash free tier with
  Google Search grounding; context = viewer-scoped Sodio data via
  `buildAssistantContext` + AIESEC sites: aiesec.org, aiesec.org.eg,
  core.aiesec.org.eg, expa.aiesec.org); **B2B = whole-ICX raising** (both
  lanes); **deals attributed to the account's Responsible** with hierarchical
  TL rollup on leaderboards, VPs/LCP excluded from the member board;
  **notifications** (migration 0008): bell + unread badge, welcome/reset/visit/
  follow-up/thanks/broadcast kinds, EB & admin broadcast to all/by function/
  by role/hand-picked (optional BCC email); **feedback v2**: anonymous option
  (🎭), rebuilt inbox cards, thank-you action (in-app + email, with confirm),
  copy-email, done/archive + status filters; **KPI cards hover animation**
  (lift + glow + value lights up); coming-soon page now uses the walking man
  with rotating funny lines; friendly enum-error message pointing at migration
  0007; proposal PDFs (iGV/iGTa/iGTe) bundled in `proposals/`.

- **2026-07-11 · v7** — Walking-man loader re-encoded as **APNG** (WebP frame
  disposal stacked frames); **"Visit Scheduled" contact result** replaces
  "Call Scheduled" and books the visit like the dedicated button (migration
  0007); **goal(IGT) = goal(IGTa) + goal(IGTe)** — goals set per product lane,
  IGT lane derived; dashboard/accounts filter bars aligned on one baseline +
  equal-height KPI cards; **official proposal PDF attachment** switch on the
  Proposal email popup (proposals/<product>.pdf, awaiting the actual files).

- **2026-07-11 · v6** — Account type vs industry lists de-overlapped (type =
  WHAT the business is; industry = its DOMAIN: Software/Marketing/Engineering/
  Architecture/Education/Healthcare/Law/Finance/Real Estate/Tourism/Other);
  team drills/leaderboards exclude the EB (real Team Leaders only); WhatsApp
  glyph in the log-contact method select; walking-AIESEC-human loader
  everywhere; **Admin** comment label for the IM director (migration 0006);
  pinned sign on the list is now a pulsing ❗; **ICX Proposal Email integrated**
  (per-product Gmail drafts in the member's own mailbox, gmail.compose scope);
  animation pass: count-up KPIs, hover-lift cards, press-scale buttons,
  confetti on recorded deals.

- **2026-07-10 · v5** — IGV **Project restored everywhere** (required at
  create/import, badge on detail, text next to the IGV badge on the list,
  filter, editable in Details); real **WhatsApp glyph** replaces the generic
  message icon (quick actions + contact history); **email tags exclude
  Whatsapp**; **Google-first auth** — credentials are rejected until a password
  exists, Google consent asks for `calendar` + `gmail.send` (future features),
  login page reordered with Google primary, all reset copy updated;
  **multi-deal model** — `deals` table (migration 0005), `recordDeal`, account
  stays workable after deals, deal history in the timeline, header shows
  "N deals · M slots"; **dashboard KPIs redesigned** to MR / Contacted /
  Visits / Visits done / Deals / Slots / Lead→Deal + conversion strip, funnel
  card and flag KPIs removed, drill tables use MR/deals.
- **2026-07-10 · v4** — Password eye toggles everywhere; Podio **Rejected**
  archives the account (confirm dialog); tagged contact lists
  (Contact/Whatsapp/Manager/HR/CEO/Owner/Other) + **multi links**
  (Website/LinkedIn/Instagram/Facebook/Other) via shared `ContactsEditor` (add
  dialog + account page); **Egyptian phone normalization** (+20 canonical,
  03/02 landlines); **slug URLs** (`/accounts/hadana`) + dynamic tab titles
  with authorization-checked metadata; **pinned comments** (highlight + 📌 on
  the list with hover preview; migration 0004); accounts list redesigned
  (Date added · Account · Product · Status · Contacts · Next step · quick
  WhatsApp/call/email/social actions with overflow menu) + date-added filter;
  dashboard date inputs labeled (mobile) and future dates blocked client+server;
  this AI_CONTEXT.md created as the living doc.
- **2026-07-10 · v3** — Mobile-first pass (min-w-0 fix, card lists, skeletons,
  transition shimmer); role/function-aware tour + tooltips; goals +
  leaderboards + All-IGT lane + scoped member filter + This month; bulk
  CSV/XLSX import; multi tagged contacts (7–15); "Not Interested" auto-OOP;
  IGTa/IGTe/IGV badges (GTe orange); project removed; free-form sheet values;
  manager defaults; LCP excluded from ops emails; Manager wording; reset CTA;
  nicer emails; logo→home; typo fix.
- **2026-07-09 · v2** — Final membership sheet structure (LCVP/Team Leader/
  Director, multi-select functions, stakeholder by name); password auth +
  onboarding; profile; in-app membership editor with sheet write-back; archive
  replaces blacklist; numbered comments; Call Scheduled; function-gated account
  creation; curated lists; AIESEC branding + dark-mode toggle; feedback page
  (emails IM director + coach, inbox restricted to them); dashboard lanes.
- **2026-07-06 · v1** — Phase 1: schema, RBAC, accounts/contacts/visits,
  Google-only auth, floating feedback, sheets mirror, PWA.
