# Sodio — Security & Reliability Audit

**Target:** https://sodio.vercel.app · **Date:** 2026-08-04 · **Scope:** full repo, prod config, live headers
**Status of this document:** Phase 1 complete, Phases 2–3 partially complete, Phases 4–6 outstanding. See §8.

---

## 1. Executive summary

Sodio is a single-tenant internal CRM for one AIESEC entity (~77 members). That
shapes every judgement below: there is **no cross-tenant boundary to breach**,
and the realistic attacker is an authenticated member exceeding their scope, not
an anonymous internet attacker. The public attack surface is three routes.

**Security posture: fair, with one systemic strength and one systemic gap.**
The strength is real — authorization is enforced *server-side* in a single
engine (`src/lib/rbac.ts`), every read passes `accountScope` and every mutation
a `can*` predicate, so the most common CRM vulnerability class (IDOR / missing
ownership checks) is structurally addressed rather than sprinkled around. The
gap is the perimeter: until this audit there were **no security headers at all**
and **2 critical + 5 high dependency vulnerabilities**, including a Next.js
*middleware bypass* affecting exactly the mechanism this app uses for route
protection.

**Reliability posture: fair, with a quota crisis now addressed.** The project
hit **97.5% of the Vercel Hobby Fluid-Active-CPU allowance**, caused by a
30-second background poll that re-rendered the full dashboard — which reads the
entire ~3,800-row account table — for every open tab.

### Highest-risk findings

| | Finding | Severity |
|---|---|---|
| F-01 | Next.js middleware/proxy bypass (CVE in 16.2.10) — the app's only route guard | **Critical** |
| F-02 | `@auth/core` / `next-auth` uncaught exception on malformed Bearer header | **Critical** |
| F-03 | No security headers in production — no CSP, no nosniff, no frame protection | **High** |
| F-04 | Hobby CPU quota exhaustion → service disruption | **High** (availability) |
| F-05 | `xlsx` prototype-pollution / ReDoS, no upstream fix | **High** |
| F-06 | Vercel API token disclosed in plaintext by the operator | **High** (operational) |

### Fixed in this pass
F-01, F-02 (dependency upgrades, verified), F-03 (headers added), F-04 (poll
removed). F-06 requires operator action. F-05 has no upstream fix — see §6.

---

## 2. Application architecture

| Layer | Detail |
|---|---|
| Framework | Next.js **16.3.0** (App Router, Turbopack), React 19.2.4 |
| Runtime | Node 20 on Vercel serverless; npm |
| Auth | Auth.js v5 (`next-auth@5 beta`) — Google OAuth + credentials (email/phone + bcrypt); JWT session cookie |
| Route guard | `src/proxy.ts` (middleware) — everything requires a session except `/login`, `/inactive`, `/book/*`, `/api/auth/*`, `/api/cron/*`, static assets |
| Authorization | `src/lib/rbac.ts` — one engine; `accountScope` for reads, `can*` predicates for mutations |
| Database | Supabase Postgres, accessed with the **service-role key** from server code only; no ORM (PostgREST client) |
| Storage | Supabase private buckets `contracts`, `cvs`; access via short-lived signed URLs |
| Integrations | Google (Sheets, Drive, Gmail, Calendar), Gemini (assistant + CV extraction), Podio (public read), CORE (public scrape) |
| Cron | 8 pg_cron jobs → `/api/cron/*`, guarded by `CRON_SECRET` |
| Sensitive data | Member names, emails, phones, Google refresh tokens, bcrypt hashes, applicant CVs, partner contacts, deal amounts, attendance and private people-concerns |

### Trust boundaries
1. **Internet → public routes** (`/login`, `/book/<slug>`, `/book/manage/<token>`) — unauthenticated input.
2. **Authenticated member → their RBAC scope** — the primary boundary; a Member must not read the LC.
3. **App → Supabase** — the service-role key bypasses RLS entirely, so *application code is the only access control*.
4. **App → Google/Gemini/Podio** — outbound; refresh tokens are the crown jewels.

### Threat model (abbreviated)
- **Assets:** member PII, Google refresh tokens, password hashes, CV pool, private concerns inbox, the account/deal pipeline.
- **Attackers:** (a) a curious member escalating scope — *most likely*; (b) an ex-member whose row was deactivated; (c) an internet attacker hitting the public booking page; (d) a compromised operator token.
- **Highest-risk components:** `src/proxy.ts` (single guard), `src/lib/rbac.ts` (single authorization engine), `bookIrCall` (unauthenticated write), the service-role key.

