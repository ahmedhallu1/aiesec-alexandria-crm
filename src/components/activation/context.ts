"use client";

import { createContext, useContext } from "react";
import type { CellValue, Column, SectionConfig } from "@/lib/activation/model";

/** What every act of the page can do to the plan (v36.7). The board owns the
 *  state and the server calls; the views only ask. Row and cell mutations are
 *  optimistic — they show at once and the save happens behind them. */
export interface BoardApi {
  /** this viewer may edit at all (a signed-in member, not the public page) */
  editable: boolean;
  /** edit mode is on */
  editing: boolean;
  publicView: boolean;
  setCells: (rowId: string, patch: Record<string, CellValue>) => void;
  /** returns the new row's id */
  addRow: (
    sectionId: string,
    data?: Record<string, CellValue>,
    near?: { rowId: string; where: "above" | "below" }
  ) => string;
  deleteRow: (rowId: string) => void;
  moveRow: (rowId: string, direction: -1 | 1) => void;
  paste: (sectionId: string, startRow: number, startCol: number, matrix: string[][], columns: Column[]) => void;
  updateSection: (
    sectionId: string,
    patch: { title?: string; subtitle?: string; hidden_public?: boolean; config?: Partial<SectionConfig> }
  ) => Promise<boolean>;
  moveSection: (sectionId: string, direction: -1 | 1) => Promise<void>;
  deleteSection: (sectionId: string) => Promise<void>;
  addSection: (title: string) => Promise<void>;
  celebrate: () => void;
}

export const BoardContext = createContext<BoardApi | null>(null);

export function useBoard(): BoardApi {
  const api = useContext(BoardContext);
  if (!api) throw new Error("useBoard outside the Activation board");
  return api;
}
