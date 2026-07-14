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

export function avatarUrl(style: AvatarStyle, seed: string): string {
  return `${DICEBEAR}/${style}/svg?seed=${encodeURIComponent(seed)}&radius=50&backgroundType=gradientLinear`;
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
