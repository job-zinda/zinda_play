# Zinda Play — React + Node.js starter

## Requirements
- Node.js LTS (includes npm): https://nodejs.org/en/download
- A MongoDB database for video metadata, categories, and view counts.
- A Bunny Stream library for storing and streaming uploaded video files.

## Run
Open this folder in VS Code. In Terminal 1:
```powershell
cd server
Copy-Item .env.example .env
npm install
npm run dev
```
In Terminal 2:
```powershell
cd client
npm install
npm run dev
```
Open the Vite URL printed by the client terminal (usually http://localhost:5173).

## Creator membership: QR payments and manual approval

Creator membership defaults to **INR 199 for 30 days**, with the existing **7-day free trial**. In the web admin dashboard, open **Membership plans & payments** to:
- Upload or replace your payment QR (JPEG, PNG, or WebP, up to 8 MB).
- Edit the trial length, plan names, prices, durations in days, and availability; add or remove plans.
- Enable the preconfigured 3-month (90-day), 6-month (180-day), and one-year (365-day) plans after checking their prices. Longer plans start disabled; their initial prices are INR 597, INR 1194, and INR 2388.
- Review pending screenshots, confirm receipt in your bank/UPI app, and approve or reject payments. Rejection requires a reason.

Creators on web and mobile open **Plans & payments** (or **Membership plans, renewal & payment status** in web Creator studio), select an available plan, scan the QR, and upload a successful-payment screenshot. Screenshots are stored in MongoDB GridFS and can only be retrieved by authenticated administrators. A screenshot does not activate membership: the existing trial/paid expiry remains in force until approval. Only one payment may await review per creator. Creators can refresh payment status and see rejection reasons and payment history; administrators receive a notification for each submission, and creators receive the review decision.

Approval adds the submitted plan's duration to any remaining paid membership, or starts on the approval date if no paid time remains. Retrying an interrupted approval cannot credit that payment twice. Plan changes do not change previously submitted payments; trial-length changes affect only trials that have not started. Payments are manual renewals, not recurring debits. Confirm the recipient and amount before paying; a screenshot alone is not evidence of funds received.

New Razorpay checkout for creator membership and business promotions is disabled. Existing Razorpay orders can still be verified. No Razorpay credentials are needed for the manual payment flows. Membership configuration is managed in the admin dashboard rather than through a membership-price environment variable. Restart/deploy the API and rebuild/deploy the clients to use this flow.

Run the membership API regression tests with `npm test` from the server directory. Tests use an isolated in-memory database double, not production data.

## Zinda Shorts (mobile and web)

### Web Shorts

The web app has a **Shorts** button in the header for every account role and guests, plus **Zinda Shorts** in the main menu. It uses the same published Shorts and interaction APIs as mobile; there is no separate web video collection. Shorts opened from creator/profile video cards use this feed instead of the regular landscape player. Shared web links use `?short=<video-id>` and open that Short first.

Scroll/swipe vertically or focus the feed and use the up/down arrow keys; desktop also has previous/next buttons. Playback starts muted. Pause, mute, seek, like/unlike, follow/unfollow, comments, share, save/un-save, report and Watch Later are supported. Viewing/comments are public; posting and other engagement require a viewer, creator, promoter or business account. Guests are sent to the existing sign-in flow. Shorts uploads remain available through **Create Zinda Short in the mobile app**.

Only the active web video is attached and buffered (no next-video download). Safari/native HLS is used where supported; other compatible browsers load the lightweight `hls.js` module on demand with bounded buffers. Changing videos, hiding the browser tab, opening the main menu or navigating away stops playback and releases media resources. Comment/report dialogs pause playback. Feed and saved-list pagination reuse the existing cursors, deduplicate overlapping pages and offer loading, empty, retry and refresh states. Backend deployment/CDN permissions described below apply equally to web playback. Build the web frontend with `npm run build` in the client directory; no additional backend routes are required for this web section.

### Flutter mobile

The Android-first app includes **Home, Shorts, Create, Earn and Profile** navigation. Explore and the existing Library/dashboard remain in the Home header. Create offers both the unchanged regular upload and **Create Zinda Short**; existing creator approval, promoter-to-creator mode, profile-photo and active trial/membership checks apply. Shorts remain private until encoded, validated and approved through the existing admin review. Regular landscape playback and uploads are unchanged.

Shorts use a full-height vertical paged feed with a centered 9:16 player, dark/violet overlays, creator avatar/username, captions, hashtags and views. Only the active Short plays. Swiping, app backgrounding, covering the route, opening comments/authentication or leaving the tab stops/pauses playback. Controls include pause, mute (on by default), progress/seeking, likes, comments, native sharing, follow, save and report. Watch Later is available from the bookmark icon in Shorts. Viewing is public; engagement requires a signed-in viewer, creator, promoter or business account.

**Upload requirements:** MP4, MOV or WebM; 9:16 portrait (ratio tolerance 0.04); positive duration up to 60 seconds; maximum 150 MB; caption up to 2,000 characters; up to 10 hashtags of 1-30 Unicode letters/numbers/underscores; a valid category. The mobile player checks the actual selected file before uploading. The backend rechecks declared metadata and only sets `shortValidated: true` after fetching Bunny's authoritative encoded length, dimensions and rotation. Client metadata cannot publish an overlength/landscape Short. Invalid encodes stay hidden with an explicit validation error in Creator studio and Admin content.

### Shorts backend deployment

If the app shows `Unexpected character ... <!DOCTYPE html>` or a server-update message, check `GET /api/shorts?limit=1` on the deployed API. `404 Cannot GET /api/shorts` means the deployed backend does not include Shorts yet; rebuilding the APK alone does not deploy the server. Deploy the updated server source (including `server/src/shorts.js` and its route registration), then verify a JSON `{items, nextCursor}` response before retrying in the app.

- Keep `BUNNY_STREAM_LIBRARY_ID` and `BUNNY_STREAM_API_KEY` on the API server as before.
- Set **`BUNNY_STREAM_CDN_HOSTNAME`** to the Stream library's pull-zone hostname, e.g. `vz-example.b-cdn.net` (not the iframe embed hostname). The server constructs native adaptive HLS `playlist.m3u8` and thumbnail URLs; no Bunny API key is sent to clients. The hostname must serve playable HLS under the library's CDN access rules. A token-protected CDN additionally needs an appropriate server-side signed-playback implementation before it can be used; iframe-only access does not provide native HLS access.
- Set a strong, stable **`VIEW_IP_HASH_SECRET`**, and the correct **`TRUST_PROXY_HOPS`** behind a proxy. Existing `ADMIN_PASSWORD` is the fallback hashing key, but a dedicated secret is recommended.
- Deploy/restart the API, rebuild/deploy the web admin, and rebuild the Flutter APK with the same deployed API URL. Database indexes are created at startup; no destructive migration is needed. Old videos without `videoType` remain regular videos. No Shorts are seeded automatically.
- Continue the existing encoding polls in Creator studio/Admin content. Shorts await this Bunny metadata check as well as admin approval. A creator can check processing/validation failures in Creator studio; the admin can reject invalid submissions through existing moderation.

Backend additions:

| API | Purpose |
| --- | --- |
| `GET /api/shorts?limit=6&cursor=...` | Public bounded newest-first feed, maximum 12 per page; `{items, nextCursor}`. Preserves publication, encoding and city restrictions. Empty location-filtered pages may still have a next cursor. |
| `GET /api/shorts/:id` | Public validated Short with native stream URL, also used when opening a Short from an existing creator/profile video list. |
| `POST /api/creator/videos/upload` | Reused raw Bunny upload with `X-Video-Type: short`, percent-encoded `X-Short-Caption`/JSON `X-Short-Hashtags`, and `X-Video-Duration`, `X-Video-Width`, `X-Video-Height`. No new public Bunny upload credentials. |
| Existing video interactions/like/comments and creator follow APIs | Reused database records, unique likes/follows, and notifications; business accounts can engage with Shorts. Shorts engagement/follow actions have per-minute limits. |
| `GET /api/shorts/:id/state`; `PUT`/`DELETE /api/shorts/:id/saved` | Authenticated persistent Watch Later state; save/un-save are idempotent. |
| `GET /api/shorts/saved?before=...` | Authenticated saved-list cursor pagination (12 per page); hidden/unpublished Shorts are not leaked. |
| `POST /api/shorts/:id/view-start`; `POST /api/shorts/:id/view` | Rate-limited HMAC-signed view ticket, then completion with `{ticket}`. The app submits only after actual foreground playback; the server requires at least 3 seconds (or the duration for shorter videos), validates ticket age/identity and counts once per IP hash per video. |
| `POST /api/shorts/:id/report` | Authenticated, deduplicated, rate-limited report with `spam`, `harassment`, `inappropriate`, `copyright` or `other`; notifies admin. |
| `GET /api/admin/shorts/reports`; `PATCH /api/admin/shorts/reports/:id` | Admin pending reports and `{action: "dismiss"}` / `{action: "unpublish"}`. Available in the Content dashboard; unpublishing preserves the video/engagement history. |

Video records add `videoType: "short"`, `caption`, `hashtags`, `shortValidated`, `shortValidationError`, validated dimensions and duration. The existing videos collection, creator review and Bunny IDs are reused. New collections are `savedShorts`, `shortReports`, `shortViews` and TTL-expiring `shortRateLimits`. Regular feed results exclude Shorts; creator/admin lists retain them. Shorts view counters are derived from the unique view ledger so retries repair a failed counter update without counting twice. Shorts do **not** create creator earning views or promoter watch rewards; this feature does not change earning rules.

Data saver is on by default: only the current player is initialized. Opt-in preloading initializes at most the next player; older controllers are paused and released. Reduced-motion preferences disable next-player preloading. HLS lets the platform choose adaptive quality. The feed paginates metadata rather than downloading every video. Public viewer-IP deduplication is intentionally conservative (people sharing an IP may count as one); signed tickets and rate limits reduce trivial replay but are not bot-proof playback attestation.

Validation: run `npm test` in the server directory, and `flutter test test\shorts_test.dart` in the mobile directory. Tests cover media constraints, cursor/location/private filtering, saved-state isolation, duplicate/premature/tampered view requests, report moderation, player swipe/lifecycle cleanup, mute/pause, preload limits and mocked engagement flows. Test a real short upload and native Bunny HLS playback on a physical Android device after configuring/deploying the backend; isolated tests do not validate real CDN permissions or low-end-device throughput.

## Ad delivery and reports

In **Admin -> Ads**, each video ad has its own **Every video**, **Every 5 videos**, or **Every 10 videos** setting. Existing ads default to every video. The counter is per ad, per browser/app session, and advances when an eligible public video is opened; city and interest targeting still apply. The first delivery for an interval of 5 or 10 is due on the fifth or tenth eligible opening. If several ads are due, one is selected; the others remain due. A delivered ad's counter resets; restarting/reloading the client starts a new session.

Set an impression target (0 means unlimited). Before displaying a banner or video ad, web and mobile clients claim an impression atomically. Once the target is reached, further claims are refused and the ad stops serving, even when viewers arrive simultaneously. Impressions report reserved ad deliveries, not unique viewers, completed plays, or independently verified attention; an interrupted delivery can still count. Deploy the updated web and mobile clients together with the API.

The admin ad table reports **unpublished / active / paused / completed**, impressions, clicks, CTR, remaining impressions, completion percentage, and completion time for newly completed ads. The **Legacy paid business promotion reports** table includes the latest 500 old feed campaigns, their amounts, locations, purchased targets, delivery progress, and completion times. Use **Refresh analytics** or **Download analytics CSV** for a combined report; legacy campaign click/CTR fields are blank because feed promotions do not track those metrics. Historical completed ads without a stored completion timestamp still show their completed status. For admin-created ads, raising a target above its existing impression count (or setting unlimited) allows an enabled ad to serve again without resetting past metrics. Paid business ad targets are locked to the purchased amount. Pausing an ad stops new deliveries; an ad already delivered can finish.

## Business ads: QR payment, review, then publication

Businesses on web and mobile open **Create ads, resubmit & view analytics** / the Business workspace ads section:
1. Enter the title, description, destination HTTP(S) URL, optional city/town, interests, and purchased impression target (1,000 to 1,000,000 in increments of 1,000).
2. Save and upload an MP4 or WebM video, up to 150 MB. This new pre-roll ad path stores media in MongoDB GridFS; it deliberately uses a smaller, browser-playable format than the legacy 2 GB Bunny upload path.
3. Pay the quoted amount using the displayed QR, upload a JPEG/PNG/WebP screenshot up to 8 MB, and submit for review. Saving a draft does not submit or publish it. Interrupted uploads can be recovered through **Continue draft** after the 30-minute upload timeout.
4. In **Admin -> Ads -> Business ad pricing & paid submissions**, verify receipt in the bank/UPI app and review the private video and payment screenshot. Approval creates an **unpublished**, inactive ad in the main Ads table with its URL, city, interests, and purchased target already filled in.
5. Select **Publish business ad** in the Ads table to start delivery through the same pre-roll system as admin video ads. Businesses receive submission, review, publication/pause, and target-completion notifications. Set the per-ad frequency and skip behavior in the main editor.

The admin can change the whole-rupee price per 1,000 impressions (default INR 500) and upload/replace the shared payment QR from this section. The QR is shared with creator membership payments; replacing it changes both payment screens. Prices and impression targets are snapshotted at draft creation and cannot be changed on that submission, even after a pricing change. Create a separate ad to buy a different target.

Rejection requires a reason and deletes the video, not the submission, payment screenshot, or review history. The business selects **Resubmit replacement**, saves corrected details, uploads a replacement video, and submits again. A payment explicitly verified by admin remains verified for that same submission and purchased target: do not charge again. Unverified payments still need verification before approval. Private video previews require the owning business or an administrator; screenshots are administrator-only. Only approved, published ad media is publicly served.

Businesses can refresh **Ad analytics & submission history** for the same impressions, clicks, CTR, remaining target, completion percentage/time, and delivery status shown to admin. Web supports CSV download; mobile supports copying an analytics report. Paid ad creatives, destination, targeting, and purchased targets are locked after approval, and paid ads can be paused rather than deleted to preserve reports.

City targeting requires a MaxMind GeoLite2 City database configured with `MAXMIND_DB_PATH`; leave the city blank for all locations. Location matching is IP-derived and approximate. Empty interests means all interests. Restart/deploy the API and rebuild/deploy web and mobile clients together. Run `npm test` in the server directory for isolated business payment/review/resubmission and delivery regressions; these tests do not verify real banking payments.

## Public viewing and promoter creator mode

The public Explore library and public playback endpoints are available without authentication to viewers and to all signed-in account types, including promoters, creators, businesses, and regular members. Dashboard upload lists are separate from the public feed. Approval, publication, encoding readiness, city targeting, and paid business-campaign availability restrictions still apply; private/pending videos are not made public.

Promoters can choose **Switch to creator / apply** in the web account menu or mobile profile/promoter dashboard. The first request enters the normal creator application review. After approval, the same profile-photo requirement, trial, paid membership checks, upload moderation, studio, and creator wallet apply. Promoters can switch back from the account menu without changing their underlying promoter account, referral code, earnings, or withdrawal history. Pending or rejected applications cannot upload or bypass approval by switching repeatedly. Approval notifications update creator mode; on mobile, reopen the profile menu or library to refresh account approval. Signing in again starts in promoter mode; creator access remains available through switching.

## Accounts and admin access
Use **Sign in** to log in or create an account. During registration, upload an optional JPEG, PNG, WebP, or GIF profile photo (up to 8 MB); photos are stored in MongoDB GridFS and shown with creator-owned videos. Signed-in members and creators can open the profile menu in the app bar to edit their profile or sign out; creators can also open Creator studio or Wallet from that left-side drawer. Notifications remain in the app bar. Use **Edit profile** to update the display name, bio, or profile photo. Their display name, bio, and photo appear above their videos. Viewers can follow or unfollow creators from the creator information shown on a video page; creator profiles display their follower count, and creators receive an in-app notification when someone follows them. Usernames remain the sign-in identifier. New members are stored in MongoDB with passwords stored as salted scrypt hashes. New creator memberships start pending; admins can approve or decline applications from **Notifications**. Members receive an in-app notification when the application is reviewed. Approved creators can upload and edit their own videos and see their own view analytics in **Creator studio**; new creator uploads remain private and show **Waiting for approval** until an admin reviews them in **Notifications**. Admins can approve a submission to publish it or reject it with a required reason; rejection deletes the video asset and related records. Creators receive in-app notifications when a video is submitted, approved, or rejected. Public video pages show the creator's display name above creator-owned video players, and video ownership and creator access are enforced by the API. Admins and creators can optionally set a target city/town on a video; the video is only listed and playable for viewers whose IP-derived GeoLite2 City location matches that city. Leave the field blank for global visibility. IP geolocation may be approximate, and city targeting requires a configured MaxMind GeoLite2 City database. Regular pending members can explore the public video library but cannot upload or access creator analytics. Sign in with the credentials configured as `ADMIN_USERNAME` and `ADMIN_PASSWORD` in `server/.env` to open the admin dashboard and review creator applications and videos. Admin credentials are reserved and cannot be used to register a member account.

The **Creators & brands** directory is available from Explore, member profile menus, creator profiles, and admin/business profile buttons. It lists approved creator profiles with their public videos and business/brand profiles with their public name, logo, and description.

Businesses can register using **Business / brand** account type and add a business name, description, and optional logo. Their Business workspace lets them browse approved creators and send a video brief/invitation. Creators can review invitations from **Brand invitations** in their account menu and accept or decline; the business receives an in-app notification of the response. Invitation status is visible to both sides.

Businesses can open a creator profile and start a private chat; creators can continue the conversation from **Messages**. New paid ads use the QR workflow above. Existing Bunny business uploads and Razorpay-paid feed campaigns remain available as legacy history, previews, and already-paid delivery; new legacy uploads/orders return HTTP 410. Old feed campaigns retain their original country/region targeting and serving behavior. Configure `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` only if existing orders still need verification. For location targeting, obtain a MaxMind GeoLite2 City database and place it at `server/data/GeoLite2-City.mmdb`, or set `MAXMIND_DB_PATH` to its path relative to the server directory. Restart the API after changing configuration. Viewer IPs are not stored by the ad location lookup.

Approved creators also have a **Wallet** showing estimated earnings at ₹50 per 1,000 unique viewer IPs per video. A viewer IP only earns once for a given video; repeat plays still appear in total plays, but do not add another earning view. The wallet shows each video's unique earning views, total plays, estimated earnings, and progress toward the next ₹50 reward. IPs are stored as keyed hashes. Set a strong, stable `VIEW_IP_HASH_SECRET` in `server/.env`; if omitted, the API uses `ADMIN_PASSWORD` as the hash key. If the API is behind a trusted reverse proxy, set `TRUST_PROXY_HOPS` to the exact number of trusted proxy hops (for example, `1` for one proxy) so Express can identify the client IP; keep it at `0` when connecting directly. Wallet earnings are estimates only: cash withdrawals and payment processing are not enabled. Signed-in members can like and comment on published videos; creators receive in-app notifications for likes and comments on their videos.

Promoters can register using **Promoter account** and share the referral link in their **Promoter dashboard**. Referred viewers must create a signed-in account through that link; eligible watches count only once per viewer and published video after the video page stays visible for 30 seconds (or the full duration for shorter videos). Promoters earn ₹50 per 1,000 eligible referred views and ₹10 per 100 distinct published videos they watch. The dashboard tracks reward milestones, available balance, and withdrawal history. Withdrawals require a minimum available balance of ₹100 and a valid UPI ID or UPI-linked 10-digit mobile number; payout requests are reviewed manually by an administrator, who must confirm payment before marking a request paid. These watch rewards are not automated payouts, and visible-page timing does not independently verify video playback.

The server loads `.env` relative to its source, even when started from another working directory. If you change the admin credentials, restart the API. Set new, strong values before deploying anywhere public; the `.env.example` file uses placeholders and should not contain real credentials. Admin API routes require a server-issued bearer token; sessions are held in memory and expire when the server restarts or you sign out.

The API requires MongoDB and will not start without a valid `MONGODB_URI`. Create a MongoDB Atlas cluster (or use another MongoDB deployment), set `MONGODB_URI` in `server/.env`, and optionally set `MONGODB_DATABASE` (defaults to `zinda_play`). The API seeds the default categories when it starts. Video metadata, categories, and view counts are persisted in MongoDB; video files remain in Bunny Stream.

## Bunny Stream uploads
Configure `BUNNY_STREAM_LIBRARY_ID` and `BUNNY_STREAM_API_KEY` in `server/.env`, then restart the API to upload videos directly to Bunny Stream from the Admin content form or an approved creator's studio. Creator video uploads require a video file; the upload form also lets creators optionally attach an HTTPS product, service, or course URL. That link appears as an action on the video's watch page. The API key stays on the server and must never be put in React/browser code. Uploads up to 2 GB report browser transfer progress; dashboards poll Bunny's encoding status and store status updates in MongoDB. Creator submissions are not listed publicly unless an admin approves them, and public videos are only available after processing finishes. Admins can publish or unpublish admin-managed items from the dashboard. Existing player/embed URLs can still be entered manually by admins.

Use **Admin → Banner** to configure the homepage promotion. Its title, description, call-to-action, and enabled state are saved in MongoDB; uploaded JPEG, PNG, WebP, and GIF banner images (up to 8 MB) are stored in MongoDB GridFS and shown to visitors when enabled. In **Admin → Add video**, upload an optional JPEG, PNG, WebP, or GIF thumbnail (up to 8 MB); thumbnail files are stored in MongoDB GridFS alongside the video's metadata.

For both the homepage promotion and top/middle/bottom advertisement banners, prepare a **1200 x 400 pixel (3:1)** test image, up to **8 MB** (JPEG, PNG, WebP, or GIF). Web and Flutter mobile display the full artwork in a responsive 3:1 area without cropping; older images with other proportions fit with padding. Homepage promotion title, description and button appear below the image on both clients, rather than covering it. Use large artwork text that remains readable when scaled down and keep the top-left corner of advertisement artwork clear for the Ad label. For a 360-pixel-wide phone, the image area is approximately 330 x 110 logical pixels, depending on surrounding padding. Test at phone widths of 320, 360 and 390 pixels as well as desktop; check all edges, text readability, the link and the disabled/hidden banner state. Both admin upload forms show these recommended dimensions; uploads are not restricted to that resolution.

Admins and approved creators can optionally group uploaded videos into a **Web series** or **Playlist** from the video form. Give each video the same collection name and type, and optionally set its episode or playlist position number. Published, processed videos are grouped into browsable collections on Explore; episodes/items appear in the specified order, with unnumbered videos following them.

When deploying the API to Render, configure `MONGODB_URI`, `MONGODB_DATABASE`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `VIEW_IP_HASH_SECRET`, `TRUST_PROXY_HOPS`, `BUNNY_STREAM_LIBRARY_ID`, `BUNNY_STREAM_API_KEY`, and `CLIENT_ORIGIN` in the service environment. Use the deployed frontend's exact origin for `CLIENT_ORIGIN` and set `TRUST_PROXY_HOPS` to match the trusted proxy chain in front of the API. For private media, add a server-side signed playback flow.
#   z i n d a _ p l a y  
 