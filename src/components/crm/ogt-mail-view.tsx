"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { ArrowLeft, Eye, Mail, Plus, Send, X } from "lucide-react";
import { toast } from "sonner";
import {
  createOgtExpectationDraft,
  previewOgtExpectationMail,
  sendOgtExpectationMail,
  type OgtMailInput,
} from "@/server/actions";
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

type Program = "OGT" | "OGV";

/** the fixed CC on every expectation mail — shown read-only so the VP knows */
const FIXED_CC = "customer.support@aiesec.net.eg";

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

/** "Home Entity Expectation Setting Mail" builder for OGT & OGV: fill the
 *  standardized fields → review the EXACT email in-app (subject + body are
 *  editable) → send it from YOUR own Gmail, or save it as a draft instead.
 *  `programs` decides the variant: one entry locks it, two show a toggle. */
export function OgtMailView({
  hasGoogle,
  programs,
  viewerId,
}: {
  hasGoogle: boolean;
  programs: Program[];
  viewerId: string;
}) {
  const [pending, startTransition] = useTransition();

  // program variant (OGT = Salary line · OGV = TN Fee line)
  const [variant, setVariant] = useState<Program>(programs[0] ?? "OGT");

  // recipients
  const [toEp, setToEp] = useState("");
  const [toIr, setToIr] = useState("");

  // hosting entity & EP
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
  const [tnFee, setTnFee] = useState("");

  // logistics
  const [computer, setComputer] = useState<YesNo>("yes");
  const [accommodation, setAccommodation] = useState<YesNo>("yes");
  const [accommodationCovered, setAccommodationCovered] = useState<YesNo>("yes");
  const [transportation, setTransportation] = useState<YesNo>("yes");
  const [transportationDetail, setTransportationDetail] = useState("");
  const [accommodationType, setAccommodationType] = useState<AccommodationType>("Hostel");
  const [accommodationDetail, setAccommodationDetail] = useState("");
  const [meals, setMeals] = useState("");

  // the built preview survives navigation (v26): everything the review step
  // needs is mirrored to sessionStorage and restored on mount
  // per-viewer key: a shared computer / admin View-As must never leak one
  // person's built email into another's session
  const CACHE_KEY = `sodio-expectation-preview:${viewerId}`;
  // review step: the built email — subject stays editable state, the body is
  // an in-place contentEditable div read back at send time
  const [review, setReview] = useState<{ subject: string; html: string } | null>(null);
  const [subject, setSubject] = useState("");
  const [reviewEpoch, setReviewEpoch] = useState(0);
  const bodyRef = useRef<HTMLDivElement>(null);

  // restore a cached preview (tab switches must not cost the VP their work)
  useEffect(() => {
    try {
      sessionStorage.removeItem("sodio-expectation-preview"); // legacy unscoped key
      const raw = sessionStorage.getItem(CACHE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as {
        review: { subject: string; html: string };
        subject: string;
        toEp: string;
        toIr: string;
        variant: Program;
      };
      if (!saved?.review?.html) return;
      setReview(saved.review);
      setSubject(saved.subject || saved.review.subject);
      if (saved.toEp) setToEp(saved.toEp);
      if (saved.toIr) setToIr(saved.toIr);
      if (saved.variant && programs.includes(saved.variant)) setVariant(saved.variant);
      setReviewEpoch((e) => e + 1);
    } catch {
      /* corrupt cache — ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cachePreview = (r: { subject: string; html: string } | null, subj?: string) => {
    try {
      if (!r) sessionStorage.removeItem(CACHE_KEY);
      else
        sessionStorage.setItem(
          CACHE_KEY,
          JSON.stringify({ review: r, subject: subj ?? r.subject, toEp, toIr, variant })
        );
    } catch {
      /* storage full/blocked — the preview just won't survive navigation */
    }
  };

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
    if (!EMAIL_RE.test(toEp.trim())) return "The EP email doesn't look valid.";
    if (!EMAIL_RE.test(toIr.trim())) return "The IR email doesn't look valid.";
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
    if (variant === "OGV" && !tnFee.trim())
      return "TN Fee and what it covers is required for the OGV mail.";
    if (needsTransportDetail && !transportationDetail.trim())
      return "Transportation isn't provided — describe the daily cost, duration & method.";
    if (needsAccommodationDetail && !accommodationDetail.trim())
      return `${accommodationType} — specify the EPs per room & bathroom situation.`;
    if (!meals.trim()) return "Meals Provided is required (write \"None\" if none).";
    return null;
  };

  const buildPreview = () => {
    const problem = firstProblem();
    if (problem) {
      toast.error(problem);
      return;
    }
    const input: OgtMailInput = {
      variant,
      toEp: toEp.trim(),
      toIr: toIr.trim(),
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
      salary: variant === "OGT" ? salary.trim() || null : null,
      tnFee: variant === "OGV" ? tnFee.trim() : null,
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
      const res = await previewOgtExpectationMail(input);
      if (res.ok && res.data) {
        setReview(res.data);
        setSubject(res.data.subject);
        setReviewEpoch((e) => e + 1);
        cachePreview(res.data);
      } else if (!res.ok) {
        toast.error(res.error);
      }
    });
  };

  /** the body as it stands NOW — including any inline edits the VP made */
  const currentHtml = () => bodyRef.current?.innerHTML ?? review?.html ?? "";

  const sendNow = () => {
    const html = currentHtml();
    if (!subject.trim()) { toast.error("The subject can't be empty."); return; }
    if (!html.trim()) { toast.error("The email body can't be empty."); return; }
    startTransition(async () => {
      const res = await sendOgtExpectationMail({
        subject: subject.trim(),
        html,
        toEp: toEp.trim(),
        toIr: toIr.trim(),
      });
      if (res.ok) {
        toast.success("Sent ✈️ — it's in your Gmail Sent folder.");
        setReview(null);
        cachePreview(null);
      } else {
        toast.error(res.error);
      }
    });
  };

  const saveDraft = () => {
    const html = currentHtml();
    if (!subject.trim()) { toast.error("The subject can't be empty."); return; }
    if (!html.trim()) { toast.error("The email body can't be empty."); return; }
    startTransition(async () => {
      const res = await createOgtExpectationDraft({
        subject: subject.trim(),
        html,
        toEp: toEp.trim(),
        toIr: toIr.trim(),
      });
      if (res.ok) {
        toast.success(
          "Draft created! Open your Gmail Drafts to review it and hit send yourself. 💜"
        );
        setReview(null);
        cachePreview(null);
      } else {
        toast.error(res.error);
      }
    });
  };

  // ---------------------------------------------------------- review step
  if (review) {
    return (
      <div className="mx-auto max-w-3xl space-y-5">
        <div>
          <h1 className="text-2xl font-bold">
            Expectation mail<span className="text-primary">.</span>
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            This is the <b>exact email</b> that goes out — click anywhere in the
            body (or the subject) to edit it, then send it from your own Gmail
            or save it as a draft.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Review &amp; send</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-1 rounded-lg border bg-muted/40 p-3 text-sm">
              <p className="break-words">
                <span className="font-semibold">To:</span> {toEp.trim()}, {toIr.trim()}
              </p>
              <p className="break-words">
                <span className="font-semibold">Cc:</span> {FIXED_CC}{" "}
                <span className="text-xs text-muted-foreground">(always included)</span>
              </p>
            </div>
            <div className="grid gap-2">
              <Label>Subject</Label>
              <Input
                value={subject}
                onChange={(e) => {
                  setSubject(e.target.value);
                  cachePreview({ subject: e.target.value, html: currentHtml() }, e.target.value);
                }}
              />
            </div>
            <div className="grid gap-2">
              <Label>Email body — click in to edit any text</Label>
              <div
                key={reviewEpoch}
                ref={bodyRef}
                contentEditable
                suppressContentEditableWarning
                dir="auto"
                role="textbox"
                aria-multiline="true"
                aria-label="Email body"
                className="max-h-[60vh] overflow-y-auto rounded-lg border bg-white p-4 text-sm leading-relaxed text-neutral-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onBlur={() => cachePreview({ subject, html: currentHtml() }, subject)}
                dangerouslySetInnerHTML={{ __html: review.html }}
              />
            </div>
          </CardContent>
        </Card>

        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="ghost"
            onClick={() => {
              // keep the (possibly edited) preview cached — the VP can come back
              cachePreview({ subject, html: currentHtml() }, subject);
              setReview(null);
            }}
            disabled={pending}
          >
            <ArrowLeft className="size-4" /> Back to the form
          </Button>
          <div className="ml-auto flex flex-wrap items-center gap-3">
            <Button variant="outline" onClick={saveDraft} disabled={pending}>
              <Mail className="size-4" />
              {pending ? "Working…" : "Save as draft instead"}
            </Button>
            <Button onClick={sendNow} disabled={pending}>
              <Send className="size-4" />
              {pending ? "Sending…" : "Send now"}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ------------------------------------------------------------- form step
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h1 className="text-2xl font-bold">
          Expectation mail<span className="text-primary">.</span>
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          The Home Entity <b>Expectation Setting Mail</b> — fill it once,
          <b> review the exact email</b> (edit anything you like), then send it
          from <b>your own Gmail</b> or save it as a draft.
        </p>
        {!hasGoogle ? (
          <p className="mt-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            Your Google access is missing — sign out, then sign in with Google
            once so Sodio can send (or draft) from your Gmail.
          </p>
        ) : null}
      </div>

      {programs.length > 1 ? (
        <div className="flex w-fit items-center gap-1 rounded-lg border p-1">
          {programs.map((p) => (
            <button
              key={p}
              type="button"
              aria-pressed={variant === p}
              onClick={() => setVariant(p)}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                variant === p
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {p === "OGT" ? "OGT — Global Talent" : "OGV — Global Volunteer"}
            </button>
          ))}
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recipients</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label>EP email</Label>
              <Input
                type="email"
                value={toEp}
                onChange={(e) => setToEp(e.target.value)}
                placeholder="The exchange participant"
              />
            </div>
            <div className="grid gap-2">
              <Label>IR email</Label>
              <Input
                type="email"
                value={toIr}
                onChange={(e) => setToIr(e.target.value)}
                placeholder="The hosting entity's IR responsible"
              />
            </div>
          </div>
          <div className="grid gap-2">
            <Label>CC — always included</Label>
            <Input value={FIXED_CC} readOnly className="text-muted-foreground" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Hosting entity &amp; EP</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label>Hosting entity — &ldquo;Dear AIESEC in ___&rdquo;</Label>
              <Input
                value={hostingEntity}
                onChange={(e) => setHostingEntity(e.target.value)}
                placeholder="e.g. Cairo University"
              />
            </div>
            <div className="grid gap-2">
              <Label>Host LC — &ldquo;an opportunity with AIESEC in ___&rdquo;</Label>
              <Input value={hostLcName} onChange={(e) => setHostLcName(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label>EP name</Label>
              <Input value={epName} onChange={(e) => setEpName(e.target.value)} />
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
            {variant === "OGT" ? (
              <div className="grid gap-2">
                <Label>Salary (if any)</Label>
                <Input
                  value={salary}
                  onChange={(e) => setSalary(e.target.value)}
                  placeholder="Left empty → N/A"
                />
              </div>
            ) : null}
          </div>
          {variant === "OGV" ? (
            <div className="grid gap-2">
              <Label>TN Fee and what it covers</Label>
              <Textarea
                rows={2}
                value={tnFee}
                onChange={(e) => setTnFee(e.target.value)}
                placeholder="e.g. 250 USD — covers accommodation & one meal/day"
              />
            </div>
          ) : null}

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
        <Button onClick={buildPreview} disabled={pending}>
          <Eye className="size-4" />
          {pending ? "Building the preview…" : "Preview the email"}
        </Button>
        <p className="text-xs text-muted-foreground">
          Nothing goes out yet — you review &amp; edit the exact email first.
        </p>
      </div>
    </div>
  );
}
