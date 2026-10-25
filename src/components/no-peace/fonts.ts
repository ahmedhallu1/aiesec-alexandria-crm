import { Black_Ops_One, Permanent_Marker } from "next/font/google";

/** The war-poster faces for /no-peace only (v38; trimmed in v38.1): Black Ops
 *  One — the stencil on "THE POINT SYSTEM" — for display type only, and
 *  Permanent Marker for the poster's brush motto in the footer. Everything
 *  people actually read is set in Sodio's own Karla and IBM Plex Mono.
 *  Self-hosted by next/font, so the CSP never sees Google. */
export const stencil = Black_Ops_One({ weight: "400", subsets: ["latin"], variable: "--np-stencil", display: "swap" });
export const marker = Permanent_Marker({ weight: "400", subsets: ["latin"], variable: "--np-marker", display: "swap" });
