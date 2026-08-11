"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { CalendarCheck2, Clock, Globe2, Mail, Phone, Video, Loader2 } from "lucide-react";
import { bookIrCall } from "@/server/actions";
import type { BookingDay } from "@/server/data";
import { IR_ROLES, normalizeLcName, normalizePhone } from "@/lib/types";
import { phoneExample } from "@/lib/dial-codes";
import {
  COUNTRY_ZONES, countryForZone, isValidZone, zoneCity, zoneOffsetLabel,
} from "@/lib/timezones";
import { cn } from "@/lib/utils";
import { CountryInput } from "./country-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";

const EMAIL_RE = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]{2,}$/;

/** REGROUP THE SERVER'S CAIRO DAYS INTO THE VISITOR'S DAYS (v33.22).
 *
 *  A slot is a UTC instant; which DAY it falls on depends entirely on who is
 *  looking. A Cairo evening slot is the same evening in Istanbul, the small
 *  hours in Jakarta and that morning in São Paulo — so the strip has to be
 *  rebuilt per zone, not just relabelled. */
export function groupSlotsInZone(days: BookingDay[], tz: string): BookingDay[] {
  const zone = isValidZone(tz) ? tz : "Africa/Cairo";
  const dayKey = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit",
  });
  const dayLabel = new Intl.DateTimeFormat("en-US", {
    timeZone: zone, weekday: "short", month: "short", day: "numeric",
  });
  const clock = new Intl.DateTimeFormat("en-US", {
    timeZone: zone, hour: "numeric", minute: "2-digit", hour12: true,
  });
  const out = new Map<string, BookingDay>();
  for (const d of days)
    for (const s of d.slots) {
      const at = new Date(s.iso);
      if (Number.isNaN(at.getTime())) continue;
      const key = dayKey.format(at);
      let bucket = out.get(key);
      if (!bucket) {
        bucket = { date: key, label: dayLabel.format(at), slots: [] };
        out.set(key, bucket);
      }
      bucket.slots.push({ iso: s.iso, label: clock.format(at) });
    }
  return [...out.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((d) => ({ ...d, slots: d.slots.sort((a, b) => a.iso.localeCompare(b.iso)) }));
}

/** The zone list for the picker: everything the browser knows (all modern
 *  engines ship `supportedValuesOf`), else the ones we carry ourselves. */
function allZones(current: string): string[] {
  let list: string[] = [];
  try {
    list = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] })
      .supportedValuesOf?.("timeZone") ?? [];
  } catch {
    list = [];
  }
  if (list.length === 0) list = [...new Set(Object.values(COUNTRY_ZONES).flat())].sort();
  return list.includes(current) ? list : [current, ...list];
}

/** The PUBLIC /book/<slug> experience (v27, upgraded v28): a Cairo-time date
 *  strip (length = the member's max-advance setting) → the free slots of the
 *  picked day → LC name + the IR's EMAIL (calendar invite + Meet land there)
 *  → bookIrCall. Everything time-related arrives precomputed from the server. */
/** who the IR is inside their own LC — one list, shared with the registry's
 *  Add-an-IR dialog and validated server-side (IR_ROLES, v33.23) */

