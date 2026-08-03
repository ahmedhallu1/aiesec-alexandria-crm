# AI_CONTEXT.md — Single Source of Truth (Sodio — AIESEC in Alexandria CRM)

> **⚠️ LIVING DOCUMENT.** Update this file **in the same commit** as any change
> to the system (feature, rule, route, schema, env var, deployment fact).
> Add a dated entry to the **Changelog** at the bottom. No secrets in this file.
>
> **⚠️ SHIP RULE (every session, no exceptions):** finished work goes
> **commit → merge to `main` → push to GitHub → `vercel deploy --prod`**.
> Never leave features on a side branch — that's how `0011_teams.sql` "went
> missing" once. Also update the in-app **Playbook**
> (`src/components/crm/playbook-view.tsx` + `PLAYBOOK_VERSION`) with every release.

Last updated: 2026-08-03 · Version: v32.1

---

## 1. What this is

**Sodio** (briefly renamed **Elevate** in v28 — REVERTED in v32.1; internal
keys/cookies were always sodio-*, so nothing user-facing was ever lost) — a **100% free** CRM for AIESEC in
Alexandria: the ICX functions
(**IGV** & **IGT** raising, **B2B/BD**, **B2C**) plus — since v25 — the **OGX
sign-ups module** (OGT & OGV, two-way synced with the LC's tracker sheets). The brand name is
**Sodio** (shown in the sidebar, tab titles, manifest, emails); the built-in
AI assistant is **The Blue Man**. Members log accounts, contacts, visits and
deals; leaders steer with goals, leaderboards and dashboards. The RBAC engine is
the blueprint for future OGX/other-function modules.

| | |
|---|---|
| Live URL | https://sodio.vercel.app (+ aiesec-alexandria-crm.vercel.app; **elevate-alex.vercel.app was removed in v32.1**) |
| Repo | github.com/ahmedhallu1/aiesec-alexandria-crm (private) |
| Vercel project | `aiesec-alexandria-crm` (scope `ahmedhallu1s-projects`) — deploy with `vercel deploy --prod` |
| Stack | Next.js 16 (App Router, Turbopack) · React 19 · Tailwind v4 · shadcn/ui · Supabase (Postgres, project `iesrpuuoduxtihuaqfic`) |
| Auth | Auth.js v5: **FIRST sign-in is Google-only** (grants `calendar` + `gmail.compose`) → onboarding sets a password → afterwards **email OR phone + password**, or Google, all work. **Members with NO email yet (v24) sign in with their phone in BOTH fields** until a password is set; adding their email closes that door (Google once, then password). Deactivated members land on **/inactive**. **Forgot password emails a fresh password** (`issueTempPassword` in `server/password.ts`); the old password still works until the member changes it (no lockouts) |
| Google | Service account (Sheets sync) · Gmail API from `ahmedhallul@aiesec.net` · Calendar events on each member's own calendar |
| Cron | Supabase `pg_cron` + `pg_net` → `/api/cron/*` (visit-followups 15 min · membership-import 30 min · sheets-export hourly · goal-reminders daily 06:00 UTC · signups-import 15 min · podio-updates daily 05:00 · period-reports daily 07:00 · streak-nags daily 17:00 UTC) |
| Admin | `ADMIN_EMAILS` env (= IM director, treated as LCP) |

**Migrations** live in `supabase/migrations/` and are run **manually** in the
Supabase SQL editor (no CLI on this machine): `0001_init` → `0002_membership_v2`
→ `0003_ops_v2` → `0004_pins_v2` → `0005_deals` → `0006_admin_label` → `0007_visit_scheduled_result` → `0008_notifications_feedback` → `0009_b2b_deals_v9` → `0010_notif_link` → `0011_teams` → `0012_contracts_reminders` → `0013_director_label` → `0014_bd_podio` → `0015_bd_deal_amount` →
`0016_comment_archive` → `0017_planning_lcfeedback_testmode` →
`0018_tl_plans_deal_allocations_unassigned` → `0019_b2c_module` →
`0020_name_worlds` → `0021_podio_updates_all_fns_email_optional` →
`0022_team_registry` → `0023_email_unique_fix_phone_identity` →
`0024_function_leaders_type` → `0025_ogx_signups` → … → `0032_ir_booker_role` →
`0033_change_journal_lc_test` (**NOT YET APPLIED** — run it in the SQL editor).

**Google Drive sheets (deliberately FEW — flag columns instead of per-product
sheets):** `CRM — Membership` (two-way, + a **"Teams" tab** naming the standing
teams — sheet types `EB / LB / Function / Function leaders / Team`;
"Function leaders" is stored as **MM**, "Team" rows are skipped (TL team names
live in the Membership tab); the Function cell may hold SEVERAL functions
("B2B, BD") → one `teams` row per function; imported into the `teams` table.
The whole Drive folder is shared with **every EB member as commenter**) ·
`CRM — Raising Accounts` (ALL accounts in ONE mirror — IGV + IGT + B2B, active
AND archived — with `Function / Product / Archived?` flag columns for
filtering) · `CRM — Archived Accounts` (the focused blacklist view: OOP +
manual names) · `CRM — Contact Log` · `CRM — Visits`. Spreadsheets are found
BY TITLE in the Drive folder; ids are cached in `app_settings`
(`sheet:<title>`). The old per-product sheets (`CRM — IGV Accounts`,
`CRM — IGT Accounts`) and the separate `CRM — Teams` spreadsheet are GONE.

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

**B2B & BD are ONE function** (same membership today — may split in future
peaks): `isB2B` in `rbac.ts` (and `memberIsB2B` in `types.ts` for plain member
rows) matches **either** "B2B" or "BD" in functions or sub-functions, and
everything below applies to both names. **Accounts carry either label** —
the crew picks B2B or BD when adding (both behave identically: whole-ICX
opens mix; migration 0014 adds the `BD` account function). The dashboard's
B2B lane shows both; BD gets its own drill row and badge color.

**Podio submission worklist** (B2B/BD only): the "Podio pending" filter on
the accounts list — visible to `canRequestPodioSubmit` (the function's MMs +
Director/VP + LCP/admin) — shows B2B/BD accounts with `requested_podio=false`
and no request state. Each row gets a **copy-name button** (for the national
Podio form), an **inline request-state select** (Checking/Approved — also
marks requested; Rejected stays on the account page behind its confirm), and
**"Ask to submit"** (`requestPodioSubmit`): in-app notification ONLY to the
owner + `accounts.podio_submit_requested_at` — the account then **pins to the
top of the owner's accounts list** with a "Submit on Podio" badge until they
mark it requested / set a state (auto-cleared in `updateAccount`).

**TM module** (`/members`, `hasTmAccess` = TM function + LCP/admin — v1, more
later): the whole-LC members directory — info, team, manager, per-member
MOS/KPIs (own accounts: MR·Contacted·Visits·Done·Deals·Opens) and
email/call/WhatsApp shortcuts. TM users without raising access enter the
shell for `/members` + `/playbook` (GateClient `extra` prefixes) — the page
ALSO gates server-side (`redirect` + `listMembersDirectory` returns `[]`).

**Profile "my people" card** (`profilePeople` in data.ts): Team Leader → their
direct team · VP/Director → their whole function · LCP/admin → the EB
(LCVPs) · Members/Coordinators → nothing. Each person row has
email/call/WhatsApp buttons.

**Admin "Test view" (View-As)**: the admin's profile has a member picker —
`startViewAs` sets an httpOnly cookie (`sodio-view-as`, 4h expiry) and
`getViewer()` then returns the impersonated member (`viewer.impersonated`)
so THE WHOLE APP behaves as them; the real session is never touched
(`getRealViewer` powers the admin checks + the picker itself, so it works
mid-test-view). A fixed bottom banner shows "Test view: X — Exit". The
/welcome redirect is skipped while impersonating. ⚠️ Actions taken in a test
view are REAL and attributed to the target member (by design — it's a test
tool; audit_log records view_as_start/stop by the real admin).

**BD deals' MOS = MONEY** (migration 0015: `deals.amount` EGP +
`deals.benefits`): recording a deal on a BD account requires the amount
(opens optional); deal history shows `EGP X` + benefits, the account header
badge sums EGP across deals, and "CRM — Raising Accounts" gains a
"Deal Amount (EGP)" column. Dashboards/leaderboards still rank opens —
money is per-account/sheet for now (a money KPI can come later).

**B2B** (function or sub-function contains "B2B"/"BD") raises **for the whole ICX**:
they add accounts as **product "B2B" or "BD"** (not IGV/IGT), and every deal
records its opens **split across IGV / IGTa / IGTe** (e.g. 3 IGV · 2 IGTe ·
1 IGTa). Those per-product opens feed the IGV / IGTa / IGTe dashboard lanes,
while the accounts live in the B2B lane/drill. Detected by `isB2B` in
`rbac.ts`; feeds `scopeFunctions`, `hasRaisingAccess`, `allowedAccountFunctions`.
**v15 isolation: the B2B/BD crew's own dashboard shows ONLY their B2B lane**
(their accounts + the B2B lane goal) — `icxFunctions` no longer widens them to
IGV/IGT and `dashboardViewer` scopes them to B2B+BD. The **B2B lane has its
own function goal** (`performance_goals.function = 'B2B'`), set by the B2B/BD
**VP or Director** (the "function leaders" team's leader — e.g. Suits → Yara),
never by its TLs; **team goals require an actual team** (a TL with zero
members can't set one — server-checked). The calendar (`/calendar`) is also
**own-function only** (LCP/admin see all).

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
- **Deal opens can be SPLIT across members** (v22, `deal_allocations` —
  deal_id, member_id, per-product splits; every deal gets ≥1 allocation, the
  default is 100% to the responsible): the Record-deal popup has a "Split the
  opens" switch (member list = everyone in the account's function via
  `listFunctionMembers`; splits must sum exactly — server-checked). ALL
  per-MEMBER opens numbers read allocations (leaderboards, members directory,
  period-report person rows, "My numbers" slots, TL-plan actuals) with an
  account-counters fallback when the table is empty (pre-0018); LANE totals
  still come from the deals' per-product split columns. Deal history shows
  "Opens split: A (3) · B (3)" when custom.
- **Unassigned accounts** (v22): `accounts.responsible_id` is NULLABLE (the
  pipeline view LEFT-JOINs members). The imported market research lands
  unassigned; member/TL scopes never match NULL so only VPs/Directors/LCP see
  those rows (accounts filter Responsible → "— Unassigned", value `none`) and
  distribute them via (bulk) reassign. Guards: scheduleVisit / requestPodioSubmit
  / recordDeal-without-split fail with "assign first" messages; UI renders
  "Unassigned".
- **B2C module (v23)**: `AccountFunction` gains `B2C` (enum + check via 0019).
  B2C accounts carry ONE **Type** — `B2C_TYPES` = Courses / Events / Student
  activities — stored in `account_type` (no industry, no product/project).
  **Podio continuous updates**: every B2C account must be refreshed on Podio
  every `podio_update_every_days` days (default `PODIO_UPDATE_DEFAULT_DAYS` = 14 since v24.1,
  editable 1–90 on the account's "Podio — continuous update" card, which shows
  the countdown); `markPodioUpdated` stamps `podio_updated_at` and clears
  `podio_update_notified_at`. The daily **podio-updates cron** (05:00 UTC,
  `/api/cron/podio-updates`, scheduled in pg_cron) notifies (bell kind
  `podio_update` + `podioUpdateDueEmail`) the responsible + the B2C
  LCVP/Directors ONCE per cycle when due. **B2C deals carry NO details**
  (deals check relaxed to `slots >= 0` in 0019): the Record-deal popup links
  the contract Google Form (`B2C_CONTRACT_FORM_URL`) and offers one "Deal
  signed" button — no opens/splits/amount/files. **No proposal emails**
  (button hidden + server-rejected). RBAC: `isB2C`/`memberIsB2C` (functions OR
  sub_functions), B2C appended to `scopeFunctions`/`allowedAccountFunctions`,
  `hasRaisingAccess` includes the crew; the **B2C dashboard lane** is
  isolated like B2B (crew + LCP/admin only), deals-centric (no Slots KPI,
  "Lead → Deal", leaderboards ranked by Deals, B2C excluded from All-ICX);
  members-directory MOS `b2c` = deals; visits announce to the B2C crew only.
- **The accounts list is PAGINATED** (v22): `listAccountsPage` (page size 100,
  `?page=` 1-based, exact count, Prev/Next footer; filter changes reset the
  page). Full-set readers (`listAccounts`, dashboard, mirrors, directory,
  reports) page through Supabase's 1000-row response cap via `fetchAll`
  (stable order + id tiebreak, 20k sanity ceiling).
- **Deal contracts (optional)**: any file format, uploaded at record time or
  later from the deal's History entry (`deals.contracts` jsonb, migration
  0012). Files go browser → private Supabase Storage bucket `contracts` via
  **signed upload URLs** (`requestContractUploads` → PUT → `confirmContractUploads`
  — Vercel caps action bodies ~4.5 MB, so bytes never touch the server); viewing
  uses 10-min signed links (`getContractUrl`, anyone who can view the account).
