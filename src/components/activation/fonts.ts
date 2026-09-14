import { Playfair_Display, Rye } from "next/font/google";

/** The circus faces for the Activate 26' page only (v36.7): Rye for the
 *  marquee — a wood-type showbill letter — and Playfair Display for the
 *  ringmaster's voice. The rest of the page keeps Sodio's Karla. Self-hosted
 *  by next/font, so the CSP never sees Google. */
export const rye = Rye({ weight: "400", subsets: ["latin"], variable: "--font-circus", display: "swap" });
export const playfair = Playfair_Display({
  subsets: ["latin"],
  style: ["normal", "italic"],
  variable: "--font-circus-serif",
  display: "swap",
});
