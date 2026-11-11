# Quest app (Trusted Web Activity)

`twa-manifest.json` describes the Quest APK that wraps https://shadowfolk.vercel.app.

- Package: `app.vercel.shadowfolk`, immersive mode, Meta app ID 1893670708290216.
- Release channel link: https://www.meta.com/s/8Q43XSCZ7
- The signing key is NOT in this repository. Keep it private. Every update must use the same key.

To publish an update to the same link:

1. Copy this folder outside the repo, put the keystore path in `signingKey.path`, and raise `appVersionCode`.
2. Run `bubblewrap update --skipVersionUpgrade` and `bubblewrap build` with `BUBBLEWRAP_KEYSTORE_PASSWORD` and `BUBBLEWRAP_KEY_PASSWORD` set.
3. Run `metavr store share app-release-signed.apk --app-id 1893670708290216`.

Web changes need none of this: the app loads the live site, so a Vercel deploy updates it.