- **IGV accounts always carry a Project** (Skill Up!, Rooted, …) — required at
  creation/import, shown on the accounts list next to the IGV badge, editable
  in Details, filterable.
- **Unique name — WORLD-AWARE (v23.2)**: ACTIVE names are unique across every
  function, but the ARCHIVE block is per world — ICX-raising (IGV/IGT/B2B/BD,
  incl. the manual blacklist) vs B2C each keep their own archive
  (`checkAccountName(name, fn)`; a cross-world archived match is a
  non-blocking heads-up in the add dialog). The DB index is
  `accounts_normalized_name_world_key (normalized_name, function='B2C')`
  (0020), so a name can exist archived in one world AND active in the other:
  slug lookups prefer the ACTIVE row; archived list rows link by UUID.
- **The archive IS the blacklist**: OOP accounts are hidden, unre-addable,
  revivable by TL+. No blacklist tab/sheet. **The Archived tab is LC-WIDE
  (v22.2)** — every member browses ALL archived names (scope skipped) and can
  OPEN any archived account read-only (`canViewAccount` passes for archived;
  editing stays scoped via `canEditAccount`); add/import archived stays TL+
  (`canManageArchive`).
- **Auto-archive rules**: contact result **"Not Interested"** and Podio request
  state **"Rejected"** both archive the account (with warning confirmations).
- **Out-of-Process reasons** (`OOP_REASONS` in `types.ts`) are a fixed pick-list
  — Not responding · Financial issues · Not Interested · Backed out · Other Plans
  · Needs too technical background EPs · Conflict of Values between AIESEC and
  organization · Blacklisted — plus **Other** (free text).
- **Manual archive** (Archived tab, TL+): **Add archived** (name — the reason
  is OPTIONAL) and **Import archived** (CSV/XLSX with Name + optional Reason,
  editable preview, ≤1000 rows, free-form reasons kept as-is) blacklist names
  that were burned before the CRM existed — no active account needed. Entries
  live in the `blacklist` table and block re-adding exactly like an OOP
  account; VP+ can remove an entry.
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
  `TL/VP/Director/LCP/Admin Comment #n` — a Director is labeled **Director**,
  NOT VP (migration 0013); the IM director's label is **Admin**, not LCP).
  Any comment can be **pinned** → highlighted in the card AND shown as a ❗
  (CircleAlert) on the accounts list; hover reveals the text. Any comment can
  also be **archived** (migration 0016 `account_comments.archived`;
  `toggleCommentArchive`, RBAC = `canEditAccount`) — archiving unpins it and
  hides it behind an **"Archived (n)"** toggle on the comments card; numbering
  runs over the FULL list so `#n` never shifts.
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
  **Design = the LC's original proposal tool** (card layout: AIESEC logo +
  program badge header, headline, intro, "Why this could be a strong fit"
  callout, Opportunity-snapshot + About-AIESEC cards, meeting-request callout,
  "More about {program}" link, member signature) — **ONE brand color for all
  products (AIESEC blue `#037EF3`)**, only the CONTENT is per-function;
  **NO company-logo section and NO "Dear …" greeting** (both by request — the
  recipient-name field was removed from the popup too). The signature title is
  product-based, NOT the CRM role (`Global Volunteer/Talent/Teacher Manager`,
  B2B → `Business Development Manager`) and the phone links to
  `wa.me/<number>`. B2B accounts default to a **general all-programs variant**
  linking to `aiesec.org/partners` (can still pick a specific product's body).
  **B2B/BD accounts attach NOTHING by default** (v20 — the attach set starts
  empty; the member opts in per product), whereas IGV/IGT prefill their own
  product PDF.
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
  - **Follow-up reminders (v11)**: the +2h "was it completed?" email goes to
    the responsible **AND their team leader/manager** when the responsible is
    a Member/Coordinator (details table included); TL-and-above get it alone;
    the LCP never. **One week later with still no report** → a firmer
    "you forgot about it" email to the same people (report the result, or
    mark the account Out of Process if not interested — no wasted resources).
    Tracked by `visits.followup_prompt_sent_at` + `forgotten_nag_sent_at`
    (migration 0012), both passes in `/api/cron/visit-followups`.
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

**GOALS COME FROM PLANNING — nothing is set in-app (v22).** The
`performance_goals` machinery is retired (setPerformanceGoal, GoalDialog,
Set-goal buttons, the goal-reminders cron + its email templates are all gone;
the table stays in the DB, unread). Instead: the **lane goal = the PlanCard**
(plan_cells opens vs `laneOpensActual`, sprint/month toggle — product lanes
only; the B2B lane has no planned goal because the planning sheet skips
B2B/BD) and the **team goal = the TL's filed plan** (`tl_plans`, see below) —
`getDashboard` returns `teamPlan` {planned vs allocation-attributed actual for
the current month} rendered as TeamPlanCard (a TL with no filed month sees a
nudge to their profile). Funnel conversion percentages are **capped at 100%**
everywhere (dashboard strip/KPI/drills + planning conversions — plan-progress
bars stay uncapped). The **"My numbers" chip is hidden for VP/Director/LCP/
admin** (they already see the whole function). Filter bar sits on a single h-9
baseline (the date range is one inline "Added → →" group) and KPI cards have
equal-height labels so the numbers align.

**Raising MM plans (v22, `tl_plans`)**: raising MMs — **Team Leaders AND
Coordinators** of IGV/IGT or B2B/BD (`isPlanningTl`; consideration/OGX MMs
keep the applicants/accepted/approvals `mm_plans` flow, never both — so EVERY
MM plans) — file OPENS per month of the peak on first sign-in
(`/welcome/plan-tl`, layout redirect via `needsTlPlan`) and edit any time from
the profile **"My plan" card** (`tlPlanForProfile` — plan + actual opens per
month, allocation-attributed; a TL's actuals cover the whole team, a
Coordinator's their own). `saveTlPlan` upserts (peak re-derived server-side,
sandbox-journaled). /planning gains a **"Raising MM plans"** card
(`listTlPlans`) next to the MM plans. Only a TL's plan feeds the dashboard
team card.

**KPI row (this exact order, nothing else):** Market Research (total accounts) ·
Contacted · Visits (scheduled) · Visits done · Deals (count of deals, not
accounts) · Slots raised · **Lead → Open** (% of accounts that raised opens).
Directly below: the step-to-step **conversion strip** — MR→Contacted,
Contacted→Visits, Visits→Done, and **Visit Done → Deal**. (The old funnel bars and flag KPI
cards were removed on request; flags remain reachable via accounts filters.)

- Lanes gated by the member's functions: `All ICX / IGV / All IGT / IGTa / IGTe`
  (product colors: GV `#F85A40`, GTa `#0CB9C1`, GTe `#F48924`).
- **Everyone in a module sees their whole function's aggregates** (accounts list
  stays scoped); member filter shows only lane members (never the LCP).
