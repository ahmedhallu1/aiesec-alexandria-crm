"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  LayoutDashboard,
  Building2,
  CalendarDays,
  Users,
  UsersRound,
  Menu,
  LogOut,
  Inbox,
  MessageSquareHeart,
  BookOpen,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { ThemeToggle } from "./theme-toggle";
import { NotificationsBell } from "./notifications-bell";
import { AutoRefresh, RefreshButton } from "./auto-refresh";
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
  nav: { raising: boolean; tm: boolean; membership: boolean; feedbackInbox: boolean };
  signOutAction: () => Promise<void>;
  children: React.ReactNode;
}

export function AppShell({ user, nav, signOutAction, children }: ShellProps) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
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
    ...(nav.tm ? [{ href: "/members", label: "Talent Management", icon: UsersRound }] : []),
    ...(nav.membership ? [{ href: "/membership", label: "Membership", icon: Users }] : []),
    { href: "/playbook", label: "Playbook", icon: BookOpen },
    { href: "/feedback", label: "Feedback", icon: MessageSquareHeart },
    ...(nav.feedbackInbox ? [{ href: "/feedback/inbox", label: "Feedback inbox", icon: Inbox }] : []),
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
            onClick={() => setOpen(false)}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              active && "bg-sidebar-primary text-sidebar-primary-foreground hover:bg-sidebar-primary"
            )}
          >
            <item.icon className="size-4.5" />
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

  const userBlock = (
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
        <RefreshButton />
        <NotificationsBell canBroadcast={canBroadcast} />
        <ThemeToggle className="text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground" />
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
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col bg-sidebar md:flex">
        {brand}
        {navList}
        {userBlock}
        {credit}
      </aside>

      {/* Mobile top bar */}
      <div className="fixed inset-x-0 top-0 z-30 flex items-center gap-2 border-b bg-sidebar px-3 py-2.5 md:hidden">
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" className="text-sidebar-foreground">
              <Menu className="size-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="flex w-64 flex-col bg-sidebar p-0 border-sidebar-border">
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            {brand}
            {navList}
            {userBlock}
            {credit}
          </SheetContent>
        </Sheet>
        <Link href="/" className="flex items-center gap-2" title="Home — your accounts">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/aiesec-white.png" alt="AIESEC" className="h-6 w-auto" />
          <p className="text-sm font-black tracking-tight text-sidebar-foreground">Sodio</p>
        </Link>
      </div>

      <main className="min-w-0 flex-1 px-4 pb-24 pt-16 md:ml-60 md:px-8 md:pt-8">{children}</main>

      {/* The Blue Man — Sodio's assistant */}
      <BlueManChat />
    </div>
  );
}
