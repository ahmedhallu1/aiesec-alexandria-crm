"use client";

import { useState, useTransition } from "react";
import { CalendarPlus, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { createTouchPoint } from "@/server/touch-points";
import { touchPointOptions, type TouchPointOption } from "@/lib/touch-points";
import { NO_WORKING_HOURS_FUNCTIONS, type TouchPointScope } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

/** Book a touch point (v29): pick the type your role allows, set the START
 *  time (there is no end), add a note, and optionally pull in sibling teams
 *  or another function. Everyone invited gets an email + a bell. */
export function TouchPointDialog({
  scopes, functions, teams, myTeam, siblingTeams, otherFunctions,
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
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const options = touchPointOptions(scopes);
  const [picked, setPicked] = useState<TouchPointOption | null>(options[0] ?? null);
  const [fn, setFn] = useState(functions[0] ?? "");
  const [team, setTeam] = useState(myTeam ?? teams[0] ?? "");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("18:00");
  const [note, setNote] = useState("");
  const [invTeams, setInvTeams] = useState<string[]>([]);
  const [invFns, setInvFns] = useState<string[]>([]);

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
      const startsAt = new Date(`${date}T${time}:00`);
      if (Number.isNaN(startsAt.getTime())) {
        toast.error("That date and time don't look right.");
        return;
      }
      const res = await createTouchPoint({
        scope: picked.scope,
        kind: picked.kind,
        functionKey: picked.scope === "lc" ? null : fn,
        teamName: picked.scope === "team" ? team : null,
        startsAt: startsAt.toISOString(),
        note: note || null,
        invitedTeams: picked.scope === "team" ? invTeams : [],
        invitedFunctions: picked.scope === "function" ? invFns : [],
      });
      if (res.ok) {
        toast.success(`${picked.label} booked — everyone invited just heard about it 📣`);
        setOpen(false);
        setNote("");
        setInvTeams([]);
        setInvFns([]);
        router.refresh();
      } else toast.error(res.error);
    });

  const noWorkingHours =
    picked?.kind === "working_hours" &&
    picked.scope !== "lc" &&
    NO_WORKING_HOURS_FUNCTIONS.includes(fn);

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <CalendarPlus className="size-4" /> Book a touch point
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Book a touch point</DialogTitle>
            <DialogDescription>
              Meetings, working hours and outings. Everyone invited gets an
              email and a bell — attendance is taken afterwards.
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
                <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
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

            {noWorkingHours ? (
              <p className="text-xs text-destructive">
                {fn} doesn&apos;t run working hours — pick a meeting or an outing.
              </p>
            ) : null}
          </div>

          <DialogFooter>
            <Button onClick={submit} disabled={pending || !picked || !date || noWorkingHours}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : <CalendarPlus className="size-4" />}
              Book it
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
