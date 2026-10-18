# zinda_play

A new Flutter project.

## Home screen spacing

The native Flutter home screen is separate from the React website. The promotion
banner displays only its 3:1 image, with no caption, Featured label or button
panel underneath. A configured HTTP(S) destination opens when the image is
tapped. Disabled banners and banners without images take no space. The Featured
video carousel is removed; videos remain in Trending and All videos. Trending
starts directly below the banner without additional top padding when there are
no popular creators. When popular creators are available, their horizontal row
appears directly below the banner, before Trending, with a 12px heading gap.
Tapping a creator's avatar or name opens that creator's profile. This row also
remains available when there are no videos; search/category results omit it.

Run the layout regression tests with:
`flutter test test/homepage_promotion_banner_test.dart test/home_featured_spacing_test.dart`.

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
