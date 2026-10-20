# zinda_play

A new Flutter project.

## Backend connection and APK builds

The mobile app defaults to the deployed HTTPS backend at
`https://zinda-play.onrender.com`. Build an installable release APK with
`flutter build apk --release`; the output is
`build/app/outputs/flutter-apk/app-release.apk`.

### Website APK downloads

The website header and menu link to `/download-app.html`, with Android install
instructions and a direct download at `/downloads/zinda-play.apk`. Installation
requires the user's approval in Android; a website cannot silently install it.
The APK is Android-only, not an iOS installation.

For each release, increase `version` above the last distributed version in
`pubspec.yaml` and build with the same release signing key:

1. From `mobile`, run `flutter build apk --release` (a universal APK).
2. From `client`, run `npm run package:apk`. This checks the Gradle release
   metadata against `pubspec.yaml`, copies the built APK to
   `public/downloads/zinda-play.apk` and generates its SHA-256 checksum. It fails
   for stale/split APKs or files exceeding the repository's 100 MiB file limit.
3. Run `npm run test:download` and `npm run build` from `client`.
4. Include both generated download files in the website deployment (and in the
   repository for Git-based hosting). Vite copies `public` files to `dist`.
   Deploy the `client` project to publish the button, install page and APK
   together. Merely building locally does not update the live website.

`client/vercel.json` sends the Android APK MIME type and attachment filename,
and requires cache revalidation so replacing the stable download URL serves the
new release. If using a different host, configure equivalent headers. Never put
keystores, signing passwords or `android/key.properties` in the web public folder.
Play Store-installed apps may use a different signing key from this direct APK;
do not tell users to uninstall just to bypass a signature conflict.

To use another backend, pass `--dart-define=API_URL=https://your-api-domain`
when running or building Flutter. Supply the origin without `/api` or a trailing
slash. For Android emulator development only, use
`flutter run --dart-define=API_URL=http://10.0.2.2:4000`.
The emulator address cannot reach a development server from a physical phone.
Changing `API_URL` requires a new run/build; reinstall a rebuilt APK on the phone.

## Reward controls and accounting

Web admin -> **Reward settings** independently enables/pauses and sets all six
rates (whole rupees per 1,000 qualifying events):

| Reward | Default |
| --- | --- |
| Personal watches, members and creators | INR 30 |
| Qualifying referred views, members and creators | INR 20 |
| Creator regular-video views | INR 50 |
| Creator Simply views | INR 25 |
| Creator-linked regular-video ad completions | INR 200 |
| Creator-linked Simply ad completions | INR 100 |

All new rewards accrue proportionally per event, including personal/referral
rewards (not the former INR 10/100-watch milestone scheme). Personal and referral
eligibility does not depend on creator approval. The existing visible,
signed-in regular-video watch qualification and once-per-viewer/video rule stay
in place. Simply retains its existing view-ticket qualification. Ads must finish
after an accepted impression; skipped ads never earn and a viewer earns once
per ad. Paused activity still consumes its distinct-view eligibility and cannot
earn retroactively when re-enabled.

`GET /api/rewards/settings` returns current public rates. Admin-only
`GET`/`PUT /api/admin/rewards/settings` reads/writes all six settings atomically
in `siteContent`. New event amounts are frozen in milli-rupees at qualification,
including in-flight ads. Retried member credits use the original unique watch's
snapshot. Existing member milestone credits and all historical creator/ad
credits remain unchanged. Regular-view ledger rows predating snapshots retain
their original 50 milli-rupee value; old unpaid Simply/member watches are not
backfilled. Wallets sum immutable event amounts before rounding for display.
Deploy the API with the website before distributing the rebuilt APK.

## Privacy policy

The mobile app's guest header and signed-in Profile menu open
https://zindaplayprivacypolicy.vercel.app/ in the external browser.

## Home screen

