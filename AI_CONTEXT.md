# AI_CONTEXT.md — Single Source of Truth (Sodio — AIESEC in Alexandria CRM)

> **⚠️ LIVING DOCUMENT.** Update this file **in the same commit** as any change
> to the system (feature, rule, route, schema, env var, deployment fact).
> Add a dated entry at the top of **`CHANGELOG.md`** (the history moved out of
> this file in v37.7 — it is not auto-loaded). No secrets in either file.
>
> **⚠️ SHIP RULE (every session, no exceptions):** finished work goes
> **commit → merge to `main` → push to GitHub**. The push IS the production
> deploy — Vercel's Git integration builds `main`. **Do NOT also run
> `vercel deploy --prod`** (v36.1): it builds the same commit a second time,
> Vercel keeps every deployment's functions, and that doubling helped fill the
> team's 10 GB Function Storage. Use the CLI only to redeploy without a commit.
> Never leave features on a side branch — that's how `0011_teams.sql` "went
> missing" once. Also update the in-app **Help center**
> (`src/lib/help-articles.ts` + `HELP_VERSION` in `help-content.ts`) with every release.

Last updated: 2026-10-16 · Version: v37.14

---

## 1. What this is

**Sodio** (briefly renamed **Elevate** in v28 — REVERTED in v32.1; internal
keys/cookies were always sodio-*, so nothing user-facing was ever lost) — a **100% free** CRM for AIESEC in
Alexandria: the ICX functions
(**IGV** & **IGT** raising, **B2B/BD**, **B2C**) plus — since v25 — the **OGX
sign-ups module** (OGT & OGV, two-way synced with the LC's tracker sheets — `SIGNUP_TABS` in
`google/signups.ts`: OGT New/Old SUs; OGV **New** = "OGV 26.2 New Signups" (`ogv_262`, shared with
the service account by name), **Old** = 26.1 Main (`ogv_main`), **Older** = 26.1 Old (`ogv_old`) — v37.9). The brand name is
**Sodio** (shown in the sidebar, tab titles, manifest, emails); the built-in
AI assistant is **The Blue Man**. Members log accounts, contacts, visits and
deals; leaders steer with goals, leaderboards and dashboards. The RBAC engine is
the blueprint for future OGX/other-function modules.

| | |
|---|---|
| Live URL | https://sodio.vercel.app (+ aiesec-alexandria-crm.vercel.app; **elevate-alex.vercel.app was removed in v32.1**) |
| Android | **Google Play, package `app.sodio.crm`** (v35) — a Bubblewrap **TWA** around the live URL, so every deploy reaches every phone with no store review. Built from `android/twa-manifest.json`; runbook in `android/README.md`. Verified by `/.well-known/assetlinks.json`, which reads `ANDROID_CERT_FINGERPRINTS` |
| Repo | github.com/ahmedhallu1/aiesec-alexandria-crm (private) |
| Vercel project | `aiesec-alexandria-crm` (scope `ahmedhallu1s-projects`, **Hobby** — 10 GB Function Storage) — pushing `main` deploys; `vercel.json`'s `ignoreCommand` skips a build when nothing but docs/tests/android/outreach/migrations changed since the last deploy |
| Stack | Next.js 16 (App Router, Turbopack) · React 19 · Tailwind v4 · shadcn/ui · Supabase (Postgres, project `iesrpuuoduxtihuaqfic`) |
| Auth | Auth.js v5: **FIRST sign-in is Google-only** (grants `calendar` + `gmail.compose`) → onboarding sets a password → afterwards **email OR phone + password**, or Google, all work. **Members with NO email yet (v24) sign in with their phone in BOTH fields** until a password is set; adding their email closes that door (Google once, then password). Deactivated members land on **/inactive**. **Forgot password emails a fresh password** (`issueTempPassword` in `server/password.ts`); the old password still works until the member changes it (no lockouts) |
| Google | Service account (Sheets sync, folder creation) · **the IM mailbox token carries mail + calendar + drive + sheets** — every Drive FILE is written as the mailbox, because a service account has no storage quota · Calendar events on each member's own calendar |
| Cron | **v36.3: visit-followups = pg_cron every 15 min, GATED by `visit_followups_due()` — Vercel is only called when a reminder is due; the IR bounce scan (`ir-bounces`) and sheets-export run on GitHub Actions `crons.yml`.** Supabase `pg_cron` + `pg_net` → `/api/cron/*`, **10 jobs** (visit-followups 15 min · signups-import "15 min" — on GitHub Actions, whose scheduler really runs it ~4–12× a day; left as is on purpose, it costs Vercel nothing · membership-import 30 min · sheets-export hourly :05 · **backup daily 02:00 UTC** · podio-updates daily 05:00 · period-reports daily 07:00 (sprint + month, no quarters) · streak-nags daily 16:00 · touch-point-feedback daily 19:00 · attendance-reminders daily 20:59) — **plus the four CXP pg_cron jobs** (cxp-sync hourly :20 · cxp-drive-scan hourly :35 · cxp-document-digest daily 06:00 · cxp-reminders daily 08:00), so pg_cron holds **11** jobs (all in `supabase/cron.sql`; verified green 2026-10-15) |
| Admin | `ADMIN_EMAILS` env (= IM director, treated as LCP) |

