"use client";

import { useEffect, useRef, useState } from "react";
import { CalendarDays, MapPin, Pencil, Ticket } from "lucide-react";
import {
  addDays, daysBetween, fmtDay, isIsoDate, weekdayOf,
  type ActivationSection, type HeroContent,
} from "@/lib/activation/model";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useBoard } from "./context";
import { followSpot, useNowSeconds } from "./fx";

export interface HeroStats {
  roadDays: number;
  checkpoints: number;
  departments: number;
  teamsters: number;
  ocSize: number;
  capacity: number;
}

/** The marquee: who presents, the name in lights, the dates, a countdown to
 *  opening night and the numbers that make the case. */
export function Hero({
  section, stats, firstActId,
}: { section: ActivationSection; stats: HeroStats; firstActId: string | null }) {
  const api = useBoard();
  const [editOpen, setEditOpen] = useState(false);
  const hero = section.config.hero;
  if (!hero) return null;
  const day1 = addDays(hero.day0, 1);
  const last = addDays(hero.day0, Math.max(1, hero.showDays) - 1);

  return (
    <header className="circus-hero" onPointerMove={followSpot}>
      <div className="circus-poster" aria-hidden />
      <div className="relative z-[1] mx-auto w-full max-w-5xl">
        <p className="circus-eyebrow" data-reveal>
          {hero.eyebrow}
        </p>
        <div className="mt-6" data-reveal style={{ "--d": "120ms" } as React.CSSProperties}>
          <span className="circus-marquee">
            <h1 className="circus-title">{hero.title}</h1>
          </span>
        </div>
        <p className="circus-tagline mx-auto mt-7 max-w-2xl" data-reveal style={{ "--d": "220ms" } as React.CSSProperties}>
          {hero.tagline}
        </p>
        <div
          className="mt-5 flex flex-wrap items-center justify-center gap-2"
          data-reveal
          style={{ "--d": "300ms" } as React.CSSProperties}
        >
          <span className="circus-chip !px-3 !py-1 !text-sm">
            <CalendarDays className="size-4" /> {fmtDay(hero.day0)} – {fmtDay(last)}
          </span>
          <span className="circus-chip !px-3 !py-1 !text-sm" style={{ "--chip": "#d7263d" } as React.CSSProperties}>
            <Ticket className="size-4" /> {hero.showDays} days under the big top
          </span>
          {hero.venue ? (
            <span className="circus-chip !px-3 !py-1 !text-sm" style={{ "--chip": "#2ec4b6" } as React.CSSProperties}>
              <MapPin className="size-4" /> {hero.venue}
            </span>
          ) : null}
        </div>

        <Countdown day1={day1} bidDay={hero.bidDay} lastDay={last} />

        <div className="mt-8 flex flex-wrap justify-center gap-3" data-reveal style={{ "--d": "420ms" } as React.CSSProperties}>
          {firstActId ? (
            <a href={`#act-${firstActId}`} className="circus-btn">
              See the show plan ↓
            </a>
          ) : null}
          {api.editing ? (
            <button type="button" className="circus-btn ghost" onClick={() => setEditOpen(true)}>
              <Pencil className="size-4" /> Edit the headline
            </button>
          ) : null}
        </div>

        <div className="mx-auto mt-12 grid max-w-4xl grid-cols-3 gap-2 sm:gap-3 lg:grid-cols-6">
          {[
            { n: stats.roadDays, label: "days on the road" },
            { n: stats.checkpoints, label: "checkpoints" },
            { n: stats.departments, label: "OC departments" },
            { n: stats.teamsters, label: "teamsters" },
            { n: stats.ocSize, label: "on the OC" },
            { n: stats.capacity, label: "members ready" },
          ].map((s, i) => (
            <div
              key={s.label}
              className="circus-ring grid aspect-square place-items-center p-3"
              data-reveal
              style={{ "--d": `${480 + i * 70}ms` } as React.CSSProperties}
            >
              <div>
                <CountUp to={s.n} className="circus-display block text-2xl text-[var(--cz-gold)] sm:text-4xl" />
                <span className="mt-1 block text-[9px] font-semibold uppercase leading-tight tracking-wider text-[var(--cz-muted)] sm:text-[11px]">
                  {s.label}
                </span>
              </div>
            </div>
          ))}
        </div>

        {hero.intro ? (
          <p className="mx-auto mt-12 max-w-2xl text-base leading-relaxed text-[var(--cz-muted)]" data-reveal dir="auto">
            {hero.intro}
          </p>
        ) : null}
      </div>

      {api.editing ? (
        <HeroEditor
          open={editOpen}
          onOpenChange={setEditOpen}
          hero={hero}
          onSave={async (next) => {
            const ok = await api.updateSection(section.id, { config: { hero: next } });
            if (ok) setEditOpen(false);
          }}
        />
      ) : null}
    </header>
  );
}

