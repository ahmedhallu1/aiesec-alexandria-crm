import { ImageResponse } from "next/og";

/** The WhatsApp / LinkedIn preview of the public bid page (v36.7) — the
 *  showbill, not the Sodio card: night sky, tent stripes, the name in gold. */
export const alt = "Activate 26' — AIESEC in Alexandria's bid to host";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  const stripes = Array.from({ length: 24 }, (_, i) => i);
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "radial-gradient(900px 500px at 50% 0%, #4a1030 0%, #140a22 55%, #0a0612 100%)",
          color: "#fff4dc",
          position: "relative",
        }}
      >
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 64, display: "flex" }}>
          {stripes.map((i) => (
            <div key={i} style={{ flex: 1, height: "100%", background: i % 2 ? "#fbeed3" : "#c8102e", borderBottomLeftRadius: 25, borderBottomRightRadius: 25 }} />
          ))}
        </div>
        <div style={{ fontSize: 30, letterSpacing: 10, textTransform: "uppercase", color: "#f7c65b", marginTop: 40 }}>
          AIESEC in Alexandria presents
        </div>
        <div
          style={{
            marginTop: 24,
            padding: "18px 60px",
            borderRadius: 36,
            // the OG renderer takes solid or dashed only
            border: "6px dashed #f7c65b",
            fontSize: 150,
            fontWeight: 900,
            color: "#f7c65b",
            textShadow: "0 8px 0 #6b0f1f",
          }}
        >
          ACTIVATE 26&apos;
        </div>
        <div style={{ marginTop: 34, fontSize: 38, fontStyle: "italic" }}>Our bid to host — the whole show, act by act</div>
        <div style={{ marginTop: 18, fontSize: 28, color: "#cdb9a3" }}>2 – 5 December · Alexandria</div>
      </div>
    ),
    size
  );
}