- **Goals** (`performance_goals`): VP/Director sets the function goal, TL the
  team goal (month or peak period) — progress bars on everyone's dashboard.
  **Goal reminder cycle (v11)**: when a period ends with no successor goal,
  the daily `goal-reminders` cron emails the owners (lane → its VPs/Directors,
  team → the TL) last period's **goal vs achieved** + a set-the-new-goal
  button (once per goal — `ended_reminder_sent_at`, migration 0012; goals
  ended >14 days ago are marked silently). Setting a NEW goal emails +
  notifies everyone it applies to (lane members incl. B2B, or the TL's team)
  via `newGoalEmail` — updates to an existing period stay quiet.
- **"My numbers" chip** in the dashboard filter bar: any member can toggle the
  KPIs + conversion strip to just their own accounts (`member=<their id>` URL
  param — the personal KPIs/MOS tracker). **The member filter scopes the KPI
  totals + conversions ONLY** — leaderboards, product/team drills and goal
  progress always show the full picture (`responsibleId` is stripped from the
  DB query and applied in JS to `total` alone).
- **B2B lane** on the dashboard for the LCP/admin, VPs & Directors (B2B
  affects their functions) and the B2B crew — `rowInLane`/`laneSlots` already
  spoke B2B; v12 exposes the `views` chip + `parseFnParam` case.
- The last conversion is labeled **"Visit Done → Deal"** (v20 — the share of
  visit-done accounts that reached a deal; `pct(dealAccounts, visitDone)`).
- **Visits calendar** (`/calendar`, sidebar for every raiser): month view of
  the WHOLE function's visits (B2B included), one stable color per member,
  legend with counts, Saturday-first weeks, agenda cards on phones, click-through
  to the account. `listFunctionVisits` in `data.ts`; `?m=YYYY-MM` picks the month.
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
supabase/migrations/          0001..0012 (run manually in SQL editor)
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
                              playbook, feedback(+inbox), profile; loading.tsx everywhere
src/components/crm/playbook-view.tsx  THE PLAYBOOK (role-organized manual — bump
                              PLAYBOOK_VERSION + content with every release)
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
| The Playbook (member manual) | `src/components/crm/playbook-view.tsx` (+ bump `PLAYBOOK_VERSION`) |
| Lane goal display (plan vs actual) | `lanePlan` in `getDashboard` · `PlanCard` in `dashboard-view.tsx` |
| TL plans (who files, flow, card) | `isPlanningTl`/`needsTlPlan`/`tlPlanForProfile` in `data.ts` · `saveTlPlan` in `actions.ts` · `tl-plan-form.tsx` · `/welcome/plan-tl` |
| Deal opens splits | `recordDeal` allocations in `actions.ts` · `deal_allocations` reads in `data.ts` · DealDialog in `account-detail-view.tsx` |
| Accounts list pagination | `listAccountsPage` in `data.ts` · pagination footer in `accounts-view.tsx` |
| Follow-up / forgotten-visit reminders | `/api/cron/visit-followups/route.ts`, templates in `email/templates.ts` |
| Deal contract uploads | `requestContractUploads`/`confirmContractUploads`/`getContractUrl` in `actions.ts` |
| Sprint/peak/quarter calendar math | `src/lib/plan.ts` |
| Planning sheet parsing / re-import | `importPlanningSheet` in `src/lib/google/sheets.ts` |
| Planning page / dashboard plan card | `planning-view.tsx` · `PlanCard` in `dashboard-view.tsx` · `lanePlan` in `getDashboard` |
| MM plan flow (who must file, when) | `isPlanningMm`/`needsMmPlan` in `data.ts` · `peakForPlanning` in `plan.ts` · `/welcome/plan` |
| Period reports (content / cadence / recipients) | `buildFunctionReport` in `data.ts` · `periodReportEmail` in `templates.ts` · `/api/cron/period-reports` |
| Sandbox test view (undo / suppression) | `src/server/sandbox.ts` · `startViewAs`/`stopViewAs` in `actions.ts` · chip in `view-as-banner.tsx` |
| Test data seeding | `seedTestAccounts`/`removeTestData` in `actions.ts` |
| Podio existence check (parser / cache / TTL) | `src/lib/podio.ts` · `checkPodioNameLive` in `actions.ts` · verdict UI in `add-account-dialog.tsx` |
| Dashboard lane list & who sees it | `raisingFunctions`/`considerationFunctions`/`seesEveryLane`/`ogxLanes` in `rbac.ts` · `views` in `dashboard/page.tsx` |
| Change journal / undo / LC test session | `src/server/sandbox.ts` · `startLcTestSession`/`stopLcTestSession`/`undoAuditEntries` in `actions.ts` · `/admin` |
| Stale plans when membership changes | `stillPlans`/`prunePlansForMember`/`pruneStalePlans` in `data.ts` |
| First-run walkthrough | `buildSteps` in `tour.tsx` (bump `crm-tour-v*` to re-show it) |
| Feedback categories | `FEEDBACK_CATEGORIES` in `types.ts` |
| LC people feedback | `submitLcFeedback` in `actions.ts` · `lc-feedback-view.tsx` · inbox via `listLcFeedback` |

---

## 9. Pending / operational notes

- **All migrations 0001–0017 are RUN** (0001–0015 verified live 2026-07-16;
  0016 applied 2026-07-18; **0017_planning_lcfeedback_testmode applied
  2026-07-21 via the Supabase MCP** — plan_cells, mm_plans, feedback.category,
  lc_feedback, accounts.is_test (+ accounts_pipeline view column),
  test_sessions, test_undo).
- **PLANNING SHEET STILL NOT REACHABLE BY THE SERVICE ACCOUNT** (re-checked
  2026-07-26 after Ahmed shared it: Drive returns "File not found" for the
  service account = zero access — the share never landed, most likely an
  aiesec.net external-sharing restriction or a mistyped address). v21's 1512
  verified plan cells stay live. For the /planning **Re-import** button to
  work, "Alexandria | Planning Tool 26.1" must be readable by
  `crm-sheets@gen-lang-client-0055329754.iam.gserviceaccount.com` — either a
  direct Viewer share (watch for the "sharing outside your organisation"
  warning and confirm it), OR move/copy the sheet into the CRM Drive folder
  (the folder is already shared with the service account).
- The **period-reports pg_cron job** (daily 07:00 UTC) was scheduled directly
  in prod (2026-07-21) by cloning the goal-reminders job's URL+key — it's in
  supabase/cron.sql too for rebuilds.
- **CRON_SECRET was rotated 2026-07-16**: the old pg_cron jobs had been
  scheduled with the literal `<CRON_SECRET>` placeholder (silent 401s — the
  production crons had likely never fired successfully). New 48-hex secret
  lives in Vercel prod env + `.env.local` (in sync); the four cron jobs were
  rebuilt with it via one SQL script. If the secret ever rotates again:
  update BOTH env locations, redeploy, and re-run the four `cron.schedule`
  calls from `supabase/cron.sql` with the value substituted.
- **CRON_SECRET is IN SYNC** since 2026-07-26: `.env.local` now carries the
  same value as Vercel/pg_cron (pulled from `cron.job` and pasted in) — manual
  local cron triggering works.
- **Drive is already renamed** (done by Ahmed by hand): the old IGT sheet is
  now `CRM — Raising Accounts`, the blacklist sheet is `CRM — Archived
  Accounts`, the IGV sheet is deleted. The code finds them by (loose) title,
  so nothing else is needed; the Teams TAB on the Membership sheet is created
  and seeded automatically on the next membership import.
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

- **2026-08-03 · v32.1** — **THE RENAME IS REVERTED: the system is SODIO again.**
  v28's Sodio → Elevate rename is undone — **173 user-visible strings** across
  38 files went back to **Sodio** (sidebar, tab titles, manifest, login,
  onboarding, tour, playbook, The Blue Man, /inactive, both /book pages, and
  **every email template + subject line**), plus 3 `ELEVATE` wordmarks and the
  7 `elevate-alex.vercel.app` links.
  **URL:** `NEXT_PUBLIC_APP_URL` → `https://sodio.vercel.app` and the
  **elevate-alex.vercel.app alias was REMOVED from the project** — so the IR
  booking links members share (`sodio.vercel.app/book/<slug>`) and every link
  inside an email now carry the Sodio domain. `aiesec-alexandria-crm.vercel.app`
  still resolves.
  **Two things deliberately NOT touched:** `elevate2point0.com` (the separate
  "Created by 2.0" credit — a different thing entirely, not the brand) and the
  `elevate-table:<id>` localStorage key for saved table column layouts —
  renaming it would silently reset everyone's column order and visibility, the
  same reason v28 kept the `sodio-*` keys.
  The v28/v29 changelog entries are kept as history and marked reverted; the
  dead "Sodio is now Elevate" announcements were removed from the Playbook and
  the Blue Man, which now states plainly that the system is Sodio at
  sodio.vercel.app and that any "Elevate" mention is the reverted name.

- **2026-08-03 · v32** — **RAISING, LANES, PODIO & THE CHANGE JOURNAL.**
  ① **"Accounts" tab renamed "Raising"** (nav, tab title, page hero,
  playbook); the `/accounts` route is unchanged.
  ② **Dashboard lanes are named for the SIDE they show** — IGV Raising ·
  IGV Consideration · IGT Raising · IGTa Raising · IGTe Raising · IGT
  Consideration · OGT · OGV · B2B · B2C — and gated on the work the viewer
  actually does (`worksSide` in rbac): a Member/Coordinator/Team Leader gets
  exactly the side(s) their **Sub Function** column names, an LCVP/Director
  gets BOTH sides of the product function they lead (bound to `icxFunctions`,
  so a B2C or BD Director never picks up IGV/IGT consideration), and **nobody
  sees the other product's lanes** (before this, any Consideration label
  handed out both IGV *and* IGT consideration). `seesEveryLane` gives the
  **LCP/admin + the TM and F&L leadership** every lane, and /dashboard is now
  reachable for them. The module gates stay deliberately narrower than the
  lane lists: `hasConsiderationAccess` and `ogxFunctions` still answer "may
  you WORK this", so overseeing a lane never grants the right to work a
  sign-up, an IR call or the CV pool (`ogxLanes` is the dashboard-only twin).
  ③ **Quick actions open the REAL contact form** — tapping WhatsApp/Call/Email
  opens the normal ContactDialog with the method pre-selected and every result
  available; the reduced `QuickContactPrompt` and its "Open the full contact
  form →" link are gone.
  ④ **AUTOMATIC PODIO CHECK** (`src/lib/podio.ts`): while the account name is
  typed, Sodio answers "is this already on Podio?" itself, by calling the
  national form's OWN dropdown search —
  `GET /webforms/<form>/<rev>/items_search?field_id=<id>&query=<q>&limit=50`.
  It is public (no key, token or cookie) and returns the same ordered list the
  member sees, best match first, over the WHOLE Companies app. `field_id` is
  discovered from the form's embedded config (cached a day in `app_settings`
  `podio:field-id`, with the known id as fallback) and results are cached
  10 min per query in-process. Verdicts: ⚠️ already on Podio (don't submit a
  duplicate — add it here and ask the MM for the request state) · 🔎 not on
  Podio (submit it, with whatever Podio DID return listed as near-misses) ·
  nothing at all if Podio is unreachable (fails SOFT to the manual link).
  **v32.2 correction:** the first version parsed the ~300 `<option>` tags
  embedded in the form's HTML. Those are only the dropdown's FIRST PAGE — the
  field is an app-reference whose select2 queries the server on every
  keystroke — so anything outside them ("Gateway", for one) was reported "not
  on Podio". There is no 300-item ceiling any more.
  ⑤ **Phone paste fix**: `cleanPhone` now reduces a pasted number to `+`? +
  digits. Invisible characters (bidi marks from Arabic chats, zero-width
  spaces, soft hyphens, BOMs) used to survive it, so a number that LOOKED
  perfect kept failing with nothing the member could see or delete — the error
  never went away. The membership field also rewrites itself on blur to what
  the system sees and gives the specific reason.
  ⑥ **Plans follow the member's CURRENT job**: `stillPlans` re-checks every
  plan row against the live membership (so `listMmPlans`/`listTlPlans` drop
  what no longer applies), `prunePlansForMember` cleans up on an in-app edit
  and `pruneStalePlans` sweeps the LC at the end of every membership import —
  where role/sub-function moves actually happen. Farah Hossam's 6 stale
  consideration months were deleted (she is a Raising Coordinator now).
  ⑦ **THE CHANGE JOURNAL** (migration **0033**, ⚠️ *run it in the SQL editor*):
  every action now carries a **change set** (one server-action call = one
  request = one uuid), and the v21 sandbox journal records **always**, not just
  in a sandbox. On that: **Undo from the logs** — /admin gains a per-entry
  Undo, checkbox selection and a bulk "Undo N actions" bar; entries with
  nothing to replay (pre-0033, sign-ins, sent reports) show a disabled
  checkbox instead of a button that would lie. And **LC-wide testing
  sessions** — the admin opens ONE session for the whole LC, everyone's writes
  are journaled, and stopping either rolls them all back or keeps them.
  **⚠️ Side effects are NOT suppressed in an LC session (deliberate choice):**
  emails, notifications, calendar events and the Sheets write-back fire for
  real and cannot be undone — only the DATABASE is restored; permanent deletes
  of archived accounts are blocked while one runs. `pruneJournal` drops
  unowned rows after 30 days. Pre-0033 grace: `logAudit` falls back to the
  classic row on 42703 and `listRecentAudit` to the classic select.
  ⑧ **Onboarding rebuilt**: the tour now opens with **what Sodio is and how
  it fits together** before any tab, and the raising walkthrough is a real
  walkthrough — adding an account (with the three live checks), opening and
  editing it, the action bar (Contact · Visit · Deal · Proposal), the golden
  rule, visits and reminders, and the shared archive. The storage key moved to
  `crm-tour-v2:` so everyone gets it once, and the Playbook gained a **"↻
  Replay the walkthrough"** button (before this, a dismissed tour was gone for
  good in that browser).
  ⑨ **Data cleanup**: the two hand-made junk accounts behind the wrong
  dashboard numbers were deleted — "test1" (IGT, El-Saied) carried the ONLY
  contact_attempt in the entire database, and "Test" (B2C, Ali) carried a
  scheduled visit. Both had been *archived* rather than deleted, and archiving
  does not remove an account from the funnel counts.

- **2026-08-09 · v31.2** — The contact-after-click hand-over keeps the channel:
  `ContactDialog` gained an optional `defaultMethod` (re-seeded when a later
  open carries a different channel, still hand-changeable), and the accounts
  list passes the tapped channel through "Open the full contact form →" — so
  a WhatsApp tap that needs the branching results (Not Interested → archive,
  Visit Scheduled → books the visit) no longer silently reverts to "Call".

- **2026-08-09 · v31.1** — Follow-up: the rows-per-page picker really is on
  EVERY paginated table now. v31 shipped it on accounts + sign-ups only while
  the release note claimed all of them — **attendance** (`?size`, whitelisted
  in the page and re-checked in `listAttendanceHistory` via the new
  `PAGE_SIZE_OPTIONS`) and **consideration** (IR-call log + CV pool — both
  reads already took `pageSize`, only the page/view wiring was missing) now
  carry it too.

- **2026-08-09 · v31** — **THE TABLES RELEASE** + smart contacts, branding and
  dashboard fixes. ① **Universal table kit** (`src/components/crm/data-table-kit.tsx`):
  `useTableColumns(tableId, cols)` (order + visibility persisted under
  `elevate-table:<id>`, self-healing against corrupt/stale keys, new columns
  appear at their defined position), `<TableSettings>` (drag + ↑/↓ reorder,
  show/hide, Reset), `<PageSizePicker>`, and a re-export of the v25 sorting
  kit — wired into **7 tables**: accounts, archived, sign-ups, TM directory,
  attendance history, IR-call log and a NEW desktop CV table. Dozens of
  optional columns ship default-hidden. ② **Sign-ups columns**: the Unassigned
  view drops Status + Country, drops Program on **OGV** (all GV), and adds
  **Person status** + **Campaign**; sign-ups gained `?size` (30/50/100/200).
  ③ **Contact-after-click**: tapping WhatsApp/Call/Email on an account or
  sign-up opens the link AND prompts to log the contact with the method
  pre-selected (`QuickContactPrompt` / `SignupContactPrompt`, dismissible).
  ④ **Smart tagging** (`guessLinkTag`/`guessEmailTag` in types.ts, wired into
  ContactsEditor): instagram/linkedin/facebook/whatsapp links and
  ceo@/hr@/manager@/info@ addresses tag themselves, always overridable.
  ⑤ **Account creation is the first History entry** (`accountCreationEntry`
  in data.ts — who/when/what, incl. bulk-import provenance).
  ⑥ **BD deal dialog simplified**: the per-product opens breakdown is behind
  a switch, OFF by default (amount + benefits stay the BD MOS).
  ⑦ **Filter options match the view**: `listVisibleMembers` now applies the
  account WORLD as well as the scope (the LCP/admin's "all" scope used to
  list the whole LC, so OGX/TM people appeared in the raising Responsible
  filter) and takes `{ fn }`, wired from the accounts page. **Regression
  caught in review**: the Blue Man's roster used that same function, so the
  admin's assistant lost every TM/OGX/CXP/F&L member — it now uses
  `listAllMembers`. ⑧ **OGX Dashboard tab** appears for OGX/consideration
  (was raising-only), **profile page no longer clipped**, the **OGV streak
  card moved onto the dashboard for every OGV member** (not just MMs), and
  **KPI cards** moved their explanatory line into the hover tooltip with a
  louder label/value. ⑨ **Real AIESEC-Alexandria branding** on every external
  surface: new `brand/alex-blue.png`+`alex-white.png` (716×408), icons
  192/512 + a true full-bleed maskable 512, app icon + apple-icon — wired
  into the manifest, login, both /book pages and /inactive.
  ⑩ **Touch points**: a PAST start is now allowed (logging something that
  already happened) and sends **nothing**; every touch point gained a
  **"tell everyone invited"** switch (default ON).

