/** The hero's backdrop (v38.1) — Alexandria's harbour at night, drawn in SVG
 *  so it is sharp on every screen. v38 stretched the 1280×400 campaign poster
 *  to ~2,500px and it showed: soft, blocky, and its middle was the poster's
 *  own baked-in text. Vector shapes have no resolution to run out of.
 *
 *  Left: the Citadel of Qaitbay on its promontory. Right: the lighthouse from
 *  the LC's own logo, its lamp sweeping the bay — the one moving thing here.
 *  Between them the corniche and a warship on the horizon, after the poster.
 *  Everything sits in one 1440×320 band anchored to the bottom of the hero;
 *  the sky above it is a CSS gradient on the hero itself. */

const WALL = "#08161a";
const FAR = "#0e2328";

// battlements along a wall top: [x0, x1, y] → small merlons every 11px
function merlons(x0: number, x1: number, y: number, w = 6, gap = 5, h = 5) {
  const out: string[] = [];
  for (let x = x0; x + w <= x1; x += w + gap) out.push(`M${x} ${y}h${w}v-${h}h-${w}z`);
  return out.join("");
}

export function HarbourScene() {
  return (
    <svg className="np-scene" viewBox="0 0 1440 320" preserveAspectRatio="xMidYMax meet" aria-hidden focusable="false">
      <defs>
        <linearGradient id="np-sea" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#123138" />
          <stop offset="1" stopColor="#0a1417" />
        </linearGradient>
        <linearGradient id="np-beam" x1="1" y1="0" x2="0" y2="0">
          <stop offset="0" stopColor="#ffe9b0" stopOpacity="0.32" />
          <stop offset="1" stopColor="#ffe9b0" stopOpacity="0" />
        </linearGradient>
        <radialGradient id="np-lamp" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#ffe3a0" stopOpacity="0.9" />
          <stop offset="1" stopColor="#ffe3a0" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="np-glint" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffd98a" stopOpacity="0.28" />
          <stop offset="1" stopColor="#ffd98a" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* the corniche, far off */}
      <path
        fill={FAR}
        d="M520 214V196h18v-8h14v8h22v-14h12v14h30v-22h16v22h24v-10h20v10h18v-26h10v-6h8v32h26v-16h22v16h30v-12h14v12h26v-20h18v20h36v-8h24v8h22v-18h12v18h40v-10h18v10h60v18z"
      />
      {/* a warship on the horizon */}
      <path
        fill={FAR}
        d="M800 214l10-8h150l14 8zM832 206v-7h22v-6h10v-9h4v9h8v6h18v7zM868 184v-10h2v10zM900 199v-5h12v5z"
      />

      {/* the sea */}
      <rect x="0" y="212" width="1440" height="108" fill="url(#np-sea)" />
      <g className="np-waves" stroke="#ecdcb6" strokeOpacity="0.07" strokeWidth="1" fill="none">
        <path d="M-60 236h220M260 236h140M520 236h300M940 236h180M1220 236h300" />
        <path d="M-20 256h160M220 256h260M600 256h120M820 256h280M1180 256h200" />
        <path d="M40 280h300M460 280h180M760 280h240M1120 280h340" />
      </g>
      {/* the lamp's light on the water */}
      <rect x="1238" y="214" width="56" height="90" fill="url(#np-glint)" />

      {/* the Citadel of Qaitbay, on its promontory */}
      <g fill={WALL}>
        <path d="M0 226l40-14h560l46 14v94H0z" />
        {/* outer wall + its round towers */}
        <path d={`M66 214v-40h470v40z${merlons(66, 536, 174)}`} />
        <path d="M54 214v-58q0-6 6-6h20q6 0 6 6v58zM196 214v-54q0-6 6-6h18q6 0 6 6v54zM392 214v-54q0-6 6-6h18q6 0 6 6v54zM524 214v-58q0-6 6-6h20q6 0 6 6v58z" />
        <path d={`${merlons(54, 86, 150, 5, 4, 4)}${merlons(524, 556, 150, 5, 4, 4)}`} />
        {/* the keep */}
        <path d={`M232 176v-74h138v74z${merlons(232, 370, 102)}`} />
        <path d="M220 176v-88q0-5 5-5h16q5 0 5 5v88zM356 176v-88q0-5 5-5h16q5 0 5 5v88z" />
        <path d={`${merlons(220, 246, 83, 4, 3, 4)}${merlons(356, 382, 83, 4, 3, 4)}`} />
        {/* the minaret */}
        <path d="M296 102V60h12v42zM292 80h20v4h-20zM298 60l4-16 4 16z" />
      </g>
      {/* lit windows */}
      <g fill="#e2b354">
        <rect x="262" y="128" width="5" height="9" rx="2.5" opacity="0.55" />
        <rect x="300" y="122" width="5" height="9" rx="2.5" opacity="0.35" />
        <rect x="336" y="130" width="5" height="9" rx="2.5" opacity="0.5" />
        <rect x="128" y="192" width="4" height="7" rx="2" opacity="0.3" />
        <rect x="462" y="190" width="4" height="7" rx="2" opacity="0.4" />
      </g>

      {/* the lighthouse from the LC's logo */}
      {/* its beam, swinging slowly across the bay */}
      <path className="np-lamp-beam" d="M1266 79L1000 40V118Z" fill="url(#np-beam)" />
      <g fill={WALL}>
        <path d="M1210 230l22-16h70l24 16v90h-116z" />
        <path d="M1244 214l9-120h26l9 120z" />
        <path d="M1240 96h52v6h-52z" />
        <path d="M1252 92V70h28v22z" />
        <path d="M1248 70l18-14 18 14z" />
      </g>
      {/* the stripes — a shade lighter than the tower */}
      <g fill="#ecdcb6" opacity="0.08">
        <path d="M1247 186l40-28 1 16-42 30zM1250 146l35-24 1 15-37 26zM1252 110l31-20 1 14-33 22z" />
      </g>
      <circle cx="1266" cy="80" r="22" fill="url(#np-lamp)" className="np-lamp-glow" />
      <rect x="1257" y="74" width="18" height="12" rx="1" fill="#ffe3a0" />
    </svg>
  );
}
