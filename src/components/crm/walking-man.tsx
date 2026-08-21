import { cn } from "@/lib/utils";

/** THE OFFICIAL AIESEC WALKING MAN, CROPPED TO THE FIGURE.
 *
 *  `walk.png` is a 356×200 APNG whose person occupies only the middle fifth of
 *  the canvas — the rest is transparent room for the walk cycle. Rendering the
 *  IMAGE at 28px therefore drew a person about 19px tall and 6px wide: the
 *  sliver that showed up in the assistant's chat header. This crops the canvas
 *  so `height` means the height of the PERSON, which is what every call site
 *  actually meant. The identity's floor is 17px inline, 96px loading.
 *
 *  ⚠️ THE BOUNDS ARE THE UNION ACROSS ALL 16 FRAMES, NOT ONE FRAME.
 *  Measured from the file's alpha channel per frame: the figure spans
 *  x 139–212 and y 31–167, but any SINGLE frame is smaller — frame 0 is
 *  y 34–167 — because he rises and falls through the stride. Cropping to one
 *  frame's box (which is what the first version did, and what
 *  activate-strip.tsx had) clipped his HEAD by 3px on frames 5, 6, 13 and 14
 *  and shaved his feet on the rounding. The values below are that union plus a
 *  small margin, so no frame is ever cut. Re-measure with PIL if the art
 *  changes — do not eyeball it. */
export const WALK_ART = {
  aspect: 356 / 200,
  left: 0.386,
  right: 0.6,
  top: 0.148,
  bottom: 0.842,
};
const FIG_W = WALK_ART.right - WALK_ART.left; // 0.214 of the canvas
const FIG_H = WALK_ART.bottom - WALK_ART.top; // 0.694 of the canvas

/** Canvas box that puts a figure of `figH` with its feet at (cx, feetY). */
export function walkerBox(cx: number, feetY: number, figH: number) {
  const h = figH / FIG_H;
  const w = h * WALK_ART.aspect;
  const cxFrac = (WALK_ART.left + WALK_ART.right) / 2;
  return { x: cx - w * cxFrac, y: feetY - h * WALK_ART.bottom, width: w, height: h };
}

export function WalkingMan({
  height,
  tone = "tint",
  className,
  alt = "",
}: {
  /** Height of the PERSON in px — not of the image canvas. */
  height: number;
  /** "tint" follows the brand colour; "white" forces white (on coloured fills). */
  tone?: "tint" | "white";
  className?: string;
  alt?: string;
}) {
  const canvasH = height / FIG_H;
  const canvasW = canvasH * WALK_ART.aspect;
  const figW = canvasW * FIG_W;
  return (
    <span
      className={cn("relative inline-block shrink-0 overflow-hidden", className)}
      style={{ width: figW, height }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/brand/walk.png"
        alt={alt}
        aria-hidden={alt ? undefined : true}
        draggable={false}
        className={cn(
          "pointer-events-none absolute max-w-none select-none",
          tone === "white" ? "brightness-0 invert" : "walkman-tint"
        )}
        style={{
          width: canvasW,
          height: canvasH,
          left: -WALK_ART.left * canvasW,
          top: -WALK_ART.top * canvasH,
        }}
      />
    </span>
  );
}
