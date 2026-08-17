"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  LayoutDashboard,
  ChevronUp,
  ChevronDown,
  ChevronsLeft,
  ChevronsRight,
  GripVertical,
  Building2,
  CalendarCheck2,
  CalendarDays,
  Globe2,
  Users,
  UsersRound,
  MailPlus,
  UserRoundPlus,
  Menu,
  LogOut,
  MessageSquareHeart,
  BookOpen,
  Activity,
  Target,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { ThemeToggle } from "./theme-toggle";
import { NotificationsBell } from "./notifications-bell";
import { AutoRefresh, RefreshButton } from "./auto-refresh";
import { FeedbackButton } from "./floating-feedback";
import { TestViewButton } from "./test-view-button";
import type { ViewAsTarget } from "@/server/data";
import { WalkingLoader } from "./walking-loader";
import { BlueManChat } from "./blue-man-chat";
import { PendingPrompt } from "./pending-prompt";
import { Prankster } from "./prankster";
import { ActivateStrip } from "./activate-strip";

interface ShellProps {
  user: {
    name: string;
    email: string;
    role: string;
    functions: string[];
    photoUrl: string | null;
    isAdmin: boolean;
    /** may open Health & Logs and the test view (v33) */
    adminTools: boolean;
  };
  nav: { raising: boolean; dashboard: boolean; tm: boolean; membership: boolean; planning: boolean; ogtMail: boolean; signups: boolean; consideration: boolean; calendar: boolean; mailbox: boolean };
  signOutAction: () => Promise<void>;
  /** the admin's test-view pool — empty for everyone else (v33.42) */
  viewAsTargets?: ViewAsTarget[];
  /** 🃏 prank mode (v33.51): the EB has this member in a mood. Client-side
   *  mischief only — see prankster.tsx for the rules it obeys. */
  prank?: { on: boolean; by: string | null };
  children: React.ReactNode;
}

