/** REGENERATE SODIO'S BRAND RASTERS from the identity's own logo geometry.
 *
 *  Source of truth: public/brand/logo/*.svg, delivered with the identity. The
 *  same geometry is mirrored as inline SVG in src/components/crm/sodio-mark.tsx
 *  — change one and you must change the other, or the browser tab quietly stops
 *  matching the sidebar.
 *
 *  The identity's scaling rules, which this script implements:
 *    · stroke grows as the tile shrinks — 10.5 at 64px, 13 at 32px, 15 at 16px
 *    · the purple node drops below 32px; at favicon size it turns to mud
 *    · maskable is full-bleed blue with the mark at 62%, inside Android's circle
 *
 *  Writes: src/app/icon.png, src/app/apple-icon.png, public/icons/*,
 *          public/brand/og-card.png
 *
 *  The OG card sets real Familjen Grotesk + IBM Plex Mono, which the renderer
 *  can only find through fontconfig:
 *
 *    mkdir -p /tmp/sodio-fonts && cd /tmp/sodio-fonts
 *    B=https://raw.githubusercontent.com/google/fonts/main/ofl
 *    curl -sLO "$B/familjengrotesk/FamiljenGrotesk%5Bwght%5D.ttf"
 *    curl -sLO "$B/ibmplexmono/IBMPlexMono-SemiBold.ttf"
 *    printf '<?xml version="1.0"?><fontconfig><dir>/tmp/sodio-fonts</dir><cachedir>/tmp/sodio-fonts/cache</cachedir></fontconfig>' > /tmp/sodio-fonts.conf
 *    FONTCONFIG_FILE=/tmp/sodio-fonts.conf node scripts/gen-brand-assets.mjs
 *
 *  Without it the icons are still exact; only the card's text falls back. */
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { readFileSync, writeFileSync } from "fs";
const sharp = createRequire(import.meta.url)("sharp");
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const BLUE = "#037EF3";   // AIESEC blue — the anchor
const PURPLE = "#7552CC"; // Sodio purple — the signature, marks actions and wins
const NAVY = "#0A2540";

/** The S: two arcs on a circle grid, with the node at the tail — the point
 *  where a lead becomes a deal. */
const S_PATH = "M40.5 11.5A12 12 0 1 0 32 32A12 12 0 1 1 23.5 52.5";

const icon = ({ stroke = 10.5, rx = 18, node = true } = {}) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="${rx}" fill="${BLUE}"/>
  <path d="${S_PATH}" fill="none" stroke="#FFFFFF" stroke-width="${stroke}" stroke-linecap="round"/>
  ${node ? `<circle cx="23.5" cy="52.5" r="5.25" fill="${PURPLE}"/>` : ""}
</svg>`;

const maskable = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="${BLUE}"/>
  <g transform="translate(256 256) scale(6.2) translate(-32 -32)">
    <path d="${S_PATH}" fill="none" stroke="#FFFFFF" stroke-width="10.5" stroke-linecap="round"/>
    <circle cx="23.5" cy="52.5" r="5.25" fill="${PURPLE}"/>
  </g>
</svg>`;

const png = (svg, size, out) =>
  sharp(Buffer.from(svg)).resize(size, size).png({ compressionLevel: 9 }).toFile(out);

// full mark — big enough for the node to read
await png(icon(), 512, `${REPO}/public/icons/icon-512.png`);
await png(icon(), 192, `${REPO}/public/icons/icon-192.png`);
await png(icon(), 180, `${REPO}/src/app/apple-icon.png`);
await sharp(Buffer.from(maskable)).resize(512, 512).png({ compressionLevel: 9 })
  .toFile(`${REPO}/public/icons/icon-maskable-512.png`);

// THE TAB CARRIES THE DOT TOO. The identity drops the node below 32px because
// it muddies, and this file first shipped the no-node favicon geometry for
// that reason — but the result was a browser tab showing a different mark from
// the sidebar, which the LC noticed immediately. One mark everywhere wins:
// the stroke is still thickened for small sizes, the node stays.
await png(icon({ stroke: 12.5, rx: 16, node: true }), 512, `${REPO}/src/app/icon.png`);