---

## 3. Findings

| ID | Title | Severity | Category | Affected | Impact | Fix | Status |
|---|---|---|---|---|---|---|---|
| F-01 | Next.js middleware/proxy bypass | Critical | A01 Broken Access Control | `package.json`, `src/proxy.ts` | The app's only route guard is middleware; a bypass exposes every authenticated page | Upgraded `next` 16.2.10 → **16.3.0** | **Fixed** |
| F-02 | `@auth/core` uncaught exception on malformed Bearer header | Critical | A06 Vulnerable Components | `package.json` | Unauthenticated request could crash the auth path | `npm audit fix` patched `@auth/core`/`next-auth` | **Fixed** |
| F-03 | No security headers in production | High | A05 Misconfiguration | `next.config.ts` | Clickjacking, MIME sniffing, referrer leakage of account-slug URLs; framework version advertised | Added `frame-ancestors 'none'`, `X-Frame-Options`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, `no-store` on app routes; `poweredByHeader:false` | **Fixed** |
| F-04 | CPU quota exhaustion → service disruption | High | Availability | `auto-refresh.tsx` | 30s poll × every open tab × full dashboard render (~3,800 rows) drove the project to 97.5% of the Hobby allowance | Background polling **removed**; refresh now on focus/visibility only, 20s floor | **Fixed** |
| F-05 | `xlsx` high-severity (prototype pollution / ReDoS) | High | A06 | `import-view.tsx` (client-side parse) | Malicious spreadsheet could poison prototypes in the importing member's browser | **No upstream fix exists.** Parsing is client-side, input is a file the member chose. Mitigation options in §6 | **Not Fixed** |
| F-06 | Vercel API token disclosed in chat | High | Secrets | operator action | Token can deploy, read all env vars (Supabase service key, Gmail refresh token, `AUTH_SECRET`), delete projects | Not used by this audit; **must be revoked** | **Needs Manual Action** |
| F-07 | Service-role key + no RLS | Medium | A01 | `src/lib/supabase.ts`, all tables | Any server-side query bug reads the whole LC; RLS is enabled on tables but the service key bypasses it | Accepted for now (single-tenant, server-only). Defence-in-depth options in §6 | **Not Fixed** |
| F-08 | No CSP `script-src` | Medium | A05 | `next.config.ts` | XSS would execute unconstrained | `frame-ancestors` added; a full CSP needs an allowlist pass (Google avatars, DiceBear, Supabase, Gemini) and would white-screen the app if wrong | **Partially Fixed** |
| F-09 | Public booking endpoint rate limiting is DB-bucket based | Medium | A04 | `bookIrCall` | 3/hour per IP via `app_settings` + an atomic RPC; correct, but IP-based and spoofable behind proxies | Reviewed — atomic RPC (0030) already fixes the earlier race. Left as-is | **Accepted** |
| F-10 | CSV/spreadsheet formula injection on export | Medium | A03 | Sheets mirrors, CSV exports | A member typing `=IMPORTXML(...)` into an account name could exfiltrate via the mirror sheet when opened | Not yet reviewed | **Not Fixed** |
| F-11 | Login error box rendered invisible text | Low | UX/Reliability | `login-form.tsx`, `login/page.tsx` | `text-destructive` on `bg-destructive/10` painted solid on mobile; only emoji visible. Members locked out with no instruction | Explicit light/dark tokens | **Fixed** |
| F-12 | Multi-value Role cell parsed as `Member` | High | A01 | `src/lib/google/sheets.ts` | `"LCVP, Admin"` fell back to `Member` — the VP of IGT ran his function with member permissions, silently, re-applied every 30 min | `parseRole` splits the cell; rank wins, `Admin` becomes a capability | **Fixed** |
| F-13 | Journal disabled permanently on first error | Medium | Reliability | `src/server/sandbox.ts` | A one-way latch meant undo silently recorded nothing on warm servers after a migration landed | Time-boxed retry (2 min) | **Fixed** |
| F-14 | IR calendar invite leaked internal URL | Low | Info disclosure | `bookIrCall` | External IRs received a link to `/consideration` | Description scrubbed to meeting facts only | **Fixed** |