- **2026-08-08 · v30** — **TM CORRECTIONS** (the v29 module shipped with the
  wrong booking matrix and no confirmation step — all found by the user).
  ① **One scope per role** (`bookableTouchPointScopes` rewritten as an
  ordered matrix, enforced in `createTouchPoint` with a rule-shaped refusal):
  **Team Leader → team ONLY** (own team, may invite sibling teams),
  **LCVP/Director → function ONLY**, **TM core → LC ONLY** (checked BEFORE
  the LCVP branch so a TM VP is TM first), LCP/admin → everything. The dialog
  shows only what the role may book and prints the rule.
  ② **Sandbox never touches other people** (new `src/server/tm-notify.ts`):
  in a test view the bell goes to the ACTING VIEWER ONLY (written directly,
  🧪-marked, undo-journaled — `notifyMembers` suppresses everything in a
  sandbox, so the tester used to see nothing), and no touch-point or appeal
  mail is sent; `appealAttendance` previously emailed REAL people from a test
  view — now gated. ③ **Working hours need human confirmation**:
  `runWorkingHoursAttendance` still pre-fills the rows but no longer stamps
  `attendance_recorded_at` or resolves prompts — `saveAttendance` is the only
  stamper (its no-op early-exit removed so a pure review confirms; coverage
  re-read from the rows so a locked own-row can't block it), the cron's
  working-hours skip is gone so unconfirmed sessions ride the same
  3-reminder → prompt ladder, and the UI says "AI pre-filled — review &
  confirm". The nag moved to **20:59 UTC = 23:59 Cairo** as asked.
  ④ **TM page filters** — This month / This sprint chips + from→to range
  (`clampDirectoryWindow`, Cairo→UTC half-open bounds, re-clamped server-side
  so a hand-typed URL can't widen it); default stays all-time.
  ⑤ **Every LCVP and Director is out of the TM performance review** (plus the
  LCP, CXP's people and TM's own MMs) — the tab reviews Members,
  Coordinators and Team Leaders. ⑥ **The empty team picker fixed** — an MM of
  a function is now automatically offered that function's "Function leaders"
  team (B2B/BD counted as one). ⑦ **Calendar day view**: clicking any day
  opens that Cairo day's touch points, IR calls and visits plus **"Book a
  touch point on this day"** with the date pre-filled (TouchPointDialog
  gained optional `defaultDate` + controlled open). Playbook v30; the Blue
  Man teaches the corrected matrix and the confirmation step.

- **2026-08-08 · v29.3** — Docs caught up with the TM module (the v29 docs
  agents had crashed, so this was owed): **The Blue Man now teaches TM** —
  touch points (the three kinds × three levels, who books what, start-time
  only, invites, move/cancel with re-notification and the TM VP on CC), the
  unified calendar and who sees what on it, attendance (who records, who may
  edit, never your own row), the **automatic working-hours rule** in plain
  words (≥2 real actions ≥10 min apart, the human edit always wins), appeals
  and the 3-reminder → blocking-prompt ladder. **Playbook** gained the
  move/cancel line it was missing.

- **2026-08-08 · v29.2** — **THE v29 REVIEW PASS** (24-agent adversarial
  review of the shipped TM module → **16 confirmed findings, all fixed**).
  The big one was **CRITICAL**: `createTouchPoint` validated the function but
  NEVER the team, and `touchPointAudience` matched team names globally — so a
  Team Leader could book a "team touch point" naming ANOTHER team, become its
  owner, and write **absent** rows against members they have no authority
  over (reachable from the UI, since the picker was handed every team in the
  function). Fixed on three layers: team names now resolve against
  `invitableTeams(fn)` server-side with a Team Leader PINNED to their own
  team, the picker only offers what the role may pick, and the audience's
  team branch additionally requires the member's functions to intersect
  `function_key` (so legacy rows stop matching). Also fixed: **update/cancel
  were dead code** — nothing called them, so a booked touch point could never
  be moved or cancelled (new `touch-point-manage-dialog.tsx`, per-point
  `canEdit` computed server-side, re-notification on both); the start time
  was built in the BROWSER's timezone (now `date`+`time` Cairo wall-clock via
  `cairoToUtc`); a prompt filed for a later-cancelled touch point could block
  a member forever (`cancelTouchPoint` resolves prompts + `openPendingPrompt`
  self-heals stranded rows); the working-hours engine ignored account work
  (`stampWork` on create/update/import, once per import); manual working-hours
  rows could be written before the session (now gated on
  `workWindowClosed`); `expandTouchPointFns` stops B2B/BD splitting a function
  in half; the manage page compared two ISO formats so the IR's current slot
  was never excluded; the calendar saw only the 50 newest IR calls (now
  range-queried) and used UTC day bounds for a Cairo grid; the attendance
  history filtered on UTC midnights; a failed reminder email skipped the
  counter so it re-sent daily; `listPartnerLcDetails` counted unpaged.
  **Migration 0032 was applied to prod with no file in the repo — the file
  now exists** (idempotent, a no-op against prod).

- **2026-08-08 · v29** — **THE TM MODULE** + a 20-item fix batch.
  ① **Touch points** (migration **0031 applied**: `touch_points`,
  `touch_point_attendance`, `attendance_appeals`, `work_activity`,
  `pending_prompts`): Team Leaders book team meetings / working hours /
  outings, VPs & Directors the function ones, TM core the LC ones (LCP
  everything — `bookableTouchPointScopes` in rbac). START time only, optional
  note, invites (sibling teams for a team point, other functions for a
  function point; TM/F&L/CXP never invited and never run working hours).
  Create / move / cancel-with-reason each **email + bell the whole audience
  with the TM VP on CC** (`src/server/touch-points.ts`, audience +
  visibility in `touch-points-read.ts`, templates in
  `email/touchpoint-templates.ts`). ② **ONE calendar for everyone**
  (`/calendar` rewritten): touch points (purple) + IR calls (teal) + visits
  (per-member colours) in a single month, each viewer seeing what they belong
  to; TM core sees the LC, a member sees other teams' points inside their own
  function; nav opened to every module member. ③ **ATTENDANCE**
  (`/attendance`, everyone): manual attended/absent/late + excuse, scoped
  reads (self → team → function → LC), appeals (email to the recorder with TM
  on CC), and **automatic working-hours attendance** — ≥2 real work actions
  ≥10 min apart inside `starts_at −15min → +4h`, fed by `stampWork` in 10
  existing actions, never overwriting a human edit. ④ **The general
  must-do ladder**: `attendance-reminders` cron (daily 21:00 UTC, scheduled
  in pg_cron) nags the responsible once per Cairo day, and after **3
  reminders** files a `pending_prompts` row that blocks the app with a prompt
  on next open (generic kind/ref_id/title/link — reusable). ⑤ **TM
  directory** honours who is actually reviewed there (LCP, F&L VP/Director,
  CXP MMs+leaders and TM's own MMs dropped), its **OGX row now mirrors the
  real funnel** (Sign-ups→Contacted→Interested→Applied→Accepted→Approved★)
  and the role filter gained **MMs (TLs & Coordinators)**. ⑥ **Booking v3
  fixes**: booker **name + role are mandatory** (`ir_calls.booker_role`,
  migration 0032), availability in **15-minute steps**, **5-minute buffer**
  option, a member's reschedule request needs a **reason** that reaches the
  IR verbatim, the IR's manage page no longer offers the slot they already
  have (+ server guard) and their cancel needs **no** reason, the "When are
  your B2C campaigns?" question is gone, CVs require an LC, LC country is the
  branded autocomplete, **MMs can rename LCs**, and the LC registry now shows
  what the calls collected (country, call/CV counts, the IR people with role
  + email). ⑦ **IR-facing emails never mention the CRM** — new
  `externalEmailLayout` (no "Open the CRM", no internal wording) on every
  booker-facing template. ⑧ **Sign-ups name matching fixed**: a bare first
  name ("Ahmed") no longer resolves to whoever happens to prefix-match — it
  stays unmatched until a leader assigns it; the **100 rows wrongly assigned
  to the admin were released** in prod. ⑨ Onboarding **Skip removed** (the
  tour is the manual), **"LC Feedback" → "Feedback"**, and the Playbook tells
  members to put their @aiesec.net mail on their phone with notifications on.
  ⑩ Prod URL env switched to **elevate-alex.vercel.app** *(reverted in v32.1)*.
  ⑪ **Consideration splits per function** on the dashboard (`CONS_IGV` /
  `CONS_IGT`, `considerationFunctions` in rbac; a call is attributed via its
  OWNER's functions — ir_calls has no product column; the CV cards only exist
  on the IGT lane). ⑫ **/admin Health refreshed** to the real system (all 8
  crons with cadence-derived staleness, today's table counts, both storage
  buckets, NEXT_PUBLIC_APP_URL). ⑬ **Feedback on a touch point you attended**
  (`listAttendedTouchPoints` + an optional `touchPointId` on
  `submitLcFeedback` — server re-verifies attendance; positive shouts out the
  owner, negative goes to the private inbox; no migration). ⑭ **Mobile pass**:
  real overflow fixes across consideration (scheduled-call rows, action
  groups, CV cards/search), attendance (owed rows, appeals free text),
  calendar agenda notes, sign-up comments/OOP reasons, the members phone card
  and the consideration KPI cards — `min-w-0 flex-1` where truncate was inert,
  `break-words` on free text, `flex-wrap` on button groups, `max-h-[90dvh]`
  on the uncapped dialogs.

- **2026-08-08 · v28** — **ELEVATE + BOOKING v2 + OGX DASHBOARDS.**
  ① **Renamed Sodio → Elevate** *(REVERTED in v32.1 — the system is Sodio)*
  (~120 user-visible strings: sidebar, titles,
  manifest, ALL emails, Playbook, Blue Man, login, tour; internal `sodio-*`
  storage keys/cookies/events + the "Sodio — LC Visits" Google calendar name
  deliberately KEPT so no user state breaks). New primary URL
  **elevate-alex.vercel.app** (elevate.vercel.app was taken; sodio.vercel.app
  + the long domain still work). ② **Booking v2** (migration **0029
  applied**): the IR's **email is required** → invited as an attendee to a
  real **Google Meet** on the owner's calendar (`conferenceData` +
  `sendUpdates: all`, `guests_can_invite` honored); confirmation email with a
  **manage link** (`/book/manage/<token>`, public, unique manage_token) where
  the IR **reschedules** (live slots, 23505 = just-taken) or **cancels with a
  required reason**; owner-side `cancelIrCall(id, reason)` emails the IR +
  `requestIrReschedule` sends them the manage link; settings gained Calendar
  parity — slots 15m–2h, **buffer**, **min notice**, **max advance**,
  **start/end dates**, weekly OR **one-date** availability rows; partner-LC
  registry dialog (⚙): crew adds, VP+ renames (cascades to denormalized
  snapshots) / deletes (refused while referenced). Booking pages: favicon +
  "Created by 2.0" credit + "Powered by Elevate"; the double "Cairo time"
  fixed. ③ **OGX DASHBOARDS**: OGT/OGV lanes on /dashboard (`ogxDashboard`
  in data.ts — status-ladder funnel Sign-ups→Contacted→Interested→Applied→
  Accepted→**Approved**, capped conversions, Members+Coordinators leaderboard
  by Approvals with FLIP re-sort, team drill, mm-plan vs pipeline, date/team/
  member filters; `SPECIAL_LANES` guard keeps getDashboard off pseudo-lanes);
  /signups gained a Dashboard button. ④ **Potential flow**:
  `setSignupPotential` — the sign-up's OWNER (+TL/VP/LCP) moves it
  Applied→Accepted→Approved (Parents Approval stays VP-only); these statuses
  are **system-only** — the sheet's Status cell now carries ONLY "Out of
  Process"/empty; 🎯 Potential filter (`?potential=`, replaces ?status).
  ⑤ **Onboarding fixed for every module**: tour.tsx rewritten module-aware
  (no more "Your ICX workspace" for everyone), `welcomeEmail` branches per
  module, /welcome blurbs gated. ⑥ **Blank home fixed**: "/" was blocked by
  GateClient on CLIENT navigations (the logo click) — "/" is ALWAYS_ALLOWED
  (exact match) and the logo now links straight to the viewer's `homeHref`;
  /dashboard added to OGX extraRoutes. ⑦ **19-agent adversarial review → 14
  confirmed findings fixed pre-ship**, the big ones: `listIrCalls` was
  shipping every call's **manage_token to every crew member's browser**
  (scrubbed to a `has_manage_link` boolean; the raw token lives server-side
  only via `IrCallServerRow`); the public reschedule/cancel updates now
  `.select("id")` and fail on 0 rows (a mid-flight status flip no longer
  moves/deletes the REAL calendar event); the booking throttle became an
  atomic **`bump_rate_bucket` RPC** (migration **0030 applied** — parallel
  bursts bypassed the read-then-upsert counter); overlapping availability
  windows are rejected (they minted racing slot grids); `ogxDashboard`
  excludes OOP rows and fails CLOSED; lane-chip switches across ICX↔OGX drop
  stale team/member params in ONE navigation; sandbox guards on
  cancelIrCall/requestIrReschedule; deletePartnerLc ignores cancelled spam
  bookings; one-date rows validate properly + default to the CAIRO date; the
  tour teaches the v28 permission model and matches rbac's sub_functions;
  the drafts script wordmark says ELEVATE.

