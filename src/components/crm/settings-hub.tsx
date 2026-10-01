"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Bell, BookOpen, Building2, Database, ExternalLink, Landmark, Loader2, SlidersHorizontal, Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { fmtDateTime } from "@/lib/types";
import type { MemberSettings, PersonalDefaults, SettingsContext } from "@/lib/member-settings";
import type { Handover, LcTermState } from "@/lib/lc-term";
import type { LcOverview } from "@/server/lc-term";
import type { PersonCard } from "@/server/data";
import { saveMyDefault } from "@/server/actions";
import { SettingsPanel } from "./settings-panel";
import { ExportButton } from "./export-button";
import { LcSettingsSection } from "./lc-settings-section";
import { ActiveToggle, FunctionDefaultsBlock, type FunctionSettingsCard } from "./profile-view";
import { MmAccessCard } from "./mm-access-card";
import type { MmAccessBlock } from "@/server/data";

export type HubTab = "notifications" | "defaults" | "team" | "function" | "data" | "handover" | "lc";

const TAB_META: Record<HubTab, { label: string; icon: typeof Bell; blurb: string }> = {
  notifications: { label: "Notifications & account", icon: Bell, blurb: "Every email and app notification, your sign-in details, how Sodio looks." },
  defaults: { label: "My defaults", icon: SlidersHorizontal, blurb: "How Sodio opens for you: your home page, dashboard, list sizes." },
  team: { label: "My team", icon: Users, blurb: "The people who report to you — who's active." },
  function: { label: "My function", icon: Building2, blurb: "Your MMs' access and the rules your whole function starts from." },
  data: { label: "My data", icon: Database, blurb: "Download what you can see, as Excel or CSV." },
  handover: { label: "Handover", icon: BookOpen, blurb: "What the previous EB left for you." },
  lc: { label: "LC & new term", icon: Landmark, blurb: "New peak or term, membership, planning, handover." },
};

const SIGNUP_VIEW_LABEL: Record<string, string> = {
  unassigned: "The unassigned pool",
  mine: "My sign-ups",
  team: "My team",
  all: "All sign-ups",
  archived: "Archived",
  cic: "CIC calls",
  referrals: "Referrals",
};

/**
 * SETTINGS — ONE PLACE, IN SECTIONS, SHAPED TO THE PERSON (v37.2).
 *
 * The sections a person sees are decided on the server from what they are:
 * everyone gets Notifications & account, My defaults and My data; a Team
 * Leader also My team; a VP or Director My function (and the Handover their
 * predecessors left); the LCP and the admins the LC tools. Nobody sees a
 * section with nothing in it for them.
 */
