import * as React from "react"

import { cn } from "@/lib/utils"

function Input({ className, type, dir, ...props }: React.ComponentProps<"input">) {
  // NATIVE DATE/TIME FIELDS NEED TWO THINGS THE OTHERS DON'T (v33.28):
  //  · tighter horizontal padding on phones — 16px type (kept deliberately, so
  //    iOS doesn't zoom the page on focus) in a two- or three-up grid clipped
  //    the value outright;
  //  · an explicit EMPTY flag, because there is no placeholder pseudo for them,
  //    so the stylesheet cannot otherwise tell a real date from a blank field.
  // MIN-height, not a fixed one (v33.44): at default settings this renders
  // identically (16px text + padding is under 36px, so the minimum wins), but
  // an Android phone with a large system font scales the TEXT while a fixed
  // `h-9` box does not — and the value spills out of its own field. Letting
  // the box grow costs nothing and stops that class of "the fields come out
  // of the UI" outright.
  const dateish = type === "date" || type === "time" || type === "datetime-local";
  return (
    <input
      type={type}
      // Arabic text flips to RTL, Latin stays LTR — automatically, per field.
      // Callers can still override with an explicit dir.
      dir={dir ?? "auto"}
      data-slot="input"
      data-empty={
        dateish ? String(props.value == null || props.value === "") : undefined
      }
      className={cn(
        "min-h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none selection:bg-primary selection:text-primary-foreground file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30",
        "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
        "aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40",
        dateish && "px-2 sm:px-3",
        className
      )}
      {...props}
    />
  )
}

export { Input }
