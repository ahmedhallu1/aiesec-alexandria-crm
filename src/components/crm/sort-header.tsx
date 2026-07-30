"use client";

/**
 * Universal client-side table sorting (v24.3) — the same click-to-sort
 * affordance the accounts list pioneered, packaged for every other table:
 * `useTableSort` orders any row array by named accessors, `SortHeader` is
 * the header button (ghost ↕ drops in on hover, bold ↑/↓ when active).
 * Unlike the accounts list (URL-param + server-driven), this kit sorts
 * purely in client state.
 */

import { useCallback, useMemo, useState } from "react";
import { cn } from "@/lib/utils";

export type SortDir = "asc" | "desc";

export type SortAccessor<T> = (row: T) => string | number | null;

/**
 * Sort `rows` client-side by one of the named `accessors`.
 * - No sort is applied until the user clicks (`sorted === rows`).
 * - null / empty values always land LAST, whatever the direction.
 * - Strings compare case-insensitively via localeCompare (Arabic-safe);
 *   numbers compare numerically.
 */
export function useTableSort<T>(
  rows: T[],
  accessors: Record<string, SortAccessor<T>>,
  initial?: { key: string; dir: SortDir }
) {
  const [sort, setSort] = useState<{ key: string; dir: SortDir } | null>(
    initial ?? null
  );

  const toggle = useCallback((key: string, defaultDir: SortDir = "asc") => {
    setSort((prev) =>
      prev?.key === key
        ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key, dir: defaultDir }
    );
  }, []);

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const get = accessors[sort.key];
    if (!get) return rows;
    const flip = sort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const va = get(a);
      const vb = get(b);
      const aEmpty = va === null || va === undefined || va === "";
      const bEmpty = vb === null || vb === undefined || vb === "";
      if (aEmpty && bEmpty) return 0;
      if (aEmpty) return 1; // empties sink to the bottom, both directions
      if (bEmpty) return -1;
      if (typeof va === "number" && typeof vb === "number")
        return (va - vb) * flip;
      return (
        String(va).localeCompare(String(vb), undefined, {
          sensitivity: "base",
          numeric: true,
        }) * flip
      );
    });
  }, [rows, sort, accessors]);

  return { sorted, sortKey: sort?.key ?? null, dir: sort?.dir ?? null, toggle };
}

/** The header button — identical hover affordance to the accounts list's
 *  SortHead: muted pill + ghost ↕ dropping in on hover, press scale,
 *  bold ↑/↓ + primary color when active. Wrap it in your own <TableHead>. */
export function SortHeader({
  label,
  onClick,
  active,
  dir,
  className,
}: {
  label: React.ReactNode;
  onClick: () => void;
  active: boolean;
  dir: SortDir | null;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group/sort -mx-1.5 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 transition-all duration-150 hover:bg-muted hover:text-foreground active:scale-95",
        active && "font-bold text-primary",
        className
      )}
      title="Sort by this column"
    >
      {label}
      {active ? (
        <span>{dir === "asc" ? "↑" : "↓"}</span>
      ) : (
        // ghost arrows fade + drop in on hover — "you can click me"
        <span
          aria-hidden
          className="-translate-y-0.5 opacity-0 transition-all duration-150 group-hover/sort:translate-y-0 group-hover/sort:opacity-60"
        >
          ↕
        </span>
      )}
    </button>
  );
}
