import { cn } from "@/lib/utils";

/** THE SODIO MARK — one geometric S, drawn as two arcs on a circle grid, with
 *  a single purple node at the tail: the point where a lead becomes a deal.
 *  AIESEC blue stays the anchor; purple is Sodio's own.
 *
 *  Geometry is the identity's own (public/brand/logo/sodio-icon.svg). Inline
 *  SVG rather than an <img> so it stays crisp at every size, costs no request
 *  and needs no light/dark twin. `scripts/gen-brand-assets.mjs` rasterises the
 *  SAME path into the favicon, the PWA icons and the OG card — change one and
 *  you must change the other.
 *
 *  THE SCALING RULES ARE THE IDENTITY'S, NOT DECORATION:
 *   · the stroke GROWS as the tile shrinks — 10.5 at 64px, 13 at 32px, 15 at
 *     16px — because a hairline S disappears in a browser tab;
 *   · the purple node DROPS below 32px, where it turns to mud.
 *  Pass the size you are actually rendering at so both rules can apply. */
const S_PATH = "M40.5 11.5A12 12 0 1 0 32 32A12 12 0 1 1 23.5 52.5";

function strokeFor(px: number) {
  if (px >= 48) return 10.5;
  if (px >= 24) return 13;
  return 15;
}

export function SodioMark({
  px = 64,
  tone = "tile",
  className,
  title,
}: {
  /** The size this will actually render at, in CSS px. Drives stroke + node. */
  px?: number;
  /** "tile" = blue squircle + white S (the app icon). "blue"/"white" = mark only. */
  tone?: "tile" | "blue" | "white";
  className?: string;
  /** Give it an accessible name only where it is the ONLY brand cue. */
  title?: string;
}) {
  const stroke = strokeFor(px);
  // the identity says the node drops below 32px. In practice it still reads
  // at 28 — and the mobile top bar sits right there, so holding the line at
  // 32 left the home screen showing a different mark from the sidebar.
  const node = px >= 28;
  const strokeColor = tone === "tile" ? "#FFFFFF" : tone === "white" ? "#FFFFFF" : "#037EF3";
  return (
    <svg
      viewBox="0 0 64 64"
      className={cn("block", className)}
      role={title ? "img" : "presentation"}
      aria-hidden={title ? undefined : true}
    >
      {title ? <title>{title}</title> : null}
      {/* clear space on every side equals the corner radius — never crop tighter */}
      {tone === "tile" ? <rect width="64" height="64" rx={px >= 28 ? 18 : 15} fill="#037EF3" /> : null}
      <path d={S_PATH} fill="none" stroke={strokeColor} strokeWidth={stroke} strokeLinecap="round" />
      {node ? <circle cx="23.5" cy="52.5" r="5.25" fill="#7552CC" /> : null}
    </svg>
  );
}

/** THE MASCOT TINT, and why it is an SVG filter and not a CSS one.
 *
 *  `public/brand/walk.png` is the official AIESEC walking man — white on
 *  transparency, and ANIMATED (APNG). The identity says the artwork is never
 *  redrawn or recoloured per-limb, only tinted. The old rule used a
 *  brightness/invert/sepia/hue-rotate chain numerically solved for AIESEC blue,
 *  which cannot simply be re-pointed at another hue. A CSS mask would be exact
 *  but samples the image once, freezing the walk cycle.
 *
 *  feColorMatrix maps RGB to a constant and leaves ALPHA untouched: exact
 *  colour, every frame still animating. `color-interpolation-filters` MUST be
 *  sRGB — the SVG default is linearRGB, which would darken the constant into a
 *  different colour than the token it came from.
 *
 *  Values are Sodio purple #7552CC as 0–1 sRGB (117/82/204). The identity's own
 *  sheet tints him AIESEC blue on light; the LC asked for purple, and purple is
 *  the colour that marks a win, so he carries it. Dark mode keeps the supplied
 *  white via `.dark .walkman-tint { filter: none }` in globals.css. */
export function SodioSvgDefs() {
  return (
    <svg aria-hidden width="0" height="0" className="absolute" style={{ position: "absolute" }}>
      <defs>
        <filter id="sodio-walk-tint" colorInterpolationFilters="sRGB">
          <feColorMatrix
            type="matrix"
            values="0 0 0 0 0.459  0 0 0 0 0.322  0 0 0 0 0.800  0 0 0 1 0"
          />
        </filter>
      </defs>
    </svg>
  );
}
