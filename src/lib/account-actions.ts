import { cairoToday, podioDefaultDays, type AccountFunction } from "@/lib/types";

/** WHAT THIS ACCOUNT IS WAITING FOR.
 *
 *  The accounts list already carries every signal it needs to answer "does
 *  this row need me?" — a visit whose date has passed with no report, a Podio
 *  refresh that has come due, a missing next step, three unanswered attempts.
 *  Before this they were scattered across emails, the bell, and a filter you
 *  had to know to apply, so a row that needed work looked exactly like one
 *  that didn't.
 *
 *  Pure and shared: the dot on the list, the tooltip that explains it, and any
 *  future filter all read the SAME rules. */

export type AccountActionKind =
  | "visit_report"
  | "podio_update"
  /** retired from the dot in v34.6 — kept so old callers still typecheck */
  | "podio_check"
  | "next_step"
  | "no_response";

/** The dot's colour is the KIND, not a generic urgency flag — a visit nobody
 *  reported is a different problem from a Podio refresh coming due, and the
 *  floor reads them as different problems. red = something is wrong now,
 *  amber = it is due, muted = a background nudge. */
export type ActionTone = "red" | "amber" | "muted";

export interface AccountAction {
  kind: AccountActionKind;
  /** what the member should do, in their words */
  label: string;
  tone: ActionTone;
}

const TONE_RANK: Record<ActionTone, number> = { red: 0, amber: 1, muted: 2 };

/** The loudest tone among the open actions — that is the dot you see. */
export function worstTone(actions: AccountAction[]): ActionTone {
  return actions.reduce<ActionTone>(
    (worst, a) => (TONE_RANK[a.tone] < TONE_RANK[worst] ? a.tone : worst),
    "muted"
  );
}

/** Only the fields we actually read — so list rows, detail rows and tests can
 *  all be passed straight in. */
export interface ActionableAccount {
  function: AccountFunction;
  out_of_process: boolean;
  stage?: string | null;
  visit_id?: string | null;
  visit_date?: string | null;
  visit_done?: boolean | null;
  next_step_missing?: boolean;
  no_response_attempts?: number;
  requested_podio?: boolean;
  request_state?: string | null;
  responsible_id?: string | null;
  podio_update_enabled?: boolean;
  podio_update_every_days?: number | null;
  podio_updated_at?: string | null;
  created_at?: string;
}

const DAY_MS = 86_400_000;

/** The day a Podio refresh falls due, as YYYY-MM-DD, or null when the account
 *  is not on the cycle. Mirrors the podio-updates cron's arithmetic. */
export function podioDueDay(a: ActionableAccount): string | null {
  if (!a.podio_update_enabled) return null;
  const anchorIso = a.podio_updated_at ?? a.created_at;
  if (!anchorIso) return null;
  const every = a.podio_update_every_days ?? podioDefaultDays(a.function);
  const due = new Date(new Date(anchorIso).getTime() + every * DAY_MS);
  if (Number.isNaN(due.getTime())) return null;
  return due.toISOString().slice(0, 10);
}

export function accountActions(
  a: ActionableAccount,
  today: string = cairoToday()
): AccountAction[] {
  // an archived account is out of the game — it is not waiting for anything
  if (a.out_of_process) return [];
  const out: AccountAction[] = [];

  // a visit whose day has passed and was never reported: the funnel is
  // counting a visit nobody can prove happened
  if (a.visit_id && a.visit_done == null && a.visit_date && a.visit_date < today)
    out.push({ kind: "visit_report", label: "Visit needs a report", tone: "red" });

  const due = podioDueDay(a);
  if (due && due <= today)
    out.push({
      kind: "podio_update",
      label: due < today ? "Podio update overdue" : "Podio update due today",
      tone: "amber",
    });

  // NOT-CHECKED-ON-PODIO IS NOT A DOT (v34.6). It was the muted grey one, and
  // it fired on almost every account — which is the definition of a signal
  // that tells you nothing. The 🔎 "Needs Podio checking" filter is still the
  // queue for that work; the dot is for the things that are actually late.

  if (a.next_step_missing)
    out.push({ kind: "next_step", label: "No next step set", tone: "amber" });

  if ((a.no_response_attempts ?? 0) >= 3)
    out.push({
      kind: "no_response",
      label: "3 unanswered attempts — decide or archive",
      tone: "red",
    });

  return out;
}
