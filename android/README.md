# Sodio on Android — the runbook

The Play app is a **Trusted Web Activity**: a full-screen Chrome, with no
address bar, rendering `https://sodio.vercel.app`. It is not a copy of Sodio
and it is not a webview wrapper — it *is* Sodio, in an app icon.

**What that buys, and it is the whole reason for this shape:** every Vercel
deploy reaches every phone the moment it lands. There is no store review
between a fix and the floor, no second UI to keep in step with the web one,
and no version of the app that can be "behind". The only thing that ever needs
re-uploading to Play is a change to the *shell* — the name, the icon, the
splash, the colours — which is roughly never.

Everything is generated from `twa-manifest.json` in this folder. The Android
project itself is gitignored: it is build output, regenerate it rather than
edit it.

---

## 0 · What the web app already carries for this

| Piece | Where | Why it matters |
|---|---|---|
| Web app manifest | `src/app/manifest.ts` | Bubblewrap reads name, icons, colours and `scope` straight from it |
| Digital Asset Links | `src/app/.well-known/assetlinks.json/route.ts` | **This is what removes the URL bar.** Driven by `ANDROID_CERT_FINGERPRINTS` |
| Service worker | `public/sw.js` | Push only, deliberately no caching — see the note in the file |
| Push sending | `src/server/push.ts`, hooked into `notifyMembers` | The app's notifications ARE the site's web push, delegated to its tray |
| Proxy exemptions | `src/proxy.ts` | `sw.js` and `.well-known` must never be redirected to `/login` |

---

## 0.5 · The toolchain — DONE

Bubblewrap brings its own JDK and Android SDK; no system Java is involved.
Both are installed (`~/.bubblewrap/jdk/jdk-17.0.11+9` and
`~/.bubblewrap/android_sdk`, ~1.1 GB), and `~/.bubblewrap/config.json` points
at them. Nothing to do here again on this machine.

## 1 · The upload key — DONE (2026-08-28)

`android/sodio-upload.keystore`, alias `sodio`, RSA 2048, 10,000 days. Its
password is in `.env.local` as `BUBBLEWRAP_KEYSTORE_PASSWORD` —
**move it into a password manager**; the keystore and the env file are both
gitignored and neither is backed up anywhere.

Its own fingerprint (SHA-256), which is in the assetlinks list so a locally
built APK also opens without an address bar:

    2C:35:22:84:27:F0:02:A9:42:A8:67:9C:B4:E7:83:CB:EB:F6:28:35:5E:4C:92:24:B6:8A:8D:AF:9E:40:7C:B2

<details><summary>How it was made, if it ever has to be made again</summary>

```bash
~/.bubblewrap/jdk/jdk-17.0.11+9/Contents/Home/bin/keytool -genkeypair -v \
  -keystore android/sodio-upload.keystore -alias sodio \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -dname "CN=Sodio, OU=IM, O=AIESEC in Alexandria, L=Alexandria, C=EG"
```

It asks for a password twice (or pass `-storepass`/`-keypass`).

> If it is ever lost: Play App Signing means this is only the *upload* key, so
> Google can reset it from Play Console rather than the app being orphaned.
> That is a support round-trip, not a catastrophe — but don't rely on it.

</details>

## 1.5 · Accept the Android SDK licence (once, yours to accept)

`bubblewrap doctor` downloads the SDK's *command-line tools* but installs no
platform and no build-tools — those need Google's **Android SDK Terms and
Conditions** accepted first, which is an agreement in your name, not a
machine's. Without it the build fails inside `SdkHandler.initTarget` with a
stack trace and no readable reason.

```bash
yes | ~/.bubblewrap/android_sdk/tools/bin/sdkmanager --sdk_root="$HOME/.bubblewrap/android_sdk" --licenses
~/.bubblewrap/android_sdk/tools/bin/sdkmanager --sdk_root="$HOME/.bubblewrap/android_sdk" "platforms;android-36" "build-tools;36.0.0"
```

(`android-36` is what `android/app/build.gradle` compiles against — if that
ever changes, install the matching platform.)

## 2 · Build the bundle

