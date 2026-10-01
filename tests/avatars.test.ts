import { describe, it, expect } from "vitest";
import {
  AVATAR_STYLES, avatarChoices, avatarUrl, buildAvatarUrl, randomAvatarSeed, VIOLET_MAN_AVATAR,
} from "@/lib/avatars";

/** The avatar URLs are stored on the member row and rendered as <img>, so a
 *  change to their shape silently changes everyone's picture. Pinned here. */
describe("avatar URLs", () => {
  it("builds the classic DiceBear URL", () => {
    expect(avatarUrl("bottts", "Nova")).toBe(
      "https://api.dicebear.com/9.x/bottts/svg?seed=Nova&radius=50&backgroundType=gradientLinear"
    );
  });

  it("encodes the seed, so spaces and symbols can't break the query", () => {
    const u = new URL(buildAvatarUrl("micah", "Ahmed & co?x=1"));
    expect(u.searchParams.get("seed")).toBe("Ahmed & co?x=1");
    expect(u.searchParams.get("radius")).toBe("50");
  });

  it("adds the creator options only when asked", () => {
    const u = new URL(buildAvatarUrl("thumbs", "Kiwi", { flip: true, backgroundColor: "b6e3f4,c0aede" }));
    expect(u.searchParams.get("flip")).toBe("true");
    expect(u.searchParams.get("backgroundColor")).toBe("b6e3f4,c0aede");
    expect(buildAvatarUrl("thumbs", "Kiwi")).not.toContain("flip");
    expect(buildAvatarUrl("thumbs", "Kiwi")).not.toContain("backgroundColor");
  });

  it("offers a bearded one first, then two per style — all https", () => {
    const all = avatarChoices();
    expect(all).toHaveLength(1 + AVATAR_STYLES.length * 2);
    expect(all[0].url).toContain("facialHair=beardMajestic");
    for (const { url } of all) expect(url.startsWith("https://api.dicebear.com/9.x/")).toBe(true);
  });

  it("keeps the mascot path updateAvatar whitelists", () => {
    expect(VIOLET_MAN_AVATAR).toBe("/brand/walk.png");
  });

  it("random seeds are a word plus a number", () => {
    for (let i = 0; i < 20; i++) expect(randomAvatarSeed()).toMatch(/^[A-Za-z0-9]+\d{1,2}$/);
  });
});
