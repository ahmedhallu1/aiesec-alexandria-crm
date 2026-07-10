"use client";

import { Globe, Mail, MessageCircle, MoreHorizontal, Phone } from "lucide-react";

/* lucide no longer ships brand icons — minimal inline glyphs instead */
const LinkedinIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
    <path d="M20.45 20.45h-3.55v-5.57c0-1.33-.03-3.04-1.85-3.04-1.86 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05c.47-.9 1.63-1.85 3.36-1.85 3.6 0 4.27 2.37 4.27 5.45v6.29ZM5.34 7.43a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12ZM7.12 20.45H3.56V9h3.56v11.45Z" />
  </svg>
);
const InstagramIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className} aria-hidden>
    <rect x="3" y="3" width="18" height="18" rx="5" />
    <circle cx="12" cy="12" r="4" />
    <circle cx="17.2" cy="6.8" r="1" fill="currentColor" stroke="none" />
  </svg>
);
const FacebookIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
    <path d="M13.5 21v-7h2.4l.36-2.8H13.5V9.4c0-.81.22-1.36 1.38-1.36h1.48V5.55c-.26-.03-1.13-.11-2.15-.11-2.13 0-3.58 1.3-3.58 3.68v2.08H8.25V14h2.38v7h2.87Z" />
  </svg>
);
import { quickActions, type AccountContact } from "@/lib/types";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Hint } from "./hint";

function linkIcon(tag: string) {
  const t = tag.toLowerCase();
  if (t.includes("linkedin")) return <LinkedinIcon className="size-3.5" />;
  if (t.includes("instagram")) return <InstagramIcon className="size-3.5" />;
  if (t.includes("facebook")) return <FacebookIcon className="size-3.5" />;
  return <Globe className="size-3.5" />;
}

interface ActionItem {
  key: string;
  label: string;
  href: string;
  icon: React.ReactNode;
}

export function buildActions(contacts: AccountContact[] | null | undefined): ActionItem[] {
  const qa = quickActions(contacts);
  const items: ActionItem[] = [];
  if (qa.whatsapp)
    items.push({
      key: "wa",
      label: `WhatsApp ${qa.whatsapp}`,
      href: `https://wa.me/${qa.whatsapp}`,
      icon: <MessageCircle className="size-3.5" />,
    });
  if (qa.call)
    items.push({
      key: "call",
      label: `Call ${qa.call}`,
      href: `tel:${qa.call}`,
      icon: <Phone className="size-3.5" />,
    });
  if (qa.email)
    items.push({
      key: "mail",
      label: `Email ${qa.email}`,
      href: `mailto:${qa.email}`,
      icon: <Mail className="size-3.5" />,
    });
  for (const [i, link] of qa.links.entries())
    items.push({
      key: `link${i}`,
      label: `${link.tag}: ${link.value}`,
      href: link.value,
      icon: linkIcon(link.tag),
    });
  return items;
}

/** One-tap WhatsApp / call / email / social actions straight from the list.
 *  Shows up to `max` icons; the rest collapse into a "…" menu. */
export function QuickActions({
  contacts, max = 4,
}: {
  contacts: AccountContact[] | null | undefined;
  max?: number;
}) {
  const items = buildActions(contacts);
  if (items.length === 0) return null;
  const visible = items.length > max ? items.slice(0, max - 1) : items;
  const overflow = items.length > max ? items.slice(max - 1) : [];

  return (
    <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
      {visible.map((a) => (
        <Hint key={a.key} label={a.label}>
          <Button asChild variant="outline" size="icon" className="size-7">
            <a
              href={a.href}
              target={a.href.startsWith("http") ? "_blank" : undefined}
              rel="noreferrer"
            >
              {a.icon}
            </a>
          </Button>
        </Hint>
      ))}
      {overflow.length > 0 ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon" className="size-7" title="More contact options">
              <MoreHorizontal className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {overflow.map((a) => (
              <DropdownMenuItem key={a.key} asChild>
                <a
                  href={a.href}
                  target={a.href.startsWith("http") ? "_blank" : undefined}
                  rel="noreferrer"
                  className="flex items-center gap-2"
                >
                  {a.icon} {a.label}
                </a>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}
