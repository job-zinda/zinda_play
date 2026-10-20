import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:video_player_platform_interface/video_player_platform_interface.dart';
import 'package:zinda_play/ads.dart';

class _AdPlayer extends VideoPlayerPlatform {
  late final StreamController<VideoEvent> events = StreamController<VideoEvent>(
    onListen: () => events.add(
      VideoEvent(
        eventType: VideoEventType.initialized,
        duration: const Duration(seconds: 3),
        size: const Size(720, 1280),
      ),
    ),
  );
  Duration position = Duration.zero;
  bool playing = false;
  @override
  Future<void> init() async {}
  @override
  Future<int?> createWithOptions(VideoCreationOptions options) async => 1;
  @override
  Stream<VideoEvent> videoEventsFor(int playerId) => events.stream;
  @override
  Future<void> dispose(int playerId) async => events.close();
  @override
  Future<void> play(int playerId) async {
    playing = true;
  }

  @override
  Future<void> pause(int playerId) async {
    playing = false;
  }

  @override
  Future<void> setVolume(int playerId, double volume) async {}
  @override
  Future<void> setLooping(int playerId, bool looping) async {}
  @override
  Future<void> setPlaybackSpeed(int playerId, double speed) async {}
  @override
  Future<void> seekTo(int playerId, Duration position) async {}
  @override
  Future<Duration> getPosition(int playerId) async => position;
  @override
  Widget buildViewWithOptions(VideoViewOptions options) =>
      const ColoredBox(color: Colors.black);
}

