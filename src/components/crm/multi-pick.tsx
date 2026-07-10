"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/** Comma-joined multi-select chips with an "Other" free-text option.
 *  value = "Software, Marketing, Robotics" (order preserved). */
export function MultiPick({
  label, options, value, onChange, compact,
}: {
  label?: string;
  options: readonly string[];
  value: string;
  onChange: (v: string) => void;
  compact?: boolean;
}) {
  const selected = value
    ? value.split(",").map((v) => v.trim()).filter(Boolean)
    : [];
  const known = options.filter((o) => o !== "Other");
  const customValues = selected.filter((v) => !known.includes(v));
  const [otherOpen, setOtherOpen] = useState(customValues.length > 0);
  const [otherText, setOtherText] = useState(customValues.join(", "));

  const emit = (knownSel: string[], custom: string) => {
    const customs = custom.split(",").map((v) => v.trim()).filter(Boolean);
    onChange([...knownSel, ...customs].join(", "));
  };

  const knownSelected = selected.filter((v) => known.includes(v));
  const toggle = (opt: string) => {
    const next = knownSelected.includes(opt)
      ? knownSelected.filter((v) => v !== opt)
      : [...knownSelected, opt];
    emit(next, otherOpen ? otherText : "");
  };

  return (
    <div className="grid gap-1.5">
      {label ? <Label>{label}</Label> : null}
      <div className="flex flex-wrap gap-1.5">
        {known.map((opt) => (
          <button
            key={opt}
            type="button"
            onClick={() => toggle(opt)}
            className={cn(
              "rounded-full border px-2.5 text-xs font-semibold transition-colors",
              compact ? "py-0.5" : "py-1",
              knownSelected.includes(opt)
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-muted text-muted-foreground hover:border-primary/50"
            )}
          >
            {opt}
          </button>
        ))}
        <button
          type="button"
          onClick={() => {
            const next = !otherOpen;
            setOtherOpen(next);
            if (!next) { setOtherText(""); emit(knownSelected, ""); }
          }}
          className={cn(
            "rounded-full border px-2.5 text-xs font-semibold transition-colors",
            compact ? "py-0.5" : "py-1",
            otherOpen
              ? "border-primary bg-primary text-primary-foreground"
              : "border-dashed border-border bg-muted text-muted-foreground hover:border-primary/50"
          )}
        >
          Other…
        </button>
      </div>
      {otherOpen ? (
        <Input
          className="h-8"
          value={otherText}
          onChange={(e) => {
            setOtherText(e.target.value);
            emit(knownSelected, e.target.value);
          }}
          placeholder="Type other value(s), comma-separated"
        />
      ) : null}
    </div>
  );
}
