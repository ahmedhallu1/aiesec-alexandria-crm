"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { CalendarPlus, ChevronDown, Loader2, Users, Video } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { createTouchPoint, previewTouchPointAudience } from "@/server/touch-points";
import {
  TOUCH_POINT_SCOPE_RULE,
  touchPointOptions,
} from "@/lib/touch-points";
import {
  NO_WORKING_HOURS_FUNCTIONS, touchPointLabel,
  type TouchPointKind, type TouchPointScope,
  cairoToday,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import { AudiencePicker } from "./audience-picker";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

/** Today in Cairo — used to tell "booking ahead" apart from "logging
 *  something that already happened" (v31: past dates are pickable again). */
const cairoTodayIso = cairoToday;

/** "HH:MM" right now in Cairo (h23 so midnight is 00:00, never 24:00). */
const cairoNowHm = () =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Cairo", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(new Date());

const isPastCairoTime = (t: string) => !!t && t < cairoNowHm();

/** Book a touch point (v29): pick the type your role allows, set the START
 *  time (there is no end), add a note, and optionally pull in sibling teams
 *  or another function. Everyone invited gets an email + a bell — unless the
 *  booker switches that off, or the start time is already past (v31: that's a
 *  touch point being LOGGED after the fact, and it never notifies anyone). */
/** WHERE THE AUDIENCE STARTS FROM — the pool the guest list is picked out of
 *  (v33.35). Not what the touch point is CALLED. */
const SCOPE_LABEL: Record<TouchPointScope, string> = {
  team: "My team",
  function: "My function",
  lc: "The whole LC",
};

export function TouchPointDialog({
  scopes, functions, teams, myTeam, siblingTeams, otherFunctions,
  defaultDate, open: openProp, onOpenChange,
}: {
  /** what this viewer may book (from rbac's bookableTouchPointScopes) */
  scopes: TouchPointScope[];
  /** the viewer's own functions — the picker when they hold several */
  functions: string[];
  /** the teams of the viewer's function(s), for a VP booking a team point */
  teams: string[];
  myTeam: string | null;
  siblingTeams: string[];
  otherFunctions: string[];
  /** pre-fill the Date field (Cairo YYYY-MM-DD) — the calendar's day panel
   *  books straight onto the day you clicked. Read once, on mount: give the
   *  element a `key` when the day changes. */
  defaultDate?: string;
  /** CONTROLLED mode (optional): the parent owns the open state AND the
   *  trigger, so the built-in button is not rendered. Omit both props and the
   *  dialog stays fully standalone, exactly as before. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const router = useRouter();
  const controlled = openProp !== undefined;
  const [selfOpen, setSelfOpen] = useState(false);
  const open = controlled ? openProp : selfOpen;
  const setOpen = (v: boolean) => {
    if (!controlled) setSelfOpen(v);
    onOpenChange?.(v);
  };
  const [pending, start] = useTransition();
  const options = touchPointOptions(scopes);
  // v33.35 — the KIND and the starting SCOPE are two questions, not one fused
  // label ("Function meeting"). Both default to this role's first option.
  const scopeChoices = [...new Set(options.map((o) => o.scope))];
  const kindChoices = [...new Set(options.map((o) => o.kind))];
  const [scope, setScope] = useState<TouchPointScope>(options[0]?.scope ?? "team");
  const [kind, setKind] = useState<TouchPointKind>(options[0]?.kind ?? "meeting");
  const pickedLabel = touchPointLabel(scope, kind);
  const [fn, setFn] = useState(functions[0] ?? "");
  const [team, setTeam] = useState(myTeam ?? teams[0] ?? "");
  const [date, setDate] = useState(defaultDate ?? "");
  const [time, setTime] = useState("18:00");
  const [note, setNote] = useState("");
  // v33.43 — where it happens; a virtual meeting's "where" is its Meet link
  const [location, setLocation] = useState("");
  const [invTeams, setInvTeams] = useState<string[]>([]);
  const [invFns, setInvFns] = useState<string[]>([]);
  const [notify, setNotify] = useState(true);
  // VIRTUAL is a MEETING thing only (v33): working hours are people sitting
  // and working, an outing is by definition somewhere — neither has a Meet
  // link, and offering one would just produce empty rooms.
  const [virtual, setVirtual] = useState(false);
  // WHO IS ACTUALLY COMING (v33.34). The scope decides who WOULD be invited;
  // this is where the booker looks at that list and unticks the three people
  // who aren't in the function yet, or the two who already said they can't.
  // Only the ticked people are invited and only they appear on the
  // attendance sheet. Loaded from the server so the preview and the booking
  // can never disagree about who "my function" means.
  const [crew, setCrew] = useState<
    { id: string; name: string; role: string; team: string | null }[]
  >([]);
  /** the audience key whose people are currently in `crew` — "loading" is
   *  DERIVED from it rather than set at the top of the effect, which would be
   *  a synchronous setState inside an effect (a cascading render) */
  const [loadedKey, setLoadedKey] = useState("");
  const [excluded, setExcluded] = useState<string[]>([]);
  const [crewOpen, setCrewOpen] = useState(false);
  const todayIso = cairoTodayIso();
  // a start earlier than right now (Cairo) = logging, not booking. The server
  // decides for real; this only shapes what the dialog promises.
  const logging = !!date && (date < todayIso || (date === todayIso && isPastCairoTime(time)));

  /** the audience key: everything the derived list depends on */
  const audienceKey = JSON.stringify([
    scope, kind, fn, team,
    scope === "team" ? invTeams : [],
    scope === "function" ? invFns : [],
  ]);
  const crewLoading = open && loadedKey !== audienceKey;
  useEffect(() => {
    if (!open) return;
    let alive = true;
    previewTouchPointAudience({
      scope,
      kind,
      functionKey: scope === "lc" ? null : fn,
      teamName: scope === "team" ? team : null,
      invitedTeams: scope === "team" ? invTeams : [],
      invitedFunctions: scope === "function" ? invFns : [],
    })
      .then((res) => {
        if (!alive) return;
        // a refusal here is the same refusal booking would give — show an
        // empty list and let the Book button surface the real message
        setCrew(res.ok && res.data ? res.data.people : []);
        // changing the scope redraws the whole list: an exclusion from the
        // OLD one means nothing against the new
        setExcluded([]);
      })
      .catch(() => alive && setCrew([]))
      // marked loaded either way — a failed preview must not spin forever
      .finally(() => alive && setLoadedKey(audienceKey));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, audienceKey]);

  const invited = useMemo(
    () => crew.filter((m) => !excluded.includes(m.id)),
    [crew, excluded]
  );

  if (options.length === 0) return null;

  const toggle = (list: string[], set: (v: string[]) => void, v: string) =>
    set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const submit = () =>
    start(async () => {
      if (options.length === 0) return;
      if (!date || !time) {
        toast.error("Pick the date and start time.");
        return;
      }
      // the CAIRO wall-clock goes to the server as typed — building a Date
      // here would read the BOOKER's timezone and shift the whole LC
      const res = await createTouchPoint({
        scope,
        kind,
        // (v37.8) the Virtual switch only exists when booking ahead — a logged past meeting is never virtual
        virtual: kind === "meeting" && !logging ? virtual : false,
        functionKey: scope === "lc" ? null : fn,
        teamName: scope === "team" ? team : null,
        date,
        time,
        note: note || null,
        location: location || null,
        invitedTeams: scope === "team" ? invTeams : [],
        invitedFunctions: scope === "function" ? invFns : [],
        // omitted when nothing was unticked, so the audience stays DERIVED
        // and keeps picking up people who join the function later
        memberIds: excluded.length > 0 ? invited.map((m) => m.id) : undefined,
        notify,
      });
      if (res.ok) {
        // the SERVER decides whether anyone was told (a past start always
        // means nobody was) — report what actually happened, not what we hoped
        toast.success(
          res.data?.announced
            ? `${pickedLabel} booked — everyone invited just heard about it 📣`
            : `${pickedLabel} saved quietly — nobody was notified. Attendance is yours to record.`
        );
        setOpen(false);
        setNote("");
        setInvTeams([]);
        setInvFns([]);
        setExcluded([]);
        setNotify(true);
        router.refresh();
      } else toast.error(res.error);
    });

  const noWorkingHours =
    kind === "working_hours" &&
    scope !== "lc" &&
    NO_WORKING_HOURS_FUNCTIONS.includes(fn);

  return (
    <>
      {controlled ? null : (
        <Button size="sm" onClick={() => setOpen(true)}>
          <CalendarPlus className="size-4" /> Book a touch point
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Book a touch point</DialogTitle>
            <DialogDescription>
              Meetings, working hours and outings. Everyone invited gets an
              email and a bell — attendance is taken afterwards. Put a past
              date to log one that already happened; that one stays silent.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3">
            {/* WHAT IT IS — just the kind (v33.35). It used to read "Team
                meeting / Function meeting / LC meeting", which stopped being
                true the moment the audience became a list you pick: a
                "function meeting" is routinely six people out of thirty. The
                kind is the name; WHO is coming is the next question. */}
            <div className="grid gap-1.5">
              <Label>What is it?</Label>
              <div className="flex flex-wrap gap-1.5">
                {kindChoices.map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setKind(k)}
                    className={cn(
                      "rounded-full border px-3 py-1 text-xs font-semibold transition-colors",
                      kind === k
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-muted text-muted-foreground hover:border-primary/50"
                    )}
                  >
                    {touchPointLabel("team", k)}
                  </button>
                ))}
              </div>
            </div>

            {/* WHO IT STARTS FROM — the scopes this role may book. It is the
                starting pool, not the final list: the guest list below is
                where it gets narrowed. */}
            {scopeChoices.length > 1 ? (
              <div className="grid gap-1.5">
                <Label>Start from</Label>
                <div className="flex flex-wrap gap-1.5">
                  {scopeChoices.map((sc) => (
                    <button
                      key={sc}
                      type="button"
                      onClick={() => setScope(sc)}
                      className={cn(
                        "rounded-full border px-3 py-1 text-xs font-semibold transition-colors",
                        scope === sc
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border bg-muted text-muted-foreground hover:border-primary/50"
                      )}
                    >
                      {SCOPE_LABEL[sc]}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {TOUCH_POINT_SCOPE_RULE[scope]} You pick exactly who comes below.
                </p>
              </div>
            ) : (
              <p className="-mt-1 text-[11px] text-muted-foreground">
                {TOUCH_POINT_SCOPE_RULE[scope]} You pick exactly who comes below.
              </p>
            )}

            {scope !== "lc" && functions.length > 1 ? (
              <div className="grid gap-1.5">
                <Label>Function</Label>
                <Select value={fn} onValueChange={setFn}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {functions.map((f) => (
                      <SelectItem key={f} value={f}>{f}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}

            {scope === "team" && teams.length > 0 ? (
              <div className="grid gap-1.5">
                <Label>Team</Label>
                <Select value={team} onValueChange={setTeam}>
                  <SelectTrigger><SelectValue placeholder="Pick the team" /></SelectTrigger>
                  <SelectContent>
                    {[...new Set([...(myTeam ? [myTeam] : []), ...teams])].map((t) => (
                      <SelectItem key={t} value={t}>{t}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}

            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label>Date *</Label>
                {/* v31: NO `min` — a past date is how you log a touch point
                    that already happened (and it notifies nobody) */}
                <Input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
                <p className="text-[11px] text-muted-foreground">
                  Past date = logging one that already happened.
                </p>
              </div>
              <div className="grid gap-1.5">
                <Label>Starts at *</Label>
                <Input
                  type="time"
                  step={900}
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                />
              </div>
            </div>

            {!(kind === "meeting" && virtual && !logging) ? (
              <div className="grid gap-1.5">
                <Label>Where (optional)</Label>
                <Input
                  dir="auto"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="The office, third floor · the café on Fouad St…"
                  maxLength={160}
                />
              </div>
            ) : null}

            <div className="grid gap-1.5">
              <Label>Note (optional)</Label>
              <Textarea
                dir="auto"
                rows={2}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Agenda, anything they should know…"
                maxLength={500}
              />
            </div>

            {scope === "team" && siblingTeams.length > 0 ? (
              <div className="grid gap-1.5">
                <Label>Invite other teams (optional)</Label>
                <div className="flex flex-wrap gap-1.5">
                  {siblingTeams.map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => toggle(invTeams, setInvTeams, t)}
                      className={cn(
                        "rounded-full border px-2.5 py-1 text-xs transition-colors",
                        invTeams.includes(t)
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border text-muted-foreground hover:border-primary/50"
                      )}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {scope === "function" && otherFunctions.length > 0 ? (
              <div className="grid gap-1.5">
                <Label>Invite another function (optional)</Label>
                <div className="flex flex-wrap gap-1.5">
                  {otherFunctions.map((f) => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => toggle(invFns, setInvFns, f)}
                      className={cn(
                        "rounded-full border px-2.5 py-1 text-xs transition-colors",
                        invFns.includes(f)
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border text-muted-foreground hover:border-primary/50"
                      )}
                    >
                      {f}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {/* WHO IS COMING (v33.34) — the derived list, ticked, with the
                right to untick. Collapsed by default because the common case
                is "everyone"; the count and the word "customise" are the
                affordance. */}
            {options.length > 0 ? (
              <div className="grid gap-1.5 rounded-lg border border-border p-3">
                <button
                  type="button"
                  onClick={() => setCrewOpen((v) => !v)}
                  className="flex items-center justify-between gap-2 text-left"
                >
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5 text-sm font-medium">
                      <Users className="size-4" />
                      Who&apos;s invited
                      <span className="rounded-full bg-primary/10 px-1.5 text-xs font-bold text-primary">
                        {crewLoading ? "…" : invited.length}
                      </span>
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {crewLoading
                        ? "Working out who this reaches…"
                        : excluded.length > 0
                          ? `${excluded.length} left out — only the ticked people are invited and only they appear on the attendance sheet.`
                          : "Everyone this reaches. Tap to untick anyone who shouldn't be counted."}
                    </span>
                  </span>
                  <ChevronDown
                    className={cn(
                      "size-4 shrink-0 text-muted-foreground transition-transform",
                      crewOpen && "rotate-180"
                    )}
                  />
                </button>

                {crewOpen ? (
                  <div className="border-t pt-2">
                    <AudiencePicker
                      people={crew}
                      excluded={excluded}
                      onChange={setExcluded}
                      loading={crewLoading}
                    />
                  </div>
                ) : null}
              </div>
            ) : null}

            {kind === "meeting" && !logging ? (
              <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 text-sm font-medium">
                    <Video className="size-4" /> Virtual meeting
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {virtual
                      ? "Everyone gets a Google Calendar invite with a Meet link — and their Yes/No on it pre-fills the attendance."
                      : "Sends a Google Meet invite and takes attendance from everyone's RSVP."}
                  </p>
                </div>
                <Switch checked={virtual} onCheckedChange={setVirtual} />
              </div>
            ) : null}

            {/* v31: notifying is the DEFAULT, not the law — and a touch point
                whose start time already passed is a log, so it never speaks */}
            <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">Tell everyone invited</p>
                <p className="text-xs text-muted-foreground">
                  {logging
                    ? "Off — that start time already passed, so this is logged, not announced. Attendance still gets taken."
                    : notify
                      ? "An email and a bell go out to everyone invited."
                      : "Nobody hears about it — it just appears on the calendar."}
                </p>
              </div>
              <Switch
                checked={notify && !logging}
                onCheckedChange={setNotify}
                disabled={logging}
              />
            </div>

            {noWorkingHours ? (
              <p className="text-xs text-destructive">
                {fn} doesn&apos;t run working hours — pick a meeting or an outing.
              </p>
            ) : null}
          </div>

          <DialogFooter>
            <Button onClick={submit} disabled={pending || !date || noWorkingHours}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : <CalendarPlus className="size-4" />}
              {logging ? "Log it" : "Book it"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
