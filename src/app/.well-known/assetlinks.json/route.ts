import { NextResponse } from "next/server";
import { env } from "@/lib/env";

/** DIGITAL ASSET LINKS — what makes the Android app an APP (v35).
 *
 *  The Play build is a Trusted Web Activity: a full-screen Chrome that renders
 *  sodio.vercel.app with no address bar. Chrome only drops the address bar if
 *  THIS file, served from this domain, names the app's package and its signing
 *  certificate — the site vouching for the app. Get it wrong and the app still
 *  works, but with a browser URL bar across the top, which is exactly what
 *  everyone will report as "it looks like a website".
 *
 *  ⚠️ THE FINGERPRINT IS PLAY'S, NOT THE ONE ON THIS MACHINE. Play App Signing
 *  re-signs every upload with Google's own key, so the certificate that
 *  actually reaches a phone is one that does not exist until the first bundle
 *  has been uploaded. Take it from Play Console → Test and release → Setup →
 *  App integrity → App signing key certificate (SHA-256), and put it in
 *  ANDROID_CERT_FINGERPRINTS. Keep the local UPLOAD key's fingerprint in the
 *  same (comma-separated) list while testing a locally built APK — both are
 *  legitimate, they just sign different builds.
 *
 *  With no fingerprints configured this returns an empty array, which is the
 *  honest answer ("this site vouches for no app") rather than a broken one.
 */
export const dynamic = "force-dynamic";

const PACKAGE_NAME = process.env.ANDROID_PACKAGE_NAME || "app.sodio.crm";

export function GET() {
  const fingerprints = env.androidFingerprints;
  const body =
    fingerprints.length === 0
      ? []
      : [
          {
            relation: ["delegate_permission/common.handle_all_urls"],
            target: {
              namespace: "android_app",
              package_name: PACKAGE_NAME,
              sha256_cert_fingerprints: fingerprints,
            },
          },
        ];
  return NextResponse.json(body, {
    headers: {
      "Content-Type": "application/json",
      // Chrome caches the verification; a short window means a corrected
      // fingerprint takes minutes to land rather than a day
      "Cache-Control": "public, max-age=300",
    },
  });
}