function Countdown({ day1, bidDay, lastDay }: { day1: string; bidDay: string; lastDay: string }) {
  const now = useNowSeconds();
  // opening morning, Cairo (UTC+2 in December)
  const target = Math.floor(Date.parse(`${day1}T09:00:00+02:00`) / 1000);
  const end = Math.floor(Date.parse(`${lastDay}T23:59:00+02:00`) / 1000);
  const bid = Math.floor(Date.parse(`${bidDay}T12:00:00+02:00`) / 1000);
  if (!now) return <div className="mt-8 h-[88px]" aria-hidden />;
  if (now > end)
    return <p className="circus-display mt-8 text-2xl text-[var(--cz-gold)]">That&apos;s a wrap — what a show.</p>;
  if (now >= target)
    return <p className="circus-display mt-8 text-2xl text-[var(--cz-gold)]">🎪 The show is on!</p>;
  const left = target - now;
  const parts = [
    { v: Math.floor(left / 86400), l: "days" },
    { v: Math.floor((left % 86400) / 3600), l: "hours" },
    { v: Math.floor((left % 3600) / 60), l: "minutes" },
    { v: left % 60, l: "seconds" },
  ];
  return (
    <div className="mt-8" aria-live="off">
      <p className="text-xs font-semibold uppercase tracking-[0.3em] text-[var(--cz-muted)]">Opening night in</p>
      <div className="mt-3 flex justify-center gap-2 sm:gap-3">
        {parts.map((p) => (
          <div key={p.l} className="circus-ticket w-[68px] px-2 py-2 sm:w-[84px]">
            <span key={p.v} className="circus-flip-digit circus-display block text-3xl sm:text-4xl">
              {String(p.v).padStart(2, "0")}
            </span>
            <span className="block text-[10px] font-bold uppercase tracking-wider opacity-70">{p.l}</span>
          </div>
        ))}
      </div>
      {now < bid ? (
        <p className="mt-3 text-xs text-[var(--cz-muted)]">
          The bid result lands on {weekdayOf(bidDay)} {fmtDay(bidDay)} — {Math.ceil((bid - now) / 86400)} days to go.
        </p>
      ) : null}
    </div>
  );
}

/** Counts up once it scrolls into view. It STARTS on the real number, so a
 *  background tab, a crawler or a link preview never reads a row of zeros —
 *  the count-up is decoration on top of a correct figure. */
function CountUp({ to, className }: { to: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [value, setValue] = useState(to);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    const run = () => {
      if (reduce) {
        raf = requestAnimationFrame(() => setValue(to));
        return;
      }
      const t0 = performance.now();
      const tick = (t: number) => {
        const k = Math.min(1, (t - t0) / 1400);
        setValue(Math.round(to * (1 - Math.pow(1 - k, 3))));
        if (k < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    };
    if (typeof IntersectionObserver === "undefined") {
      run();
      return () => cancelAnimationFrame(raf);
    }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        io.disconnect();
        run();
      }
    });
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [to]);
  return (
    <span ref={ref} className={className}>
      {value}
    </span>
  );
}

function HeroEditor({
  open, onOpenChange, hero, onSave,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  hero: HeroContent;
  onSave: (h: HeroContent) => Promise<void>;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        {open ? <HeroForm hero={hero} onSave={onSave} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function HeroForm({ hero, onSave }: { hero: HeroContent; onSave: (h: HeroContent) => Promise<void> }) {
  const [h, setH] = useState(hero);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof HeroContent) => (v: string) => setH((x) => ({ ...x, [k]: k === "showDays" ? Number(v) : v }));
  const valid = isIsoDate(h.bidDay) && isIsoDate(h.day0) && h.day0 >= h.bidDay && h.showDays >= 1 && h.showDays <= 10;
  return (
    <>
      <DialogHeader>
        <DialogTitle>The headline</DialogTitle>
        <DialogDescription>What everyone — and the public page — sees first.</DialogDescription>
      </DialogHeader>
      <div className="grid gap-3">
        <Field label="Presented by">
          <Input value={h.eyebrow} onChange={(e) => set("eyebrow")(e.target.value)} />
        </Field>
        <Field label="Title">
          <Input value={h.title} onChange={(e) => set("title")(e.target.value)} />
        </Field>
        <Field label="Tagline">
          <Input value={h.tagline} onChange={(e) => set("tagline")(e.target.value)} />
        </Field>
        <Field label="Intro">
          <Textarea rows={4} value={h.intro} onChange={(e) => set("intro")(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Bid result">
            <Input type="date" value={h.bidDay} onChange={(e) => set("bidDay")(e.target.value)} />
          </Field>
          <Field label="Day 0">
            <Input type="date" value={h.day0} onChange={(e) => set("day0")(e.target.value)} />
          </Field>
          <Field label="Show days">
            <Input type="number" min={1} max={10} value={h.showDays} onChange={(e) => set("showDays")(e.target.value)} />
          </Field>
          <Field label="Venue">
            <Input value={h.venue} placeholder="Once it's confirmed" onChange={(e) => set("venue")(e.target.value)} />
          </Field>
        </div>
        {!valid ? <p className="text-xs text-destructive">Day 0 must be on or after the bid result, and the show lasts 1–10 days.</p> : null}
        <p className="text-xs text-muted-foreground">
          Road length: {valid ? daysBetween(h.bidDay, h.day0) : "—"} days.
        </p>
      </div>
      <DialogFooter>
        <Button
          disabled={!valid || busy}
          onClick={async () => {
            setBusy(true);
            await onSave(h);
            setBusy(false);
          }}
        >
          {busy ? "Saving…" : "Save the headline"}
        </Button>
      </DialogFooter>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