- **2026-08-01 · v27** — BOOKING, STREAKS & a 16-item polish batch.
  ① **IR-call BOOKING** (migration **0027 applied**: `ir_booking_settings`
  member-keyed slug/slot/availability-jsonb(Cairo)/active; `ir_calls` gains
  status(scheduled/completed/cancelled)/demand/b2c_campaigns/booker_name/
  booked_at/calendar_event_id): every consideration member sets weekly
  availability + slot length on the **"My booking link" card** and shares
  `sodio.vercel.app/book/<slug>` — a **PUBLIC Sodio-branded page**
  (`/book/[slug]`, proxy-exempt, force-dynamic) where an IR abroad picks a
  free Cairo-time slot (14-day strip; overlaps + past excluded) + their LC
  (resolved/created in `partner_lcs`) → `bookIrCall` (hardened public
  action: input sanitation, 10-future-calls rate limit, fresh overlap
  re-check) inserts the scheduled call, best-effort creates the event on the
  OWNER's Google Calendar (`createIrCallEvent`), bell + `irCallBookedEmail`.
  Scheduled calls list soonest-first with an **in-call notes dialog** —
  demand (industry chips + Other), **"When are your B2C campaigns?"**, free
  notes, screenshot → `completeIrCall`; `cancelIrCall` removes the calendar
  event. Manual past-call recording collapses behind a toggle (with the new
  fields). ② **CV pool is IGT-only** (`canSeeCvPool` — IGV-only VPs keep IR
  calls, lose CVs; upload/list actions re-gated). ③ **OGV STREAKS**
  (`signup_activity(member_id, day)` + `members.streak_reminded_on`):
  claim/contact/comment stamp the Cairo day (`stampSignupActivity`,
  sandbox-skipped); `streakStats` → **StreakCard** on /signups (🔥 current,
  best, saved-today state, LC top-3); **streak-nags cron** (daily 17:00 UTC
  = 19:00 Cairo, scheduled in pg_cron) emails a 3-tier escalating funny nag
  (`streakNagEmail`) to OGV MMs with a ≥3-day streak and no save today —
  once per day (`streak_reminded_on`). ④ **The Blue Man v3**: chat HISTORY
  (localStorage `sodio-blueman-chats:<email>`, 8 most recent, validated +
  self-healing), history list + 🗑 + **New chat**, and **role/module-based
  suggested-question chips** on fresh chats. ⑤ **FileDrop everywhere**
  (`src/components/crm/file-drop.tsx`, single+multi): visible drag-and-drop
  zones on Deal contracts, archived import, market-research import, CV
  upload, IR screenshot — and the avatar tile accepts drops. ⑥ **Sign-ups
  phone filter is two-way** (`?phone=has|missing` Select replacing the
  nophone chip). ⑦ **"Soon" is unreachable for module-owners**: GateClient
  gained `hasModule` — a non-allowed route bounces to "/" (their workspace)
  instead of rendering ComingSoon (copy refreshed for the truly
  module-less). ⑧ **Dashboard "Consideration" lane** (`?fn=CONS`,
  `considerationStats` + ConsiderationPanel): IR calls (total/month/
  upcoming), partner LCs reached, CV pool (+by industry), consideration
  plan chips — for `hasConsiderationAccess` viewers. ⑨ **Global smooth
  scrolling** (`scroll-behavior: smooth`, reduced-motion-safe) — playbook
  index jumps glide. ⑩ Polish: consideration tab switches show the
  walking-man/nav-pending shimmer; dashboard lost the redundant
  "{fn} function" subtitle; planning lost the dead **Re-import** button;
  profile "Wrong info?" now opens **WhatsApp to the admin**
  (wa.me/201099019374); both URLs (sodio.vercel.app + the long one) are
  project domains tracking every deploy. ⑪ **26-agent adversarial review →
  20 confirmed findings fixed pre-ship**, the big ones: the public booking
  endpoint got REAL race protection (**0028 applied**: unique partial index
  `ir_calls_member_slot_key (member_id, called_at) where scheduled` — 23505
  = "slot just taken"; + `duration_minutes` so cadence changes never
  mis-compute overlaps), a 3-bookings/hour per-IP throttle
  (app_settings `bookrl:*`), country validated against the real list and
  anonymous input can no longer mutate existing partner_lcs rows, sandbox
  test views can't book; the IGT-only CV gate now covers EVERY path
  (searchCvs, the Blue Man tool declaration+handler, rerun/update/get/delete
  actions); streak stamps run in Next's `after()` (Vercel could drop the
  floating promise), streak windows widened to 400 days, `streakStats`
  fails CLOSED (no lying 0-day card), the nag cron moved to **16:00 UTC**
  (19:00 Cairo in DST); `cairoToUtc` became two-pass (DST-evening slots were
  an hour off) and the 14-day strip iterates CALENDAR days; `recordIrCall`
  rejects future timestamps server-side; `considerationStats` pages past the
  1000-row cap; the CONS lane header reads "Consideration Dashboard";
  phone-only members got a stable Blue-Man chat key. Playbook v27; the Blue
  Man teaches all of it.

- **2026-07-31 · v26** — THE CONSIDERATION RELEASE + a 16-item polish batch.
  ① **Consideration module** (`/consideration`, sidebar "Consideration",
  `hasConsiderationAccess` = Consideration in functions/subs + IGV/IGT
  VPs/Directors + LCP/admin; migration **0026 applied**: `partner_lcs`
  (unique lower(name)) · `ir_calls` · `cvs` + private storage bucket `cvs`).
  **IR calls tab**: record-call form — partner LC combobox with inline
  "+ Add new LC", datetime defaulting to now, notes, screenshot ≤3MB →
  uploaded to the Drive subfolder **"CRM — IR Calls"** (created/cached at
  app_settings `drive:ir-calls`; upload best-effort — a Drive failure keeps
  the call recorded) — shared crew-wide log, paged 50. **CVs tab**: any-format
  upload via the contracts-style signed-URL flow → `confirmCvUpload` runs
  **Gemini extraction** (`src/lib/cv-extract.ts`: PDF/images inline, text
  formats as text, others `unsupported` for manual fill) extracting
  name/phone/email/industry/skills/summary/full text; editable fields
  (uploader or VP+), 10-min signed file links, re-run button, delete
  (sandbox-refused); server-side search. **The Blue Man reads the pool**:
  `searchCvs` Gemini tool (declared only for consideration viewers) — "CVs
  with C# in skills" works. ② **Sign-ups UX**: Claim → **Contact** (auto-opens
  the detail dialog after claiming), **bulk select + Assign to… / Unassign**
  (`bulkReassignSignups` loops `reassignSignup` so scope rules re-run per
  row), **📵 Missing phone** filter (`?nophone=1`), program badges in the
  official **GTa/GTe/GV brand colors**, the country field became the branded
  `CountryInput` autocomplete (datalist gone), and **`MmPlanCard`** — an OGX
  MM with a current-month `mm_plans` row sees Applicants/Accepted/Approvals
  **plan vs live pipeline** (Approved = MOS, progress bar; `ogxPlanCard` in
  data.ts). ③ **Home routing**: "/" lands on the viewer's FIRST live module
  (accounts → sign-ups → consideration → members → membership → planning) —
  nobody with a built module ever meets "coming soon" at home.
  ④ **Walking man visible in light mode**: the brand APNG is WHITE — a
  `.walkman-tint` CSS filter paints it AIESEC blue on light backgrounds
  (dark keeps white). ⑤ **Expectation mail**: subject defaults to
  **"Home Entity Expectation Setting Mail"**; the review step (subject,
  edited body, recipients, variant) is cached in sessionStorage
  (`sodio-expectation-preview`) so tab switches never lose the built email —
  cleared on send/draft. ⑥ **Team field = list-or-create**: the member
  dialog's team picker lost its free-text fallback — pick from the registry
  or "➕ New team…" (creates a type-Team registry row inline, Member/TL roles).
  ⑦ **Sidebar "Arrange tabs"** (bottom of the nav): ↑/↓ reorder per member,
  persisted in localStorage (`sodio-nav-order`), Reset available.
  ⑧ **Ask-the-Blue-Man callouts** (`AskBlueMan` + window event
  `sodio:ask-blue-man` opening the chat pre-filled) on the accounts header
  ("accounts matching any criteria") and dashboard. ⑨ **sodio.vercel.app**
  aliased to production (permanent — tracks every deploy).
  ⑩ **30-agent adversarial review → 22 confirmed findings fixed pre-ship**,
  the big ones: Next 16's DEFAULT 1 MB server-action body cap would have
  rejected every IR screenshot (next.config now sets
  `serverActions.bodySizeLimit: "4.5mb"`; server guard 3.2 MB decoded);
  CV uploads/extraction are sandbox-refused (storage + Gemini quota can't be
  undone); `runCvExtraction` surfaces lost DB writes instead of reporting
  "done"; bulk sign-up reassign batches the sheet write-back (ONE tab
  read + ONE batchUpdate per sheet via `writeSignupsBackBatch` instead of
  ~3 calls per row) and a no-op unassign no longer flips `sodio_touched`;
  `ogxPlanCard` uses the Cairo month key (`monthOf().start`); CountryInput
  floats the exact-typed country above substring matches and Escape closes
  the suggestion list, not the whole dialog; CV "Open file" opens the window
  BEFORE the await (Safari popup rule); wa.me links only for
  `normalizePhone`-valid extracted numbers; screenshot content checked by
  magic bytes; Drive folder cache self-heals; the edit dialog rehydrates on
  reopen; sidebar chevrons un-nested from the nav links + nav-order key
  self-heals; the expectation-preview cache is per-viewer
  (`sodio-expectation-preview:<id>`); Tour counts Consideration as a live
  module. Playbook v26 (+ Consideration section); the Blue Man teaches all
  of it.

- **2026-07-31 · v25** — **THE OGX RELEASE.**
  ① **Sign-ups module** (`/signups`, sidebar "Sign-ups", `hasOgxAccess` =
  OGT/OGV in functions or subs + LCP/admin; OGX-only members' home "/" now
  lands there): migration **0025 applied** (`signups` + `signup_comments`,
  unique `(source, ep_id)`). **Two-way sheet sync** (`src/lib/google/
  signups.ts`): imports the 4 tracker tabs — OGT "New SUs"/"Old SUs", OGV
  [Old]"Old"/[New]"Main" (~7.9k rows) — every 15 min (pg_cron `signups-import`
  scheduled; batched inserts + row-diffing keep runs cheap) AND writes every
  in-app edit straight back to the row's workflow cells (`writeSignupBack`,
  row located by EP ID at write time, columns resolved BY HEADER NAME with
  aliases — trailing spaces/"Intersted"/double-"Status" on OGV Main all
  handled). Ownership rule: intake data is sheet-authoritative; once a row is
  touched in Sodio (`sodio_touched`) the workflow fields belong to Sodio.
  Legacy sheet Comment/VP Comment cells become the log's first entries;
  Sodio comments are an **organized two-class log** (member/MM → Comment
  cell, VP → VP Comment cell, each entry stamped author+time); Time Stamp /
  Assigned date / Contacted date cells stamp automatically. **Views**:
  Unassigned (the MAIN pool — anyone in the function contacts one and
  **Claims** it, race-guarded), Mine, My team (TL), All (VP+), Archived
  (OOP). Member/MM edits: Contacted + Interested (Yes/No) + comments; TL
  re-assigns within the team; **VP-only**: VP comments, Country (autocomplete
  from `src/lib/countries.ts`), Sub Product (OGT: GTa/GTe), **Status**
  (`SIGNUP_STATUSES` = Parents Approval · Applied · Accepted · **Approved** =
  the OGX MOS) and Out of Process (+reason, revivable — hidden like the
  archive). Members directory: OGX MOS now shows **real Approvals**
  (`kpis.signupApprovals`) next to the plan number. RBAC:
  `ogxFunctions`/`canWorkSignup`/`canViewSignup`/`canEditSignupVpFields` in
  rbac.ts; reads/mutations re-check server-side; sheet write-back is
  sandbox-suppressed.
  ② **Expectation mail v2**: OGT **and OGV** VPs/Directors (+LCP/admin;
  variant toggle for dual-access) — OGT keeps "Salary (If any)", OGV gets
  required "TN Fee and what it covers"; recipients = **EP email + IR email**
  (both required) with **customer.support@aiesec.net.eg always in CC**; new
  **review step**: the final email renders in an editable (contentEditable)
  preview with editable subject → **"Send now"** sends from the VP's own
  Gmail (`sendMemberEmail` via gmail users.messages.send) or "Save as draft
  instead"; the email ends with the VP's **signature** (name, position —
  LCVP/Director — Outgoing Global Talent/Volunteer, phone, email). Actions:
  `previewOgtExpectationMail` / `sendOgtExpectationMail` /
  `createOgtExpectationDraft` (all take the reviewed subject/html).
  ③ **Universal table sorting**: new `src/components/crm/sort-header.tsx`
  (`useTableSort` + `SortHeader`, null-last, Arabic-safe localeCompare) wired
  into the membership table, the TM members directory (incl. a per-MOS metric
  sort) and the Archived list (whose selection now survives re-sorting);
  the sign-ups table sorts server-side like accounts.
  ④ **Planning privacy**: `/planning` shows a VP/Director only THEIR
  function's MM/TL plans (`listMmPlans`/`listTlPlans` gained a `memberFns`
  filter); on dashboards the VP `lanePlan` card is now **leaders-only** — a
  TL keeps the team card and a planning **Coordinator** now gets their OWN
  plan vs their own numbers (`planOwnerId` self-scope in `getDashboard`).
  ⑤ WhatsApp opener is **emoji-free** (the 👋 rendered as � on several
  devices — removed for good). Playbook v25; the Blue Man teaches all of it.

