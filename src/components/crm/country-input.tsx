"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { COUNTRIES } from "@/lib/countries";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

/** Branded country autocomplete (replaces the grey native <datalist>): a
 *  styled Input with a popover-styled dropdown of matching COUNTRIES —
 *  case-insensitive contains-match, ↑/↓/Enter/Escape keyboard navigation,
 *  click to pick, free text still allowed. `onCommit` fires on an explicit
 *  pick (Enter/click) AND on blur — wire the save there.
 *
 *  THE LIST RIDES A PORTAL (v33.40). As an absolute child it kept losing
 *  paint-order fights with whatever stacking context an ancestor happened to
 *  create (the CV tab's table header drew OVER it) — the same reason Radix
 *  portals every popover. Fixed-positioned at the input's rect, re-measured
 *  on scroll/resize, `pointer-events: auto` against Radix's body lock inside
 *  dialogs, and `data-country-list` so the dialog's outside-click guard
 *  knows a tap on it is not a reason to close. */
export function CountryInput({
  value,
  onChange,
  onCommit,
  placeholder = "Start typing…",
  className,
  id,
}: {
  value: string;
  onChange: (v: string) => void;
  /** called with the final value on pick (Enter/click) and on blur */
  onCommit?: (v: string) => void;
  placeholder?: string;
  className?: string;
  id?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<{ top: number; left: number; width: number } | null>(
    null
  );

  const matches = useMemo(() => {
    const q = value.trim().toLowerCase();
    if (!q) return COUNTRIES;
    const list = COUNTRIES.filter((c) => c.toLowerCase().includes(q));
    // the exactly-typed country leads — Enter must never save a superstring
    // ("Sudan" typed, "South Sudan" first in contains-order)
    const i = list.findIndex((c) => c.toLowerCase() === q);
    if (i > 0) list.unshift(list.splice(i, 1)[0]);
    return list;
  }, [value]);

  const showList = open && matches.length > 0;
  const clampedActive = Math.min(active, Math.max(0, matches.length - 1));

  // anchor the portaled list to the input — kept fresh while it is open
  useEffect(() => {
    if (!showList) return;
    const measure = () => {
      const el = wrapRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setRect({ top: r.bottom + 4, left: r.left, width: r.width });
    };
    measure();
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
    };
  }, [showList]);

  const pick = (c: string) => {
    onChange(c);
    setOpen(false);
    onCommit?.(c);
  };

  return (
    <div ref={wrapRef} className={cn("relative", className)}>
      <Input
        id={id}
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        role="combobox"
        aria-expanded={showList}
        aria-autocomplete="list"
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          setOpen(false);
          onCommit?.(value);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            if (!showList) setOpen(true);
            else setActive((a) => (a + 1) % matches.length);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            if (!showList) setOpen(true);
            else setActive((a) => (a - 1 + matches.length) % matches.length);
          } else if (e.key === "Enter") {
            if (showList) {
              e.preventDefault();
              pick(matches[clampedActive]);
            }
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
      />
      {showList && rect
        ? createPortal(
            <div
              role="listbox"
              data-country-list=""
              // inline pointerEvents beats the body lock Radix applies while
              // a dialog is open — the list is used inside dialogs too
              style={{
                position: "fixed",
                top: rect.top,
                left: rect.left,
                width: rect.width,
                pointerEvents: "auto",
              }}
              className="z-[60] max-h-56 overflow-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
              // a scrollbar drag on the list itself must not blur the input
              onMouseDown={(e) => e.preventDefault()}
            >
              {matches.map((c, i) => (
                <div
                  key={c}
                  role="option"
                  aria-selected={i === clampedActive}
                  ref={
                    i === clampedActive
                      ? (el) => el?.scrollIntoView({ block: "nearest" })
                      : undefined
                  }
                  className={cn(
                    "cursor-pointer rounded-sm px-2 py-1.5 text-sm",
                    i === clampedActive && "bg-accent text-accent-foreground"
                  )}
                  // mousedown (not click) so the input's blur can't fire first
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pick(c);
                  }}
                  onMouseEnter={() => setActive(i)}
                >
                  {c}
                </div>
              ))}
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
