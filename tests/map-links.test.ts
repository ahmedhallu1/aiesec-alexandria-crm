import { describe, it, expect } from "vitest";
import { guessLinkTag, isMapLink, LINK_TAGS } from "@/lib/types";

/** A shared Maps link is a LOCATION, with its own tag and pin (v36.4). */
describe("map links", () => {
  it("tags every Maps share link as Location", () => {
    for (const url of [
      "https://maps.app.goo.gl/qxGhAXQ3xJYAho5z5?g_st=ac",
      "maps.app.goo.gl/qxGhAXQ3xJYAho5z5",
      "https://goo.gl/maps/abc123",
      "https://www.google.com/maps/place/Deli+Techno/@31.2,29.9,17z",
      "https://www.google.com.eg/maps/@31.2,29.9,15z",
      "https://maps.google.com/?q=31.2,29.9",
      "https://maps.apple.com/?q=Alexandria",
      "https://waze.com/ul?ll=31.2,29.9",
    ]) {
      expect(guessLinkTag(url), url).toBe("Location");
      expect(isMapLink(url), url).toBe(true);
    }
  });

  it("leaves everything else alone", () => {
    expect(guessLinkTag("https://www.google.com/search?q=deli")).toBe("Website");
    expect(guessLinkTag("https://instagram.com/delitechno")).toBe("Instagram");
    expect(guessLinkTag("https://goo.gl/forms/abc")).toBe("Website");
    expect(isMapLink("https://delitechno.com/maps")).toBe(false);
  });

  it("offers Location in the link tag list", () => {
    expect(LINK_TAGS).toContain("Location");
  });
});