- **2026-07-30 · v24.2** — Teams registry made REAL + emoji fix.
  ① Migration **0024 applied**: teams type `MM` renamed to its real name
  **`Function leaders`** (check constraint now the 5 sheet types; "MM" kept
  as an import alias). All consumers updated (`teamsForViewer`, member-dialog
  picker, importTeams). ② **Full team CRUD**: the Membership Teams card now
  manages EVERY type — add with a Type+Function+Name form, ✏️ edit and 🗑
  delete each chip, grouped by type; `saveTeamEntry`/`deleteTeamEntry`
  enforce the structure (EB/LB single, Function & Function leaders one per
  function, Team many) and `writeTeamsTab` rewrites the whole sheet tab from
  the DB after every change (the tab is now a mirror of the in-app registry;
  importTeams also imports `Team` rows and no longer cleanup-deletes
  siblings of the many-per-function Team type). ③ **WhatsApp 👋 fixed for
  real**: the emoji is emitted via the ASCII escape `\u{1F44B}` so no
  re-encoding step can mangle it into �.

- **2026-07-30 · v24.1** — Post-launch polish from Ahmed's test pass.
  ① **Sortable headers advertise themselves**: hover shows a ghost ↕ arrow
  dropping in + a muted pill background + press-scale (`SortHead`).
  ② **Podio default is 14 days for ALL functions** — `podioDefaultDays`
  returns 14 across the board (`B2C_DEFAULT_UPDATE_DAYS` deleted; existing
  B2C rows at the old 10-day default were backfilled to 14 in prod).
  ③ **Bulk-assign heads-up skips self-assignments** (no email/bell when the
  leader assigns accounts to themself). ④ **WhatsApp opener shortened** per
  request: "Hello! 👋 This is {name} from AIESEC, the world's largest
  youth-led organization. I'm reaching out about a collaboration with
  {account}." ⑤ **"OGT mail" renamed "Expectation mail"** (sidebar, tab
  title, page hero, Playbook, Blue Man — route stays `/ogt-mail`).
  ⑥ **Teams structure corrected to the sheet's 5 types** — EB & LB are
  SINGLE teams, `Function`, `Function leaders` (stored as type `MM`) and
  `Team` are many (per function): Teams-tab headers/seed rewritten to match
  the real tab, the Membership Teams card labels MM rows "Function leaders",
  and the stale seed-era `Function` duplicate rows (Suits / فرقة ناجي
  عطالله) were deleted from the prod `teams` table.

- **2026-07-30 · v24** — THE 15-ITEM BATCH. ① **Click-to-sort accounts list**
  (`SortHead` headers; `AccountFilters.sort/dir`, whitelist in
  `buildAccountsQuery`, `?sort/&dir` params, page reset on re-sort). ② **B2C-only
  viewers** see a **Type** column instead of Product (`viewer.b2cOnly`, like
  igvOnly). ③ OOP reasons + **"Closed company" / "No contact info"**.
  ④ **Archive bulk actions**: select archived account rows → **Back to active**
  (`bulkReviveAccounts`, TL+ via per-row `canReassignAccount`) or **Delete**
  (`bulkDeleteArchived`, VP/Director/LCP + `canEditAccount` per row — deletes
  children then the account, frees the name) — both behind confirm dialogs, plus
  a per-row ↩️ revive with confirm. ⑤ **Podio continuous updates for ALL raising
  functions** (migration **0021 applied**: `podio_update_enabled` default false
  backfilled true for B2C, `podio_update_second_notified_at`, members.email
  nullable + partial unique index): the card (renamed `PodioUpdateCard`) shows
  on IGV/IGT/BD/B2C with an ON/OFF switch (`setPodioUpdateEnabled` — enabling
  restarts the countdown); **new IGV/B2C/BD accounts start ON, IGT/B2B OFF**
  (`createAccount`); default cadence **14 days** (`PODIO_UPDATE_DEFAULT_DAYS`;
  since v24.1 B2C too); the cron
  (`/api/cron/podio-updates`) now scans `podio_update_enabled=true` across all
  functions, mails the responsible + the FUNCTION's VP/Directors (BD↔B2B
  aliased), and sends a **firmer second reminder one week after the first**
  (once per cycle; `markPodioUpdated` clears both stamps).
  ⑥ **Phone-only sign-in** (`members.email` NULLABLE, `Member.email:
  string|null` — every consumer null-guarded): members without an AIESEC email
  sign in with their **phone in BOTH fields** until a password is set
  (`okPhoneAsPassword` in authorize); their session key is a synthetic
  `phone+<digits>@sodio.local` (`phoneSessionKey`/`parsePhoneSessionKey` in
  types.ts, resolved in `getViewerByEmail`); once the email lands (sheet import
  ADOPTS the phone-keyed row — no duplicate member) the phone door closes and
  login says "sign in with Google once"; sheet import/write-back key email-less
  rows by phone tail (parseSheetRow accepts them, deactivation loop spares
  them). ⑦ **/inactive screen** (public route in the proxy matcher):
  deactivated members are routed there from login (probe in
  `loginWithPassword`), from Google sign-in (`signIn` callback returns the
  URL), and mid-session (`getRealViewer` → `sessionKeyIsInactiveMember`).
  ⑧ **Membership**: email OPTIONAL in the editor (locked only once set —
  adding an email to a phone-only member is the upgrade path) + schema
  requires email OR phone; **manager rules** — a plain Member can never be a
  manager (dialog options, `upsertMember` resolution AND import
  `relinkStakeholders` via `MANAGER_ROLES` all enforce it); **Teams registry**
  (migration **0022 applied**: teams.type gains 'Team', unique key now
  (type,function_key,name)): EB registers TL team names on a Membership
  "Teams" card (`addTeamName`/`deleteTeamName`, mirrored to the sheet's Teams
  tab as informational "Team" rows via `writeTeamRegistryRows` — import still
  skips them), and the member dialog's Team field became a **role-aware
  picker** (Member → registered TL teams of their function · TL/Coordinator/
  Director → the fn's MM team · LCP/LCVP → EB · "Other…" custom fallback).
  ⑨ **"Next week"** (+7d) buttons on the Next-step date (account card +
  contact dialog) and a **"This sprint" chip** (1–15 / 16–EOM) on the
  dashboard. ⑩ **Avatar creator** ("🎨 Create your own": style/seed/dice/flip/
  gradient presets via `buildAvatarUrl` in avatars.ts) + **The Blue Man** as a
  pickable avatar (`/brand/walk.png` whitelisted in `updateAvatar`).
  ⑪ **Bulk-assign heads-up**: the reassign popup's "Email them about it"
  toggle → bell + `accountsAssignedEmail` (account list + button) to the new
  responsible (`bulkReassignAccounts(ids, target, notify)`).
  ⑫ **WhatsApp ready-to-send opener**: accounts-list WhatsApp quick actions
  carry `?text=` (`waIntroText` — member name + AIESEC intro + meeting ask).
  ⑬ **OGT mail tab** (`/ogt-mail`, sidebar + GateClient extra; OGT
  VPs/Directors + LCP/admin): the "Home Entity Expectation Setting Mail" form
  (numeric EP/OPP IDs, calendar slot dates rendered "Aug 5, 2026", flexible
  per-day working-hours rows, logistics with conditional details, NO TN-fee
  line) → `createOgtExpectationDraft` drops a ready-to-review DRAFT in the
  VP's own Gmail (`ogtExpectationEmail` template). ⑭ **Launch drafts script
  rewritten** for v24 (`scripts/draft-announcements.mjs`): B2C launch segments
  (lead + member), planning-not-goals copy everywhere, split-opens/unassigned
  bullets, **OGX members get NO draft at all**. ⑮ **32-agent adversarial
  review → 26 confirmed findings fixed pre-ship**, the big ones: 0021's
  partial unique index silently broke EVERY members upsert (`ON CONFLICT
  (email)` can't use a partial index — the 30-min import cron was erroring;
  **0022 + 0023 applied to prod**: plain UNIQUE constraint restored, unique
  phone-digits index for email-less members, phone normalization backfill);
  phone-keyed sessions/import matched by 9-digit TAIL (identity collision —
  now exact full-digit equality everywhere: `memberByPhoneDigits` in data.ts,
  findMemberByIdentifier, probeMember, findPhoneKeyed) with phone-duplicate
  guards in `upsertMember`; sheet import stores `normalizePhone`d values; the
  email-upgrade write-back fills the member's OLD phone row (no duplicate row
  → no duplicate member on re-import); mid-session email-landing no longer
  logout-loops (phone sessions resolve email-ful members too);
  `bulkReviveAccounts` delegates to `reviveAccount` (calendar reminder +
  RBAC); `bulkDeleteArchived` is sandbox-refused (undo can't restore a
  cascade delete), aborts per-account on child-delete errors, and the client
  chunks select-all into 50s; archive selection resets on filter/page change;
  the podio cron pages past 1000 rows and fails loudly on stamp errors;
  cadence edits restart the reminder cycle; bulk-assign email skips the LCP
  and the toast reports when no email was on file; Team Leaders' team picker
  offers their LED team (their `team_name` labels every dashboard drill), not
  the MM team. Playbook v24; the Blue Man teaches all of it.

- **2026-07-27 · v23.2** — ① **Name worlds**: the archive block is per world
  (0020 splits the unique index) — B2C is tested against ALL active accounts
  + its OWN archive only; the raising archive/blacklist never blocks B2C and
  vice versa (cross-world archived match = amber heads-up in the add dialog,
  not a block); slug prefers the active row, archived rows link by UUID; all
  "unique across all ICX" copy now says every function. ② **Dashboard
  drill-down "By team" → "By MM"**: rows = every TL AND Coordinator with
  their whole portfolio (label "Nick — Team"). ③ v23.1: B2C default cadence
  = 10 days; Perrihan (B2C Director) auto-covered by the reminder cron.

