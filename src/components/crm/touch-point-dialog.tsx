"use client";

import { useState, useTransition } from "react";
import { CalendarPlus, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { createTouchPoint } from "@/server/touch-points";
import {
  TOUCH_POINT_SCOPE_RULE,
  touchPointOptions,
  type TouchPointOption,
} from "@/lib/touch-points";
import { NO_WORKING_HOURS_FUNCTIONS, type TouchPointScope } from "@/lib/types";
import { cn } from "@/lib/utils";
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

/** Today in Cairo — used to tell "booking ahead" apart from "logging something
 *  that already happened" (v31: past dates are pickable again). */
const cairoTodayIso = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());

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
  const [picked, setPicked] = useState<TouchPointOption | null>(options[0] ?? null);
  const [fn, setFn] = useState(functions[0] ?? "");
  const [team, setTeam] = useState(myTeam ?? teams[0] ?? "");
  const [date, setDate] = useState(defaultDate ?? "");
  const [time, setTime] = useState("18:00");
  const [note, setNote] = useState("");
  const [invTeams, setInvTeams] = useState<string[]>([]);
  const [invFns, setInvFns] = useState<string[]>([]);
  const [notify, setNotify] = useState(true);
  const todayIso = cairoTodayIso();
  // a start earlier than right now (Cairo) = logging, not booking. The server
  // decides for real; this only shapes what the dialog promises.
  const logging = !!date && (date < todayIso || (date === todayIso && isPastCairoTime(time)));

  if (options.length === 0) return null;

  const toggle = (list: string[], set: (v: string[]) => void, v: string) =>
    set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const submit = () =>
    start(async () => {
      if (!picked) return;
      if (!date || !time) {
        toast.error("Pick the date and start time.");
        return;
      }
      // the CAIRO wall-clock goes to the server as typed — building a Date
      // here would read the BOOKER's timezone and shift the whole LC
      const res = await createTouchPoint({
        scope: picked.scope,
        kind: picked.kind,
        functionKey: picked.scope === "lc" ? null : fn,
        teamName: picked.scope === "team" ? team : null,
        date,
        time,
        note: note || null,
        invitedTeams: picked.scope === "team" ? invTeams : [],
        invitedFunctions: picked.scope === "function" ? invFns : [],
        notify,
      });
      if (res.ok) {
        // the SERVER decides whether anyone was told (a past start always
        // means nobody was) — report what actually happened, not what we hoped
        toast.success(
          res.data?.announced
            ? `${picked.label} booked — everyone invited just heard about it 📣`
            : `${picked.label} saved quietly — nobody was notified. Attendance is yours to record.`
        );
        setOpen(false);
        setNote("");
        setInvTeams([]);
        setInvFns([]);
        setNotify(true);
        router.refresh();
      } else toast.error(res.error);
    });

  const noWorkingHours =
    picked?.kind === "working_hours" &&
    picked.scope !== "lc" &&
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
            <div className="grid gap-1.5">
              <Label>Type</Label>
              <div className="flex flex-wrap gap-1.5">
                {options.map((o) => (
                  <button
                    key={`${o.scope}-${o.kind}`}
                    type="button"
                    onClick={() => setPicked(o)}
                    className={cn(
                      "rounded-full border px-3 py-1 text-xs font-semibold transition-colors",
                      picked?.scope === o.scope && picked?.kind === o.kind
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-muted text-muted-foreground hover:border-primary/50"
                    )}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
              {/* the picker only ever offers this viewer's OWN scope (v29.3:
                  Team Leader → team · VP/Director → function · TM → LC), so
                  say which one it is instead of leaving them guessing */}
              {picked ? (
                <p className="text-[11px] text-muted-foreground">
                  {TOUCH_POINT_SCOPE_RULE[picked.scope]}
                </p>
              ) : null}
            </div>

            {picked && picked.scope !== "lc" && functions.length > 1 ? (
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

            {picked?.scope === "team" && teams.length > 0 ? (
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

            <div className="grid gap-1.5">
              <Label>Note (optional)</Label>
              <Textarea
                dir="auto"
                rows={2}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Agenda, place, anything they should know…"
                maxLength={500}
              />
            </div>

            {picked?.scope === "team" && siblingTeams.length > 0 ? (
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

            {picked?.scope === "function" && otherFunctions.length > 0 ? (
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
            <Button onClick={submit} disabled={pending || !picked || !date || noWorkingHours}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : <CalendarPlus className="size-4" />}
              {logging ? "Log it" : "Book it"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
