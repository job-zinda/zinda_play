# zinda_play

A new Flutter project.

## Backend connection and APK builds

The mobile app defaults to the deployed HTTPS backend at
`https://zinda-play.onrender.com`. Build an installable release APK with
`flutter build apk --release`; the output is
`build/app/outputs/flutter-apk/app-release.apk`.

To use another backend, pass `--dart-define=API_URL=https://your-api-domain`
when running or building Flutter. Supply the origin without `/api` or a trailing
slash. For Android emulator development only, use
`flutter run --dart-define=API_URL=http://10.0.2.2:4000`.
The emulator address cannot reach a development server from a physical phone.
Changing `API_URL` requires a new run/build; reinstall a rebuilt APK on the phone.

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
placements remain available. Admins can add, edit, hide and delete multiple
homepage banners (web admin → **Banners**); enabled banners rotate every five
seconds in a carousel placed after the first three feed videos.

Sharing a video or creator profile opens a sheet with the creator's photo and
name plus Share, WhatsApp and Copy link actions. Creators can share their own
profile from Creator studio. Profile links use
`https://zindaplay.com/share/creator/<id>`. Every signed-in account (viewer,
creator, promoter and business) can follow creators and like or comment on
videos. The bottom navigation keeps Home, Simply, Create, Earn and Profile actions.

Run the home layout, promotion, sharing and creator-search tests with:
`flutter test test/homepage_promotion_banner_test.dart test/home_featured_spacing_test.dart test/share_search_banner_test.dart`.

## Profile settings, creator applications and recovery

Open **Profile & account settings** from Profile or the creator, promoter or
business dashboard. Every personal role can change its username with the current
password and set a verified recovery email. Signup requires an email; the backend
saves it, emails a verification code, and notifies the admin (who also sees a
**Joined users** list with emails on the web). At sign-in, **Forgot password?**
and **Forgot username?** send instructions through Brevo; paste the emailed code to reset a
password or verify an address. Codes expire after 30 minutes. Recovery requires
a verified email; verify the signup email (or add one) in Profile & account settings.

Creator applicants stay viewers until approval. Add a required profile photo,
optionally upload an introduction video (recommended for quicker approval), then
tap **Submit for approval**. Switching modes alone does not submit an application.
Deploy the matching backend and web app, including Brevo sender configuration.
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