- **2026-07-27 · v23** — **THE B2C MODULE.** B2C is a full account function:
  accounts like raising but with a single **Type** (Courses / Events / Student
  activities) instead of product/account-type/industry; **Podio continuous
  updates** (per-account cadence, default 10 days, countdown card, daily cron
  → bell + email to the MM + B2C VP/Director once per cycle, "Updated on
  Podio" resets); **detail-free deals** behind the contract Google Form link;
  **no proposal emails**; an isolated **deals-centric B2C dashboard lane**
  (no opens anywhere, leaderboard by Deals); B2C MOS in the members directory
  = deals. Migration **0019 applied via MCP** (enum value, checks, cadence
  columns, view); pg_cron job `podio-updates` scheduled (daily 05:00 UTC).
  Salma's & Ali's B2C accounts get the workspace immediately (their tour and
  ComingSoon copy updated). Playbook v23; the Blue Man teaches all of it.

- **2026-07-27 · v22.2** — Fix-and-polish wave from LC feedback. ① **Archive
  is LC-WIDE**: `canViewArchive()` = everyone (management stays TL+ via
  `canManageArchive`), the Archived tab query skips accountScope, and
  `canViewAccount` returns true for ANY archived account (read-only —
  `canEditAccount` is no longer an alias and stays scoped). ② **Live name
  check** (`checkAccountNameLive` + debounced check in AddAccountDialog):
  duplicate/archived/blacklist verdict with full context appears AS the name
  is typed — before the rest of the form is filled; submit blocked. ③ **Every
  MM sees & edits their plan on the PROFILE**: new `mmPlanForProfile` +
  MmPlanForm profile mode (consideration/OGX funnel card) next to the raising
  opens card; `isPlanningTl` no longer excludes `isPlanningMm` — an MM with
  subs "Raising, Consideration" (e.g. Boda) files BOTH plans. ④ **Accounts
  list**: IGV-only viewers see a **Project** column instead of the pointless
  IGV badge; **sub-product filter** (`?sub`, ilike) for IGT-access viewers;
  **page-size picker** (?size 30/50/100/200). ⑤ **Planning conversions
  UNcapped** (applicants > opens is normal); the dashboard funnel keeps its
  100% cap. ⑥ **System-feedback inbox** left the sidebar — it's the "Open the
  inbox" button on /feedback (inbox owners only). ⑦ **The Blue Man v2**:
  Gemini function-calling with RBAC-scoped `searchAccounts` /
  `getAccountDetail` (+ `webInfo` bridge, since google_search can't mix with
  custom tools), **?open= action deep links** (contact/visit/deal/proposal
  auto-open on the account page, edit-gated), and **link grounding** (internal
  links are stripped unless the slug came from the context or a tool result;
  `buildAssistantContext` now returns `{text, slugs}`). ⑧ **Test data
  purged**: members "Test TL"/"Test member" deleted (notifications/audit/
  goal-rows cleaned; they were never in the Membership sheet) + the 4 old
  manually-made test accounts (incl. Hana's 3 "missing" ones — they were
  archived under her name) with their children.

- **2026-07-26 · v22.1** — **Every raising MM plans**: `isPlanningTl` now
  matches **Coordinators too** (was TLs only) — raising Coordinators of
  IGV/IGT/B2B&BD file their own opens plan on first sign-in and from the
  profile card (their actuals = their own allocation-attributed opens);
  /planning card retitled "Raising MM plans". Role-aware copy on
  /welcome/plan-tl + the profile card. Planning-sheet re-import attempted —
  still blocked: the service account has ZERO access ("File not found"), the
  share to `crm-sheets@gen-lang-client-0055329754.iam.gserviceaccount.com`
  never landed (likely an aiesec.net external-sharing restriction). v21's
  verified 1512 plan_cells stay live. Test period-report email sent to the IM
  mailbox via `?test=1`.

- **2026-07-26 · v22** — **GOALS = PLANNING + THE BIG IMPORT.** ① **Goal
  setting removed everywhere** ("no one sets goals from Sodio"): GoalDialog /
  Set-goal buttons / `setPerformanceGoal` / the goal-reminders cron (route
  deleted, pg_cron job unscheduled) / `newGoalEmail` + `goalPeriodEndedEmail`
  are gone. The **lane goal is the PlanCard** (VPs' plan_cells opens vs
  actual, sprint/month toggle; B2B lane has none — the planning sheet skips
  it) and the **team goal is the TL's plan**. ② **TL planning** (migration
  0018 `tl_plans`): raising TLs file opens-per-month of the peak on first
  sign-in (`/welcome/plan-tl`) and edit from the profile **"My plan" card**
  (with per-month actuals); dashboard team card + /planning "Team Leader
  plans" card track plan vs raised. ③ **Deal opens splits**
  (`deal_allocations` + backfill): the Record-deal popup can split a deal's
  opens across function members (sums must match, server-validated); ALL
  per-member opens numbers (leaderboards, directory, reports, my-numbers,
  TL-plan actuals) are allocation-attributed with a pre-0018 fallback;
  deal history shows the split. ④ **Funnel conversions capped at 100%**
  (dashboard strip/KPI/drills + planning conversions) and **"My numbers"
  hidden for VP/Director/LCP** (they see the whole function anyway).
  ⑤ **THE IMPORT**: the LC's two old Google Sheets were parsed
  (18 tabs — IGV: Farwada + 8 project tabs + Bulking + 2 scrapped + Black
  Listed + OUR PARTNERS + potential partners; IGT: Market Research +
  scrapped; the IGT "Main" tab is EP data, excluded) → **39 blacklist rows**
  (blacklisted/partners/potential partners, with their info in comments) +
  **3,782 accounts**: **1,637 archived** (contacted even once → OOP with the
  old contact history, stakeholders, package plans and "was with" in an
  Admin comment) and **2,145 active UNASSIGNED** market-research accounts
  (IGV rows carry their project tab; IGT mostly product-unknown — the badge
  renders plain "IGT"). Dedupe ran across tabs (blacklist > archived >
  active) and against the DB; phones normalized to +20 canonical (invalid
  ones preserved in the comment). ⑥ **Unassigned + scale support**:
  `accounts.responsible_id` nullable + LEFT-JOIN pipeline view (0018);
  "— Unassigned" filter; null-safe renders + guards (visit scheduling, podio
  ask, deal without split); **accounts list paginated** (100/page + count);
  every full-set reader pages past Supabase's 1000-row cap (`fetchAll`,
  mirror `pageAll`, directory, reports); the Blue Man reads the freshest 300
  accounts only. Playbook v22; assistant knows all of it. Migration **0018
  applied via MCP**; import ran via service-role script (scratchpad).

- **2026-07-21 · v21** — **THE PLANNING RELEASE.** ① **VP planning imported
  from the LC's sheet** ("Alexandria | Planning Tool 26.1", id
  `1gmPTHjZdYC2i8jdzFZi6mX7-…`): the six 🎯 goal-setting tabs (iGV/iGTa/iGTe/
  oGV/oGTa/oGTe — BD/B2B/TM skipped by request) were scraped via the user's
  browser (the sheet is NOT yet shared with the service account —
  `crm-sheets@gen-lang-client-0055329754.iam.gserviceaccount.com` needs Viewer
  for re-imports), verified (all Q sums match) and seeded as **1512
  `plan_cells` rows** (fn, scope month|sprint, period_start, metric, value).
  Term Feb 2026→Jan 2027; **S1 summer = Feb–Jul, S2 winter = Aug–Jan
  (current); sprints are HALF-MONTHS** (S1 = 1–15, S2 = 16–EOM); quarters
  Q1 Feb-Apr · Q2 May-Jul · Q3 Aug-Oct · Q4 Nov-Jan. Calendar math in
  `src/lib/plan.ts`; re-import parser `importPlanningSheet` in sheets.ts
  (sheet id cached at app_settings `planning:sheet-id`); scrape reference doc
  in the session scratchpad (PLANNING-REFERENCE.md). ② **/planning tab**
  (`canSeePlanning` = LCP/admin + VPs/Directors of IGV/IGT/OGV/OGT; OGX VPs
  enter via GateClient extra): per-function plan — sprint/month/quarter cards
  (plan vs ACTUAL opens for ICX lanes via `laneOpensActual` from deals'
  per-product splits; OGX = plan-only), full funnel tables, conversions,
  monthly + sprint-split tables, MM plans, and a **Re-import** button
  (`runPlanningImport`). ③ **Dashboard plan card** on product lanes
  (`lanePlan` in getDashboard): current SPRINT's planned opens vs raised +
  consideration plan chips, toggle to month. ④ **MM planning on first
  sign-in** (`mm_plans`, migration 0017): OGX & Consideration MMs
  (TL/Coordinator; `isPlanningMm`) are redirected to **/welcome/plan** after
  onboarding to file applicants/accepted/approvals × the peak's 6 months
  (peak from signup date via `peakForPlanning` — July→winter, January→summer
  edge rule); `saveMmPlan` upserts; plans feed /planning, the members
  directory and reports. ⑤ **Period reports** (`/api/cron/period-reports`,
  daily 07:00 UTC, scheduled in pg_cron): when a sprint/month/quarter closes
  (starting with the winter peak, Aug 2026), each function (IGV / IGT / B2B&BD)
  + the LCP gets a **waterfall report email** — totals, plan-vs-achieved, per
  team (bold) → per person rows (`buildFunctionReport` + `periodReportEmail`
  + `gridTable` multi-col builder); idempotent via app_settings
  `report:<kind>:<fn>:<start>`; `?test=1` sends a live preview to the IM
  mailbox only. ⑥ **Admin test mode**: /admin gains a Test-mode card —
  **Seed test accounts** (~11 `is_test=true` accounts across IGV/IGT/B2B/BD in
  every stage incl. OOP + a 3-no-response flag case), **Remove test data**,
  and a **Show-test-data switch** (`sodio-test-mode` cookie). Test accounts
  are invisible everywhere (accounts query, dashboards, members KPIs,
  calendar, Drive mirrors, reports) unless `viewer.testMode`. ⑦ **Sandbox
  test view** (v3): startViewAs defaults to **sandbox** — cookie
  `<target>|<mode>|<sessionId>` + `test_sessions` row; every mutation is
  journaled to `test_undo` (via `recordUndo`/`snapshotForUndo` in
  `src/server/sandbox.ts`, instrumented across accounts/contacts/visits/
  deals/comments/goals/blacklist writes) and **rolled back in reverse on
  exit** (`undoSandboxSession`); outbound side effects (emails, notifications,
  calendar events, sheet write-backs, Gmail drafts) are **suppressed** in
  sandbox (`sandboxSuppressed` checks the verified cookie). The fixed banner
  became a **draggable chip** (view-as-banner.tsx): drag anywhere, snaps to
  the nearest edge (position persisted in localStorage), collapses to a tab,
  and carries the 🧪 Sandbox / ⚡ Real toggle (`setViewAsMode` — flips without
  losing the undo journal). ⑧ **Feedback split**: SYSTEM feedback (form now
  has **type-dependent categories** — `FEEDBACK_CATEGORIES` in types.ts,
  `feedback.category` column, chips in the inbox) moved off the sidebar to a
  **Profile card**; the sidebar gained **LC Feedback** (`/lc-feedback`,
  ALWAYS_ALLOWED): feedback about PEOPLE — smart level-aware quick-pick chips
  (a TL is never offered "My TL"), searchable multi-select (≤10), 🎉 positive
  → bell + `lcShoutoutEmail` to the person (anonymous supported), 😟 negative
  → `lc_feedback` table, **inbox visible ONLY to LCP + admin** behind an
  "Inbox (n)" button on the form page (no sidebar tab). ⑨ **Members directory
  MOS fix**: per-member `mos` class — raising/B2B → opens ★, **BD → money
  (EGP ★)**, consideration & OGX → approvals (their **plan** until the
  consideration module lands), others → "module coming"; one flexible MOS
  cell replaces the uniform 6-column row. Playbook v21; Blue Man teaches all
  of it. Migration **0017 applied via MCP** (plan_cells, mm_plans,
  feedback.category, lc_feedback, accounts.is_test + view column,
  test_sessions, test_undo).

- **2026-07-18 · v20** — **Comment archiving** (migration `0016_comment_archive`,
  applied via the Supabase MCP): every comment gets an **Archive** button
  (archiving also unpins it); the comments card counts only live comments and
  reveals archived ones behind an **"Archived (n)"** toggle. Numbering runs over
  the FULL list so `#n` never shifts when archived comments hide.
  `toggleCommentArchive` in `actions.ts`, `AccountComment.archived` in types,
  RBAC via `canEditAccount`. **Proposal default attachments** on **B2B/BD**
  accounts are now **nothing** (was IGV) — `proposal-dialog.tsx` starts with an
  empty attach set. **Desktop direct-select**: the accounts table shows the
  select checkbox **always** (no "Select" click needed on desktop; the Select
  button is mobile-only) — rows still open on click, the checkbox cell swallows
  it. **Mobile accounts view switcher**: a **Cards / Compact / Table** segmented
  control (localStorage `sodio-accounts-mobile-view`) — Cards is the roomy
  default, Compact is a one-line-per-account list, Table reuses the desktop grid.
  **Bulk reassign RBAC fix**: the bulk-reassign picker now offers ONLY the
  viewer's allowed targets (`listReassignTargetsForViewer` in `data.ts`, mirrors
  `reassignTargetScope`) instead of every member — the server already re-checked
  per row, but the client had been offering everyone (a bug). Also fixed a
  latent server bug the new picker surfaced: `reassignAccount`'s per-account
  scope check now matches B2B/BD targets by `memberIsB2B` (BOTH `functions` and
  `sub_functions`) so a B2B crew member whose "B2B" lives only in the Sub
  Function column can actually receive a B2B/BD account (was always rejected).
  The **"All"**
  button in the bulk bar is now **select/unselect-all** for the current view
  ("All (N)" ↔ "Clear"). **Relabels** (dashboard): the 4th conversion is
  **"Visit Done → Deal"** (was "Lead Done → Open"); the KPI card is **"Lead →
  Open"** measured by **accounts that raised opens** (was "Lead → Deal"). **The
  Blue Man** now knows leaders can bulk-edit (Select → archive/reassign many) +
  the mobile view switcher. **Launch announcement drafts**
  (`scripts/draft-announcements.mjs`): one personalized Gmail **DRAFT** per
  active member in the IM mailbox (nothing sent) — a funny, role/function/level-
  tailored launch tour for everyone whose module is live (uses the app's own
  `hasRaisingAccess` gate: IGV/IGT raising, B2B/BD, LCP) and a "stay-tuned"
  teaser for everyone else (TM, OGX, F&L, B2C, CXP, consideration-only, no-
  module). `--dry` previews, `--emit=<dir>` dumps HTML. Playbook v20.

