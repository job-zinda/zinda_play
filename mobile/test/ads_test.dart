import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
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
          expect(find.text('Visit advertiser'), findsNothing);
          final steps = skip ? 4 : 12;
          for (int step = 1; step <= steps; step++) {
            player.position = Duration(milliseconds: step * 250);
            await tester.pump(const Duration(milliseconds: 250));
            await tester.pump();
          }
          if (skip) {
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
