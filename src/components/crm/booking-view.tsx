"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { CalendarCheck2, Clock, Globe2, Loader2 } from "lucide-react";
import { bookIrCall } from "@/server/actions";
import type { BookingDay } from "@/server/data";
import { cn } from "@/lib/utils";
import { CountryInput } from "./country-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** The PUBLIC /book/<slug> experience (v27): a 14-day Cairo-time date strip →
 *  the free slots of the picked day → LC name (+ optional country & name) →
 *  bookIrCall. Everything time-related arrives precomputed from the server. */
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
  const [country, setCountry] = useState("");
  const [bookerName, setBookerName] = useState("");
  const [done, setDone] = useState<{ memberName: string; whenLabel: string } | null>(null);

  const day = days[Math.min(dayIdx, Math.max(0, days.length - 1))];
  const slot = day?.slots.find((s) => s.iso === slotIso) ?? null;

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
      const res = await bookIrCall({
        slug,
        startIso: slotIso,
        lcName,
        country: country || null,
        bookerName: bookerName || null,
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
          you on <b className="text-card-foreground">{done.whenLabel}</b> —
          Cairo time. See you there! 🌍
        </p>
        <p className="mt-4 text-xs text-muted-foreground">
          Powered by Sodio · AIESEC in Alexandria
        </p>
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
          No free slots in the next two weeks — {memberName}&apos;s calendar is
          full. Check back in a few days. 😴
        </p>
      ) : (
        <>
          {/* 14-day date strip — only days with availability */}
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
                <Label htmlFor="bk-name">Your name (optional)</Label>
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
            </div>
            <Button
              className="h-11 w-full text-base font-bold"
              onClick={submit}
              disabled={pending || !slotIso || !lcName.trim()}
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

      <p className="mt-4 text-center text-xs text-muted-foreground">
        Powered by Sodio · AIESEC in Alexandria
      </p>
    </div>
  );
}

function BrandHeader() {
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/aiesec-blue.png" alt="AIESEC" className="mx-auto mb-4 h-10 w-auto dark:hidden" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/aiesec-white.png" alt="AIESEC" className="mx-auto mb-4 hidden h-10 w-auto dark:block" />
    </>
  );
}