The native Flutter home screen is separate from the React website. It uses a
compact brand header, a horizontal Popular Creators row, category chips, a
trending/latest sort menu and a vertical feed with side-by-side thumbnails and
video details. A most-viewed Trending carousel appears directly below Popular
Creators, before the category filters. Videos without uploaded thumbnail images
play muted previews in both the carousel and home feed; uploaded thumbnails stay
still. The floating WhatsApp **Ask me** button opens
`https://wa.me/919847561998?text=Zindaplay` externally.
Search is opened from the header; searches also list matching creators above the
video results. A **Search content creators** field above Popular Creators opens a
dedicated creator search. Creator profiles, video playback, sharing and ad
placements remain available. The mobile homepage no longer fetches or displays
the promotional banner carousel. The separate web admin **Banners** section has
been removed; existing website homepage banners and their stored data remain.

## Ad placements

Web admin -> **Ads** -> **Ad placements** lets admins select multiple locations:
**Normal videos**, **Simply**, and **Homepage**. Video ads play before normal
videos or Simply clips, or inline on the homepage (after the first three mobile
feed videos, or after the feed when fewer are available). Image ads remain
homepage-only, with top/middle/bottom positions managed under Ads.
Approved paid business ads also support placement selection; their creative,
destination, targeting and paid impression limits remain locked.

**Visit advertiser** remains visible throughout video-ad playback and on the
end card when a destination is configured. Skip delays, frequency, impression
caps, click tracking and full-watch creator credit use the existing flows.
Only active Simply clips request ads; homepage video ads load when visible and
pause offscreen. Video frequency is shared across selected surfaces within the
browser/app session. Ads without the new `placements` field keep their previous
behavior: video ads on normal videos, image ads on the homepage.

Deploy the API and website together, then rebuild/reinstall the mobile app.
The API now accepts `placements: ["video", "simply", "home"]` on admin ads and
filters `/api/ads?placement=video|simply|home` for video ads; the existing
`top|middle|bottom` image-ad queries remain supported. At least one placement
is required when explicitly supplied. No banner records or media are deleted.
Test with `node --test server/src/ad-delivery.test.js server/src/creator-ads.test.js server/src/business-ads.test.js`
from the repository root and
`flutter test test/ads_test.dart test/shorts_test.dart test/home_featured_spacing_test.dart test/ad_frequency_test.dart`
from `mobile`.

Sharing a video or creator profile opens a sheet with the creator's photo and
name plus Share, WhatsApp and Copy link actions. Creators can share their own
profile from Creator studio. Profile links use
`https://zindaplay.com/share/creator/<id>`. Every signed-in account (viewer,
creator, promoter and business) can follow creators and like or comment on
videos. The bottom navigation keeps Home, Simply, Create, Earn and Profile actions.

## Regular-video engagement

The mobile regular-video player has a compact dark engagement card with Like,
Comments, Share and Save. Likes and comment totals come from the existing video
APIs. Tapping Comments opens and refreshes the panel; its refresh button also
fetches current totals. Signed-in users retain the 500-character comment composer,
and guests see a Sign In prompt. Sharing uses the existing share sheet.

Regular-video bookmarks are stored locally in a separate secure-storage namespace,
per signed-in username and video. They survive reopening the screen and signing
out on Android/iOS, but do not sync between devices or appear in Saved Simply.
Changing a username starts a separate local bookmark set. No regular-video Save
API is called, and Simply's existing server-side saves are unchanged.

Validate the layout, counts, authentication return, bookmarks and sharing with
`flutter test test/watch_engagement_test.dart`.

The creator wallet has a **Withdraw** button once at least ₹100 is available.
Creators withdraw the full balance or a custom amount (minimum ₹100) to a Google
Pay or PhonePe number, one request at a time. The admin pays manually and marks
the request paid (deducted from the wallet) or rejects it with a reason (amount
returned), from web admin → **Creator payouts**, where they can also send an
amount to a creator's wallet. Every step creates a notification. Tests:
`flutter test test/withdraw_card_test.dart`.

Run the home layout, promotion, sharing and creator-search tests with:
`flutter test test/homepage_promotion_banner_test.dart test/home_featured_spacing_test.dart test/share_search_banner_test.dart`.

## Profile settings and creator applications

