/** Fun avatar characters via DiceBear's public HTTP API (deterministic SVGs,
 *  no key). Members pick one on their profile; it's stored as a plain URL and
 *  rendered in an <img>. Seeds are AIESEC-flavored so the set feels on-brand. */

const DICEBEAR = "https://api.dicebear.com/9.x";

const SEEDS = [
  "Sodio", "Bluey", "Nova", "Comet", "Delta", "Pixel", "Mango", "Kiwi",
  "Cosmo", "Echo", "Zippy", "Juno", "Milo", "Nori", "Pepper", "Sunny",
];

/** Each character style DiceBear offers that reads as playful/friendly. */
export const AVATAR_STYLES = [
  "fun-emoji", "bottts", "adventurer", "big-smile", "micah", "open-peeps",
  "avataaars", "notionists", "thumbs", "lorelei",
] as const;

export type AvatarStyle = (typeof AVATAR_STYLES)[number];

/** Friendly picker labels for the "Create your own" style select. */
export const AVATAR_STYLE_LABELS: Record<AvatarStyle, string> = {
  "fun-emoji": "Fun emoji",
  bottts: "Robots",
  adventurer: "Adventurers",
  "big-smile": "Big smiles",
  micah: "Minimal faces",
  "open-peeps": "Peeps",
  avataaars: "Cartoon people",
  notionists: "Notion-style",
  thumbs: "Thumbs",
  lorelei: "Line art",
};

/** Build a DiceBear URL from creator options. Keeps radius=50 like the fixed
 *  grid; a backgroundColor (comma-separated hex pair WITHOUT '#', e.g.
 *  "b6e3f4,c0aede") turns into a linear gradient. Without one the URL matches
 *  the classic avatarUrl() output exactly. */
export function buildAvatarUrl(
  style: AvatarStyle,
  seed: string,
  opts: { flip?: boolean; backgroundColor?: string } = {}
): string {
  let url = `${DICEBEAR}/${style}/svg?seed=${encodeURIComponent(seed)}&radius=50`;
  if (opts.backgroundColor) url += `&backgroundColor=${opts.backgroundColor}`;
  url += `&backgroundType=gradientLinear`;
  if (opts.flip) url += `&flip=true`;
  return url;
}

export function avatarUrl(style: AvatarStyle, seed: string): string {
  return buildAvatarUrl(style, seed);
}

/** The Blue Man — Sodio's mascot as an avatar. Deliberately a SITE-RELATIVE
 *  path (the APNG lives in /public/brand); updateAvatar whitelists this exact
 *  literal. The picker renders it inverted-white on a blue circle (like the
 *  floating assistant button); elsewhere it shows as the blue walking figure. */
export const BLUE_MAN_AVATAR = "/brand/walk.png";

/** Fun words for the creator's 🎲 randomize button (client-side only). */
const RANDOM_SEED_WORDS = [
  "Falafel", "Koshary", "Mishmish", "Simsim", "Batates", "Toota", "Loulou",
  "Habibi", "Sunshine", "Rocket", "Bubbles", "Waffles", "Caramel", "Pistachio",
  "Marshmallow", "Halawa", "Zatoona", "Fosdo2", "Basbousa", "Molokhia",
];

export function randomAvatarSeed(): string {
  const word = RANDOM_SEED_WORDS[Math.floor(Math.random() * RANDOM_SEED_WORDS.length)];
  return `${word}${Math.floor(Math.random() * 100)}`;
}

/** One classic full-beard character (DiceBear avataaars forces facial hair on).
 *  NOTE: avataaars enum values are camelCase — "beardMajestic", NOT
 *  "BeardMajestic" (PascalCase 400s and the image never loads). Ahmed's pick 🙂 */
const BEARDED_URL =
  `${DICEBEAR}/avataaars/svg?seed=Ahmed&radius=50&backgroundType=gradientLinear` +
  `&facialHairProbability=100&facialHair=beardMajestic&facialHairColor=2c1b18`;

/** A grid of fun options for the picker (a bearded one first, then style ×
 *  a couple of seeds). */
export function avatarChoices(): { url: string }[] {
  const out: { url: string }[] = [{ url: BEARDED_URL }];
  AVATAR_STYLES.forEach((style, i) => {
    // two seeds per style keeps the grid varied without being huge
    out.push({ url: avatarUrl(style, SEEDS[i % SEEDS.length]) });
    out.push({ url: avatarUrl(style, SEEDS[(i + 5) % SEEDS.length]) });
  });
  return out;
}
