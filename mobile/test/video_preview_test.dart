import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:video_player_platform_interface/video_player_platform_interface.dart';
import 'package:zinda_play/navigation.dart';
import 'package:zinda_play/screens/creator_screen.dart';
import 'package:zinda_play/screens/home_screen.dart';
import 'package:zinda_play/widgets/muted_video_preview.dart';
import 'package:zinda_play/widgets/video_card.dart';

class _Players extends VideoPlayerPlatform {
  final streams = <int, StreamController<VideoEvent>>{};
  final volumes = <int, double>{};
  final playing = <int>{};
  final loops = <int, bool>{};
  int next = 0;

  @override
  Future<void> init() async {}
  @override
  Future<int?> createWithOptions(VideoCreationOptions options) async {
    final id = ++next;
    late StreamController<VideoEvent> stream;
    stream = StreamController<VideoEvent>(
      onListen: () {
        stream.add(
          VideoEvent(
            eventType: VideoEventType.initialized,
            duration: const Duration(seconds: 10),
            size: const Size(320, 180),
          ),
        );
      },
    );
    streams[id] = stream;
    return id;
  }

  @override
  Stream<VideoEvent> videoEventsFor(int playerId) => streams[playerId]!.stream;
  @override
  Future<void> dispose(int playerId) async {
    playing.remove(playerId);
    await streams.remove(playerId)?.close();
  }

  @override
  Future<void> play(int playerId) async => playing.add(playerId);
  @override
  Future<void> pause(int playerId) async => playing.remove(playerId);
  @override
  Future<void> setVolume(int playerId, double volume) async =>
      volumes[playerId] = volume;
  @override
  Future<void> setLooping(int playerId, bool looping) async =>
      loops[playerId] = looping;
  @override
  Future<void> setPlaybackSpeed(int playerId, double speed) async {}
  @override
  Future<void> seekTo(int playerId, Duration position) async {}
  @override
  Future<Duration> getPosition(int playerId) async => Duration.zero;
  @override
  Widget buildViewWithOptions(VideoViewOptions options) =>
      const SizedBox.expand();
}

void main() {
  for (final type in ['video', 'short']) {
    testWidgets(
      '$type preview is muted, loops, and releases offscreen and behind routes',
      (tester) async {
        final original = VideoPlayerPlatform.instance;
        final players = _Players();
        VideoPlayerPlatform.instance = players;
        addTearDown(() => VideoPlayerPlatform.instance = original);
        final scroll = ScrollController();
        addTearDown(scroll.dispose);
        final navigator = GlobalKey<NavigatorState>();
        await tester.pumpWidget(
          MaterialApp(
            navigatorKey: navigator,
            navigatorObservers: [appRouteObserver],
            home: Scaffold(
              body: SingleChildScrollView(
                controller: scroll,
                child: Column(
                  children: [
                    SizedBox(
                      height: 160,
                      width: 300,
                      child: MutedVideoPreview(
                        video: {
                          'id': type,
                          'videoType': type,
                          'streamUrl': 'https://example.test/video.mp4',
                        },
                      ),
                    ),
                    const SizedBox(height: 2000),
                  ],
                ),
              ),
            ),
          ),
        );
        await tester.pumpAndSettle();
        expect(players.playing, isNotEmpty);
        expect(players.volumes.values, everyElement(0));
        expect(players.loops.values, everyElement(true));
        navigator.currentState!.push(
          MaterialPageRoute<void>(
            builder: (_) => const Scaffold(body: Text('Next route')),
          ),
        );
        await tester.pumpAndSettle();
        await tester.runAsync(() => Future<void>.delayed(Duration.zero));
        expect(players.playing, isEmpty);
        navigator.currentState!.pop();
        await tester.pumpAndSettle();
        expect(players.playing, isNotEmpty);
        scroll.jumpTo(1000);
        await tester.pumpAndSettle();
        await tester.runAsync(() => Future<void>.delayed(Duration.zero));
        expect(players.playing, isEmpty);
        expect(players.streams, isEmpty);
        await tester.pumpWidget(const SizedBox.shrink());
        await tester.pumpAndSettle();
      },
    );
  }

  testWidgets('existing thumbnail does not start a video preview', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: VideoCard(
            video: const {
              'id': 'image',
              'thumbnailUrl': 'https://example.test/thumb.jpg',
            },
            onTap: () {},
          ),
        ),
      ),
    );
    expect(find.byType(MutedVideoPreview), findsNothing);
    expect(find.byType(Image), findsOneWidget);
    await tester.pumpWidget(const SizedBox.shrink());
  });

  testWidgets('home feed previews videos without thumbnails and keeps uploaded images still', (tester) async {
    tester.view.physicalSize = const Size(430, 1600);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final original = VideoPlayerPlatform.instance;
    final players = _Players();
    VideoPlayerPlatform.instance = players;
    addTearDown(() => VideoPlayerPlatform.instance = original);
    final client = MockClient((request) async {
      final Object body = switch (request.url.path) {
        '/api/videos' => [
          {
            'id': 'preview',
            'title': 'Creator video without thumbnail',
            'streamUrl': 'https://example.test/video.mp4',
            'creatorProfile': {'id': 'creator', 'displayName': 'Creator'},
          },
          {
            'id': 'still',
            'title': 'Creator video with thumbnail',
            'thumbnailUrl': 'https://example.test/thumb.jpg',
            'streamUrl': 'https://example.test/still.mp4',
          },
        ],
        _ => [],
      };
      return http.Response(jsonEncode(body), 200);
    });
    await http.runWithClient(() async {
      await tester.pumpWidget(MaterialApp(
        navigatorObservers: [appRouteObserver],
        home: const HomeScreen(),
      ));
      for (var i = 0; i < 10; i++) {
        await tester.pump(const Duration(milliseconds: 200));
      }
      expect(find.byType(MutedVideoPreview), findsOneWidget);
      expect(players.playing, hasLength(1));
      expect(players.volumes.values, everyElement(0));
      expect(players.loops.values, everyElement(true));
      expect(find.text('Creator video with thumbnail'), findsOneWidget);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pumpAndSettle();
      await tester.runAsync(() => Future<void>.delayed(Duration.zero));
      expect(players.playing, isEmpty);
    }, () => client);
  });

  testWidgets('creator profile separates Videos and Simply with 24px icons', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(430, 1600);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final client = MockClient(
      (request) async => http.Response(
        jsonEncode({
          'videos': [
            {
              'id': 'normal',
              'title': 'Normal',
              'thumbnailUrl': 'https://example.test/one.jpg',
            },
            {
              'id': 'short',
              'title': 'Short',
              'videoType': 'short',
              'thumbnailUrl': 'https://example.test/two.jpg',
            },
          ],
        }),
        200,
      ),
    );
    await http.runWithClient(() async {
      await tester.pumpWidget(
        const MaterialApp(
          home: CreatorScreen(
            creator: {'id': 'creator', 'displayName': 'Creator'},
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Videos'), findsOneWidget);
      expect(find.text('Simply'), findsOneWidget);
      expect(
        tester.getTopLeft(find.text('Normal')).dy,
        lessThan(tester.getTopLeft(find.text('Simply')).dy),
      );
      expect(
        tester.getTopLeft(find.text('Short')).dy,
        greaterThan(tester.getTopLeft(find.text('Simply')).dy),
      );
      expect(
        tester.widget<Icon>(find.byIcon(Icons.video_library_outlined)).size,
        24,
      );
      expect(
        tester.widget<Icon>(find.byIcon(Icons.play_circle_outline)).size,
        24,
      );
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
    }, () => client);
  });
}