**Migrations** live in `supabase/migrations/` and are run **manually** in the
Supabase SQL editor (no CLI on this machine): `0001_init` → `0002_membership_v2`
→ `0003_ops_v2` → `0004_pins_v2` → `0005_deals` → `0006_admin_label` → `0007_visit_scheduled_result` → `0008_notifications_feedback` → `0009_b2b_deals_v9` → `0010_notif_link` → `0011_teams` → `0012_contracts_reminders` → `0013_director_label` → `0014_bd_podio` → `0015_bd_deal_amount` →
`0016_comment_archive` → `0017_planning_lcfeedback_testmode` →
`0018_tl_plans_deal_allocations_unassigned` → `0019_b2c_module` →
`0020_name_worlds` → `0021_podio_updates_all_fns_email_optional` →
`0022_team_registry` → `0023_email_unique_fix_phone_identity` →
`0024_function_leaders_type` → `0025_ogx_signups` → … → `0032_ir_booker_role` →
`0033_change_journal_lc_test` → `0033_touch_point_announced` →
`0034_bd_service_world` → `0035_ir_booker_phone` →
`0036_virtual_touch_points_and_routines` → `0037_admin_member_role` → … →
`0045_cic_signup_logs_ir_event_source` → `0046_lc_feedback_inbox` →
`0047_ir_call_timezone` → `0048_ir_product_and_lc_comments` →
`0049_direct_visits_mailbox_ir_notes` → `0050_ir_call_reschedule_history` →
`0051_fallback_email_bounces_b2c_cic` → `0052_three_name_worlds` →
`0053_calendar_item_visibility` → `0054_function_settings` →
`0055_touch_point_rating` → `0056_touch_point_members` →
`0057_touch_point_feedback_nudge` → `0058_ir_max_per_day` →
`0059_lc_partnerships` → `0060_ir_per_day_overrides` →
`0061_touch_point_location` → `0062_close_rls_gaps` → `0063_prank_mode` →
`0064_api_keys` → `0065_ir_slot_requests` → `0066_im_prompts` →
`0067_member_settings` → `0068_cxp_module` → `0069_push_subscriptions` → `0070_b2c_cic_outcomes` →
`0071_partnership_stage` → … → `0076_next_step_reminders` → `0077_visit_followups_gate` → `0078_contact_keys` → `0079_cv_drive_import` → `0080_redirect_links_and_locations` → `0081_activation_bid_and_tour_seen` → `0082_bd_b2b_planning` → `0083_cxp_staging_and_icx_approvals` → `0084_function_privileges_and_streak_index` → `0085_signup_batch_older` → `0086_list_indexes_and_ir_registry` (0077's FILE was recreated from prod in v37.7)
(**all applied**, 0046–0063 during v33.22–v33.51, 0064–0067 during v34.5–v34.8,
0069 during v35).

**Google Drive sheets (deliberately FEW — flag columns instead of per-product
sheets):** `CRM — Membership` (two-way; **8 columns since v33.53**: Name · Email ·
Phone · Role · Function · Sub Function · **Manager** · Active. The "Teams" TAB
and the "Team Name" COLUMN were deleted by the LC — **teams have no names any
more**: a team is a MANAGER and the people whose Manager cell names them. EB
and LB keep a name in the `teams` table, edited in-app; nothing recreates the
tab. The whole Drive folder is shared with **every EB member as commenter**) ·
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
- **ICX Proposal Email** (`src/lib/email/proposal.ts` + `sendProposalEmail` /
  `previewProposalEmail`, both built by the private `buildProposal()` so the
  preview cannot drift from the send):
  the "Proposal email" button on every account opens a popup (recipient,
  sector, custom note — product auto-detected iGV/iGTa/iGTe, company
  prefilled). It **SENDS from the member's own Gmail** on their
  `gmail.compose` grant (v34.10 — the "leave it as a draft" option is gone;
  **See it first** renders the exact letter in an `iframe srcDoc` inside
  Sodio, with Send underneath it and no redirect). An
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
  reminders), +2h follow-up email, report emails to the function's head(s) —
  LCVPs AND Directors, B2B/BD matched as one function (v37.14) — + manager
  (never LCP).
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
    A **Director** rides the invite for their OWN function's visits only
    (v37.14 — B2B & BD, B2C); the IGV/IGT→B2B widening stays an LCVP rule.
  - **Archiving clears the calendar on every path** (`clearArchivedCalendar`,
    v37.14): the archive button, a *Not Interested* contact result and a Podio
    *Rejected* all drop the pending visit's event and the next-step event.
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
  except `/login`, auth/cron APIs, static assets, `/brand`, PWA files, and the
  read-only public pages (`/book`, `/privacy`, `/delete-account`, and since
  v36.7 `/activate26` — the editable twin `/activation` stays protected, and
  since v36.8 is MMs and above only: `canSeeActivationBid` in rbac.ts gates the
  nav, the layout's gate routes, the page — a Member is sent to `/activate26`
  — and every action, reads included).
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
(plan_cells opens vs `laneOpensActual`, sprint/month toggle — the 6 product
lanes) plus, **since v36.9, the B2B lane's own `TermPlanCard`** — BD/B2B set
ONE term-wide target in their sheet tabs (revenue + a slots/contract count),
not a month/sprint plan, so it's a running term-to-date figure rather than
following the sprint/month toggle — and the **team goal = the TL's filed
plan** (`tl_plans`, see below) —
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

