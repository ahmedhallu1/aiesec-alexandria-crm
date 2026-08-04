import type { MetadataRoute } from "next";

/** This is a PRIVATE internal CRM — every page behind /login holds member PII,
 *  partner contacts and deal data. Nothing here should ever be indexed, and
 *  the public booking pages are shared by link with named IRs, not searched
 *  for. Without this the route 307'd to /login, so crawlers got no directive
 *  at all (v33 audit, F-15). */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", disallow: "/" }],
  };
}
