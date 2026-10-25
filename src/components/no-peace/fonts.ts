import { Black_Ops_One, Permanent_Marker, Special_Elite } from "next/font/google";

/** The war-poster faces for /no-peace only (v38): Black Ops One — the stencil
 *  on "THE POINT SYSTEM"; Special Elite — the typewriter of a field dispatch;
 *  Permanent Marker — the brush "Alexandria". Self-hosted by next/font, so the
 *  CSP never sees Google. */
export const stencil = Black_Ops_One({ weight: "400", subsets: ["latin"], variable: "--np-stencil", display: "swap" });
export const typewriter = Special_Elite({ weight: "400", subsets: ["latin"], variable: "--np-type", display: "swap" });
export const marker = Permanent_Marker({ weight: "400", subsets: ["latin"], variable: "--np-marker", display: "swap" });
