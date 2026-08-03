"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { CalendarCheck2, Clock, Globe2, Mail, Phone, Video, Loader2 } from "lucide-react";
import { bookIrCall } from "@/server/actions";
import type { BookingDay } from "@/server/data";
import { normalizePhone } from "@/lib/types";
import { cn } from "@/lib/utils";
import { CountryInput } from "./country-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";

const EMAIL_RE = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]{2,}$/;

/** The PUBLIC /book/<slug> experience (v27, upgraded v28): a Cairo-time date
 *  strip (length = the member's max-advance setting) → the free slots of the
 *  picked day → LC name + the IR's EMAIL (calendar invite + Meet land there)
 *  → bookIrCall. Everything time-related arrives precomputed from the server. */
/** who the IR is inside their own LC — asked on the public page (v29) */
const BOOKER_ROLES = ["Member", "MM (Team Leader / Coordinator)", "LCVP", "LCP"] as const;

export function BookingView({
  slug, memberName, slotMinutes, days,
}: {
  slug: string;
  memberName: string;
  slotMinutes: number;
  days: BookingDay[];
}) {
  const [pending, start] = useTransition();
  const [dayIdx, setDayIdx] = useState(0);
  const [slotIso, setSlotIso] = useState<string | null>(null);
  const [lcName, setLcName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [country, setCountry] = useState("");
  const [bookerName, setBookerName] = useState("");
  const [bookerRole, setBookerRole] = useState("");
  const [done, setDone] = useState<{
    memberName: string;
    whenLabel: string;
    meetLink: string | null;
  } | null>(null);

  const day = days[Math.min(dayIdx, Math.max(0, days.length - 1))];
  const slot = day?.slots.find((s) => s.iso === slotIso) ?? null;
  const emailOk = EMAIL_RE.test(email.trim());
  // the crew reaches IRs on WhatsApp, so the number must carry a country code
  const phoneCheck = normalizePhone(phone);
  const phoneOk = phoneCheck.ok && phoneCheck.value.startsWith("+");

  const submit = () =>
    start(async () => {
      if (!slotIso) {
        toast.error("Pick a time slot first.");
        return;
      }
      if (!lcName.trim()) {
        toast.error("Tell us your LC's name first.");
        return;
      }
      if (!phoneOk) {
        toast.error("Add your number with its country code, e.g. +20 10 1234 5678.");
        return;
      }
      if (!emailOk) {
        toast.error("Enter a valid email — the calendar invite and Meet link go there.");
        return;
      }
      if (!bookerName.trim()) {
        toast.error("Tell us your name.");
        return;
      }
      if (!bookerRole) {
        toast.error("Pick your role in your LC.");
        return;
      }
      const res = await bookIrCall({
        slug,
        startIso: slotIso,
        lcName,
        bookerEmail: email.trim(),
        bookerPhone: phoneCheck.value,
        country: country || null,
        bookerName: bookerName.trim(),
        bookerRole,
      });
      if (res.ok && res.data) setDone(res.data);
      else if (!res.ok) toast.error(res.error);
    });

  if (done) {
    return (
      <div className="rise-in relative z-10 w-full max-w-md rounded-2xl bg-card p-8 text-center shadow-2xl">
        <BrandHeader />
        <div className="mx-auto mb-3 flex size-14 items-center justify-center rounded-full bg-emerald-500/15">
          <CalendarCheck2 className="size-7 text-emerald-600 dark:text-emerald-400" />
        </div>
        <h1 className="text-2xl font-bold text-card-foreground">Booked! 🎉</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          <b className="text-card-foreground">{done.memberName}</b> will meet
          you on <b className="text-card-foreground">{done.whenLabel}</b>. See
          you there! 🌍
        </p>
        {done.meetLink ? (
          <a
            href={done.meetLink}
            target="_blank"
            rel="noreferrer"
            className="mt-4 inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-bold text-primary-foreground transition-opacity hover:opacity-90"
          >
            <Video className="size-4" /> Google Meet link
          </a>
        ) : null}
        <p className="mt-4 text-xs text-muted-foreground">
          A confirmation with the calendar invite, the Meet link and a
          reschedule/cancel link is on its way to <b>{email.trim()}</b>.
        </p>
        <BookingFooter />
      </div>
    );
  }

  return (
    <div className="rise-in relative z-10 w-full max-w-2xl rounded-2xl bg-card p-6 shadow-2xl md:p-8">
      <BrandHeader />
      <h1 className="text-center text-2xl font-bold text-card-foreground">
        Book an IR call with <span className="text-primary">{memberName}</span>
      </h1>
      <p className="mt-1 text-center text-sm text-muted-foreground">
        AIESEC in Alexandria · {slotMinutes}-minute call
      </p>
      <p className="mt-1 flex items-center justify-center gap-1 text-center text-xs font-medium text-muted-foreground">
        <Clock className="size-3.5" /> Times are in Cairo (GMT+2/+3)
      </p>

      {days.length === 0 ? (
        <p className="mt-8 pb-2 text-center text-sm text-muted-foreground">
          No free slots right now — {memberName}&apos;s calendar is full. Check
          back in a few days. 😴
        </p>
      ) : (
        <>
          {/* date strip — only days with availability */}
          <div className="mt-5 flex gap-2 overflow-x-auto pb-1">
            {days.map((d, i) => {
              const on = i === dayIdx;
              return (
                <button
                  key={d.date}
                  type="button"
                  onClick={() => {
                    setDayIdx(i);
                    setSlotIso(null);
                  }}
                  className={cn(
                    "shrink-0 rounded-xl border px-3.5 py-2 text-center transition-colors",
                    on
                      ? "border-primary bg-primary text-primary-foreground"
                      : "bg-background text-card-foreground hover:border-primary/50"
                  )}
                >
                  <span className="block text-sm font-bold">{d.label}</span>
                  <span className={cn("block text-[11px]", on ? "text-primary-foreground/80" : "text-muted-foreground")}>
                    {d.slots.length} slot{d.slots.length === 1 ? "" : "s"}
                  </span>
                </button>
              );
            })}
          </div>

          {/* the picked day's free slots */}
          <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-4">
            {day?.slots.map((s) => {
              const on = s.iso === slotIso;
              return (
                <button
                  key={s.iso}
                  type="button"
                  onClick={() => setSlotIso(on ? null : s.iso)}
                  className={cn(
                    "rounded-lg border px-2 py-2 text-sm font-semibold transition-colors",
                    on
                      ? "border-primary bg-primary text-primary-foreground"
                      : "bg-background text-card-foreground hover:border-primary/50"
                  )}
                >
                  {s.label}
                </button>
              );
            })}
          </div>

          {/* booker details */}
          <div className="mt-5 space-y-3 border-t pt-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="bk-lc">Your LC (local committee) *</Label>
                <div className="relative">
                  <Globe2 className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="bk-lc"
                    dir="auto"
                    value={lcName}
                    onChange={(e) => setLcName(e.target.value)}
                    placeholder="e.g. AIESEC in Tunis"
                    className="h-10 pl-8"
                    maxLength={120}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="bk-email">Your email *</Label>
                <div className="relative">
                  <Mail className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="bk-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@aiesec.net"
                    className="h-10 pl-8"
                    maxLength={200}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  You&apos;ll get the calendar invite + Meet link here.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="bk-phone">Your WhatsApp number *</Label>
                <div className="relative">
                  <Phone className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="bk-phone"
                    type="tel"
                    inputMode="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    onBlur={() => { if (phoneOk) setPhone(phoneCheck.value); }}
                    placeholder="+20 10 1234 5678"
                    className="h-10 pl-8"
                    maxLength={40}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  {phone.trim() && !phoneOk ? (
                    <span className="font-medium text-destructive">
                      Include your country code — e.g. +33 6 12 34 56 78.
                    </span>
                  ) : (
                    "With your country code, so we can reach you on WhatsApp."
                  )}
                </p>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="bk-country">Country (optional)</Label>
                <CountryInput
                  id="bk-country"
                  value={country}
                  onChange={setCountry}
                  placeholder="Start typing…"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="bk-name">Your name *</Label>
                <Input
                  id="bk-name"
                  dir="auto"
                  value={bookerName}
                  onChange={(e) => setBookerName(e.target.value)}
                  placeholder="So they know who's calling"
                  className="h-10"
                  maxLength={100}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="bk-role">Your role *</Label>
                <Select value={bookerRole || undefined} onValueChange={setBookerRole}>
                  <SelectTrigger id="bk-role" className="h-10">
                    <SelectValue placeholder="Pick your role" />
                  </SelectTrigger>
                  <SelectContent>
                    {BOOKER_ROLES.map((r) => (
                      <SelectItem key={r} value={r}>{r}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Button
              className="h-11 w-full text-base font-bold"
              onClick={submit}
              disabled={
              pending ||
              !slotIso ||
              !lcName.trim() ||
              !emailOk ||
              !phoneOk ||
              !bookerName.trim() ||
              !bookerRole
            }
            >
              {pending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <CalendarCheck2 className="size-4" />
              )}
              {slot && day ? `Book ${day.label} · ${slot.label}` : "Pick a slot to book"}
            </Button>
          </div>
        </>
      )}

      <BookingFooter />
    </div>
  );
}

function BrandHeader() {
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/alex-blue.png" alt="AIESEC in Alexandria" className="mx-auto mb-4 h-16 w-auto dark:hidden" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/alex-white.png" alt="AIESEC in Alexandria" className="mx-auto mb-4 hidden h-16 w-auto dark:block" />
    </>
  );
}

function BookingFooter() {
  return (
    <>
      <p className="mt-4 text-center text-xs text-muted-foreground">
        Powered by Sodio · AIESEC in Alexandria
      </p>
      <BookingCredit />
    </>
  );
}

/** The "Created by 2.0" credit — same look as the login card's, theme-aware
 *  (black mark on light surfaces, white on dark). Shared by the public
 *  booking + manage pages. */
export function BookingCredit() {
  return (
    <a
      href="http://elevate2point0.com/"
      target="_blank"
      rel="noreferrer"
      className="mt-3 flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground transition-opacity hover:opacity-80"
      title="Created by 2.0 — elevate2point0.com"
    >
      <span>Created by</span>
      {/* theme-swap: black mark on light bg, white mark on dark bg */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/2.0-light.png" alt="2.0" className="block h-4 w-auto dark:hidden" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/2.0-dark.png" alt="2.0" className="hidden h-4 w-auto dark:block" />
    </a>
  );
}