**Loading = the walking human** (`public/brand/walk.png`, looping alpha
**APNG** converted from the official brand `.mov` — WebP was dropped because
its frame disposal stacked frames over each other; component `WalkingLoader`,
used inside `PageSkeleton`). The artwork is white-on-transparent and is
recoloured to Sodio purple by the **SVG `feColorMatrix`** in `SodioSvgDefs`
(mounted once in the root layout) — NOT by the old brightness/invert/hue-rotate
chain, which was numerically solved for AIESEC blue and could not be re-pointed
at a new hue. A CSS mask would also have been exact but samples the image once,
which would freeze the walk cycle. Motion system (all
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
- Branding: **Sodio's own identity** (v34) — "blue anchors, purple acts". The
  geometric-S mark (`SodioMark`, inline SVG; source files in
  `public/brand/logo/`), **Familjen Grotesk** for voice, **Karla** for work,
  **IBM Plex Mono** for facts, AIESEC blue `#037EF3` as the anchor and Sodio
  purple `#7552CC` as the signature. Purple NEVER labels a product — it marks
  actions and wins only, which is what keeps it from fighting the GV/GT/GTe
  tags on the same row. **EVERY email wears the AIESEC in Alexandria logo**
  (v34.10 — internal and external alike; the split header is gone, because the
  same LC looking like two organisations depending on the recipient was the
  problem), on a navy→purple header, with **"Powered by Sodio" + "Made by 2.0"**
  as the footer credit on all of it (`sodioCredit()` in `templates.ts`;
  `crmLink: false` on anything leaving the LC, so "Sodio" is a name out there
  and never a door into an internal system). The `/book` and `/inactive` pages
  wear the LC logo for the same reason.
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
src/lib/help-content.ts       Help center machinery (types, categories, search)
src/lib/help-articles.ts      THE KNOWLEDGE BASE (bump HELP_VERSION with every release)
src/components/crm/help-view.tsx  the /help UI (search, categories, articles, FAQs)
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
| The Sodio mark (logo geometry) | `src/components/crm/sodio-mark.tsx` — and `scripts/gen-brand-assets.mjs`, which MUST be re-run so the favicon/PWA/OG rasters keep matching |
| The palette / brand tokens | the `:root` + `.dark` blocks in `src/app/globals.css` (re-check contrast — see the v34 table) |
| The type pairing | `src/app/layout.tsx` (next/font) + `--font-display` in the `@theme inline` block |
| The mascot's colour | the `feColorMatrix` in `SodioSvgDefs` (`sodio-mark.tsx`) |
| The Help center (articles/FAQs) | `src/lib/help-articles.ts` (+ bump `HELP_VERSION` in `help-content.ts`) · diagrams in `help-diagrams.tsx` |
| Lane goal display (plan vs actual) | `lanePlan` in `getDashboard` · `PlanCard` in `dashboard-view.tsx` |
| VP planning sheet (which spreadsheet, re-import) | `app_settings.planning:sheet-id` (manually seeded, never auto-discovered) · `importPlanningSheet`/`importBdB2bPlanning` in `google/sheets.ts` · `runPlanningImport` in `actions.ts` |
| BD/B2B term goal (revenue/slots vs achieved) | `importBdB2bPlanning` in `google/sheets.ts` (parses the "🎯BD"/"🎯B2B \| goal setting" tabs — a different shape from the 6-lane funnel, `plan_cells.scope='term'`) · `dealsTotalsForAccountFn`/the `termPlan` block in `getDashboard` · `TermPlanCard` in `dashboard-view.tsx` · the `isB2BReport` branch of `buildFunctionReport`'s plan-check |
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
| Guided walkthrough (steps / anchors) | `tour.tsx` (steps) · `guided-tour.tsx` (engine) · `data-tour="…"` in the views |
| Column filters | `ColumnFilter` in `data-table-kit.tsx` · `columnFilter()` in accounts-view / signups-view |
| Podio existence check (parser / cache / TTL) | `src/lib/podio.ts` · `checkPodioNameLive` in `actions.ts` · verdict UI in `add-account-dialog.tsx` |
| Dashboard lane list & who sees it | `raisingFunctions`/`considerationFunctions`/`seesEveryLane`/`ogxLanes` in `rbac.ts` · `views` in `dashboard/page.tsx` |
| Change journal / undo / LC test session | `src/server/sandbox.ts` · `startLcTestSession`/`stopLcTestSession`/`undoAuditEntries` in `actions.ts` · `/admin` |
| Stale plans when membership changes | `stillPlans`/`prunePlansForMember`/`pruneStalePlans` in `data.ts` |
| First-run walkthrough | `buildSteps` in `tour.tsx` (bump `crm-tour-v*` to re-show it) |
| Nightly backup (tables, retention, destinations) | `src/server/backup.ts` · `/api/cron/backup` |
| Security headers / CSP | `next.config.ts` |
| Tests | `tests/*.test.ts` (Vitest — `npm test`) |
| Proposal decks (which PDF, defaults, size budget) | `src/lib/proposal-pdfs.ts` (pure, client-safe) · files in `proposals/` · `sendProposalEmail` in `actions.ts` |
| Import columns (per function, examples, template) | `src/lib/import-columns.ts` (pure) · `import-view.tsx` — ⚠️ mirrors `createAccount`'s rules, pinned by `tests/import-columns.test.ts` |
| A member's own settings (shape, defaults, search index) | `src/lib/member-settings.ts` (pure) · reader `src/server/member-settings.ts` · `saveMySetting` in `actions.ts` · `settings-panel.tsx` |
| What "this week" means to the Violet Man | `src/lib/ask-period.ts` (pure) · the `getNumbers` tool in `src/app/api/assistant/route.ts` |
| IM prompt defaults (response-label fallback, shared by server + preview) | `src/lib/im-prompt.ts` (pure) · preview UI `im-prompt-preview.tsx` · composer `im-prompt-card.tsx` |
| The OG / link-preview card (and its 2.0 credit) | `scripts/gen-brand-assets.mjs` — re-run it after touching the mark, exactly like the favicon/PWA rasters |
| Feedback categories | `FEEDBACK_CATEGORIES` in `types.ts` |
| LC people feedback | `submitLcFeedback` in `actions.ts` · `lc-feedback-view.tsx` · inbox via `listLcFeedback` |
| Function defaults (shape + what unset means) | `src/lib/function-settings.ts` (pure) · reader `src/server/function-settings.ts` · `saveFunctionSettings` in `actions.ts` · card in `profile-view.tsx` |
| Who may read a whole function (per-role) | `openViewFns`/`fnSettings` on the Viewer (`viewerFunctionSettings` in data.ts) · `canViewAccount`/`openViewFunctions` in rbac · the `openFns` OR in `applyScope` |
| OGX tracker tabs (which sheets, New/Old/Older batch, header aliases, phone repair) | `SIGNUP_TABS` / `HEADER_ALIASES` / `trackerPhone` in `src/lib/google/signups.ts` · labels `signupBatchLabel` in `types.ts` · a new tab's sheet must be shared with the service account (Editor) · pinned by `tests/signup-tabs.test.ts` |
| OGX referrals | `addSignupReferral` in `actions.ts` · `ReferralDialog` in `signups-view.tsx` (source='referral' — never synced to a tracker tab) |
| IR email checks (pre-booking) | `src/lib/email-check.ts` |
| IR bounce watcher + host alert | `src/server/bounces.ts` · `irEmailBouncedEmail` in `email/templates.ts` |
| Fixing an IR's email (invite swap/rebuild) | `updateIrBookerEmail` in `actions.ts` · `swapIrCallAttendee` in `google/calendar.ts` |
| Consideration lane filters | `ConsiderationFilters` in `considerationStats` (data.ts) · the shared filter bar in `dashboard-view.tsx` |
| IR call-log filters | `IrCallFilters`/`irCallFilterOptions`/`listIrCalls` in data.ts · `IrCallsTab` in `consideration-view.tsx` |
| Handing an IR call to another host | `reassignIrCall` in `actions.ts` · `irCallHandoverTargets` in `data.ts` · `HandOverCallDialog` in `consideration-view.tsx` · the three `irCallHandedTo*`/`irCallHostChanged` templates |
| The Activate banner (brief, road, walker) | `src/components/crm/activate-strip.tsx` (`ACTIVATE_DAY`, `roadDays`, `monthPosts`, `LINKS`) |
| Link prefetching / Vercel invocations | `prefetch={false}` on every `<Link>` (see the note at the sidebar nav in `app-shell.tsx`) · the proxy matcher in `src/proxy.ts` · pinned by `tests/link-prefetch.test.ts` |
| What EVERY page view costs (per-request reads) | `src/app/(app)/layout.tsx` · the module-memory cache in `src/server/function-settings.ts` · `hasFiledPlan` in `data.ts` |
| Phone notifications (sending) | `src/server/push.ts` — hooked into `notifyMembers` in `src/server/notify.ts` and NOWHERE else |
| Phone notifications (the device side) | `public/sw.js` · `src/lib/push-client.ts` · `PushToggle`/`PushSync` in `push-toggle.tsx` · `savePushSubscription`/`sendTestPush` in `actions.ts` |
| The Android app (shell: name, icon, splash, colours) | `android/twa-manifest.json` — then `bubblewrap update && bubblewrap build`, bump `appVersionCode`. A WEB change needs none of this |
| Why the app shows a URL bar | `src/app/.well-known/assetlinks.json/route.ts` + `ANDROID_CERT_FINGERPRINTS` (it is Play's app-signing SHA-256, NOT the local upload key's) |
| The privacy policy (required by Play) | `src/app/privacy/page.tsx` — public route, must stay in the proxy matcher's exclusion list |
| The road to a partnership (stages, auto-detection) | `src/lib/partnership-stage.ts` (pure) · `listPartnerLcDetails` in `data.ts` derives it · `setLcPartnershipStage` in `actions.ts` · `PartnershipRoad` in `consideration-view.tsx` |
| Who may hand out / move a partnership target | `resolvePartnershipTarget` in `actions.ts` · the `partnershipTargets` narrowing in `consideration/page.tsx` (the two must agree) |
| B2C call outcomes + the call-back reminder | `B2C_CALL_OUTCOMES` in `types.ts` · `updateB2cCic` in `actions.ts` · `runB2cCallBacks` in `server/cron/visit-followups.ts` |
| Deleting an account / cancelling a deal | `deleteAccount` + `accountDeletionCheck` + `cancelDeal` in `actions.ts` · the dialogs in `account-detail-view.tsx` |
| The CIC 1st-caller filter | `cicFirstCallerOptions` + `cicPoolFilter` in `data.ts` · `firstCaller` in `SignupFilters` · the `assigned` case in `columnFilter` (signups-view) |
| The Activate 26' bid page (model, public shaping, paste parsing) | `src/lib/activation/model.ts` (pure) · the first version `lib/activation/seed.ts` + `seed.json` (generated once from the two sheets — history, the DB is the plan) |
| Bid page reads / writes | `src/server/activation.ts` · `src/server/activation-actions.ts` (every action: MMs and above via `canSeeActivationBid`, never a test view) |
| Bid page UI (theme, sheet editor, timeline, acts) | `src/components/activation/*` — `circus.css` is namespaced `.circus`; routes `/activation` (in-app, editable) and `/activate26` (public, read-only) |
| Who sees the bid tab | `canSeeActivationBid` in `rbac.ts` (MMs and above) — read by the layout, the nav, the page and `editor()` in the actions |
| Bid sheet bulk editing (ranges, fill, row delete) | `sheet-grid.tsx` (`commitMany` → `onSetMany` → `pasteActivationCells`) · `deleteActivationRows` in `activation-actions.ts` |
| The bid page's poster | `public/brand/activate26-poster(-sm).webp` · `.circus-poster` / `.circus-finale-poster` in `circus.css` |
| ICX approvals (credit rule, plan vs achieved, SubTool matching) | `src/lib/icx-approvals.ts` (pure, tested) · reads `src/server/icx-approvals.ts` · writes `src/server/icx-approval-actions.ts` · the tab `icx-approvals-tab.tsx` · the board `icx-approvals-board.tsx` (dashboard lane AND the tab) · `approvals` in `considerationStats` · the report's consideration section in `buildFunctionReport` |
| CXP uploads (two-step, via the `cxp-staging` bucket) | `requestCxpUpload`/`confirmCxpUpload` in `src/server/cxp-actions.ts` · `putWithProgress` in `cxp-ep-view.tsx` |
| CXP downloads (one document / an EP / a week, streamed) | `openCxpDriveFile` + `collectedForWeek` in `cxp-drive.ts` · `src/server/cxp-download.ts` · routes `src/app/api/cxp/file` and `src/app/api/cxp/zip` |
| Whose approvals plan a viewer sees | `ApprovalPlanSource` / `laneApprovals` in `src/lib/icx-approvals.ts` · `approvalPlanSourceFor` in `src/server/icx-approvals.ts` |
| CXP Drive root | `app_settings` `cxp:drive-root` · `cxpRoot()` in `cxp-drive.ts` |
| TL active/inactive for their team | `setTeamMemberActive` in `actions.ts` · `ActiveToggle` in `profile-view.tsx` · the TL branch of `profilePeople` |
| Data export (what, who, which reader) | `src/server/exports.ts` · route `src/app/api/export` · `ExportButton` · `src/lib/export/book.ts` |
| Personal defaults (home, lane, page size, sign-ups view) | `PersonalDefaults` in `lib/member-settings.ts` · `saveMyDefault` · `lib/home-options.ts` |
| Settings sections per user type | `src/app/(app)/profile/settings/page.tsx` · `settings-hub.tsx` |
| Membership source / upload / mirror | `membershipSource`, `applyMembershipGrid`, `previewMembershipGrid`, `mirrorMembershipToSheet` in `google/sheets.ts` · `lc-actions.ts` · `membership-upload-dialog.tsx` |
| New peak / term, handover | `lib/lc-term.ts` · `server/lc-term.ts` · `server/lc-actions.ts` · `lc-settings-section.tsx` |
| MM access (who an MM reaches: team / function / only self) | `src/lib/mm-access.ts` (pure) · `reachIds`/`actsOverOthers` in `rbac.ts` (EVERY access check — never `role === "Team Leader" && teamMemberIds` again) · `viewerReach` in `data.ts` · `setMmAccess` in `actions.ts` · `mmAccessBlocks` + `mm-access-card.tsx` (Settings → My function) |
| B2C CIC — which call is "the" call, what assigning does | `src/lib/b2c-cic.ts` (pure, tested) · `assignB2cCic` in `actions.ts` · the `cic_b2c*` cells in `signups-view.tsx` |
| Storage keys the browser hands back (sign/confirm uploads) | `isSafeStorageKey` in `src/lib/storage-key.ts` — every signed-URL / confirm-upload action checks it; never sign a raw client key |
| Identity lookups by email (sign-in, viewer, reset) | `exactIlike` in `src/lib/like-pattern.ts` — never `.ilike("email", raw)` (pinned by `tests/security-hardening.test.ts`) |
| Password / reset throttles | `src/server/rate-limit.ts` (`passwordAttemptAllowed`, `underHourlyLimit`) · `authorize` in `src/lib/auth.ts` · `requestPasswordReset` in `auth-actions.ts` |
| Work-activity stamps (working-hours raw material) | `stampWork` in `src/server/work-activity.ts` — NOT in a "use server" file (that made it a public endpoint) |
| IR availability rules (what the form marks vs what Save refuses) | `src/lib/availability.ts` (pure, the form) · the overlap block in `saveIrBookingSettings` (actions.ts) — the two must agree, one-date rows included (pinned by `tests/jules-review-3.test.ts`) |
| Journalling many rows in one action | `recordUndoMany` / `snapshotManyForUndo` in `src/server/sandbox.ts` — never a per-row `await recordUndo` loop over an audience |
| Rows-per-page pickers | `src/lib/page-size.ts` (`DEFAULT_PAGE_SIZE` — never a literal; pinned by `tests/page-size.test.ts`) |
| The OGX streak's day rule (card AND 19:00 nag) | `contactDaysByMember` in `src/lib/streak.ts` (pure, tested) — the referral rule lives there and nowhere else |
| Fire-and-forget emails/bells from an action | `keepAlive(promise)` in `src/server/background.ts` (Next `after()` → waitUntil) — never a bare un-awaited `sendEmail(…)` (pinned) |
| What archiving takes off the calendar | `clearArchivedCalendar` in `actions.ts` — every archive path calls it (pinned) |
| Storing an IR call's calendar event / registering the IR | `linkIrCallEvent` (checked write, one retry) · `registerBookingContact` (plain insert; 23505 = already there) in `actions.ts` |
| Deal counters + the Deal Done stage | DERIVED from the `deals` table in `recordDeal`/`updateDeal`/`cancelDeal` — the last cancel clears `slot_raised` (the view's stage reads it) |
| Column-filter option lists (sign-ups, CIC, IR calls) | `memoOptions` in `data.ts` — module memory, 5 min; NOT `unstable_cache` (revalidatePath evicts it) |
| Throttle buckets in app_settings | `RATE_BUCKET_SCOPES` + `pruneRateBuckets` in `src/server/rate-limit.ts` (nightly, after the backup) — a new scope must be added to the list (pinned) |

---

## 9. Pending / operational notes

- **VERCEL FUNCTION STORAGE (v36.1)**: Hobby includes 10 GB, and every
  retained deployment's functions count toward it. Since v36.1 a function
  traces ~5 MB instead of ~97 MB, but every OLDER deployment keeps its old
  size until it expires or is deleted — so after v36.1 is live, delete old
  deployments from the project's Deployments tab (keep the current production
  one plus one to roll back to) and set a short **Deployment Retention** window
  in Project Settings. Don't add `googleapis`, `outputFileTracingIncludes` or
  big files under a traced path back. The proposal decks are in the private
  Storage bucket `proposals`; replacing one = `proposals/README.md`.
- **BACKUPS (v33)**: nightly at 02:00 UTC into the private Supabase bucket
  `backups` (30 days, gzipped ~1.2 MB each) + a gzipped copy emailed to the IM
  mailbox + a copy in the CRM Drive folder ("CRM — Backups"). Restore = create the schema from `supabase/migrations/`, gunzip the
  dump, insert each array under `data.<table>`. **Storage buckets (contracts,
  cvs) are NOT backed up** — they are files, not rows. Health page shows the
  last run; a failed run returns 500 and logs `[backup] FAILED`.
- **The `xlsx` high-severity advisory has no upstream fix.** Parsing is
  client-side on a file the member chose, so the blast radius is that member's
  own browser. Revisit if SheetJS ever ships a patched release.
- **All migrations 0001–0017 are RUN** (0001–0015 verified live 2026-07-16;
  0016 applied 2026-07-18; **0017_planning_lcfeedback_testmode applied
  2026-07-21 via the Supabase MCP** — plan_cells, mm_plans, feedback.category,
  lc_feedback, accounts.is_test (+ accounts_pipeline view column),
  test_sessions, test_undo).
- **THE PLANNING SHEET IS REACHABLE AGAIN — IT'S A NEW SHEET NOW** (v36.9).
  "Alexandria | Planning Tool 26.1" (id `1gmPTHjZdYC2i8jdzFZi6mX7-…`) never
  became readable and confirmed **403** on re-check — the share genuinely
  never landed. The LC has since moved on to **"Alexandria | Planning Tool
  26.2"** (id `1BF4nh017y12glrOzfQBNarS2tNya9P7QInvpE11HC5I`), shared
  **"Anyone with the link"**, which the service account reads with no share
  needed. `app_settings.planning:sheet-id` now points at 26.2. If the LC
  rolls to a 26.3/27.1 sheet next term, repoint that same setting (there is
  still no in-app writer for it — see §8's "VP planning tabs" row) and
  re-run the import.
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

The full release history lives in **`CHANGELOG.md`** (moved 2026-10-03, v37.7 —
it was ~87% of this file and this file is loaded into every session). Add each
release's dated entry at the **top** of CHANGELOG.md, in the same commit as the
change. Before changing a behaviour that looks odd, `grep -n` CHANGELOG.md for
it — most "why is it like this?" answers (⚠️ notes) are there.