void main() {
  setUp(() => FlutterSecureStorage.setMockInitialValues({}));
  for (final placement in ['video', 'simply', 'home']) {
    testWidgets('$placement ads load only when active and pause offscreen', (
      tester,
    ) async {
      final player = _AdPlayer();
      VideoPlayerPlatform.instance = player;
      var active = false;
      var requests = 0;
      var claims = 0;
      var clicks = 0;
      String? openedUrl;
      const launcher = MethodChannel('plugins.flutter.io/url_launcher');
      tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(launcher, (
        call,
      ) async {
        openedUrl = (call.arguments as Map)['url'] as String;
        return true;
      });
      addTearDown(
        () => tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
          launcher,
          null,
        ),
      );
      late StateSetter update;
      final client = MockClient((request) async {
        if (request.url.path == '/api/ads') {
          requests++;
          expect(request.url.queryParameters['placement'], placement);
          return http.Response(
            jsonEncode([
              {
                'id': 'placement-$placement',
                'type': 'video',
                'title': 'Placement ad',
                'mediaUrl': 'https://example.test/ad.mp4',
                'targetUrl': 'https://example.test/advertiser',
                'frequency': 1,
                'skippable': true,
                'skipAfterSeconds': 1,
              },
            ]),
            200,
          );
        }
        if (request.url.path.endsWith('/click')) {
          clicks++;
          return http.Response('', 204);
        }
        expect(request.url.path, '/api/ads/placement-$placement/impression');
        claims++;
        return http.Response('{"accepted":true}', 200);
      });
      await http.runWithClient(() async {
        await tester.pumpWidget(
          MaterialApp(
            home: Scaffold(
              body: StatefulBuilder(
                builder: (_, setState) {
                  update = setState;
                  return SizedBox(
                    width: 320,
                    height: 180,
                    child: PlayerGate(
                      placement: placement,
                      active: active,
                      builder: (_) => const Text('Content'),
                    ),
                  );
                },
              ),
            ),
          ),
        );
        await tester.pumpAndSettle();
        expect(requests, 0);
        expect(claims, 0);
        update(() => active = true);
        await tester.pumpAndSettle();
        expect(requests, 1);
        expect(claims, 1);
        expect(player.playing, isTrue);
        expect(find.text('Visit advertiser'), findsOneWidget);
        final cta = tester.getRect(find.text('Visit advertiser'));
        expect(cta.right, lessThanOrEqualTo(320));
        expect(cta.bottom, lessThanOrEqualTo(180));
        update(() => active = false);
        await tester.pumpAndSettle();
        expect(player.playing, isFalse);
        update(() => active = true);
        await tester.pumpAndSettle();
        expect(requests, 1);
        expect(claims, 1);
        expect(find.text('Visit advertiser'), findsOneWidget);
        await tester.tap(find.text('Visit advertiser'));
        await tester.pumpAndSettle();
        expect(openedUrl, 'https://example.test/advertiser');
        expect(clicks, 1);
        expect(player.playing, isFalse);
        await tester.pumpWidget(const SizedBox.shrink());
        await tester.pump();
        expect(tester.takeException(), isNull);
      }, () => client);
    });
  }

  testWidgets('homepage slot disappears when no homepage video ads exist', (
    tester,
  ) async {
    final client = MockClient((request) async {
      expect(request.url.queryParameters['placement'], 'home');
      return http.Response('[]', 200);
    });
    await http.runWithClient(() async {
      await tester.pumpWidget(
        const MaterialApp(home: Scaffold(body: HomeVideoAd())),
      );
      await tester.pumpAndSettle();
      expect(find.byType(PlayerGate), findsNothing);
      expect(find.byType(AspectRatio), findsNothing);
      await tester.pumpWidget(const SizedBox.shrink());
    }, () => client);
  });

  for (final skip in [false, true]) {
    testWidgets(
      'creator ad ${skip ? "skip does not earn" : "full watch posts one earning ticket"}',
      (tester) async {
        final player = _AdPlayer();
        VideoPlayerPlatform.instance = player;
        final calls = <String>[];
        final adId = skip ? 'skip-ad' : 'full-ad';
        final client = MockClient((request) async {
          final path = request.url.path;
          calls.add('${request.method} $path');
          Object body;
          if (path == '/api/ads') {
            body = [
              {
                'id': adId,
                'type': 'video',
                'title': 'Full watch offer',
                'targetUrl': 'https://example.com/business',
                'productUrl': 'https://example.com/product',
                'creatorVideoId': 'simply',
                'mediaUrl': 'https://example.b-cdn.net/video/playlist.m3u8',
                'frequency': 1,
                'skippable': skip,
                'skipAfterSeconds': 1,
              },
            ];
          } else if (path.endsWith('/impression')) {
            expect(jsonDecode(request.body)['ticket'], 'full-watch-ticket');
            expect(
              calls.indexOf('POST /api/ads/$adId/view-start'),
              lessThan(calls.length - 1),
            );
            body = {'accepted': true};
          } else if (path.endsWith('/view-start')) {
            body = {'ticket': 'full-watch-ticket', 'minimumWatchMs': 3000};
          } else if (path.endsWith('/view')) {
            expect(jsonDecode(request.body)['ticket'], 'full-watch-ticket');
            body = {'counted': true};
          } else {
            return http.Response(
              jsonEncode({'error': 'Unexpected request'}),
              404,
            );
          }
          return http.Response(jsonEncode(body), 200);
        });
        await http.runWithClient(() async {
          await tester.pumpWidget(
            MaterialApp(
              home: Scaffold(
                body: PlayerGate(builder: (_) => const Text('Main video')),
              ),
            ),
          );
          await tester.pumpAndSettle();
          expect(player.playing, isTrue);
          expect(calls, contains('POST /api/ads/$adId/view-start'));
          expect(find.text('Visit advertiser'), findsOneWidget);
          final steps = skip ? 4 : 12;
          for (int step = 1; step <= steps; step++) {
            player.position = Duration(milliseconds: step * 250);
            await tester.pump(const Duration(milliseconds: 250));
            await tester.pump();
            expect(find.text('Visit advertiser'), findsOneWidget);
          }
          if (skip) {
            await tester.binding.setSurfaceSize(const Size(320, 640));
            await tester.pump();
            final visit = tester.getRect(find.text('Visit advertiser'));
            final skipButton = tester.getRect(find.text('Skip ad ›'));
            expect((visit.center.dy - skipButton.center.dy).abs(), lessThan(1));
            expect(visit.right, lessThan(skipButton.left));
            expect(skipButton.bottom, greaterThan(560));
            await tester.binding.setSurfaceSize(null);
            await tester.pump();
            await tester.tap(find.text('Skip ad ›'));
          } else {
            player.events.add(VideoEvent(eventType: VideoEventType.completed));
            await tester.pumpAndSettle();
            expect(find.text('Visit advertiser'), findsOneWidget);
            expect(find.text('View product'), findsOneWidget);
            await tester.tap(find.text('Skip ad ›'));
          }
          await tester.pumpAndSettle();
          expect(find.text('Main video'), findsOneWidget);
          expect(
            calls.where((call) => call == 'POST /api/ads/$adId/view'),
            hasLength(skip ? 0 : 1),
          );
          await tester.pumpWidget(const SizedBox.shrink());
          await tester.pump();
        }, () => client);
        expect(tester.takeException(), isNull);
      },
    );
  }
}
