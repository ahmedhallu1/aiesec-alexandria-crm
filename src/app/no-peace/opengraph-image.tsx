import { ImageResponse } from "next/og";

/** The WhatsApp / Instagram preview of /no-peace (v38) — the war poster's
 *  palette: night sea, chart paper, rust and brass. */
export const alt = "No Peace — AIESEC in Alexandria's war board";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
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
          background: "radial-gradient(900px 520px at 20% 0%, #1d4c53 0%, #0b1a1d 60%, #060e10 100%)",
          color: "#ecdcb6",
          position: "relative",
        }}
      >
        <div
          style={{
            display: "flex",
            fontSize: 30,
            letterSpacing: 12,
            textTransform: "uppercase",
            color: "#e0573b",
            border: "4px solid #e0573b",
            padding: "8px 26px",
            transform: "rotate(-2deg)",
          }}
        >
          War declaration
        </div>
        <div style={{ display: "flex", marginTop: 30, fontSize: 190, fontWeight: 900, letterSpacing: -2, color: "#ecdcb6", textShadow: "0 10px 0 #6b4a1f" }}>
          NO PEACE
        </div>
        <div style={{ display: "flex", marginTop: 26, fontSize: 36, color: "#f6d48a" }}>
          The city is on alert · The troops are ready · The mission is clear
        </div>
        <div style={{ display: "flex", marginTop: 22, fontSize: 28, color: "#b8c9c6" }}>AIESEC in Alexandria · live war points</div>
      </div>
    ),
    size
  );
}
