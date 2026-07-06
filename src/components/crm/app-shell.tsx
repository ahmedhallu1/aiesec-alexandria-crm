"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  LayoutDashboard,
  Building2,
  ShieldBan,
  Users,
  Menu,
  LogOut,
  Inbox,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

interface ShellProps {
  user: {
    name: string;
    email: string;
    role: string;
    function: string | null;
    photoUrl: string | null;
    isAdmin: boolean;
  };
  nav: { raising: boolean; blacklist: boolean; membership: boolean; blacklistManage: boolean };
  signOutAction: () => Promise<void>;
  children: React.ReactNode;
}

export function AppShell({ user, nav, signOutAction, children }: ShellProps) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const items = [
    ...(nav.raising
      ? [
          { href: "/", label: "Dashboard", icon: LayoutDashboard },
          { href: "/accounts", label: "Accounts", icon: Building2 },
        ]
      : []),
    ...(nav.blacklist ? [{ href: "/blacklist", label: "Blacklist", icon: ShieldBan }] : []),
    ...(nav.membership
      ? [
          { href: "/membership", label: "Membership", icon: Users },
          { href: "/feedback", label: "Feedback inbox", icon: Inbox },
        ]
      : []),
  ];

  const navList = (
    <nav className="flex flex-1 flex-col gap-1 p-3">
      {items.map((item) => {
        const active =
          item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
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
    </nav>
  );

  const credit = (
    <a
      href="https://wa.me/201099019374?text=Hi%20Ahmed!%20I%27m%20reaching%20out%20about%20the%20AIESEC%20Alexandria%20CRM%20%F0%9F%91%8B"
      target="_blank"
      rel="noreferrer"
      className="block px-5 pb-4 text-center text-[11px] text-sidebar-foreground/50 transition-colors hover:text-sidebar-foreground"
    >
      System made by <span className="font-semibold">Ahmed Hallul</span> · 💬 WhatsApp
    </a>
  );

  const userBlock = (
    <div className="border-t border-sidebar-border p-3">
      <div className="flex items-center gap-3 rounded-lg px-2 py-2">
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
            {user.function ? ` · ${user.function}` : ""}
          </p>
        </div>
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
    <div className="flex items-center gap-2.5 px-5 py-5">
      <div className="flex size-9 items-center justify-center rounded-xl bg-primary text-lg font-black text-primary-foreground">
        A
      </div>
      <div className="leading-tight">
        <p className="text-sm font-bold text-sidebar-foreground">AIESEC in Alexandria</p>
        <p className="text-[11px] text-sidebar-foreground/60">ICX CRM</p>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen w-full">
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
        <p className="text-sm font-bold text-sidebar-foreground">
          AIESEC <span className="text-primary">CRM</span>
        </p>
      </div>

      <main className="flex-1 px-4 pb-24 pt-16 md:ml-60 md:px-8 md:pt-8">{children}</main>
    </div>
  );
}