// ── the OG social card ────────────────────────────────────────────────────
const logo20DataUri = `data:image/png;base64,${readFileSync(`${REPO}/public/brand/2.0-dark.png`).toString("base64")}`;
const MARK = 128, MX = (1200 - MARK) / 2, MY = 128;
const og = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <radialGradient id="gp" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="${PURPLE}" stop-opacity="0.85"/>
      <stop offset="1" stop-color="${PURPLE}" stop-opacity="0"/></radialGradient>
    <radialGradient id="gb" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="${BLUE}" stop-opacity="0.34"/>
      <stop offset="1" stop-color="${BLUE}" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="1200" height="630" fill="#0a1a33"/>
  <!-- purple leads, blue answers from the far corner: the same night treatment
       as the Road to Activate banner, so the link preview and the app agree -->
  <ellipse cx="760" cy="700" rx="820" ry="620" fill="url(#gp)"/>
  <ellipse cx="90" cy="-40" rx="560" ry="460" fill="url(#gb)"/>
  <g transform="translate(${MX},${MY}) scale(${MARK / 64})">
    <rect width="64" height="64" rx="18" fill="${BLUE}"/>
    <path d="${S_PATH}" fill="none" stroke="#FFFFFF" stroke-width="10.5" stroke-linecap="round"/>
    <circle cx="23.5" cy="52.5" r="5.25" fill="${PURPLE}"/>
  </g>
  <text x="600" y="400" text-anchor="middle" font-family="Familjen Grotesk" font-weight="700"
        font-size="104" letter-spacing="-4" fill="#FFFFFF">Sodio</text>
  <text x="600" y="462" text-anchor="middle" font-family="IBM Plex Mono" font-weight="600"
        font-size="26" letter-spacing="3.4" fill="#C0AEF3">AIESEC IN ALEXANDRIA</text>
  <rect x="556" y="506" width="88" height="4" rx="2" fill="#C0AEF3"/>
  <!-- "Made by 2.0" (v34.9) — every other surface someone outside the LC sees
       (external emails, the composed-letter footer) carries this credit now;
       the link-preview card — the first thing an IR abroad sees when a
       booking link lands in WhatsApp — was the one place it was still
       missing. Embedded as a raster (no vector source for the mark exists)
       at native 2:1, the light-ink-on-dark variant to sit on the card's navy. -->
  <g transform="translate(600 560)">
    <text x="-6" y="6" text-anchor="end" font-family="IBM Plex Mono" font-weight="500"
          font-size="15" fill="#93A5BC">Made by</text>
    <image x="4" y="-9" width="56" height="28" href="${logo20DataUri}"/>
  </g>
</svg>`;
await sharp(Buffer.from(og)).png({ compressionLevel: 9 }).toFile(`${REPO}/public/brand/og-card.png`);

console.log("brand rasters written");

// ── the email lockup ──────────────────────────────────────────────────────
// Email clients do not render SVG, so the header lockup ships as a 2x PNG.
// This is the identity's sodio-lockup-dark.svg: white tile, navy S, purple
// node, white wordmark — built for the navy email header.
const lockup = `<svg xmlns="http://www.w3.org/2000/svg" width="680" height="160" viewBox="0 0 340 80">
  <g transform="translate(8 8)">
    <rect width="64" height="64" rx="18" fill="#FFFFFF"/>
    <path d="${S_PATH}" fill="none" stroke="${NAVY}" stroke-width="10.5" stroke-linecap="round"/>
    <circle cx="23.5" cy="52.5" r="5.25" fill="${PURPLE}"/>
  </g>
  <text x="88" y="42" font-family="Familjen Grotesk" font-size="38" font-weight="700"
        letter-spacing="-1.3" fill="#FFFFFF">Sodio</text>
  <text x="90" y="60" font-family="IBM Plex Mono" font-size="10.5" letter-spacing="1.6"
        fill="#8FA6C2">AIESEC IN ALEXANDRIA</text>
</svg>`;
await sharp(Buffer.from(lockup)).png({ compressionLevel: 9 })
  .toFile(`${REPO}/public/brand/sodio-email-lockup.png`);

console.log("email lockup written");