export function BookingView({
  slug, memberName, slotMinutes, days, knownLcs = [], ipZone = null,
}: {
  slug: string;
  memberName: string;
  slotMinutes: number;
  days: BookingDay[];
  /** LCs we already know — suggested so a re-typed name never duplicates */
  knownLcs?: { name: string; country: string | null }[];
  /** the zone the CONNECTION resolves to at Vercel's edge (v33.23) — a second
   *  opinion the page offers when it disagrees with the browser's own clock */
  ipZone?: string | null;
}) {
  const [pending, start] = useTransition();
  const [dayIdx, setDayIdx] = useState(0);
  const [slotIso, setSlotIso] = useState<string | null>(null);
  // THE PAGE IS DRAWN IN THE VISITOR'S OWN TIME ZONE (v33.22).
  //
  // It used to render Cairo time with a footnote, which is how an IR books
  // "6:00 PM" believing it is 6 PM at home. Google Calendar renders in the
  // viewer's zone and so do we. Server-rendered as Cairo and switched on
  // mount — reading the browser during render would mismatch hydration.
  const [tz, setTz] = useState("Africa/Cairo");
  const zoneOptions = useMemo(() => allZones(tz), [tz]);
  const [countryTouched, setCountryTouched] = useState(false);
  const [lcName, setLcName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [country, setCountry] = useState("");
  const [bookerName, setBookerName] = useState("");
  const [bookerRole, setBookerRole] = useState("");
  const [note, setNote] = useState("");
  const [done, setDone] = useState<{
    memberName: string;
    whenLabel: string;
    meetLink: string | null;
  } | null>(null);

  /** the device said one thing and the connection another — remembered so the
   *  page can offer the way back in one tap instead of a question */
  const [deviceZone, setDeviceZone] = useState<string | null>(null);
  useEffect(() => {
    const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const device = detected && isValidZone(detected) ? detected : null;
    setDeviceZone(device);
    // WHERE THE VISITOR ACTUALLY IS (v33.35).
    //
    // A browser reports the MACHINE's zone: a laptop set to Cairo says Cairo
    // from anywhere on earth, VPN or no VPN, which is why turning on a
    // Singapore exit changed nothing here. v33.23 handled that with a "did
    // you mean Singapore?" prompt and v33.33 removed the prompt — leaving
    // nothing at all.
    //
    // So the CONNECTION now wins when the two disagree, because it is the one
    // signal that moves when the person does. The device zone isn't thrown
    // away: it becomes the one-tap way back, for the corporate-VPN case where
    // the machine was right all along. Nothing is ever asked; the page just
    // says which clock it is on.
    if (ipZone && isValidZone(ipZone)) setTz(ipZone);
    else if (device) setTz(device);
  }, [ipZone]);
  // THE ZONE ALREADY SAYS WHICH COUNTRY THEY ARE IN — offer it instead of
  // asking twice. It only ever fills a field the IR hasn't touched: a typed
  // country wins, and so does a known LC's own country.
  useEffect(() => {
    if (countryTouched) return;
    const guess = countryForZone(tz);
    if (guess) setCountry(guess);
  }, [tz, countryTouched]);

  // the server groups slots by CAIRO day; regroup them by the visitor's day,
  // which is a different calendar once the offset crosses midnight
  const viewDays = useMemo(() => groupSlotsInZone(days, tz), [days, tz]);
  const day = viewDays[Math.min(dayIdx, Math.max(0, viewDays.length - 1))];
  const slot = day?.slots.find((s) => s.iso === slotIso) ?? null;
  // a zone change can move the picked slot to another day — keep the picked
  // TIME and follow it, rather than silently losing the selection
  useEffect(() => {
    if (!slotIso) return;
    const i = viewDays.findIndex((d) => d.slots.some((s) => s.iso === slotIso));
    if (i >= 0) setDayIdx(i);
  }, [viewDays, slotIso]);
  const emailOk = EMAIL_RE.test(email.trim());
  // a typed name we already KNOW (normalized: case, diacritics, "AIESEC in"/
  // "LC" prefixes) — auto-fills the country and lands on the same registry row
  const knownLc =
    lcName.trim().length >= 3
      ? knownLcs.find((l) => normalizeLcName(l.name) === normalizeLcName(lcName)) ?? null
      : null;
  const onLcInput = (v: string) => {
    setLcName(v);
    const hit =
      v.trim().length >= 3
        ? knownLcs.find((l) => normalizeLcName(l.name) === normalizeLcName(v))
        : null;
    if (hit?.country) { setCountryTouched(true); setCountry(hit.country); }
  };
  // the crew reaches IRs on WhatsApp, so the number must carry a country code
  const phoneEg = phoneExample(country);
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
        note: note.trim() || null,
        // what zone they were LOOKING at — every later email speaks it back
        tz,
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
    <div
      className="rise-in relative z-10 w-full max-w-2xl rounded-2xl bg-card p-6 shadow-2xl md:p-8"
      // what the EDGE thinks of this connection — invisible, but it makes
      // "the zone detection isn't working" answerable without guessing
      data-ip-zone={ipZone ?? "none"}
    >
      <BrandHeader />
      <h1 className="text-center text-2xl font-bold text-card-foreground">
        Book an IR call with <span className="text-primary">{memberName}</span>
      </h1>
      <p className="mt-1 text-center text-sm text-muted-foreground">
        AIESEC in Alexandria · {slotMinutes}-minute call
      </p>
      {/* WHAT CLOCK THIS PAGE IS ON — stated plainly, and changeable. */}
      <div className="mt-2 flex flex-wrap items-center justify-center gap-1.5 text-xs text-muted-foreground">
        <Clock className="size-3.5 shrink-0" />
        <span>Times shown in</span>
        <select
          value={tz}
          onChange={(e) => {
            setTz(e.target.value);
            setCountryTouched(false); // a new zone re-guesses the country
          }}
          className="h-7 max-w-[13rem] rounded-md border bg-background px-1.5 text-xs font-semibold text-card-foreground"
          aria-label="Your time zone"
        >
          {zoneOptions.map((z) => (
            <option key={z} value={z}>
              {z.replaceAll("_", " ")}
            </option>
          ))}
        </select>
        <span className="font-semibold text-card-foreground">
          {zoneOffsetLabel(new Date(), tz)}
        </span>
        <span className="w-full text-center text-[11px] sm:w-auto">
          · Cairo is {zoneOffsetLabel(new Date(), "Africa/Cairo")}
        </span>
      </div>
      {/* STILL NO QUESTION (v33.33) — but when the connection and the device
          disagree we now follow the connection (v33.35) and say so, with the
          way back one tap away. A statement, not a prompt. */}
      {deviceZone && deviceZone !== tz ? (
        <p className="mt-1.5 text-center text-xs text-muted-foreground">
          Showing <b className="text-card-foreground">{zoneCity(tz)}</b> time —
          your device says {zoneCity(deviceZone)}.{" "}
          <button
            type="button"
            onClick={() => { setTz(deviceZone); setCountryTouched(false); }}
            className="font-medium text-primary hover:underline"
          >
            Use {zoneCity(deviceZone)} instead
          </button>
        </p>
      ) : null}

      {viewDays.length === 0 ? (
        <p className="mt-8 pb-2 text-center text-sm text-muted-foreground">
          No free slots right now — {memberName}&apos;s calendar is full. Check
          back in a few days. 😴
        </p>
      ) : (
        <>
          {/* date strip — only days with availability */}
          <div className="mt-5 flex gap-2 overflow-x-auto pb-1">
            {viewDays.map((d, i) => {
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
                    onChange={(e) => onLcInput(e.target.value)}
                    placeholder="e.g. AIESEC in Tunis"
                    className="h-10 pl-8"
                    maxLength={120}
                    list="bk-lc-known"
                  />
                  <datalist id="bk-lc-known">
                    {knownLcs.map((l) => (
                      <option key={l.name} value={l.name} />
                    ))}
                  </datalist>
                </div>
                {knownLc ? (
                  <p className="text-xs text-emerald-600 dark:text-emerald-400">
                    ✓ We already know {knownLc.name}
                    {knownLc.country ? ` (${knownLc.country})` : ""} — you&apos;ll land
                    on the same record.
                  </p>
                ) : null}
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
                    // AN EXAMPLE FROM THEIR COUNTRY (v33.23). It used to show
                    // an Egyptian number to an IR abroad and a French one in
                    // the error line — which reads as an instruction, not an
                    // illustration. Every example here is a real shape for
                    // that country AND passes normalizePhone if typed
                    // literally, so nobody is shown something we would reject.
                    placeholder={phoneEg ?? "+20 10 1234 5678"}
                    className="h-10 pl-8"
                    maxLength={40}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  {phone.trim() && !phoneOk ? (
                    <span className="font-medium text-destructive">
                      Include your country code{phoneEg ? ` — e.g. ${phoneEg}` : ""}.
                    </span>
                  ) : (
                    "With your country code, so we can reach you on WhatsApp."
                  )}
                </p>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="bk-country">Country</Label>
                <CountryInput
                  id="bk-country"
                  value={country}
                  onChange={(v) => { setCountryTouched(true); setCountry(v); }}
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
                    {IR_ROLES.map((r) => (
                      <SelectItem key={r} value={r}>{r}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {/* WHAT THE CALL IS ABOUT (v33.24). The form asked who and when
                and never why, so the host walked in blind and the one person
                who knew had no way to say. Optional — a call with no agenda is
                still a call. */}
            <div className="space-y-1.5">
              <Label htmlFor="bk-note">
                Anything you&apos;d like to talk about?{" "}
                <span className="font-normal text-muted-foreground">— optional</span>
              </Label>
              <textarea
                id="bk-note"
                dir="auto"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                maxLength={1000}
                placeholder="Your demand, a project you're planning, what you'd like from us…"
                className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
              />
              <p className="text-xs text-muted-foreground">
                It reaches {memberName} before the call, so they can come prepared.
              </p>
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