---

## 4. Code changes

| File | Why |
|---|---|
| `package.json` / `package-lock.json` | `next` → 16.3.0 (F-01); `@auth/core`/`next-auth` patched (F-02) |
| `next.config.ts` | Security headers + `poweredByHeader:false` (F-03, F-08) |
| `src/components/crm/auto-refresh.tsx` | Removed background polling (F-04) |
| `src/lib/google/sheets.ts` | Multi-value Role parsing (F-12) |
| `src/server/sandbox.ts` | Journal retry instead of permanent latch (F-13) |
| `src/server/actions.ts` | IR invite description scrubbed (F-14) |
| `src/components/crm/login-form.tsx`, `src/app/login/page.tsx` | Legible error boxes (F-11) |

---

## 5. Verification performed

| Command | Result |
|---|---|
| `npm audit --omit=dev` (before) | 2 critical, 5 high |
| `npm audit fix` + `npm i next@16.3.0` | **0 critical, 1 high** (`xlsx`, no fix available) |
| `npx tsc --noEmit` | Pass (one stale `.next` artifact unrelated to source) |
| `npx eslint src/` | 37 problems — **unchanged from baseline**, no new issues introduced |
| `npm run build` | ✓ Compiled successfully |
| `curl -I https://sodio.vercel.app/login` | Confirmed pre-fix: only HSTS present; `x-powered-by: Next.js` leaked |
| Source-map exposure check | None exposed |

---

## 6. Manual actions required

1. **Revoke the Vercel API token** disclosed in chat — vercel.com/account/tokens. It can read every environment variable. *(F-06, urgent)*
2. **Decide on `xlsx`** *(F-05)*: no patched version exists. Options — (a) accept: parsing is client-side on a file the member chose; (b) replace with `exceljs`; (c) move parsing server-side with strict limits. Recommend (a) short-term, (b) planned.
3. **Consider Supabase RLS policies** as defence-in-depth *(F-07)* — the service key bypasses them, but they protect against a future anon-key path.
4. **Set up a database backup schedule** if not already enabled in Supabase.
5. **Rotate `AUTH_SECRET` and the Supabase service key** if the Vercel token was ever used by anyone else.

---

## 7. Deployment checklist

1. `npm ci` — confirm the lockfile installs cleanly.
2. `npx tsc --noEmit` and `npm run build` — both must pass.
3. Deploy to production.
4. Verify headers: `curl -I https://sodio.vercel.app/login` → expect `content-security-policy: frame-ancestors 'none'`, `x-content-type-options: nosniff`, no `x-powered-by`.
5. Sign in and load `/accounts`, `/dashboard`, `/calendar` — confirm no white screen (the Next 16.3 upgrade is the only behavioural risk).
6. Watch Vercel Fluid Active CPU for 48h — it should drop sharply.

## 8. Rollback plan

Every change is a separate commit on `main`. To reverse:
- **Headers only:** revert the `next.config.ts` commit.
- **Next.js upgrade:** `npm i next@16.2.10` and redeploy. *(Reintroduces F-01 — do this only if 16.3.0 breaks rendering.)*
- **Full:** `git revert <merge-sha>` then redeploy. No migrations were applied in this pass, so there is no database rollback to perform.

---

## 9. Outstanding work (Phases 4–6)

This pass covered Phase 1 (architecture + threat model), Phase 2 partially
(dependencies, headers, secrets scan, live-header review) and Phase 3 partially
(the quota incident). **Not yet done, and required before calling this
complete:**

- Per-endpoint inventory of all server actions and API routes with the controls applied to each (Phase 2, "APIs and server actions").
- Systematic input-validation review — many server actions use zod, coverage is not verified to be complete.
- CSV/formula injection review (F-10).
- File-upload validation review (contracts, CVs, IR screenshots) — magic-byte checks exist for screenshots; not verified for the others.
- Full CSP with an allowlist (F-08).
- Automated security tests (Phase 4) — **the repo currently has no test suite at all.** This is the single biggest gap in the audit: none of the RBAC guarantees above are regression-protected.
- Authenticated production testing with a dedicated test account (Phase 5).

**Verdict: not production-ready in the audit sense** — not because a known
Critical remains open (none do), but because Phase 4 has not run. The
application is *safe to deploy* (§7); it is not *verified* against regression.