```bash
cd android
export BUBBLEWRAP_KEYSTORE_PASSWORD=$(grep '^BUBBLEWRAP_KEYSTORE_PASSWORD=' ../.env.local | cut -d= -f2-)
export BUBBLEWRAP_KEY_PASSWORD="$BUBBLEWRAP_KEYSTORE_PASSWORD"
npx @bubblewrap/cli update --skipVersionUpgrade   # regenerate from twa-manifest.json
npx @bubblewrap/cli build --skipPwaValidation     # → app-release-bundle.aab (+ .apk)
```

⚠️ **`update` without `--skipVersionUpgrade` PROMPTS for a version name** and
writes whatever it is given straight into `twa-manifest.json` — answer it
carelessly (or pipe anything into it) and the app's version becomes that
string. Use the flag unless you actually mean to bump the version, and bump it
in the file instead.

⚠️ **The first `build` takes 10–20 minutes** — Gradle downloads its own
toolchain (~400 MB) before it compiles anything. Later builds are a minute.

`app-release-bundle.aab` is what Play wants. The `.apk` is for sideloading onto
a phone to check it before anyone else sees it.

## 3 · Play Console — the first upload

Create the app (name **Sodio**, package **`app.sodio.crm`** — a package name is
permanent, it can never be changed once published), then **Test and release →
Testing → Internal testing → Create new release** and upload the `.aab`.

Internal testing is live within minutes and takes up to 100 testers by email.
Start there whatever the eventual plan is.

## 4 · The fingerprint — the step everyone misses

**Play re-signs your upload with Google's own key.** The certificate that
actually reaches a phone is therefore NOT the one from step 1, and it does not
exist until after the first upload.

Play Console → **Test and release → Setup → App integrity → App signing key
certificate → SHA-256 certificate fingerprint**. Copy it, then:

```bash
vercel env add ANDROID_CERT_FINGERPRINTS production   # paste it
vercel deploy --prod
curl -s https://sodio.vercel.app/.well-known/assetlinks.json
```

That last command must print your package and that fingerprint. Until it does,
the app opens **with a browser address bar across the top** — which is the
single most common "the app looks wrong" report, and this is always the cause.

While sideloading the step-1 APK, add the **upload** key's fingerprint to the
same comma-separated list (`keytool -list -v -keystore …`). Both are
legitimate; they sign different builds.

## 5 · Getting to production — read this before promising a date

The developer account is a **personal** one, so Google requires **closed
testing with 12 opted-in testers for 14 continuous days** before it will unlock
production. The 14 days do not start until 12 testers have actually opted in.

Three honest options:

1. **Internal testing only, forever.** Members install from an emailed link,
   up to 100 people. Live today. For a private LC tool this is a legitimate end
   state, not a workaround — nothing about Sodio wants to be found by strangers
   in the Play Store.
2. **Run the 14 days**, then publish publicly. Start the clock now with 12 of
   the LC and it is done in a fortnight.
3. Move the app to an **organisation** account (D-U-N-S verified) and skip the
   rule entirely.

## 6 · What the listing needs (only you can fill these in)

- **Privacy policy URL** — `https://sodio.vercel.app/privacy` (a draft is in the
  repo at `src/app/privacy/page.tsx`; read it and correct anything that is
  wrong before you submit it, it is a statement the LC is making).
- **Data safety form** — Sodio collects: name, email address, phone number,
  and user-generated work records. It is *collected*, *not shared* with third
  parties, encrypted in transit, and a member can request deletion through the
  IM team. Sign-in is required.
- **Content rating** questionnaire — a business tool, everyone.
- **Target audience** — 18+.
- **Screenshots** — at least 2 phone screenshots. Take them from the app.
- **Feature graphic** — 1024×500 PNG.
- **App icon** — 512×512 (`public/icons/icon-512.png`).

## 7 · Later releases

A change to the web app needs **nothing here** — it is already live.

A change to the shell (name, icon, splash, colours) means: edit
`twa-manifest.json`, bump **both** `appVersionCode` (an integer, must increase)
and `appVersionName`, then repeat steps 2 and 3.

## 8 · Notifications inside the app

`enableNotifications: true` in `twa-manifest.json` turns on **notification
delegation**: the site's web push is handed to the app's own notification tray,
and the app asks for Android 13+'s `POST_NOTIFICATIONS` permission itself.

So there is no FCM key, no second sender, and no separate list of "things that
push". A member turns it on at **Profile → ⚙ My settings → Notifications on
this phone or laptop**, and from then on everything Sodio already puts on the
bell reaches them. `Test it` on that row proves the whole chain end to end.
