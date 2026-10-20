diff --git a/mobile/test/ads_test.dart b/mobile/test/ads_test.dart
index e996b7f..369e283 100644
--- a/mobile/test/ads_test.dart
+++ b/mobile/test/ads_test.dart
@@ -11,13 +11,19 @@ import 'package:video_player_platform_interface/video_player_platform_interface.
 import 'package:zinda_play/ads.dart';
 
 class _AdPlayer extends VideoPlayerPlatform {
+  bool initializeAutomatically = true;
+  int creations = 0;
+  int disposals = 0;
   late final StreamController<VideoEvent> events = StreamController<VideoEvent>(
-    onListen: () => events.add(
-      VideoEvent(
-        eventType: VideoEventType.initialized,
-        duration: const Duration(seconds: 3),
-        size: const Size(720, 1280),
-      ),
+    onListen: () {
+      if (initializeAutomatically) initialize();
+    },
+  );
+  void initialize() => events.add(
+    VideoEvent(
+      eventType: VideoEventType.initialized,
+      duration: const Duration(seconds: 3),
+      size: const Size(720, 1280),
     ),
   );
   Duration position = Duration.zero;
@@ -25,11 +31,19 @@ class _AdPlayer extends VideoPlayerPlatform {
   @override
   Future<void> init() async {}
   @override
-  Future<int?> createWithOptions(VideoCreationOptions options) async => 1;
+  Future<int?> createWithOptions(VideoCreationOptions options) async {
+    creations++;
+    return 1;
+  }
+
   @override
   Stream<VideoEvent> videoEventsFor(int playerId) => events.stream;
   @override
-  Future<void> dispose(int playerId) async => events.close();
+  Future<void> dispose(int playerId) async {
+    disposals++;
+    await events.close();
+  }
+
   @override
   Future<void> play(int playerId) async {
     playing = true;
@@ -57,6 +71,106 @@ class _AdPlayer extends VideoPlayerPlatform {
 
 void main() {
   setUp(() => FlutterSecureStorage.setMockInitialValues({}));
+  testWidgets(
+    'creator media prepares concurrently with ticket and waits for claim before playing',
+    (tester) async {
+      final player = _AdPlayer()..initializeAutomatically = false;
+      VideoPlayerPlatform.instance = player;
+      final ticket = Completer<http.Response>();
+      final claim = Completer<http.Response>();
+      final calls = <String>[];
+      final client = MockClient((request) async {
+        calls.add(request.url.path);
+        if (request.url.path.endsWith('/view-start')) return ticket.future;
+        if (request.url.path.endsWith('/impression')) return claim.future;
+        return http.Response(
+          jsonEncode([
+            {
+              'id': 'parallel-ad',
+              'creatorVideoId': 'creator-video',
+              'frequency': 1,
+              'mediaUrl': 'https://example.test/ad.mp4',
+              'skippable': false,
+            },
+          ]),
+          200,
+        );
+      });
+      await http.runWithClient(() async {
+        await tester.pumpWidget(
+          MaterialApp(
+            home: Scaffold(
+              body: SizedBox(
+                width: 320,
+                height: 180,
+                child: PlayerGate(builder: (_) => const Text('Content')),
+              ),
+            ),
+          ),
+        );
+        await tester.pump();
+        await tester.pump();
+        expect(player.creations, 1);
+        expect(calls, contains('/api/ads/parallel-ad/view-start'));
+        expect(calls.any((path) => path.endsWith('/impression')), isFalse);
+        expect(player.playing, isFalse);
+        ticket.complete(
+          http.Response(
+            '{"ticket":"parallel-ticket","minimumWatchMs":3000}',
+            200,
+          ),
+        );
+        await tester.pump();
+        expect(calls.any((path) => path.endsWith('/impression')), isFalse);
+        player.initialize();
+        await tester.pump();
+        await tester.pump();
+        expect(calls, contains('/api/ads/parallel-ad/impression'));
+        expect(player.playing, isFalse);
+        claim.complete(http.Response('{"accepted":true}', 200));
+        await tester.pumpAndSettle();
+        expect(player.playing, isTrue);
+        await tester.pumpWidget(const SizedBox.shrink());
+        expect(player.disposals, 1);
+      }, () => client);
+    },
+  );
+
+  testWidgets(
+    'slow ad lookup offers recovery at 15 seconds and late results cannot play',
+    (tester) async {
+      final player = _AdPlayer();
+      VideoPlayerPlatform.instance = player;
+      final response = Completer<http.Response>();
+      await http.runWithClient(() async {
+        await tester.pumpWidget(
+          MaterialApp(
+            home: Scaffold(
+              body: PlayerGate(builder: (_) => const Text('Content')),
+            ),
+          ),
+        );
+        await tester.pump(const Duration(seconds: 14));
+        expect(find.text('Continue to video'), findsNothing);
+        await tester.pump(const Duration(seconds: 1));
+        expect(find.text('Continue to video'), findsOneWidget);
+        await tester.tap(find.text('Continue to video'));
+        await tester.pump();
+        expect(find.text('Content'), findsOneWidget);
+        response.complete(
+          http.Response(
+            '[{"id":"late-ad","mediaUrl":"https://example.test/ad.mp4"}]',
+            200,
+          ),
+        );
+        await tester.pumpAndSettle();
+        expect(player.creations, 0);
+        expect(player.playing, isFalse);
+        await tester.pumpWidget(const SizedBox.shrink());
+      }, () => MockClient((_) => response.future));
+    },
+  );
+
   for (final placement in ['video', 'simply', 'home']) {
     testWidgets('$placement ads load only when active and pause offscreen', (
       tester,
