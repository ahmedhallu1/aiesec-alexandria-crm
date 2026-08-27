import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Sodio — AIESEC in Alexandria",
    short_name: "Sodio",
    description:
      "Sodio — the ICX CRM of AIESEC in Alexandria. Accounts, visits and pipelines.",
    // THE ANDROID APP READS THIS FILE (v35). Bubblewrap generates the Play
    // build straight from the manifest, so `id` and `scope` stop being
    // cosmetic: `scope` is what the TWA treats as "still the app" (anything
    // outside it opens in a browser tab instead), and `id` is the stable
    // identity that survives start_url ever changing.
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#0A2540",
    theme_color: "#0A2540",
    // Sodio's own mark: the geometric S, white on AIESEC blue, with the
    // purple node at the tail. The maskable one is full-bleed blue with the
    // mark at 62%, inside Android's safe circle.
    // The maskable one is a separate, full-bleed file with the mark inside the
    // inner-80% safe circle — reusing the rounded any-icon got its corners
    // shaved by Android's mask.
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
