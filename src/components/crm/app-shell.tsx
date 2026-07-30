"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  LayoutDashboard,
  Building2,
  CalendarDays,
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
import { WalkingLoader } from "./walking-loader";
import { BlueManChat } from "./blue-man-chat";

interface ShellProps {
  user: {
    name: string;
    email: string;
    role: string;
    functions: string[];
    photoUrl: string | null;
    isAdmin: boolean;
  };
  nav: { raising: boolean; tm: boolean; membership: boolean; planning: boolean; ogtMail: boolean; signups: boolean };
  signOutAction: () => Promise<void>;
  children: React.ReactNode;
}

export function AppShell({ user, nav, signOutAction, children }: ShellProps) {
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

  // Accounts is the daily workspace — it leads, and "/" lands on it
  const items = [
    ...(nav.raising
      ? [
          { href: "/accounts", label: "Accounts", icon: Building2 },
          { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
          { href: "/calendar", label: "Calendar", icon: CalendarDays },
        ]
      : []),
    ...(nav.signups ? [{ href: "/signups", label: "Sign-ups", icon: UserRoundPlus }] : []),
    ...(nav.planning ? [{ href: "/planning", label: "Planning", icon: Target }] : []),
    ...(nav.ogtMail ? [{ href: "/ogt-mail", label: "Expectation mail", icon: MailPlus }] : []),
    ...(nav.tm ? [{ href: "/members", label: "Talent Management", icon: UsersRound }] : []),
    ...(nav.membership ? [{ href: "/membership", label: "Membership", icon: Users }] : []),
    { href: "/playbook", label: "Playbook", icon: BookOpen },
    // system feedback moved to the Profile page (v21) — this is feedback about
    // PEOPLE in the LC: shout-outs & concerns
    { href: "/lc-feedback", label: "LC Feedback", icon: MessageSquareHeart },
    ...(user.isAdmin ? [{ href: "/admin", label: "Health & Logs", icon: Activity }] : []),
  ];

  const navList = (
    <nav className="flex flex-1 flex-col gap-1 p-3">
      {items.map((item) => {
        const active =
          pathname === item.href ||
          (item.href === "/accounts" && pathname === "/") ||
          (item.href !== "/feedback" && pathname.startsWith(item.href + "/")) ||
          (item.href === "/feedback" && pathname === "/feedback");
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={(e) => {
              setOpen(false);
              // modified clicks open a new tab — this tab never navigates
              const modified =
                e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0;
              if (!active && !modified) setNavTarget(item.href);
            }}
            className={cn(
              "group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-sidebar-foreground/80 transition-all hover:translate-x-0.5 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground motion-reduce:hover:translate-x-0",
              active &&
                "bg-sidebar-primary text-sidebar-primary-foreground shadow-[0_0_18px_-6px_rgb(3_126_243/0.8)] hover:translate-x-0 hover:bg-sidebar-primary"
            )}
          >
            <item.icon className="size-4.5 transition-transform group-hover:scale-110 motion-reduce:group-hover:scale-100" />
            {item.label}
          </Link>
        );
      })}
      <p className="mt-1 px-3 text-[11px] leading-snug text-sidebar-foreground/45">
        Your feedback builds this system for <b>YOU</b> — every idea or bug you
        report makes it better and more reliable. 💙
      </p>
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
    <div className="border-t border-sidebar-border p-3">
      <div className="flex items-center gap-2 rounded-lg px-2 py-2">
        <Link
          href="/profile"
          onClick={() => setOpen(false)}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-lg transition-opacity hover:opacity-80"
          title="My profile"
        >
          <Avatar className="size-9">
            {user.photoUrl ? <AvatarImage src={user.photoUrl} alt="" /> : null}
            <AvatarFallback className="bg-sidebar-primary text-sidebar-primary-foreground text-xs font-bold">
              {user.name.slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-sidebar-foreground">{user.name}</p>
            <p className="truncate text-xs text-sidebar-foreground/60">
              {user.isAdmin ? "Admin" : user.role}
              {user.functions.length > 0 ? ` · ${user.functions.join(", ")}` : ""}
            </p>
          </div>
        </Link>
        {!inDrawer ? (
          <>
            <NotificationsBell canBroadcast={canBroadcast} />
            <ThemeToggle className="text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground" />
          </>
        ) : null}
        <form action={signOutAction}>
          <Button
            type="submit"
            variant="ghost"
            size="icon"
            className="text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground"
            title="Sign out"
          >
            <LogOut className="size-4" />
          </Button>
        </form>
      </div>
    </div>
  );

  const brand = (
    <Link
      href="/"
      onClick={() => setOpen(false)}
      title="Home — your accounts"
      className="flex items-center gap-2.5 px-5 py-5 transition-opacity hover:opacity-80"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/aiesec-white.png" alt="AIESEC" className="h-7 w-auto" />
      <div className="leading-tight">
        <p className="text-sm font-black tracking-tight text-sidebar-foreground">Sodio</p>
        <p className="text-[10px] text-sidebar-foreground/60">AIESEC in Alexandria</p>
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
      {/* manual refresh — pinned top-right over the content, always reachable */}
      <div className="fixed right-4 top-3 z-40 hidden md:block">
        <RefreshButton className="rounded-full border bg-card/85 text-muted-foreground shadow-sm backdrop-blur hover:bg-muted hover:text-foreground" />
      </div>
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col bg-sidebar md:flex">
        {brand}
        {navList}
        {userBlock(false)}
        {credit}
      </aside>

      {/* Mobile top bar */}
      <div className="fixed inset-x-0 top-0 z-30 flex items-center gap-2 border-b bg-sidebar px-3 py-2.5 pt-[calc(0.625rem+env(safe-area-inset-top))] md:hidden">
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" className="text-sidebar-foreground">
              <Menu className="size-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="flex w-64 flex-col overflow-y-auto bg-sidebar p-0 border-sidebar-border">
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            {brand}
            {navList}
            {userBlock(true)}
            {credit}
          </SheetContent>
        </Sheet>
        <Link href="/" className="flex items-center gap-2" title="Home — your accounts">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/aiesec-white.png" alt="AIESEC" className="h-6 w-auto" />
          <p className="text-sm font-black tracking-tight text-sidebar-foreground">Sodio</p>
        </Link>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <NotificationsBell canBroadcast={canBroadcast} />
          <ThemeToggle className="text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground" />
          <RefreshButton />
        </div>
      </div>

      <main className="min-w-0 flex-1 px-4 pb-24 pt-[calc(4rem+env(safe-area-inset-top))] md:ml-60 md:px-8 md:pt-14">{children}</main>

      {/* The Blue Man — Sodio's assistant */}
      <BlueManChat />
    </div>
  );
}
