"use client";

import { useState, useTransition } from "react";
import { Mail, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { createOgtExpectationDraft, type OgtMailInput } from "@/server/actions";
import { EMAIL_RE } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
type Day = (typeof DAYS)[number];

interface DayRow {
  days: Day[];
  from: string;
  to: string;
}

type YesNo = "yes" | "no";
type AccommodationType = "Hostel" | "Host Family" | "Private Apartment";

const newDayRow = (): DayRow => ({ days: [], from: "09:00", to: "17:00" });

/** One yes/no logistics select on a labeled grid cell. */
function YesNoField({
  label, value, onChange,
}: {
  label: string;
  value: YesNo;
  onChange: (v: YesNo) => void;
}) {
  return (
    <div className="grid gap-2">
      <Label>{label}</Label>
      <Select value={value} onValueChange={(v) => onChange(v as YesNo)}>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="yes">Yes</SelectItem>
          <SelectItem value="no">No</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

/** OGT "Home Entity Expectation Setting Mail" builder: fill the standardized
 *  fields → a ready-to-review DRAFT lands in YOUR Gmail (like the proposal
 *  emails) — review it there, tweak anything, and hit send yourself. */
export function OgtMailView({ hasGoogle }: { hasGoogle: boolean }) {
  const [pending, startTransition] = useTransition();

  // hosting entity & EP
  const [to, setTo] = useState("");
  const [hostingEntity, setHostingEntity] = useState("");
  const [epName, setEpName] = useState("");
  const [hostLcName, setHostLcName] = useState("");
  const [epId, setEpId] = useState("");
  const [oppId, setOppId] = useState("");

  // opportunity
  const [oppName, setOppName] = useState("");
  const [slotStart, setSlotStart] = useState("");
  const [slotEnd, setSlotEnd] = useState("");
  const [workingHours, setWorkingHours] = useState("");
  const [dayRows, setDayRows] = useState<DayRow[]>([newDayRow()]);
  const [daysNote, setDaysNote] = useState("");
  const [salary, setSalary] = useState("");

  // logistics
  const [computer, setComputer] = useState<YesNo>("yes");
  const [accommodation, setAccommodation] = useState<YesNo>("yes");
  const [accommodationCovered, setAccommodationCovered] = useState<YesNo>("yes");
  const [transportation, setTransportation] = useState<YesNo>("yes");
  const [transportationDetail, setTransportationDetail] = useState("");
  const [accommodationType, setAccommodationType] = useState<AccommodationType>("Hostel");
  const [accommodationDetail, setAccommodationDetail] = useState("");
  const [meals, setMeals] = useState("");

  const digitsOnly = (v: string) => v.replace(/\D+/g, "");

  const toggleDay = (rowIdx: number, day: Day) =>
    setDayRows((rows) =>
      rows.map((r, i) =>
        i === rowIdx
          ? {
              ...r,
              days: r.days.includes(day)
                ? r.days.filter((d) => d !== day)
                : [...r.days, day],
            }
          : r
      )
    );

  const setRowTime = (rowIdx: number, key: "from" | "to", value: string) =>
    setDayRows((rows) => rows.map((r, i) => (i === rowIdx ? { ...r, [key]: value } : r)));

  const removeRow = (rowIdx: number) =>
    setDayRows((rows) => (rows.length > 1 ? rows.filter((_, i) => i !== rowIdx) : rows));

  const rowLine = (r: DayRow) => {
    const days = DAYS.filter((d) => r.days.includes(d));
    return days.length > 0 && r.from && r.to ? `${days.join(", ")}: ${r.from}–${r.to}` : null;
  };

  const needsTransportDetail = transportation === "no";
  const needsAccommodationDetail =
    accommodationType === "Hostel" || accommodationType === "Private Apartment";

  const firstProblem = (): string | null => {
    if (to.trim() && !EMAIL_RE.test(to.trim()))
      return "That hosting-entity email doesn't look valid (or leave it empty).";
    if (!hostingEntity.trim()) return "Which hosting entity? (\"Dear AIESEC in ___\")";
    if (!epName.trim()) return "The EP name is required.";
    if (!hostLcName.trim()) return "The host LC name is required.";
    if (!/^\d+$/.test(epId)) return "EP ID must be digits only.";
    if (!/^\d+$/.test(oppId)) return "OPP ID must be digits only.";
    if (!oppName.trim()) return "The opportunity name is required.";
    if (!slotStart) return "Pick the slot start date.";
    if (!slotEnd) return "Pick the slot end date.";
    if (slotEnd < slotStart) return "The slot end date can't be before its start date.";
    if (!workingHours.trim()) return "The working hours are required.";
    if (dayRows.some((r) => r.days.length === 0))
      return "Every working-days row needs at least one day picked.";
    if (dayRows.some((r) => !r.from || !r.to))
      return "Every working-days row needs both times.";
    if (needsTransportDetail && !transportationDetail.trim())
      return "Transportation isn't provided — describe the daily cost, duration & method.";
    if (needsAccommodationDetail && !accommodationDetail.trim())
      return `${accommodationType} — specify the EPs per room & bathroom situation.`;
    if (!meals.trim()) return "Meals Provided is required (write \"None\" if none).";
    return null;
  };

  const submit = () => {
    const problem = firstProblem();
    if (problem) {
      toast.error(problem);
      return;
    }
    const input: OgtMailInput = {
      to: to.trim() || null,
      hostingEntity: hostingEntity.trim(),
      epName: epName.trim(),
      hostLcName: hostLcName.trim(),
      epId,
      oppId,
      oppName: oppName.trim(),
      slotStart,
      slotEnd,
      workingHours: workingHours.trim(),
      workingDays: dayRows.map((r) => ({
        days: DAYS.filter((d) => r.days.includes(d)),
        from: r.from,
        to: r.to,
      })),
      workingDaysNote: daysNote.trim() || null,
      salary: salary.trim() || null,
      computerProvided: computer === "yes",
      accommodationProvided: accommodation === "yes",
      accommodationCovered: accommodationCovered === "yes",
      transportationProvided: transportation === "yes",
      transportationDetail: transportationDetail.trim() || null,
      accommodationType,
      accommodationTypeDetail: accommodationDetail.trim() || null,
      mealsProvided: meals.trim(),
    };
    startTransition(async () => {
      const res = await createOgtExpectationDraft(input);
      if (res.ok) {
        toast.success(
          "Draft created! Open your Gmail Drafts to review it and hit send yourself. 💙"
        );
      } else {
        toast.error(res.error);
      }
    });
  };

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h1 className="text-2xl font-bold">
          OGT mail<span className="text-primary">.</span>
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          The Home Entity <b>Expectation Setting Mail</b> — fill it once, and a
          ready-to-review <b>draft</b> lands in <b>your own Gmail</b>. Review,
          adjust anything, and send it yourself before approving the EP.
        </p>
        {!hasGoogle ? (
          <p className="mt-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            Your Google access is missing — sign out, then sign in with Google
            once so Sodio can place drafts in your Gmail.
          </p>
        ) : null}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Hosting entity &amp; EP</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label>Hosting entity email (optional)</Label>
              <Input
                type="email"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                placeholder="Set as the draft's To — or add it in Gmail"
              />
            </div>
            <div className="grid gap-2">
              <Label>Hosting entity — &ldquo;Dear AIESEC in ___&rdquo;</Label>
              <Input
                value={hostingEntity}
                onChange={(e) => setHostingEntity(e.target.value)}
                placeholder="e.g. Cairo University"
              />
            </div>
            <div className="grid gap-2">
              <Label>EP name</Label>
              <Input value={epName} onChange={(e) => setEpName(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label>Host LC — &ldquo;an opportunity with AIESEC in ___&rdquo;</Label>
              <Input value={hostLcName} onChange={(e) => setHostLcName(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label>EP ID</Label>
              <Input
                inputMode="numeric"
                value={epId}
                onChange={(e) => setEpId(digitsOnly(e.target.value))}
                placeholder="Digits only"
              />
            </div>
            <div className="grid gap-2">
              <Label>OPP ID</Label>
              <Input
                inputMode="numeric"
                value={oppId}
                onChange={(e) => setOppId(digitsOnly(e.target.value))}
                placeholder="Digits only"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Opportunity</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-2">
            <Label>Opportunity name</Label>
            <Input value={oppName} onChange={(e) => setOppName(e.target.value)} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label>Slot start date</Label>
              <Input
                type="date"
                value={slotStart}
                onChange={(e) => setSlotStart(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label>Slot end date</Label>
              <Input type="date" value={slotEnd} onChange={(e) => setSlotEnd(e.target.value)} />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label>Working hours</Label>
              <Input
                value={workingHours}
                onChange={(e) => setWorkingHours(e.target.value)}
                placeholder="e.g. 6 hours/day"
              />
            </div>
            <div className="grid gap-2">
              <Label>Salary (if any)</Label>
              <Input
                value={salary}
                onChange={(e) => setSalary(e.target.value)}
                placeholder="Left empty → N/A"
              />
            </div>
          </div>

          <div className="grid gap-2">
            <Label>Working days</Label>
            <p className="text-xs text-muted-foreground">
              Different days can have different intervals — add a row per
              interval (e.g. Mon–Thu 09:00–17:00, then Sat 10:00–14:00).
            </p>
            <div className="grid gap-3">
              {dayRows.map((row, i) => (
                <div key={i} className="rounded-lg border p-3">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {DAYS.map((d) => {
                      const on = row.days.includes(d);
                      return (
                        <button
                          key={d}
                          type="button"
                          aria-pressed={on}
                          onClick={() => toggleDay(i, d)}
                          className={`rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                            on
                              ? "border-primary bg-primary text-primary-foreground"
                              : "bg-background text-muted-foreground hover:border-primary/50"
                          }`}
                        >
                          {d}
                        </button>
                      );
                    })}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Input
                      type="time"
                      className="w-32"
                      value={row.from}
                      onChange={(e) => setRowTime(i, "from", e.target.value)}
                    />
                    <span className="text-sm text-muted-foreground">to</span>
                    <Input
                      type="time"
                      className="w-32"
                      value={row.to}
                      onChange={(e) => setRowTime(i, "to", e.target.value)}
                    />
                    {dayRows.length > 1 ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="ml-auto text-muted-foreground"
                        onClick={() => removeRow(i)}
                      >
                        <X className="size-4" />
                        <span className="sr-only">Remove this interval</span>
                      </Button>
                    ) : null}
                  </div>
                  {rowLine(row) ? (
                    <p className="mt-2 text-xs text-muted-foreground">
                      In the email: <b>{rowLine(row)}</b>
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-fit"
              onClick={() => setDayRows((rows) => [...rows, newDayRow()])}
            >
              <Plus className="size-4" /> Add another interval
            </Button>
          </div>
          <div className="grid gap-2">
            <Label>Working-days note (optional)</Label>
            <Input
              value={daysNote}
              onChange={(e) => setDaysNote(e.target.value)}
              placeholder="e.g. Saturday is on the weekend"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Logistics</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <YesNoField label="Computer provided" value={computer} onChange={setComputer} />
            <YesNoField
              label="Accommodation provided"
              value={accommodation}
              onChange={setAccommodation}
            />
            <YesNoField
              label="Accommodation covered"
              value={accommodationCovered}
              onChange={setAccommodationCovered}
            />
            <YesNoField
              label="Transportation provided"
              value={transportation}
              onChange={setTransportation}
            />
          </div>
          {needsTransportDetail ? (
            <div className="grid gap-2">
              <Label>Transportation — daily cost, duration &amp; method</Label>
              <Textarea
                rows={2}
                value={transportationDetail}
                onChange={(e) => setTransportationDetail(e.target.value)}
                placeholder="e.g. ~40 EGP/day, 45 min by metro + bus"
              />
            </div>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label>Accommodation type</Label>
              <Select
                value={accommodationType}
                onValueChange={(v) => setAccommodationType(v as AccommodationType)}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Hostel">Hostel</SelectItem>
                  <SelectItem value="Host Family">Host Family</SelectItem>
                  <SelectItem value="Private Apartment">Private Apartment</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Meals provided</Label>
              <Input
                value={meals}
                onChange={(e) => setMeals(e.target.value)}
                placeholder="e.g. 2 meals/day — or None"
              />
            </div>
          </div>
          {needsAccommodationDetail ? (
            <div className="grid gap-2">
              <Label>{accommodationType} — EPs per room &amp; bathroom</Label>
              <Textarea
                rows={2}
                value={accommodationDetail}
                onChange={(e) => setAccommodationDetail(e.target.value)}
                placeholder="e.g. 3 EPs per room, shared bathroom per 2 rooms"
              />
            </div>
          ) : null}
        </CardContent>
      </Card>

      <div className="flex items-center gap-3">
        <Button onClick={submit} disabled={pending}>
          <Mail className="size-4" />
          {pending ? "Creating the draft…" : "Create the Gmail draft"}
        </Button>
        <p className="text-xs text-muted-foreground">
          Nothing is sent automatically — you review &amp; send from Gmail.
        </p>
      </div>
    </div>
  );
}