export function AppShell({
  user, nav, signOutAction, viewAsTargets = [], prank, children,
}: ShellProps) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  // slow route changes get the walking man after a beat — fast ones never
  // see it (the overlay fades in with a 250ms delay)
  const [navTarget, setNavTarget] = useState<string | null>(null);
  useEffect(() => {
    setNavTarget(null);
  }, [pathname]);
  useEffect(() => {
    if (!navTarget) return;
    const safety = setTimeout(() => setNavTarget(null), 8000);
    return () => clearTimeout(safety);
  }, [navTarget]);
  // admin + the EB (LCP / LCVPs) can broadcast messages to members
  const canBroadcast = user.isAdmin || user.role === "LCP" || user.role === "LCVP";

  // The logo lands DIRECTLY on the viewer's home module (v28) — mirrors the
  // "/" redirect priority. Never "/": for non-raising viewers "/" renders as
  // a never-mounted child of the GateClient, so its redirect could never fire
  // on client navigation (the blank-home bug).
  const homeHref = nav.raising
    ? "/accounts"
    : nav.signups
      ? "/signups"
      : nav.consideration
        ? "/consideration"
        : nav.tm
          ? "/members"
          : nav.membership
            ? "/membership"
            : nav.planning
              ? "/planning"
              : "/accounts";

  // The Dashboard belongs to ANYONE with a real lane — raising (ICX/B2B/B2C),
  // OGX (the OGT/OGV sign-up funnels, v28) and Consideration (v27/v29). It used
  // to be gated on `raising` alone, so OGX/Consideration crews could only reach
  // their own dashboard through the button on /signups.
  const dashboardItem = { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard };

  // Accounts is the daily workspace — it leads, and "/" lands on it
  const items = [
    ...(nav.raising
      ? [{ href: "/accounts", label: "Raising", icon: Building2 }, dashboardItem]
      : []),
    // v29: the calendar carries TM touch points too — everyone with a module
    ...(nav.calendar ? [{ href: "/calendar", label: "Calendar", icon: CalendarDays }] : []),
    ...(nav.signups ? [{ href: "/signups", label: "Sign-ups", icon: UserRoundPlus }] : []),
    ...(nav.consideration
      ? [{ href: "/consideration", label: "Consideration", icon: Globe2 }]
      : []),
    // non-raising lane owners: the Dashboard sits right after the module they
    // actually work in (Sign-ups / Consideration), never above it
    ...(nav.dashboard && !nav.raising ? [dashboardItem] : []),
    ...(nav.planning ? [{ href: "/planning", label: "Planning", icon: Target }] : []),
    // v33.37 — the Expectation mail lives as a BUTTON inside the Emails tab
    // now (one tab fewer); the /ogt-mail route itself stays for the button.
    ...(nav.tm ? [{ href: "/members", label: "Talent Management", icon: UsersRound }] : []),
    ...(nav.membership ? [{ href: "/membership", label: "Membership", icon: Users }] : []),
    // v29: attendance is everybody's — own history, plus whatever you record
    { href: "/attendance", label: "Attendance", icon: CalendarCheck2 },
    // v33.24 — writing to partners, EPs and other LCs, with the LC's look
    ...(nav.mailbox ? [{ href: "/emails", label: "Emails", icon: MailPlus }] : []),
    { href: "/help", label: "Help", icon: BookOpen },
    // system feedback moved to the Profile page (v21) — this is feedback about
    // PEOPLE in the LC: shout-outs & concerns
    { href: "/lc-feedback", label: "LC Feedback", icon: MessageSquareHeart },
    ...(user.adminTools ? [{ href: "/admin", label: "Health & Logs", icon: Activity }] : []),
  ];

  // v26: members arrange their OWN sidebar — order persisted per browser
  const [navOrder, setNavOrder] = useState<string[] | null>(null);
  const [sortMode, setSortMode] = useState(false);
  // v33.18: drag-to-reorder, but ONLY from the grip. `dragArmed` is raised by
  // the handle's pointer-down and is what puts `draggable` on the row — so a
  // press on the label or the icon is still just a click on the link, and the
  // drag can never fight the navigation. Reset on dragend / pointer-up / exit.
  const [dragArmed, setDragArmed] = useState(false);
  const [dragHref, setDragHref] = useState<string | null>(null);
  const [overHref, setOverHref] = useState<string | null>(null);
  // v33: the tab the logo goes to. Arranging your tabs without being able to
  // say which one is HOME only got you halfway — a B2C coordinator who lives
  // in Raising shouldn't land wherever the priority list happens to point.
  const [homePin, setHomePin] = useState<string | null>(null);
  // COLLAPSED SIDEBAR (v33): the accounts table is wide and the nav is mostly
  // idle once you're working a list — collapsing gives it ~15rem back without
  // losing the tabs, which stay as icons.
  const [railed, setRailed] = useState(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem("sodio-nav-order");
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.every((x) => typeof x === "string"))
        setNavOrder(parsed);
      else localStorage.removeItem("sodio-nav-order"); // self-heal a poisoned key
    } catch {
      /* corrupt — default order */
    }
    try {
      setHomePin(localStorage.getItem("sodio-nav-home"));
      setRailed(localStorage.getItem("sodio-nav-railed") === "1");
    } catch {
      /* no pin — fall back to the module priority */
    }
  }, []);
  const orderedItems = (() => {
    if (!navOrder) return items;
    const pos = new Map(navOrder.map((h, i) => [h, i]));
    return [...items].sort((a, b) => {
      const pa = pos.get(a.href) ?? 1000 + items.findIndex((x) => x.href === a.href);
      const pb = pos.get(b.href) ?? 1000 + items.findIndex((x) => x.href === b.href);
      return pa - pb;
    });
  })();
  // the pinned tab wins — but only while it's still a tab this viewer has
  // (a function change can take a module away, and home must not 404)
  const effectiveHome =
    homePin && orderedItems.some((i) => i.href === homePin) ? homePin : homeHref;

  const persistOrder = (hrefs: string[]) => {
    setNavOrder(hrefs);
    try {
      localStorage.setItem("sodio-nav-order", JSON.stringify(hrefs));
    } catch {
      /* private mode — order just won't persist */
    }
  };

  const moveItem = (href: string, dir: -1 | 1) => {
    const hrefs = orderedItems.map((i) => i.href);
    const idx = hrefs.indexOf(href);
    const to = idx + dir;
    if (idx < 0 || to < 0 || to >= hrefs.length) return;
    [hrefs[idx], hrefs[to]] = [hrefs[to], hrefs[idx]];
    persistOrder(hrefs);
  };

  /** Drop `href` onto position `to` — splice-move, the same semantics the
   *  table kit's column reorder uses, so both drags feel identical. */
  const moveHrefTo = (href: string, to: number) => {
    const hrefs = orderedItems.map((i) => i.href);
    const from = hrefs.indexOf(href);
    const target = Math.max(0, Math.min(hrefs.length - 1, to));
    if (from < 0 || from === target) return;
    hrefs.splice(from, 1);
    hrefs.splice(target, 0, href);
    persistOrder(hrefs);
  };

  const endDrag = () => {
    setDragArmed(false);
    setDragHref(null);
    setOverHref(null);
  };

  // the nav is in arrange mode: grips, arrows and the home star show, and the
  // rows accept a drag (the rail has no room for any of it)
  const arranging = sortMode && !railed;

  const navList = (
    // THE TABS SCROLL, THE FOOTER STAYS (v33.38): the nav is the only
    // scrollable region, so the profile block / theme / sign-out under the
    // divider are always in view — no more scrolling to find Sign out.
    <nav
      className={cn(
        "flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto overscroll-contain p-3",
        railed && "items-center px-1.5"
      )}
    >
      {orderedItems.map((item, index) => {
        const active =
          pathname === item.href ||
          (item.href === "/accounts" && pathname === "/") ||
          (item.href !== "/feedback" && pathname.startsWith(item.href + "/")) ||
          (item.href === "/feedback" && pathname === "/feedback");
        return (
          <div
            key={item.href}
            // ⚠️ ONLY the grip arms this. Without `dragArmed` the attribute is
            // absent, so a press anywhere else in the row starts no drag.
            draggable={arranging && dragArmed}
            onDragStart={(e) => {
              if (!arranging || !dragArmed) {
                e.preventDefault();
                return;
              }
              setDragHref(item.href);
              e.dataTransfer.effectAllowed = "move";
              try {
                e.dataTransfer.setData("text/plain", item.href);
              } catch {
                /* some browsers refuse — the state carries it */
              }
            }}
            onDragOver={(e) => {
              if (!dragHref) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              if (overHref !== item.href) setOverHref(item.href);
            }}
            onDragLeave={(e) => {
              // moving between the row's own children (grip → label) must not
              // flicker the cue off
              if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
              setOverHref((h) => (h === item.href ? null : h));
            }}
            onDrop={(e) => {
              e.preventDefault();
              let href = dragHref;
              if (!href) {
                try {
                  href = e.dataTransfer.getData("text/plain") || null;
                } catch {
                  href = null;
                }
              }
              if (href) moveHrefTo(href, index);
              endDrag();
            }}
            onDragEnd={endDrag}
            className={cn(
              "flex items-center gap-1 rounded-lg transition-opacity",
              arranging && dragHref === item.href && "opacity-60",
              arranging &&
                overHref === item.href &&
                dragHref !== item.href &&
                "ring-1 ring-inset ring-primary/50"
            )}
          >
          {arranging ? (
            <span
              aria-hidden
              title="Drag to move this tab"
              // pointer-down ARMS the row's draggable; a plain click that never
              // becomes a drag disarms it again on release
              onMouseDown={() => setDragArmed(true)}
              onTouchStart={() => setDragArmed(true)}
              onMouseUp={() => setDragArmed(false)}
              onTouchEnd={() => setDragArmed(false)}
              // size-8 = a 32px touch target on phones. No `touch-none`: HTML5
              // drag doesn't fire on touch anyway (the ↑ ↓ buttons are that
              // path), and blocking it here would kill scrolling on the grip.
              className="flex size-8 shrink-0 cursor-grab items-center justify-center rounded text-sidebar-foreground/45 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground active:cursor-grabbing"
            >
              <GripVertical className="size-4" />
            </span>
          ) : null}
          <Link
            href={item.href}
            title={railed ? item.label : undefined}
            data-tour={`nav:${item.href}`}
            // an <a> is natively draggable — that is what made the WHOLE tab
            // grabbable with no affordance. The grip is the only handle now.
            draggable={false}
            onClick={(e) => {
              setOpen(false);
              // modified clicks open a new tab — this tab never navigates
              const modified =
                e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0;
              if (!active && !modified) setNavTarget(item.href);
            }}
            className={cn(
              "group flex min-w-0 flex-1 items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-sidebar-foreground/80 transition-all hover:translate-x-0.5 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground motion-reduce:hover:translate-x-0",
              active &&
                "bg-sidebar-primary text-sidebar-primary-foreground shadow-[0_0_18px_-6px_rgb(3_126_243/0.8)] hover:translate-x-0 hover:bg-sidebar-primary"
            )}
          >
            <item.icon className="size-4.5 transition-transform group-hover:scale-110 motion-reduce:group-hover:scale-100" />
            {railed ? null : (
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
            )}
          </Link>
          {arranging ? (
            <span className="flex shrink-0 items-center gap-0.5 pr-1">
              <button
                type="button"
                aria-label={`Move ${item.label} up`}
                className="rounded p-0.5 text-sidebar-foreground/70 transition-opacity hover:bg-sidebar-accent hover:text-sidebar-foreground"
                onClick={() => moveItem(item.href, -1)}
              >
                <ChevronUp className="size-3.5" />
              </button>
              <button
                type="button"
                aria-label={`Move ${item.label} down`}
                className="rounded p-0.5 text-sidebar-foreground/70 transition-opacity hover:bg-sidebar-accent hover:text-sidebar-foreground"
                onClick={() => moveItem(item.href, 1)}
              >
                <ChevronDown className="size-3.5" />
              </button>
              <button
                type="button"
                aria-label={
                  homePin === item.href
                    ? `${item.label} is your home tab`
                    : `Make ${item.label} your home tab`
                }
                title={
                  homePin === item.href
                    ? "Your home tab — the logo lands here"
                    : "Make this your home tab"
                }
                className={cn(
                  "rounded p-0.5 transition-colors",
                  homePin === item.href
                    ? "text-warning"
                    : "text-sidebar-foreground/40 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                )}
                onClick={() => {
                  const next = homePin === item.href ? null : item.href;
                  setHomePin(next);
                  try {
                    if (next) localStorage.setItem("sodio-nav-home", next);
                    else localStorage.removeItem("sodio-nav-home");
                  } catch { /* private mode — the pin just won't persist */ }
                }}
              >
                {homePin === item.href ? "★" : "☆"}
              </button>
            </span>
          ) : null}
          </div>
        );
      })}
      <div
        className={cn(
          "mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 px-3",
          railed && "hidden"
        )}
      >
        <button
          type="button"
          className="text-[11px] font-medium text-sidebar-foreground/45 transition-colors hover:text-sidebar-foreground/80"
          onClick={() => {
            setSortMode((s) => !s);
            endDrag(); // leaving arrange mode never leaves a row armed or dimmed
          }}
        >
          {sortMode ? "✓ Done arranging" : "↕ Arrange tabs"}
        </button>
        {sortMode && navOrder ? (
          <button
            type="button"
            className="text-[11px] text-sidebar-foreground/45 transition-colors hover:text-sidebar-foreground/80"
            onClick={() => {
              setNavOrder(null);
              try {
                localStorage.removeItem("sodio-nav-order");
              } catch {
                /* noop */
              }
            }}
          >
            Reset
          </button>
        ) : null}
        {/* the grip is the affordance; this line just names the second path */}
        {sortMode ? (
          <span className="basis-full text-[11px] text-sidebar-foreground/35">
            drag <GripVertical className="inline size-3 align-[-2px]" /> or use ↑ ↓
          </span>
        ) : null}
      </div>
    </nav>
  );

  const credit = (
    <a
      href="http://elevate2point0.com/"
      target="_blank"
      rel="noreferrer"
      className="flex items-center justify-center gap-1.5 px-5 pb-4 text-[11px] text-sidebar-foreground/55 transition-opacity hover:opacity-80"
      title="Created by 2.0 — elevate2point0.com"
    >
      <span>Created by</span>
      {/* the sidebar is dark in BOTH themes → the white-on-dark 2.0 mark reads
          correctly here (the black light-mode variant ships for light surfaces) */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/2.0-dark.png" alt="2.0" className="h-4 w-auto" />
    </a>
  );

  // the DRAWER omits the bell + theme toggle: on phones both already live in
  // the top bar — no duplicated controls
  const userBlock = (inDrawer: boolean) => (
    <div className={cn("border-t border-sidebar-border p-3", !inDrawer && railed && "px-1.5")}>
      <div
        className={cn(
          "flex rounded-lg px-2 py-2",
          !inDrawer && railed
            ? "flex-col items-center gap-1 px-0"
            : inDrawer
              ? "items-center gap-2"
              : // desktop, expanded: the name gets the WHOLE row and the buttons
                // sit underneath it. Three icon buttons beside a 9-unit avatar
                // left ~60px for the name, so everyone read as "A…"
                "flex-col items-stretch gap-0.5"
        )}
      >
        <Link
          href="/profile"
          onClick={() => setOpen(false)}
          data-tour={inDrawer ? undefined : "nav:/profile"}
          className={cn(
            "flex min-w-0 items-center gap-3 rounded-lg transition-opacity hover:opacity-80",
            !inDrawer && railed ? "justify-center" : inDrawer ? "flex-1" : "w-full"
          )}
          title="My profile"
        >
          <Avatar className="size-9">
            {user.photoUrl ? <AvatarImage src={user.photoUrl} alt="" /> : null}
            <AvatarFallback className="bg-sidebar-primary text-sidebar-primary-foreground text-xs font-bold">
              {user.name.slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className={cn("min-w-0 flex-1", !inDrawer && railed && "hidden")}>
            <p className="truncate text-sm font-semibold text-sidebar-foreground">{user.name}</p>
            <p className="truncate text-xs text-sidebar-foreground/60">
              {user.isAdmin ? "Admin" : user.role}
              {user.functions.length > 0 ? ` · ${user.functions.join(", ")}` : ""}
            </p>
          </div>
        </Link>
        {/* One toolbar, three EQUAL segments — notifications · appearance ·
            sign out, in that order: the one you touch daily, the one you touch
            sometimes, the one you touch last. Equal widths make it read as a
            deliberate strip; a lone button shoved to the far edge read as an
            accident. */}
        <div
          className={cn(
            "flex items-center",
            !inDrawer && railed ? "flex-col gap-1" : !inDrawer ? "gap-0.5" : "gap-1"
          )}
        >
          {!inDrawer && !railed ? (
            <>
              <NotificationsBell canBroadcast={canBroadcast} className="flex-1" />
              <ThemeToggle className="flex-1 text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground" />
            </>
          ) : null}
          <form action={signOutAction} className={cn(!inDrawer && !railed && "flex-1")}>
            <Button
              type="submit"
              variant="ghost"
              size="icon"
              className={cn(
                "text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground",
                !inDrawer && !railed && "w-full"
              )}
              title="Sign out"
            >
              <LogOut className="size-4" />
            </Button>
          </form>
        </div>
      </div>
    </div>
  );

  /** The collapse control. A row at the FOOT of the nav, styled like the tabs
   *  it sits under — a floating chip on the sidebar's edge overlapped the
   *  brand and read as an accident. */
  const railedToggle = (
    <button
      type="button"
      onClick={() => {
        const next = !railed;
        setRailed(next);
        try { localStorage.setItem("sodio-nav-railed", next ? "1" : "0"); } catch {}
      }}
      title={railed ? "Expand the sidebar" : "Collapse the sidebar — more room for the table"}
      aria-label={railed ? "Expand the sidebar" : "Collapse the sidebar"}
      className={cn(
        "mx-3 mb-1 hidden items-center gap-3 rounded-lg px-3 py-2 text-sm text-sidebar-foreground/55 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground md:flex",
        railed && "mx-1.5 justify-center px-0"
      )}
    >
      {railed ? (
        <ChevronsRight className="size-4.5 shrink-0" />
      ) : (
        <ChevronsLeft className="size-4.5 shrink-0" />
      )}
      {railed ? null : <span className="truncate">Collapse</span>}
    </button>
  );

  const brand = (
    <Link
      href={effectiveHome}
      onClick={() => setOpen(false)}
      title="Home — your workspace"
      className={cn(
        "flex items-center gap-2 py-5 transition-opacity hover:opacity-80",
        railed ? "justify-center px-0" : "px-4"
      )}
    >
      {/* TWO MARKS, ONE SLOT (v33.8). The AIESEC wordmark is a WIDE lockup —
          squeezed into a 3.75rem rail it shrank to an illegible smear. The
          rail gets the walking human instead, which is the same brand at a
          square aspect, and the two cross-fade so the collapse reads as one
          movement rather than a pop. */}
      {/* THE BOX MUST MATCH THE TALLEST THING IN IT (v33.28) — an h-7 span
          holding an h-8 image bled 4px and sliced the wordmark's top edge. */}
      <span className="relative grid h-8 shrink-0 place-items-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/brand/aiesec-white.png"
          alt="AIESEC"
          className={cn(
            // a 4.9:1 lockup at h-7 is 137px wide — too much for a 200px row,
            // which is what pushed the caption into being sliced
            "col-start-1 row-start-1 h-5 w-auto transition-all duration-300",
            railed ? "scale-90 opacity-0" : "opacity-100"
          )}
        />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/brand/walk.png"
          alt="AIESEC"
          className={cn(
            "walkman-tint col-start-1 row-start-1 h-8 w-8 object-contain transition-all duration-300",
            railed ? "opacity-100" : "scale-90 opacity-0"
          )}
        />
      </span>
      <div
        className={cn(
          "min-w-0 overflow-hidden whitespace-nowrap leading-tight transition-all duration-300",
          // the text block OWNS the remaining space instead of a fixed w-32
          // that silently sliced "AIESEC in Alexandria" mid-letter
          railed ? "ml-0 w-0 opacity-0" : "flex-1 opacity-100"
        )}
      >
        <p className="truncate text-sm font-black tracking-tight text-sidebar-foreground">Sodio</p>
        <p className="truncate text-[10px] text-sidebar-foreground/60">AIESEC in Alexandria</p>
      </div>
    </Link>
  );

  return (
    <div className="flex min-h-screen w-full">
      {/* shared-sheet freshness: refetch on focus + every 30s while visible */}
      <AutoRefresh />
      {/* slow-navigation feedback: the walking man appears after 250ms */}
      {navTarget ? (
        // pointer-events-none: purely informational — it must never swallow
        // clicks (especially while still invisible during its 250ms delay)
        <div className="nav-overlay pointer-events-none fixed inset-0 z-[70] flex items-center justify-center bg-background/70">
          <WalkingLoader label="Taking you there…" />
        </div>
      ) : null}
      {/* manual refresh + the report button — pinned top-right, always reachable */}
      <div className="fixed right-4 top-3 z-40 hidden items-center gap-1.5 md:flex">
        {/* the admin's test view, next to the report button (v33.42) — the
            question "what does a Member see HERE?" is asked on the page you
            are looking at, not on the profile */}
        {viewAsTargets.length > 0 ? (
          <TestViewButton
            targets={viewAsTargets}
            className="rounded-full border bg-card/85 text-muted-foreground shadow-sm backdrop-blur hover:bg-muted hover:text-foreground"
          />
        ) : null}
        <FeedbackButton className="rounded-full border bg-card/85 shadow-sm backdrop-blur hover:bg-muted" />
        <RefreshButton className="rounded-full border bg-card/85 text-muted-foreground shadow-sm backdrop-blur hover:bg-muted hover:text-foreground" />
      </div>
      {/* Desktop sidebar — it is `fixed inset-y-0`, so it is exactly one
          viewport tall and CANNOT scroll with the page. Since v29/v30 the nav
          carries ~13 items + the arrange row + the feedback note (~850px), so
          on any window under ~850px tall (every 1366×768 laptop) the bottom of
          this column — the user block with SIGN OUT, and the 2.0 credit — used
          to be pushed off-screen and was unreachable. It scrolls itself now;
          the nav keeps its content height (flex min-height:auto), so items are
          never squashed. */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-30 hidden flex-col bg-sidebar pb-[env(safe-area-inset-bottom)] md:flex",
          // one easing for the whole collapse — the width, the wordmark and
          // the labels all move together (v33.8)
          "transition-[width] duration-300 ease-out",
          railed ? "w-[3.75rem]" : "w-60"
        )}
        data-railed={railed ? "true" : undefined}
      >
        {brand}
        {navList}
        {railedToggle}
        {userBlock(false)}
        {railed ? null : credit}
      </aside>


      {/* Mobile top bar */}
      <div className="fixed inset-x-0 top-0 z-30 flex items-center gap-2 border-b bg-sidebar px-3 py-2.5 pt-[calc(0.625rem+env(safe-area-inset-top))] md:hidden">
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="text-sidebar-foreground"
              data-tour="nav:open"
              aria-label="Open the menu"
            >
              <Menu className="size-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="flex w-64 flex-col bg-sidebar p-0 pb-[env(safe-area-inset-bottom)] border-sidebar-border">
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            {brand}
            {navList}
            {userBlock(true)}
            {credit}
          </SheetContent>
        </Sheet>
        {/* on a ≤360px phone the logo was the thing that got squeezed (v33.28) */}
        <Link href={effectiveHome} className="flex min-w-0 items-center gap-2" title="Home — your workspace">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/aiesec-white.png" alt="AIESEC" className="h-5 w-auto shrink-0" />
          <p className="truncate text-sm font-black tracking-tight text-sidebar-foreground">Sodio</p>
        </Link>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {viewAsTargets.length > 0 ? (
            <TestViewButton
              targets={viewAsTargets}
              className="text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground"
            />
          ) : null}
          <FeedbackButton className="text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground" />
          <NotificationsBell canBroadcast={canBroadcast} />
          <ThemeToggle className="text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground" />
          <RefreshButton />
        </div>
      </div>

      {/* The bottom padding has to clear THREE things at once: the phone's home
          indicator (safe-area inset — we ship `viewport-fit=cover`, and the PWA
          runs full-bleed), the floating Blue Man button and the draggable
          test-view chip. 7rem + the inset keeps the last card of a page (the
          profile's cards, the dashboard's drill-down) fully readable. */}
      <main
        className={cn(
          "min-w-0 flex-1 px-4 pb-[calc(7rem+env(safe-area-inset-bottom))] pt-[calc(4rem+env(safe-area-inset-top))] transition-[margin] duration-300 ease-out md:px-8 md:pt-14",
          railed ? "md:ml-[3.75rem]" : "md:ml-60"
        )}
      >
        {/* 🏆 v33.52 — the national conference the whole LC works towards.
            In the page's own flow (never fixed): a second fixed bar would sit
            on top of the phone's top bar and fight it for the same 3rem. */}
        <div className="mb-4">
          <ActivateStrip />
        </div>
        {children}
      </main>

      {/* v29: the must-do prompt — after three ignored reminders it meets the
          member here, on every app open, until the record lands */}
      <PendingPrompt />

      {/* 🃏 v33.51 — mounted ONLY for a member the EB has put in a mood, and
          only while it lasts. Everything it does is cosmetic and self-
          reverting; it never mounts in a test view (an admin diagnosing
          somebody's screen must see the real thing). */}
      {prank?.on ? <Prankster prankedBy={prank.by} /> : null}

      {/* The Blue Man — Sodio's assistant (persistent per-user chats +
          role/module-aware suggested questions) */}
      <BlueManChat
        userEmail={user.email}
        role={user.role}
        modules={{
          raising: nav.raising,
          signups: nav.signups,
          consideration: nav.consideration,
          tm: nav.tm,
        }}
      />
    </div>
  );
}
