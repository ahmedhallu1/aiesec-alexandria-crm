import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Elevate — AIESEC in Alexandria",
    short_name: "Elevate",
    description:
      "Elevate — the ICX CRM of AIESEC in Alexandria. Accounts, visits and pipelines.",
    start_url: "/",
    display: "standalone",
    background_color: "#0A2540",
    theme_color: "#0A2540",
    // v31: the AIESEC in Alexandria lighthouse mark (white on AIESEC blue).
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
