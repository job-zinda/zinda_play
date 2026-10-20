import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:video_player/video_player.dart';
import 'package:video_player_platform_interface/video_player_platform_interface.dart';
import 'package:zinda_play/playback.dart';
import 'package:zinda_play/widgets/normal_video_player.dart';

class _Player extends VideoPlayerPlatform {
  late final StreamController<VideoEvent> events = StreamController<VideoEvent>(
    onListen: () => events.add(
      VideoEvent(
        eventType: VideoEventType.initialized,
        duration: const Duration(seconds: 60),
        size: const Size(1280, 720),
      ),
    ),
  );
  final speeds = <double>[];
  bool playing = false;
  int disposed = 0;
  @override
  Future<void> init() async {}
  @override
  Future<int?> createWithOptions(VideoCreationOptions options) async => 1;
  @override
  Stream<VideoEvent> videoEventsFor(int playerId) => events.stream;
  @override
  Future<void> dispose(int playerId) async {
    disposed++;
    await events.close();
  }

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
  Future<void> setPlaybackSpeed(int playerId, double speed) async {
    speeds.add(speed);
  }

  @override
  Future<void> seekTo(int playerId, Duration position) async {}
  @override
  Future<Duration> getPosition(int playerId) async => Duration.zero;
  @override
  Widget buildViewWithOptions(VideoViewOptions options) =>
      const ColoredBox(color: Colors.black);
}

void main() {
  test(
    'Bunny speed, preload and quality cap preserve tokens and non-Bunny URLs',
    () {
      final url = Uri.parse(
        normalPlaybackUrl(
          'https://iframe.mediadelivery.net/embed/1/video?token=secret-test&expires=123&showSpeed=false&levelCap=false',
        ),
      );
      expect(url.queryParameters, {
        'token': 'secret-test',
        'expires': '123',
        'showSpeed': 'true',
        'levelCap': 'true',
        'preload': 'true',
      });
      for (final url in [
        'https://example.test/video.mp4?token=test',
        'https://example.test/embed/1',
      ]) {
        expect(normalPlaybackUrl(url), url);
      }
      expect(
        isDirectPlayback('https://example.test/video.M3U8?token=x'),
        isTrue,
      );
      expect(
        isDirectPlayback('https://iframe.mediadelivery.net/embed/1/video'),
        isFalse,
      );
      expect(playbackSpeeds, [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]);
    },
  );

  testWidgets(
    'direct video changes actual speed, keeps fullscreen and pauses in background',
    (tester) async {
      tester.view.physicalSize = const Size(320, 640);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final player = _Player();
      VideoPlayerPlatform.instance = player;
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: SizedBox(
              width: 320,
              height: 180,
              child: NormalVideoPlayer(
                source: 'https://example.test/video.mp4',
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      final rendered = tester.widget<VideoPlayer>(find.byType(VideoPlayer));
      rendered.controller.value = rendered.controller.value.copyWith(
        position: const Duration(milliseconds: 250),
      );
      await tester.pump();
      expect(
        identical(
          rendered,
          tester.widget<VideoPlayer>(find.byType(VideoPlayer)),
        ),
        isTrue,
      );
      rendered.controller.value = rendered.controller.value.copyWith(
        isBuffering: true,
      );
      await tester.pump();
      expect(find.byType(CircularProgressIndicator), findsOneWidget);
      rendered.controller.value = rendered.controller.value.copyWith(
        isBuffering: false,
      );
      await tester.pump();
      await tester.tap(find.byTooltip('Playback speed'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('2.0x'));
      await tester.pumpAndSettle();
      // The plugin keeps the speed in its own value while paused and only
      // forwards it to the platform once playback starts.
      expect(player.speeds, isEmpty);
      await tester.tap(find.byTooltip('Play video'));
      await tester.pump();
      await tester.pump();
      expect(player.playing, isTrue);
      expect(player.speeds.last, 2);
      await tester.tap(find.byTooltip('Fullscreen'));
      await tester.pumpAndSettle();
      expect(find.byTooltip('Exit fullscreen'), findsOneWidget);
      expect(player.playing, isTrue);
      final fullscreenPlayer = tester
          .widgetList<VideoPlayer>(
            find.byType(VideoPlayer, skipOffstage: false),
          )
          .last;
      fullscreenPlayer.controller.value = fullscreenPlayer.controller.value
          .copyWith(position: const Duration(milliseconds: 500));
      await tester.pump();
      expect(
        identical(
          fullscreenPlayer,
          tester
              .widgetList<VideoPlayer>(
                find.byType(VideoPlayer, skipOffstage: false),
              )
              .last,
        ),
        isTrue,
      );
      await tester.tap(find.byTooltip('Exit fullscreen'));
      await tester.pumpAndSettle();
      expect(find.text('2.0x'), findsOneWidget);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
      await tester.pump();
      expect(player.playing, isFalse);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pump();
      await tester.runAsync(() => Future<void>.delayed(Duration.zero));
      expect(player.disposed, 1);
      expect(tester.takeException(), isNull);
    },
  );
}