- **2026-07-17 · v19** — **Bidi/RTL fixed everywhere**: the base `Input` &
  `Textarea` default to `dir="auto"` (Arabic → RTL, Latin → LTR, per field),
  the Blue Man chat annotates each rendered line + the input + bubbles with
  `dir="auto"` + `text-start`, and key free-text displays (account name,
  comment body, feedback message, audit details) do too — mixed Arabic/
  English no longer reverses. **Mobile notifications** animate out of the
  bell: the panel's `DialogContent` gets `.notif-panel`, and a `max-width:639`
  CSS rule (doubled-class specificity) anchors it top-right with
  `transform-origin: top right` so the base zoom-in/out reads as growing from
  and shrinking back to the bell; desktop keeps the centered dialog.
  **Admin Health & Logs page** (`/admin`, `viewer.isAdmin` server-gated,
  sidebar entry for admins): `getSystemHealth` (DB, contracts bucket, shared
  visits calendar, GEMINI/CRON/ADMIN env presence, table counts) +
  `listRecentAudit` (audit_log with actor join, searchable). **Real cron
  run-tracking**: `markCronRun(name)` upserts `app_settings` key `cron:<name>`
  at the end of all four cron routes; the admin page reads them for genuine
  last-run times (green/amber freshness) — no more inferring from data stamps.

- **2026-07-17 · v18** — **Mobile chrome consolidated**: the drawer's user
  block drops the bell + theme toggle (both live in the mobile top bar now,
  theme toggle added there); desktop sidebar unchanged. **Compact mobile
  leaderboard**: phones get metric chips + rank/name/value rows (top 8)
  instead of the wide 7-column table (which stays ≥md). **Phone
  auto-normalization**: every phone input (contacts editor, profile,
  membership dialog, onboarding) cleans pasted/typed numbers to the
  canonical +20… format on blur via `normalizePhone`. **Blue Man smart
  actions**: the context now carries each account's `/accounts/<slug>` link,
  the prompt instructs attaching `[Open X](/accounts/x)` markdown actions,
  and the chat renders internal links as tappable action chips (external
  links open in a new tab).

- **2026-07-17 · v17** — **Mobile QA pass**: drawer slide is transform-only
  (dropped the double-driving `transition`, 300ms, `will-change`), the
  background no longer shifts on open (`scrollbar-gutter: stable` +
  neutralized react-remove-scroll body compensation), notifications bell now
  lives in the MOBILE top bar, drawer scrolls on short screens, notch-safe
  paddings, date-range filters fit 360px, mobile card names truncate
  properly, profile emails wrap, `<main>` clears the fixed refresh pill
  (md:pt-14). **Slow-nav feedback**: sidebar clicks show the walking man
  after 250ms until the route commits (8s safety). **Bulk operations**:
  Select mode on the accounts list (checkbox per row, All, fixed action bar)
  → `bulkArchiveAccounts` / `bulkReassignAccounts` loop the single-account
  actions so RBAC runs per row; plus a per-row quick-archive ✕ on desktop
  and mobile. **Fixes**: the test-view banner strip no longer swallows
  clicks (pointer-events — the "2.0 credit not clickable" report), "Add
  another" hard-remounts the add-account form via an epoch key (stale
  ListOrOther/MultiPick state was silently reinjecting old custom values),
  membership editor gained a search box (name/email/team/function/role).
  Playbook v17.

- **2026-07-16 · v16** — **BD money goal**: the B2B lane now carries TWO
  function goals — `B2B` (opens) and `BD` (MONEY, `performance_goals.metric =
  'EGP'`) — both set by the B2B/BD VP/Director from the same dialog (new
  "BD — money goal (EGP)" scope); second GoalCard on the B2B lane (achieved =
  Σ `deals.amount` on BD accounts, date-filter aware); unit-aware goal emails
  + goal-reminders (`laneAchieved('BD')` sums EGP; owners match B2B or BD in
  functions OR sub-functions). **Fixes**: scope label reads "B2B function"
  (one name); refresh button moved to the TOP (fixed top-right on desktop,
  mobile top bar); the first-run tour never pitches "Your ICX workspace" to
  members without a live module (Barthinya) and says "Your B2B workspace" for
  the B2B crew; LCP/admin calendar hovers show each visit's function; the
  Podio worklist's inline state select gained **Rejected (archives)** behind
  the same confirm as the account page. **Motion wave (CSS-only,
  reduced-motion-safe)**: aurora login background, animated striped goal
  fills, staggered KPI/calendar/playbook entrances, sidebar hover slide +
  active glow, breathing playbook hero. **Mirror-sheet guardrail**: every
  mirror sheet's last header cell now reads "⚠ MIRROR — Sodio overwrites this
  sheet hourly. Edit/delete IN SODIO, not here" (a sheet-side deletion was
  expected to sync back — it never does; only Membership is two-way). All
  TEST DATA was wiped on request (10 accounts + deals/visits/contacts/
  comments + 2 blacklist rows — full JSON backup in `backups/` (gitignored)
  in the main folder). Playbook v16.

- **2026-07-16 · v15** — **B2B/BD dashboard isolation**: the crew sees ONLY
  their B2B lane (no ICX aggregates — `icxFunctions` stopped widening,
  `dashboardViewer` scopes to B2B+BD); **B2B lane goal** (function='B2B') set
  by the B2B VP/Director (Suits = function-leaders team → its leader sets it),
  covered by goal-reminders (`laneAchieved` B2B branch) and announced to the
  B2B crew only (product-lane goals no longer spam B2B); **team goals require
  team members** (server-checked). **Calendar = own function only** (LCP/admin
  all). **Accounts is the home view** ("/" → /accounts; dashboard → /dashboard,
  all emails/notifications updated). **Add-account success popup** (open it /
  add another). **Test view v2**: the floating banner's name is a live SWITCHER
  (pick anyone; role + functions shown in both lists); tab-title metadata now
  honors the test view (was the raw session). **Freshness**: refresh button in
  the sidebar + auto `router.refresh()` on tab focus and every 30s while
  visible (`AutoRefresh`, 10s floor). **Playbook v15 is DYNAMIC** — renders
  only the viewer's sections + a "ask The Blue Man" callout. **Profile "my
  people"** now also shows a Member/Coordinator their own team (TL +
  teammates). **/membership un-blocked for non-raising EB** (GateClient extra;
  Hawash), /playbook ALWAYS_ALLOWED; TM tab renamed **"Talent Management"**;
  login shows just "Sodio"; sidebar brand "AIESEC in Alexandria"; ComingSoon
  copy updated (covers IGV·IGT·B2B&BD + TM).

- **2026-07-16 · v14** — **Admin Test view (View-As)**: profile picker + cookie
  impersonation through `getViewer` + exit banner; real session drives the
  admin checks. **BD deals' MOS = money** (migration 0015): amount (EGP)
  required on BD deals (+ optional benefits, opens optional), shown in
  history/header and a new sheet column. **ui-ux-pro-max skill reinstalled
  properly** (the ~/.claude/skills copies had dangling symlinks — data
  materialized for all 7 design skills) and the **21st.dev MCP server**
  registered user-scope; applied the skill's conservative recommendations:
  mobile touch targets enlarged to 36px (contact shortcuts + quick actions,
  desktop unchanged) — heavier items (style overhauls, GSAP, generated
  components) deliberately skipped to protect smoothness/reliability/
  responsiveness. Playbook v14.

- **2026-07-15 · v13** — **TM module v1** (`/members`, TM function + LCP/admin):
  whole-LC members directory with per-member MOS/KPIs + email/call/WhatsApp
  buttons; TM users enter the shell (GateClient `extra`) with server-side
  gates. **Profile "my people" card**: TL → team, VP/Director → function,
  LCP → EB, with contact buttons. **BD accounts** (migration 0014): B2B/BD
  crew picks the label per account, BD behaves like B2B (whole-ICX opens),
  own badge/drill; **Podio worklist**: "Podio pending" filter (B2B/BD MMs +
  Director/VP + LCP/admin) with copy-name, inline request-state, and "Ask to
  submit" → inbox-only notification + the account pins on top of the owner's
  list (`podio_submit_requested_at`, auto-cleared on action). **BD proposal
  variant** — Talent-Solutions pitch from aiesec.org.eg/partner.html, NO
  ready attachments; proposal signature now links to https://aiesec.org.eg/.
  **v12 review fixes**: ContractsDialog auto-load (effect) + stale-response
  guard; `/calendar` server-side gate + `listFunctionVisits` raising-access
  guard (no more B2B leak to non-ICX viewers); calendar chips only link to
  accounts the viewer can open; Cairo-timezone month default; function-goal
  progress unscoped from "My numbers" (`funcAchieved`); BD alias propagated
  to every inline B2B check (`memberIsB2B`). Playbook v13 (+ TM section);
  Blue Man knows all of it.

- **2026-07-15 · v12** — **B2B & BD are one function** (`isB2B` matches either
  name; membership sheet uses "BD, B2B"); **Teams tab logic applied from the
  sheet Ahmed set up**: types EB/LB/Function/**Function leaders**(→MM)/Team
  (skipped), multi-function cells ("B2B, BD") stored one row per function,
  VPs/Directors now see their "≤fn> leaders" team on the profile; **Director
  comment label** (not VP — migration 0013); **archive reason optional** (name
  alone blacklists); **My-numbers/member filter scopes KPIs + conversions
  ONLY** (boards & drills stay full); **B2B dashboard lane** for LCP/VPs/
  Directors/B2B; conversion renamed **"Lead Done → Open"**; **/calendar** —
  function-wide month calendar of visits, color-coded per member (legend,
  Saturday-first, agenda on phones, account click-through); **History pending
  visits are clickable** to report (same dialog as the top button, deep-link
  still works); **Contracts button** on accounts with uploaded contracts —
  popup with inline preview (iframe over a signed URL) + download; **proposal
  email v2 edits**: no "Dear …" line, recipient-name field removed,
  product-based signature title (Global Volunteer/Talent/Teacher Manager,
  B2B → Business Development Manager), phone → wa.me link; **The Blue Man**
  got playbook-grade system knowledge + fluent Egyptian-Arabic instructions;
  **EB shared on the Drive folder as commenters** (all 7, done via API);
  account "hadana" renamed **"Hadana Moves"** (data fix). Playbook bumped to
  v12.

- **2026-07-15 · v11** — **Drive sheets consolidated**: ONE `CRM — Raising
  Accounts` mirror for ALL accounts (IGV+IGT+B2B, active AND archived) with
  Function/Product/Archived? filter flags; archived-only view renamed
  `CRM — Archived Accounts`; the Teams sheet became a **"Teams" TAB on
  CRM — Membership** (auto-created + seeded); per-product sheets deleted.
  **Follow-up reminders v2**: +2h report prompt now emails the responsible
  **+ their TL** (Member/Coordinator only; leaders get it alone; details
  table included), and a **1-week "you forgot" nag** (same recipients) asks
  to report or archive — `forgotten_nag_sent_at`. **Deal contracts**: optional
  any-format uploads on Record-deal or later from History (private `contracts`
  bucket, signed-URL direct uploads, 10 files ≤25 MB each, RBAC-checked signed
  view links). **Proposal email rebuilt to the LC's original design** — ONE
  AIESEC blue for all products, per-function content, general B2B variant →
  aiesec.org/partners, NO company-logo section. **"My numbers" dashboard chip**
  (personal KPIs/MOS). **Goal reminder cycle**: daily cron emails goal owners
  when a period ends (goal vs achieved + set-new button, once per goal), and
  new goals are announced by email + bell to everyone they apply to.
  **The Playbook** (`/playbook`, sidebar for everyone): AIESEC-branded,
  role-organized manual with index + "That's you" badges — MUST be updated
  with every release (`PLAYBOOK_VERSION`). **SDG badges removed** (mapping,
  tiles, CSS). Migration **0012**; ship-rule (merge to main + deploy every
  session) added at the top of this file.

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
