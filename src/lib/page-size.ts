/** ROWS PER PAGE (v33.10).
 *
 *  Smaller than it was. Every page render reads and renders that many rows,
 *  and a 200-row default was paying for scroll nobody did — the cost lands on
 *  the hosting bill and on how quickly the list appears. 20 is a screenful; the bigger
 *  sizes are still one click away.
 */
export const PAGE_SIZES: number[] = [20, 50, 75, 100];
export const DEFAULT_PAGE_SIZE = 20;

/** Whitelists a `?size=` param — anything else falls back to the default. */
export function pageSizeOf(raw: string | number | undefined): number {
  const n = Number(raw);
  return PAGE_SIZES.includes(n) ? n : DEFAULT_PAGE_SIZE;
}
