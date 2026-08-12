/** FUNCTION DEFAULTS (v33.32) — the shape, and what it means when unset.
 *
 *  Every value here used to be a constant somewhere in the code. Moving them
 *  to the function's own leader only works if the DEFAULTS are exactly the old
 *  behaviour: an LC that never opens this card must not notice it exists.
 *  So `resolveFunctionSettings` is written against what shipped before, and a
 *  stored row only ever overrides a key it actually carries.
 *
 *  Pure — no DB, no server imports — so the reader (server/function-settings),
 *  the profile card and the tests all agree on one source of truth.
 */

import { PODIO_UPDATE_DEFAULT_DAYS } from "./types";

/** Which functions have defaults worth setting. Keyed by the string the
 *  membership sheet uses, so a leader's own Function cell resolves directly. */
export const SETTABLE_FUNCTIONS = [
  "IGV", "IGT", "B2B", "BD", "B2C", "OGT", "OGV", "TM",
] as const;
export type SettableFunction = (typeof SETTABLE_FUNCTIONS)[number];

export function isSettableFunction(fn: string): fn is SettableFunction {
  return (SETTABLE_FUNCTIONS as readonly string[]).includes(fn);
}

/** The RAISING functions — the ones that hold accounts. */
const RAISING = new Set(["IGV", "IGT", "B2B", "BD", "B2C"]);
const OGX = new Set(["OGT", "OGV"]);

export interface FunctionSettings {
  // ---------------- accounts & Podio (raising functions)
  /** new accounts in this function start on the Podio continuous-update cycle */
  podioUpdateDefault: boolean;
  /** how many days between updates — 1..90 */
  podioUpdateDays: number;
  /** the function-wide "visit booked" announcement email ALSO reaches the
   *  LCVP/Directors (they always ride the calendar invite regardless) —
   *  off by default since v33.38 */
  visitAnnounceLeaders: boolean;

  // ---------------- consideration (IGV / IGT)
  /** an MM (Team Leader) may hand 🤝 partnership targets to members of OTHER
   *  teams, not only their own — off by default (v33.39) */
  partnershipCrossTeam: boolean;

  // ---------------- who sees what (per role, read-only widening)
  /** plain Members may OPEN every account/sign-up in the function */
  seeAllMembers: boolean;
  /** Coordinators may */
  seeAllCoordinators: boolean;
  /** Team Leaders may (beyond their own team) */
  seeAllTeamLeaders: boolean;

  // ---------------- OGX
  /** members may CLAIM a sign-up out of the unassigned pool themselves */
  poolClaimOpen: boolean;
  /** the CIC second-call queue is in use */
  cicEnabled: boolean;
  /** who may add an organic referral: the whole function, or MMs and above */
  referralsBy: "everyone" | "mms";
  /** the daily streak nag email */
  streakNags: boolean;

  // ---------------- TM
  /** the attendance-reminder ladder runs for this function's touch points */
  attendanceReminders: boolean;
  /** working-hours attendance is pre-filled automatically from real work */
  workingHoursAuto: boolean;
  /** this function is judged on working hours at all */
  workingHoursJudged: boolean;
}

/** THE BUILT-IN BEHAVIOUR, per function — what the code did before 0054. */
export function functionDefaults(fn: string): FunctionSettings {
  return {
    // createAccount's old rule, verbatim: IGV/B2C/BD started ON, IGT/B2B OFF
    podioUpdateDefault: ["IGV", "B2C", "BD"].includes(fn),
    podioUpdateDays: PODIO_UPDATE_DEFAULT_DAYS,
    visitAnnounceLeaders: false,
    partnershipCrossTeam: false,
    seeAllMembers: false,
    seeAllCoordinators: false,
    seeAllTeamLeaders: false,
    poolClaimOpen: true,
    cicEnabled: true,
    referralsBy: "everyone",
    streakNags: true,
    attendanceReminders: true,
    workingHoursAuto: true,
    workingHoursJudged: true,
  };
}

/** Merge a stored blob over the defaults, dropping anything malformed. A row
 *  is written by our own form, but it is JSONB in a database people can edit. */
export function resolveFunctionSettings(
  fn: string,
  stored: unknown
): FunctionSettings {
  const base = functionDefaults(fn);
  if (!stored || typeof stored !== "object") return base;
  const s = stored as Record<string, unknown>;
  const bool = (k: keyof FunctionSettings) =>
    typeof s[k] === "boolean" ? (s[k] as boolean) : (base[k] as boolean);
  const days = Number(s.podioUpdateDays);
  return {
    podioUpdateDefault: bool("podioUpdateDefault"),
    podioUpdateDays:
      Number.isFinite(days) && days >= 1 && days <= 90
        ? Math.round(days)
        : base.podioUpdateDays,
    visitAnnounceLeaders: bool("visitAnnounceLeaders"),
    partnershipCrossTeam: bool("partnershipCrossTeam"),
    seeAllMembers: bool("seeAllMembers"),
    seeAllCoordinators: bool("seeAllCoordinators"),
    seeAllTeamLeaders: bool("seeAllTeamLeaders"),
    poolClaimOpen: bool("poolClaimOpen"),
    cicEnabled: bool("cicEnabled"),
    referralsBy: s.referralsBy === "mms" ? "mms" : base.referralsBy,
    streakNags: bool("streakNags"),
    attendanceReminders: bool("attendanceReminders"),
    workingHoursAuto: bool("workingHoursAuto"),
    workingHoursJudged: bool("workingHoursJudged"),
  };
}

/** Which groups of switches apply to a function — the card only renders what
 *  the function actually does, so a TM leader is never shown a Podio cadence. */
export function settingGroupsFor(fn: string): {
  accounts: boolean;
  visibility: boolean;
  ogx: boolean;
  tm: boolean;
} {
  return {
    accounts: RAISING.has(fn),
    // "who sees what" is about a pool of work — accounts or sign-ups
    visibility: RAISING.has(fn) || OGX.has(fn),
    ogx: OGX.has(fn),
    tm: fn === "TM",
  };
}

/** Does this function's leader let ROLE see the whole function read-only? */
export function opensViewTo(s: FunctionSettings, role: string): boolean {
  if (role === "Member") return s.seeAllMembers;
  if (role === "Coordinator") return s.seeAllCoordinators;
  if (role === "Team Leader") return s.seeAllTeamLeaders;
  return false;
}