export function SettingsHub({
  tab,
  tabs,
  notifications,
  defaults,
  team,
  fnSettings,
  mmAccess = [],
  exports,
  handover,
  lc,
}: {
  tab: HubTab;
  tabs: HubTab[];
  notifications: { settings: MemberSettings; context: SettingsContext };
  defaults: {
    values: PersonalDefaults;
    homeOptions: { value: string; label: string }[];
    laneOptions: { value: string; label: string }[];
    pageSizes: number[];
    signupViews: string[];
  };
  team: PersonCard[] | null;
  fnSettings: FunctionSettingsCard[];
  mmAccess?: MmAccessBlock[];
  exports: { id: string; label: string; description: string }[];
  handover: { handover: Handover; functions: string[]; state: LcTermState | null } | null;
  lc: LcOverview | null;
}) {
  const router = useRouter();
  const [navPending, startNav] = useTransition();
  const go = (t: HubTab) => startNav(() => router.replace(`/profile/settings?tab=${t}`, { scroll: false }));

  return (
    <div className={cn("grid gap-4 md:grid-cols-[14rem_1fr]", navPending && "nav-pending")}>
      {/* the sections — a column on desktop, a scrolling row on a phone */}
      <nav className="flex gap-1 overflow-x-auto pb-1 md:flex-col md:overflow-visible md:pb-0">
        {tabs.map((t) => {
          const M = TAB_META[t];
          return (
            <button
              key={t}
              type="button"
              onClick={() => go(t)}
              className={cn(
                "flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors",
                tab === t ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
              )}
            >
              <M.icon className="size-4 shrink-0" />
              {M.label}
            </button>
          );
        })}
      </nav>

      <div className="min-w-0 space-y-4">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold">
            {TAB_META[tab].label}
            {navPending ? <Loader2 className="size-4 animate-spin text-primary" /> : null}
          </h2>
          <p className="text-sm text-muted-foreground">{TAB_META[tab].blurb}</p>
        </div>

        {tab === "notifications" ? (
          <SettingsPanel settings={notifications.settings} context={notifications.context} />
        ) : tab === "defaults" ? (
          <MyDefaults {...defaults} />
        ) : tab === "team" && team ? (
          <Card>
            <CardContent className="space-y-1.5 pt-4">
              {team.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nobody reports to you on the membership yet.</p>
              ) : (
                team.map((p) => (
                  <div
                    key={p.id}
                    className={cn(
                      "flex flex-wrap items-center gap-3 rounded-lg border p-2.5",
                      p.is_active === false && "border-dashed bg-muted/40 opacity-75"
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold" dir="auto">
                        {p.name}
                        {p.is_active === false ? <Badge variant="outline" className="ml-1.5 text-[10px]">Inactive</Badge> : null}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {p.role}{p.functions.length ? ` · ${p.functions.join(", ")}` : ""} · {p.email ?? "no email"}
                      </p>
                    </div>
                    {p.canToggleActive ? <ActiveToggle person={p} /> : null}
                  </div>
                ))
              )}
              <p className="pt-2 text-xs text-muted-foreground">
                Marking someone inactive stops them signing in and takes them off every list; their
                accounts and history stay theirs. It&apos;s written to the Membership too.
              </p>
            </CardContent>
          </Card>
        ) : tab === "function" ? (
          <div className="space-y-4">
            <MmAccessCard blocks={mmAccess} />
            <Card>
              <CardContent className="space-y-4 pt-4">
                {fnSettings.map((s) => (
                  <FunctionDefaultsBlock key={s.fn} settings={s} />
                ))}
              </CardContent>
            </Card>
          </div>
        ) : tab === "data" ? (
          <div className="grid gap-2">
            {exports.map((e) => (
              <Card key={e.id} className="py-0">
                <CardContent className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">{e.label}</p>
                    <p className="text-xs text-muted-foreground">{e.description}</p>
                  </div>
                  <ExportButton kind={e.id} label="Download" />
                </CardContent>
              </Card>
            ))}
            <p className="text-xs text-muted-foreground">
              Everything here holds only what you can already see in Sodio. For the rows on screen
              with your filters, use the Export button on that page (Raising, Sign-ups, Dashboard…).
            </p>
          </div>
        ) : tab === "handover" && handover ? (
          <HandoverView data={handover} />
        ) : tab === "lc" && lc ? (
          <LcSettingsSection lc={lc} />
        ) : null}
      </div>
    </div>
  );
}

function MyDefaults({
  values,
  homeOptions,
  laneOptions,
  pageSizes,
  signupViews,
}: {
  values: PersonalDefaults;
  homeOptions: { value: string; label: string }[];
  laneOptions: { value: string; label: string }[];
  pageSizes: number[];
  signupViews: string[];
}) {
  const router = useRouter();
  const [saving, setSaving] = useState<string | null>(null);
  const [savePending, start] = useTransition();

  const save = (key: keyof PersonalDefaults, value: string) => {
    setSaving(key);
    start(async () => {
      try {
        const v = value === "__system" ? null : key === "pageSize" ? Number(value) : value;
        const r = await saveMyDefault(key, v);
        if (r.ok) {
          toast.success("Saved.");
          router.refresh();
        } else toast.error(r.error);
      } catch {
        toast.error("Couldn't save — try again.");
      } finally {
        setSaving(null);
      }
    });
  };

  const rows: {
    key: keyof PersonalDefaults;
    label: string;
    hint: string;
    options: { value: string; label: string }[];
    show: boolean;
  }[] = [
    {
      key: "home",
      label: "My home page",
      hint: "Where Sodio opens after you sign in.",
      options: homeOptions,
      show: homeOptions.length > 1,
    },
    {
      key: "dashboardLane",
      label: "My dashboard",
      hint: "The lane the dashboard opens on.",
      options: laneOptions,
      show: laneOptions.length > 1,
    },
    {
      key: "pageSize",
      label: "Rows per page",
      hint: "On Raising, Sign-ups, Consideration and Attendance — unless you pick another on the page.",
      options: pageSizes.map((n) => ({ value: String(n), label: `${n} rows` })),
      show: true,
    },
    {
      key: "signupsView",
      label: "Sign-ups opens on",
      hint: "The view you land on in Sign-ups.",
      options: signupViews.map((v) => ({ value: v, label: SIGNUP_VIEW_LABEL[v] ?? v })),
      show: signupViews.length > 1,
    },
  ];

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">How Sodio opens for you</CardTitle>
        <p className="text-sm text-muted-foreground">
          Saved to your account — the same on every device. “System default” is what Sodio
          does for everyone in your role.
        </p>
      </CardHeader>
      <CardContent className="grid gap-3">
        {rows
          .filter((r) => r.show)
          .map((r) => {
            const current = values[r.key];
            return (
              <div key={r.key} className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">{r.label}</p>
                  <p className="text-xs text-muted-foreground">{r.hint}</p>
                </div>
                <Select
                  value={current == null ? "__system" : String(current)}
                  onValueChange={(v) => save(r.key, v)}
                  disabled={savePending && saving === r.key}
                >
                  <SelectTrigger className="h-9 w-56">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__system">System default</SelectItem>
                    {r.options.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            );
          })}
        <p className="text-xs text-muted-foreground">
          Theme, phone notifications and the phone list style are under Notifications &amp; account.
        </p>
      </CardContent>
    </Card>
  );
}

function HandoverView({
  data,
}: {
  data: { handover: Handover; functions: string[]; state: LcTermState | null };
}) {
  const { handover, functions, state } = data;
  return (
    <div className="space-y-3">
      {state ? (
        <p className="text-sm text-muted-foreground">
          {state.kind === "term" ? `Term ${state.termLabel}` : state.peakLabel} — started{" "}
          {fmtDateTime(state.startedAt)} by {state.startedBy}.
        </p>
      ) : null}
      {handover.general ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">For the whole EB</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap text-sm" dir="auto">{handover.general}</p>
          </CardContent>
        </Card>
      ) : null}
      {functions.map((f) => (
        <Card key={f}>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{f}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap text-sm" dir="auto">{handover.perFunction[f]}</p>
          </CardContent>
        </Card>
      ))}
      {handover.links.length > 0 ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Links</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-1.5">
            {handover.links.map((l) => (
              <a
                key={l.url}
                href={l.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
              >
                {l.label} <ExternalLink className="size-3.5" />
              </a>
            ))}
          </CardContent>
        </Card>
      ) : null}
      {handover.updatedAt ? (
        <p className="text-xs text-muted-foreground">
          Written {fmtDateTime(handover.updatedAt)}{handover.updatedBy ? ` by ${handover.updatedBy}` : ""}.
        </p>
      ) : null}
      <p className="text-xs text-muted-foreground">
        Questions about it? <Link prefetch={false} href="/help" className="underline">Help</Link> or ask your LCP.
      </p>
    </div>
  );
}
