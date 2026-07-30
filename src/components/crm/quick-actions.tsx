"use client";

import { Globe, Mail, MoreHorizontal, Phone } from "lucide-react";
import { FacebookIcon, InstagramIcon, LinkedinIcon, WhatsAppIcon } from "./icons";
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

/** The ready-to-send WhatsApp opener (v24): a short, personal AIESEC intro —
 *  the member just hits send (or edits first). */
export function waIntroText(viewerName: string, accountName?: string): string {
  const target = accountName ? ` I'm reaching out about a collaboration with ${accountName}.` : "";
  return (
    `Hello! 👋 This is ${viewerName} from AIESEC in Alexandria — the world's largest youth-led leadership organization.` +
    target +
    ` We connect organizations with talented international young people. When would be a good time for a quick chat?`
  );
}

export function buildActions(
  contacts: AccountContact[] | null | undefined,
  opts?: { viewerName?: string; accountName?: string }
): ActionItem[] {
  const qa = quickActions(contacts);
  const items: ActionItem[] = [];
  if (qa.whatsapp) {
    const text = opts?.viewerName ? waIntroText(opts.viewerName, opts.accountName) : null;
    items.push({
      key: "wa",
      label: text ? `WhatsApp ${qa.whatsapp} — message ready to send` : `WhatsApp ${qa.whatsapp}`,
      href: `https://wa.me/${qa.whatsapp}${text ? `?text=${encodeURIComponent(text)}` : ""}`,
      icon: <WhatsAppIcon className="size-3.5" />,
    });
  }
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
  contacts, max = 4, viewerName, accountName,
}: {
  contacts: AccountContact[] | null | undefined;
  max?: number;
  /** when set, the WhatsApp link opens with a ready-to-send AIESEC intro */
  viewerName?: string;
  accountName?: string;
}) {
  const items = buildActions(contacts, { viewerName, accountName });
  if (items.length === 0) return null;
  const visible = items.length > max ? items.slice(0, max - 1) : items;
  const overflow = items.length > max ? items.slice(max - 1) : [];

  return (
    <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
      {visible.map((a) => (
        <Hint key={a.key} label={a.label}>
          <Button asChild variant="outline" size="icon" className="size-9 sm:size-7">
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
            <Button variant="outline" size="icon" className="size-9 sm:size-7" title="More contact options">
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