Signup offers Member and Business only. Members join immediately with username,
and password, without an email field, OTP step or approval. Existing viewers and promoters are treated
as members without changing account IDs, balances, referrals or withdrawals.
Earn and Profile -> Wallet & referrals open the member reward wallet for every
non-business member, including approved creators and pending/rejected applicants.
Creators also retain a separate Creator earnings wallet. Businesses have no
member rewards or invitation signup input. Creator applications remain optional
from Profile & account settings and still need the existing photo/admin approval.
Deploy the matching API and web app alongside the rebuilt mobile app.

Regular-video member rewards use the existing watch-start/watch-complete flow
after the pre-roll gate. Only visible foreground watch time on the current route
counts; Simply and feed previews do not generate member watch rewards.
Test with `flutter test test/auth_referral_test.dart test/member_wallet_test.dart test/member_watch_tracker_test.dart test/account_settings_test.dart`.

Open **Profile & account settings** from Profile or the creator, promoter or
business dashboard. Every personal role can change its username with the current
password. Email verification and email recovery are removed, including signup
email collection, recovery links and profile email controls. Sign in with your
username/password; contact support if credentials are lost. Existing accounts,
balances and referrals are preserved. Old email recovery API calls return HTTP
410 and cannot reset passwords. WhatsApp OTP is not configured or available yet.

Creator applicants stay viewers until approval. Add a required profile photo,
optionally upload an introduction video (recommended for quicker approval), then
tap **Submit for approval**. Switching modes alone does not submit an application.
Deploy the matching backend and web app. Brevo credentials are no longer used
and can be removed from the backend environment.
Legacy pending applications without an explicit submission return to draft on
backend startup; approved creators keep their access.

## Invitation IDs

Creator and promoter invitation IDs are now unique six-digit numbers issued by
the API. Both clients accept them at signup and share them as
`https://zindaplay.com/?ref=123456`. Deploy the updated API and web app alongside
the mobile build: API startup assigns codes to existing personal accounts, and
new accounts receive a code when their invitation dashboard is first opened.
Old long account-ID invitations are no longer accepted. Existing referrals and
reward records keep their original internal account IDs, so earnings and
attribution are unchanged.

## Shared links open the app

Android App Links send `https://zindaplay.com/share/video/<id>` and
`/share/creator/<id>` straight into the installed app (`lib/deep_links.dart`);
without the app they open the website. Android verifies the link using
`client/public/.well-known/assetlinks.json`, which lists the SHA-256 fingerprint
of the key that signs the APK. Release builds use the upload keystore configured
in the private `android/key.properties`, never the debug key. When publishing
through Google Play (Play App Signing), add the Play app-signing key's SHA-256 fingerprint to
`assetlinks.json` and redeploy the website.

## Play Store release

Create ignored `android/key.properties` locally with `storeFile`, `storePassword`,
`keyAlias` and `keyPassword`. `storeFile` is resolved relative to `android`;
an absolute Windows path must use escaped backslashes in this properties file.
Keep the keystore and passwords private and backed up; never commit them.
Release builds fail if the signing file is missing or incomplete.
Run `flutter build appbundle --release` from `mobile`. The bundle is written to
`build/app/outputs/bundle/release/app-release.aab`. Increase the version code in
`pubspec.yaml` above all previously uploaded versions before uploading. Android
release builds compile and target API level 36.
Google Play signs installed apps with its app-signing key, which may differ from
this upload key.

## Getting Started

Cards without thumbnails play muted, looping previews only while at least half
visible. Previews release playback when offscreen, behind another route, or
when the app is backgrounded. Existing thumbnails remain still images.
Creator profiles list Videos and Simply separately with 24px heading icons;
both use the shared cards and keep their existing full-player destinations.
Deploy the API together with the apps so Bunny CDN stream URLs are available
on creator profile cards (`BUNNY_STREAM_CDN_HOSTNAME` must be configured).

This project is a starting point for a Flutter application.

A few resources to get you started if this is your first Flutter project:

- [Learn Flutter](https://docs.flutter.dev/get-started/learn-flutter)
- [Write your first Flutter app](https://docs.flutter.dev/get-started/codelab)
- [Flutter learning resources](https://docs.flutter.dev/reference/learning-resources)

For help getting started with Flutter development, view the
[online documentation](https://docs.flutter.dev/), which offers tutorials,
samples, guidance on mobile development, and a full API reference.
