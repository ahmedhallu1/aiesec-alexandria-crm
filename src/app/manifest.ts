import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "AIESEC in Alexandria CRM",
    short_name: "AIESEC CRM",
    description:
      "The ICX CRM platform of AIESEC in Alexandria — accounts, visits and pipelines.",
    start_url: "/",
    display: "standalone",
    background_color: "#0A2540",
    theme_color: "#0A2540",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
